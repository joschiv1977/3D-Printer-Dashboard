#!/bin/bash
#
# 3D Printer Web App - Complete One-Click Installer
# Supports: Raspberry Pi, Ubuntu, Debian, Generic Linux
# Includes: Docker, Spoolman, FCM Setup, Cloudflare Tunnel
#
# Version: 3.0.0
# Author: Speed-Knuffel Community
#

# NOTE: set -e is DISABLED for robust error handling
# We use retry_or_skip() function instead which allows:
# - Retry failed components
# - Skip non-critical components
# - Continue installation with warnings

# ============================================================================
# CONFIGURATION
# ============================================================================

VERSION="3.0.0"
REPO_URL="https://github.com/joschiv1977/3D-Printer-Dashboard"
APP_DIR="/opt/printer-web-app"
SERVICE_NAME="printer-web-app"
PYTHON_MIN_VERSION="3.9"
LOG_FILE="/tmp/printer-app-install.log"

# ============================================================================
# COLORS & FORMATTING
# ============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

# Unicode symbols
CHECK_MARK="✓"
CROSS_MARK="✗"
ARROW="➜"
PACKAGE="📦"
ROCKET="🚀"
WRENCH="🔧"
LOCK="🔒"
FIRE="🔥"
DOCKER="🐳"
CLOUD="☁️"

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

print_banner() {
    # Without a terminal (ssh plus sudo set TERM=unknown) clear reports
    # "'unknown': I need something more specific." -- about the worst
    # possible opening line for an installer.
    clear 2>/dev/null || true
    echo -e "${CYAN}"
    cat << "EOF"
    _____ ____    ____       _       __
   |__  // __ \  / __ \_____(_)___  / /____  _____
    /_ </ / / / / /_/ / ___/ / __ \/ __/ _ \/ ___/
  ___/ / /_/ / / ____/ /  / / / / / /_/  __/ /
 /____/_____/ /_/   /_/  /_/_/ /_/\__/\___/_/

EOF
    echo -e "    3D Printer Dashboard"
    echo -e "    Complete One-Click Installation System"
    echo -e "${NC}"
    echo -e "${WHITE}    Universal Installer v${VERSION}${NC}"
    echo -e "${BLUE}    ═══════════════════════════════════════${NC}"
    echo
}

# ============================================================================
# ROBUST ERROR HANDLING & INSTALLATION TRACKING
# ============================================================================

# Arrays to track installation status
declare -a INSTALL_SUCCESS=()
declare -a INSTALL_FAILED=()
declare -a INSTALL_SKIPPED=()

# Add component to tracking lists
track_success() { INSTALL_SUCCESS+=("$1"); }
track_failure() { INSTALL_FAILED+=("$1"); }
track_skipped() { INSTALL_SKIPPED+=("$1"); }

# Retry or Skip prompt - ALL IN ENGLISH
# Usage: retry_or_skip "Component Name" <command>
# Returns: 0 if successful, 1 if skipped, 2 if aborted
retry_or_skip() {
    local component_name="$1"
    shift  # Remove first argument, rest is the command
    local command="$@"
    local max_retries=3
    local retry_count=0

    while [ $retry_count -lt $max_retries ]; do
        # Try to execute the command
        if eval "$command"; then
            track_success "$component_name"
            return 0
        fi

        # Command failed
        retry_count=$((retry_count + 1))

        if [ $retry_count -lt $max_retries ]; then
            echo
            print_error "$component_name failed (Attempt $retry_count/$max_retries)"
            echo
            echo -e "${CYAN}What do you want to do?${NC}"
            echo -e "  ${GREEN}1)${NC} Retry - Try again"
            echo -e "  ${YELLOW}2)${NC} Skip - Continue without this component"
            echo -e "  ${RED}3)${NC} Abort - Stop installation"
            echo

            read -p "Choose [1-3]: " -n 1 -r choice
            echo
            echo

            case "$choice" in
                1)
                    print_status "Retrying $component_name..."
                    sleep 1
                    continue
                    ;;
                2)
                    print_warning "$component_name skipped"
                    track_skipped "$component_name"
                    return 1
                    ;;
                3)
                    print_error "Installation aborted by user"
                    track_failure "$component_name"
                    show_installation_summary
                    exit 1
                    ;;
                *)
                    print_warning "Invalid choice, trying again..."
                    continue
                    ;;
            esac
        fi
    done

    # Max retries reached
    echo
    print_error "$component_name failed after $max_retries attempts"
    echo
    echo -e "${CYAN}What do you want to do?${NC}"
    echo -e "  ${YELLOW}1)${NC} Skip - Continue without this component"
    echo -e "  ${RED}2)${NC} Abort - Stop installation"
    echo

    read -p "Choose [1-2]: " -n 1 -r choice
    echo
    echo

    case "$choice" in
        1)
            print_warning "$component_name skipped"
            track_skipped "$component_name"
            return 1
            ;;
        *)
            print_error "Installation aborted"
            track_failure "$component_name"
            show_installation_summary
            exit 1
            ;;
    esac
}

# Show installation summary at the end
show_installation_summary() {
    echo
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}📊 INSTALLATION SUMMARY${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo

    # Successful installations
    if [ ${#INSTALL_SUCCESS[@]} -gt 0 ]; then
        echo -e "${GREEN}✓ Successfully installed (${#INSTALL_SUCCESS[@]}):${NC}"
        for component in "${INSTALL_SUCCESS[@]}"; do
            echo -e "  ${GREEN}•${NC} $component"
        done
        echo
    fi

    # Skipped installations
    if [ ${#INSTALL_SKIPPED[@]} -gt 0 ]; then
        echo -e "${YELLOW}⊘ Skipped (${#INSTALL_SKIPPED[@]}):${NC}"
        for component in "${INSTALL_SKIPPED[@]}"; do
            echo -e "  ${YELLOW}•${NC} $component"
        done
        echo
    fi

    # Failed installations
    if [ ${#INSTALL_FAILED[@]} -gt 0 ]; then
        echo -e "${RED}✗ Failed (${#INSTALL_FAILED[@]}):${NC}"
        for component in "${INSTALL_FAILED[@]}"; do
            echo -e "  ${RED}•${NC} $component"
        done
        echo
    fi

    # Overall status
    if [ ${#INSTALL_FAILED[@]} -eq 0 ] && [ ${#INSTALL_SKIPPED[@]} -eq 0 ]; then
        echo -e "${GREEN}🎉 All components installed successfully!${NC}"
    elif [ ${#INSTALL_FAILED[@]} -eq 0 ]; then
        echo -e "${YELLOW}⚠️  Installation completed with warnings${NC}"
        echo -e "${YELLOW}   Some components were skipped${NC}"
    else
        echo -e "${RED}❌ Installation completed with errors${NC}"
        echo -e "${YELLOW}   Please check the failed components${NC}"
    fi

    echo
    echo -e "${CYAN}========================================${NC}"
    echo
}

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

print_status() {
    echo -e "${BLUE}[${WHITE}INFO${BLUE}]${NC} $1"
    log "INFO: $1"
}

print_success() {
    echo -e "${GREEN}[${WHITE}${CHECK_MARK}${GREEN}]${NC} $1"
    log "SUCCESS: $1"
}

print_warning() {
    echo -e "${YELLOW}[${WHITE}!${YELLOW}]${NC} $1"
    log "WARNING: $1"
}

print_error() {
    echo -e "${RED}[${WHITE}${CROSS_MARK}${RED}]${NC} $1"
    log "ERROR: $1"
}

print_step() {
    echo
    echo -e "${PURPLE}${ARROW} $1${NC}"
    echo -e "${BLUE}════════════════════════════════════════${NC}"
    log "STEP: $1"
}

spinner() {
    local pid=$1
    local delay=0.1
    local spinstr='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    while [ "$(ps a | awk '{print $1}' | grep $pid)" ]; do
        local temp=${spinstr#?}
        printf " [%c]  " "$spinstr"
        local spinstr=$temp${spinstr%"$temp"}
        sleep $delay
        printf "\b\b\b\b\b\b"
    done
    printf "    \b\b\b\b"
}

prompt_yes_no() {
    local prompt="$1"
    local default="${2:-n}"
    local yes_char="Y"
    local no_char="N"
    local yes_pattern="^[Yy]$"
    local no_pattern="^[Nn]$"

    # Detect German locale and use J/N instead of Y/N
    if [[ "$LANG" =~ ^de || "$LC_ALL" =~ ^de || "$LC_MESSAGES" =~ ^de ]]; then
        yes_char="J"
        no_char="N"
        yes_pattern="^[JjYy]$"  # Accept both J and Y for German
        no_pattern="^[Nn]$"
    fi

    # Build prompt with localized characters
    if [ "$default" = "y" ]; then
        prompt="$prompt [${yes_char}/${no_char,,}]: "
    else
        prompt="$prompt [${yes_char,,}/${no_char}]: "
    fi

    # Loop until valid input
    while true; do
        read -p "$prompt" -n 1 -r
        echo

        # Empty input = use default
        if [ -z "$REPLY" ]; then
            if [ "$default" = "y" ]; then
                return 0
            else
                return 1
            fi
        fi

        # Check for valid yes
        if [[ $REPLY =~ $yes_pattern ]]; then
            return 0
        fi

        # Check for valid no
        if [[ $REPLY =~ $no_pattern ]]; then
            return 1
        fi

        # Invalid input - ask again
        echo -e "${YELLOW}[!]${NC} Invalid input. Please enter ${yes_char} or ${no_char} (or press Enter)."
    done
}

# ============================================================================
# SYSTEM DETECTION
# ============================================================================

detect_platform() {
    if [ -f /proc/device-tree/model ] && grep -q "Raspberry Pi" /proc/device-tree/model; then
        echo "raspberry"
    elif [ -f /etc/os-release ]; then
        . /etc/os-release
        case "$ID" in
            ubuntu) echo "ubuntu" ;;
            debian) echo "debian" ;;
            *) echo "linux" ;;
        esac
    else
        echo "linux"
    fi
}

get_distro() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        echo "$ID"
    else
        echo "unknown"
    fi
}

check_root() {
    if [ "$EUID" -ne 0 ]; then
        print_error "Please run as root or with sudo"
        exit 1
    fi
}

# The interpreter everything runs on. require_python() sets it, and every
# call site uses it from then on.
PYTHON_BIN="python3"

benoetigte_python_fassung() {
    # The version sits in the shipped modules' file names:
    # `web_app.cpython-313-aarch64-linux-gnu.so` means 3.13. Reading it here
    # instead of writing a number into the script means a new build moves the
    # requirement along with it.
    # Nothing has been copied to $APP_DIR yet at check time — clone_repository
    # runs later. So look where the script itself sits; that is where the
    # modules come from. $APP_DIR is the fallback for a later re-run.
    local datei
    for ort in "$SCRIPT_DIR" "$APP_DIR"; do
        [ -n "$ort" ] && [ -d "$ort" ] || continue
        datei=$(find "$ort" -maxdepth 3 -name '*.cpython-3*-*.so' 2>/dev/null | head -1)
        [ -n "$datei" ] && break
    done
    [ -n "$datei" ] || return 1
    basename "$datei" | sed -E 's/.*cpython-3([0-9]+)-.*/3.\1/'
}

require_python() {
    local noetig
    noetig=$(benoetigte_python_fassung)

    if [ -z "$noetig" ]; then
        # No compiled module found — source install. That runs on any
        # reasonably recent version.
        local hier
        hier=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "none")
        print_status "Source installation, Python $hier"
        return 0
    fi

    local kandidat
    for kandidat in "python$noetig" "/usr/bin/python$noetig" python3; do
        command -v "$kandidat" > /dev/null 2>&1 || continue
        if [ "$("$kandidat" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null)" = "$noetig" ]; then
            PYTHON_BIN="$kandidat"
            print_success "Python $noetig found: $(command -v "$kandidat")"
            return 0
        fi
    done

    local gefunden
    gefunden=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "none")
    print_error "Python $noetig is required, this machine runs $gefunden."
    echo
    echo -e "  The shipped modules are named ${CYAN}cpython-${noetig//./}-...so${NC} and load"
    echo -e "  ONLY under exactly that version — another one will not even see them."
    echo
    echo -e "  ${WHITE}Debian/Ubuntu, if that version is available:${NC}"
    echo -e "    ${CYAN}sudo apt-get install python$noetig python$noetig-venv python$noetig-dev${NC}"
    echo -e "  ${WHITE}Ubuntu, if not:${NC} the deadsnakes PPA"
    echo -e "    ${CYAN}sudo add-apt-repository ppa:deadsnakes/ppa && sudo apt-get update${NC}"
    echo -e "  ${WHITE}Debian, if not:${NC} deadsnakes does NOT exist there."
    echo -e "    Either pyenv (${CYAN}curl https://pyenv.run | bash${NC}) or compile it yourself."
    echo
    echo -e "  Or rebuild the modules for $gefunden:"
    echo -e "    ${CYAN}PY_FASSUNG=$gefunden ./build_docker.sh${NC}  (on the development machine)"
    return 1
}

check_python_version() {
    local required=$1
    if command -v python3 &> /dev/null; then
        local version=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
        if [ "$(printf '%s\n' "$required" "$version" | sort -V | head -n1)" = "$required" ]; then
            return 0
        fi
    fi
    return 1
}

# ============================================================================
# DOCKER INSTALLATION
# ============================================================================

check_docker() {
    if command -v docker &> /dev/null && command -v docker-compose &> /dev/null; then
        return 0
    fi
    return 1
}

install_docker() {
    print_step "${DOCKER} Install Docker & Docker Compose"

    if check_docker; then
        print_success "Docker is already installed"
        docker --version
        docker-compose --version 2>/dev/null || docker compose version
        return 0
    fi

    # Check if running in LXC
    if [ -f /proc/1/environ ] && grep -qa container=lxc /proc/1/environ; then
        print_warning "LXC Container detected!"
        echo -e "${YELLOW}Docker in LXC requires special configuration:${NC}"
        echo -e "${YELLOW}1. Container must have: features: nesting=1,keyctl=1${NC}"
        echo -e "${YELLOW}2. Edit LXC config: pct set <CTID> -features nesting=1,keyctl=1${NC}"
        echo -e "${YELLOW}3. Reboot container after config change${NC}"
        echo
        read -p "Continue with Docker installation? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_warning "Skipping Docker installation"
            return 1
        fi
    fi

    print_status "Installing Docker..."

    # Add Docker's official GPG key
    sudo apt-get update > /dev/null 2>&1
    sudo apt-get install -y ca-certificates curl gnupg > /dev/null 2>&1 &
    spinner $!

    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/$(get_distro)/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg > /dev/null 2>&1
    sudo chmod a+r /etc/apt/keyrings/docker.gpg

    # Determine Docker repository codename
    # Debian 13 (trixie) not yet supported by Docker, use bookworm (Debian 12)
    . /etc/os-release
    DOCKER_CODENAME="$VERSION_CODENAME"
    if [ "$VERSION_CODENAME" = "trixie" ]; then
        print_warning "Debian 13 (trixie) detected - using Debian 12 (bookworm) Docker repository"
        DOCKER_CODENAME="bookworm"
    fi

    # Add repository
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$(get_distro) \
      $DOCKER_CODENAME stable" | \
      sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    # Install Docker Engine
    sudo apt-get update > /dev/null 2>&1
    if ! sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin > /dev/null 2>&1; then
        print_error "Failed to install Docker packages"
        echo "Trying to get more info..."
        sudo apt-get install -y docker-ce docker-ce-cli containerd.io
        return 1
    fi

    # Install docker-compose standalone for compatibility
    sudo curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
        -o /usr/local/bin/docker-compose > /dev/null 2>&1
    sudo chmod +x /usr/local/bin/docker-compose

    # Add user to docker group
    sudo usermod -aG docker ${SUDO_USER:-$(whoami)}

    # Start Docker service
    if ! sudo systemctl start docker; then
        print_error "Failed to start Docker service"
        echo "Checking Docker logs..."
        sudo journalctl -xeu docker.service --no-pager | tail -20
        return 1
    fi
    sudo systemctl enable docker > /dev/null 2>&1

    # Test Docker
    if ! sudo docker run --rm hello-world > /dev/null 2>&1; then
        print_warning "Docker installed but test container failed"
        print_warning "This is common in LXC - may need container restart"
    else
        print_success "Docker successfully installed and tested"
    fi

    docker --version
    docker-compose --version 2>/dev/null || docker compose version

    print_warning "IMPORTANT: Log out and log back in for Docker group to take effect!"
    print_warning "Or run: newgrp docker"
}

# ============================================================================
# SPOOLMAN INSTALLATION
# ============================================================================

install_spoolman() {
    print_step "${DOCKER} Install Spoolman Filament Manager"

    # Is Spoolman already running here? Then keep hands off.
    #
    # The docker-compose.yml written below claims the container name
    # "spoolman" and port 7912, and points the volume at a freshly created,
    # EMPTY data directory. On a machine that has been running Spoolman for a
    # while this step would have displaced the existing installation and made
    # its spools vanish from the interface. Found on 01sep26 while rebuilding
    # the Pi, before it could happen -- configure_app further down already
    # probes for a running Spoolman and picks up its URL by itself.
    local vorhandene_ip=$(hostname -I | awk '{print $1}')
    if sudo docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "spoolman" \
       || curl -s -o /dev/null --max-time 3 "http://127.0.0.1:7912/" 2>/dev/null; then
        print_warning "Spoolman is already running here -- left untouched"
        print_status "   Using the existing instance: http://${vorhandene_ip}:7912"
        return 0
    fi

    if ! check_docker; then
        print_error "Docker must be installed first!"
        return 1
    fi

    print_status "Setting up Spoolman..."

    # Create data directory
    sudo mkdir -p "$APP_DIR/spoolman_data"
    sudo chown -R ${SUDO_USER:-$(whoami)}:${SUDO_USER:-$(whoami)} "$APP_DIR/spoolman_data"

    # Check if docker-compose.yml exists
    if [ ! -f "$APP_DIR/docker-compose.yml" ]; then
        print_status "Creating docker-compose.yml..."
        cat > "$APP_DIR/docker-compose.yml" << 'EOF'
version: '3.8'

services:
  spoolman:
    image: ghcr.io/donkie/spoolman:latest
    container_name: spoolman
    restart: unless-stopped
    volumes:
      - /opt/printer-web-app/spoolman_data:/home/app/.local/share/spoolman
    ports:
      - "7912:8000"
    environment:
      - TZ=Europe/Berlin
    networks:
      - printer-network

networks:
  printer-network:
    driver: bridge
EOF
    fi

    # Start Spoolman (try both docker-compose and docker compose)
    cd "$APP_DIR"
    print_status "Starting Spoolman container..."

    if command -v docker-compose &> /dev/null; then
        sudo docker-compose up -d > /dev/null 2>&1 &
        spinner $!
    elif docker compose version &> /dev/null; then
        sudo docker compose up -d > /dev/null 2>&1 &
        spinner $!
    else
        print_error "Neither docker-compose nor docker compose plugin found"
        return 1
    fi

    # Wait for container to start
    print_status "Waiting for container to initialize..."
    sleep 5

    # Check if container is running
    if sudo docker ps | grep -q spoolman; then
        print_success "Spoolman is running on port 7912"
        echo -e "${GREEN}   ${ARROW} Web-UI: ${WHITE}http://$(hostname -I | awk '{print $1}'):7912${NC}"
    else
        print_error "Could not start Spoolman"
        echo "Checking container logs..."
        sudo docker logs spoolman 2>&1 | tail -20
        return 1
    fi
}

# ============================================================================
# CLOUDFLARE TUNNEL
# ============================================================================

install_cloudflare_tunnel() {
    print_step "${CLOUD} Setting up the Cloudflare tunnel"

    echo -e "${CYAN}Cloudflare Tunnel enables secure external access without port forwarding!${NC}"
    echo

    if ! prompt_yes_no "Do you want to install Cloudflare Tunnel?" "n"; then
        print_warning "Cloudflare Tunnel skipped"
        return 0
    fi

    # Install cloudflared
    print_status "Installing cloudflared..."

    # Download and install
    local ARCH=$(dpkg --print-architecture)
    curl -L "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb" \
        -o /tmp/cloudflared.deb > /dev/null 2>&1 &
    spinner $!

    sudo dpkg -i /tmp/cloudflared.deb > /dev/null 2>&1
    rm /tmp/cloudflared.deb

    print_success "cloudflared installed"

    echo
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}   CLOUDFLARE TUNNEL SETUP${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo
    echo -e "${WHITE}Follow these steps:${NC}"
    echo
    echo -e "${GREEN}1.${NC} Go to: ${CYAN}https://one.dash.cloudflare.com${NC}"
    echo -e "${GREEN}2.${NC} Log in or create an account (free)"
    echo -e "${GREEN}3.${NC} Zero Trust → Networks → Tunnels → Create a tunnel"
    echo -e "${GREEN}4.${NC} Name the tunnel (e.g. 'printer-dashboard')"
    echo -e "${GREEN}5.${NC} Choose: ${YELLOW}Debian (64-bit)${NC}"
    echo -e "${GREEN}6.${NC} Copy the command: ${CYAN}cloudflared service install <TOKEN>${NC}"
    echo
    echo -e "${YELLOW}Execute the command now:${NC}"
    echo -e "${WHITE}(The command looks like: cloudflared service install eyJh...)${NC}"
    echo
    read -p "Press Enter when you are ready..."

    echo
    echo -e "${CYAN}Paste the cloudflared installation command here:${NC}"
    read -p "> " CLOUDFLARED_CMD

    if [ -n "$CLOUDFLARED_CMD" ]; then
        eval $CLOUDFLARED_CMD

        echo
        echo -e "${GREEN}7.${NC} Back in dashboard: Configure the Public Hostnames:"
        echo
        echo -e "${CYAN}   Route 1 - Web Dashboard:${NC}"
        echo -e "    ${YELLOW}Subdomain:${NC} printer (or a name of your choice)"
        echo -e "    ${YELLOW}Domain:${NC} Choose your domain (e.g. example.com)"
        echo -e "    ${YELLOW}Service Type:${NC} HTTPS"
        echo -e "    ${YELLOW}URL:${NC} localhost:5555"
        echo -e "    ${YELLOW}No TLS Verify:${NC} ✓ (enable)"
        echo
        echo -e "${CYAN}   Route 2 - License Server (IMPORTANT!):${NC}"
        echo -e "    ${YELLOW}Subdomain:${NC} license"
        echo -e "    ${YELLOW}Domain:${NC} Same domain as above"
        echo -e "    ${YELLOW}Service Type:${NC} HTTPS"
        echo -e "    ${YELLOW}URL:${NC} localhost:5556"
        echo -e "    ${YELLOW}No TLS Verify:${NC} ✓ (enable)"
        echo
        echo -e "${GREEN}8.${NC} Click 'Save tunnel' for both routes"
        echo

        # Ask for the external domain
        echo
        echo -e "${CYAN}Configure the external domain:${NC}"
        read -p "Enter your external domain (for instance printer.mydomain.com): " EXTERNAL_DOMAIN
        # No fallback. What stood here was ONE domain -- the developer's --
        # and every installation that skipped the question got it written in.
        # Without an answer the tunnel simply stays unconfigured; the server
        # is reachable on the local network, which is what an installation
        # without a domain can be.
        if [ -z "$EXTERNAL_DOMAIN" ]; then
            print_warning "No domain given - the tunnel stays unconfigured."
            print_warning "The server remains reachable on the local network."
        fi

        # Enable and start service
        sudo systemctl enable cloudflared > /dev/null 2>&1
        sudo systemctl start cloudflared

        print_success "Cloudflare tunnel set up!"
        if [ -n "$EXTERNAL_DOMAIN" ]; then
            echo -e "${GREEN}   ${ARROW} Web Dashboard: ${WHITE}https://$EXTERNAL_DOMAIN${NC}"
            # Extract base domain for license server
            BASE_DOMAIN=$(echo "$EXTERNAL_DOMAIN" | sed 's/^[^.]*\.//')
            if [ -n "$BASE_DOMAIN" ] && [ "$BASE_DOMAIN" != "$EXTERNAL_DOMAIN" ]; then
                echo -e "${GREEN}   ${ARROW} License Server: ${WHITE}https://license.$BASE_DOMAIN${NC}"
            fi
        fi

    else
        print_warning "Cloudflare Tunnel setup skipped"
        EXTERNAL_DOMAIN=""
    fi
}

# ============================================================================
# SYSTEM DEPENDENCIES
# ============================================================================

wait_for_apt() {
    local max_wait=300  # 5 Minuten Maximum
    local waited=0
    local is_blocked=false

    # Check ONCE if apt is blocked
    if sudo fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || \
       sudo fuser /var/lib/dpkg/lock >/dev/null 2>&1 || \
       sudo fuser /var/lib/apt/lists/lock >/dev/null 2>&1; then
        is_blocked=true
    fi

    # If apt is NOT blocked, output nothing and return immediately
    if [ "$is_blocked" = false ]; then
        return 0
    fi

    # apt IS blocked - show a warning
    print_warning "apt is blocked (probably unattended-upgrades)"
    print_status "Waiting for apt to become available (max. 5 minutes)..."

    while sudo fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || \
          sudo fuser /var/lib/dpkg/lock >/dev/null 2>&1 || \
          sudo fuser /var/lib/apt/lists/lock >/dev/null 2>&1; do

        echo -ne "\r   ${YELLOW}Waiting for ${waited}s...${NC}"
        sleep 5
        waited=$((waited + 5))

        if [ $waited -ge $max_wait ]; then
            echo
            print_warning "apt is still blocked after ${max_wait}s"

            if prompt_yes_no "Do you want to stop unattended-upgrades?" "y"; then
                print_status "Stopping unattended-upgrades..."
                sudo systemctl stop unattended-upgrades 2>/dev/null || true
                sudo systemctl stop apt-daily.timer 2>/dev/null || true
                sudo systemctl stop apt-daily-upgrade.timer 2>/dev/null || true
                sudo killall apt apt-get 2>/dev/null || true
                sleep 3
                print_success "Automatic updates stopped"
                return 0
            else
                print_error "Installation cannot continue"
                return 1
            fi
        fi
    done

    echo
    print_success "apt is now available (waited ${waited}s)"

    return 0
}

install_system_deps() {
    print_step "${PACKAGE} Install System Dependencies"

    # Wait for apt to be available
    if ! wait_for_apt; then
        print_error "apt is not available"
        return 1
    fi

    # Detect Python version and add version-specific packages
    local PYTHON_VERSION=$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    print_status "Detected Python version: $PYTHON_VERSION"

    # IMPORTANT: python3.x-dev AND python3.x-venv must be version-specific!
    local PACKAGES="python3-pip python${PYTHON_VERSION}-venv python${PYTHON_VERSION}-dev git curl wget"
    # Debian 13 / Python 3.13: Explicit gcc, g++ needed for numpy compilation
    PACKAGES="$PACKAGES build-essential gcc g++ cmake libssl-dev libffi-dev"
    PACKAGES="$PACKAGES libjpeg-dev zlib1g-dev libfreetype6-dev"
    PACKAGES="$PACKAGES ffmpeg libgpiod-dev python3-pil"
    # Every name here has to exist on Debian 13 and Ubuntu 24.04: a single
    # unknown one makes apt drop the WHOLE transaction ("has no installation
    # candidate", exit 100), and nothing on this list gets installed (14sep26,
    # libgl1-mesa-glx). No xvfb/libgl1 any more -- they were for OrcaSlicer,
    # which is gone; Bambu Studio runs as a Flatpak with its own runtime.

    print_status "Packages to install:"
    echo -e "${CYAN}   Python: python${PYTHON_VERSION}-venv, python${PYTHON_VERSION}-dev${NC}"
    echo -e "${CYAN}   Build: build-essential, gcc, g++, cmake (for numpy/Pillow 11+)${NC}"
    echo -e "${CYAN}   Libs: libgpiod-dev, libssl-dev, libjpeg-dev, ...${NC}"

    print_status "Updating package lists..."
    local retry=0
    local max_retries=3
    local update_log="/tmp/apt_update_$$.log"

    while [ $retry -lt $max_retries ]; do
        print_status "Trying apt-get update (attempt $((retry + 1))/$max_retries)..."

        # Show the output AND log it
        sudo apt-get update 2>&1 | tee "$update_log"
        # PIPESTATUS, not the pipeline -- `if cmd | tee` only ever sees tee.
        if [ "${PIPESTATUS[0]}" -eq 0 ]; then
            print_success "Package lists updated"
            rm -f "$update_log"
            break
        else
            retry=$((retry + 1))
            if [ $retry -lt $max_retries ]; then
                print_warning "Update failed, attempt $retry/$max_retries"

                echo -e "${YELLOW}Recent errors:${NC}"
                tail -5 "$update_log" 2>/dev/null || echo "No error details available"

                print_status "Waiting 5 seconds and checking apt-locks..."
                sleep 5
                wait_for_apt
                sleep 2
            else
                print_error "Package list update failed after $max_retries attempts"
                echo -e "${RED}Complete error:${NC}"
                cat "$update_log" 2>/dev/null || echo "No error details available"
                rm -f "$update_log"

                echo -e "${YELLOW}Possible solutions:${NC}"
                echo -e "  1. Check network connection: ${CYAN}ping -c 3 google.com${NC}"
                echo -e "  2. Check DNS: ${CYAN}nslookup archive.ubuntu.com${NC}"
                echo -e "  3. Check apt sources: ${CYAN}sudo apt-get update${NC}"
                echo -e "  4. Resolve manual blocking: ${CYAN}sudo killall apt apt-get${NC}"
                return 1
            fi
        fi
    done

    print_status "Installing packages (this may take 5-10 minutes)..."

    # Install packages with retry logic
    retry=0
    while [ $retry -lt $max_retries ]; do
        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y $PACKAGES 2>&1 | tee -a "$LOG_FILE"
        # PIPESTATUS, not the pipeline: `if apt ... | tee` tests tee, which
        # always succeeds. Without pipefail a failed install was reported as
        # "Packages installed" and the script carried on with nothing
        # installed (14sep26).
        if [ "${PIPESTATUS[0]}" -eq 0 ]; then
            print_success "Packages installed"
            break
        else
            retry=$((retry + 1))
            if [ $retry -lt $max_retries ]; then
                print_warning "Installation failed, attempt $retry/$max_retries"
                wait_for_apt
                sleep 2
            else
                print_error "Package installation failed after $max_retries attempts"
                cat "$LOG_FILE" | tail -20
                return 1
            fi
        fi
    done

    # Verify python3-venv is working (including ensurepip!)
    print_status "Checking if python3-venv is available..."

    # Test 1: Check if venv module exists
    if ! "$PYTHON_BIN" -m venv --help > /dev/null 2>&1; then
        print_warning "venv module not found!"
        local venv_missing=true
    fi

    # Test 2: Check if ensurepip exists (required for venv creation)
    if ! "$PYTHON_BIN" -c "import ensurepip" > /dev/null 2>&1; then
        print_warning "ensurepip module not found!"
        print_warning "python${PYTHON_VERSION}-venv does not appear to be correctly installed"
        local ensurepip_missing=true
    fi

    # If either test failed, install the correct package
    if [ "$venv_missing" = true ] || [ "$ensurepip_missing" = true ]; then
        print_status "Installing python${PYTHON_VERSION}-venv and python3-venv..."

        # Install both version-specific and generic packages
        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "python${PYTHON_VERSION}-venv" python3-venv 2>&1 | tee -a "$LOG_FILE"
        if [ "${PIPESTATUS[0]}" -eq 0 ]; then
            print_success "python3-venv Packages installed"
        else
            print_error "Could not install python3-venv!"
            return 1
        fi

        # Verify again with both tests
        if ! "$PYTHON_BIN" -m venv --help > /dev/null 2>&1; then
            print_error "venv module is still not available!"
            print_status "Available python3 packages:"
            dpkg -l | grep python3 | grep -E "(venv|ensurepip)"
            return 1
        fi

        if ! "$PYTHON_BIN" -c "import ensurepip" > /dev/null 2>&1; then
            print_error "ensurepip is still not available!"
            print_status "Available python3 packages:"
            dpkg -l | grep python3 | grep -E "(venv|ensurepip)"
            echo
            echo -e "${YELLOW}Please install manually:${NC}"
            echo -e "  ${CYAN}sudo apt-get install python${PYTHON_VERSION}-venv${NC}"
            return 1
        fi

        print_success "python3-venv was successfully reinstalled"
    fi

    print_success "python3-venv and ensurepip are available"

    # Verify python-dev is installed (needed for compiling packages like gpiod)
    print_status "Checking if python${PYTHON_VERSION}-dev is installed..."
    if [ -f "/usr/include/python${PYTHON_VERSION}/Python.h" ]; then
        print_success "python${PYTHON_VERSION}-dev is installed"
    else
        print_warning "Python.h not found - python${PYTHON_VERSION}-dev may be missing"
        print_status "Trying to install python${PYTHON_VERSION}-dev..."

        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "python${PYTHON_VERSION}-dev" 2>&1 | tee -a "$LOG_FILE"
        if [ "${PIPESTATUS[0]}" -eq 0 ]; then
            if [ -f "/usr/include/python${PYTHON_VERSION}/Python.h" ]; then
                print_success "python${PYTHON_VERSION}-dev installed"
            else
                print_warning "python${PYTHON_VERSION}-dev installed, but Python.h not found"
                echo -e "${YELLOW}   Packages requiring Python.h (e.g. gpiod) will fail${NC}"
            fi
        else
            print_warning "Could not install python${PYTHON_VERSION}-dev"
            echo -e "${YELLOW}   Packages requiring Python.h (e.g. gpiod) will fail${NC}"
        fi
    fi


    # Verify ffmpeg installation
    print_status "Checking if ffmpeg is installed..."
    if ! command -v ffmpeg &> /dev/null; then
        print_warning "ffmpeg not found - will be reinstalled..."

        if ! wait_for_apt; then
            print_error "apt is not available"
            return 1
        fi

        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ffmpeg 2>&1 | tee -a "$LOG_FILE"
        if [ "${PIPESTATUS[0]}" -eq 0 ]; then
            if command -v ffmpeg &> /dev/null; then
                print_success "ffmpeg installed"
            else
                print_error "Could not install ffmpeg!"
                echo -e "${YELLOW}Please install manually: ${CYAN}sudo apt-get install ffmpeg${NC}"
                return 1
            fi
        else
            print_error "ffmpeg installation failed"
            return 1
        fi
    else
        print_success "ffmpeg is installed"
    fi

    print_success "System-Packages installed"
}

# ============================================================================
# BAMBU STUDIO (Flatpak) -- slices MakerWorld models on the server
# ============================================================================
# The MakerWorld import slices with Bambu Studio and its own printer profiles
# (services/slice_bambu.py). GitHub ships it for x86 Linux only; Flathub
# carries x86_64 and aarch64, so a Pi gets it the same way. The server finds
# it by itself (flatpak run, current/active). Measured on the Pi 5, 13sep26:
# a real MakerWorld project sliced headless in 3 s, same result as on a Mac.
install_bambustudio() {
    print_step "🔪 Bambu Studio (MakerWorld slicing)"
    if command -v flatpak &>/dev/null && flatpak info com.bambulab.BambuStudio &>/dev/null; then
        print_success "Bambu Studio already installed: $(flatpak info com.bambulab.BambuStudio | awk -F': *' '/Version/ {print $2; exit}')"
        return 0
    fi
    if ! prompt_yes_no "Install Bambu Studio to slice MakerWorld models on the server (~1.2 GB)?" "y"; then
        print_warning "Bambu Studio skipped - MakerWorld models can be fetched, not sliced"
        return 0
    fi
    print_status "Installing Flatpak and Bambu Studio from Flathub (takes a few minutes)..."
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y flatpak >> "$LOG_FILE" 2>&1
    sudo flatpak remote-add --if-not-exists flathub \
        https://dl.flathub.org/repo/flathub.flatpakrepo >> "$LOG_FILE" 2>&1
    sudo flatpak install -y --noninteractive flathub com.bambulab.BambuStudio >> "$LOG_FILE" 2>&1
    if flatpak info com.bambulab.BambuStudio &>/dev/null; then
        print_success "Bambu Studio installed: $(flatpak info com.bambulab.BambuStudio | awk -F': *' '/Version/ {print $2; exit}')"
    else
        print_warning "Bambu Studio could not be installed - MakerWorld models can be fetched, not sliced (log: $LOG_FILE)"
    fi
}

# ============================================================================
# APP INSTALLATION
# ============================================================================

setup_app_directory() {
    print_step "${WRENCH} Setting up the app directory"

    # Check for an INSTALLATION, not for the directory. install_spoolman
    # creates $APP_DIR itself and runs earlier, so on a fresh machine this
    # step would find "its own" old installation and bail out.
    local alt_vorhanden=false
    for beleg in start.py web_app.py dist venv; do
        [ -e "$APP_DIR/$beleg" ] && alt_vorhanden=true && break
    done

    if [ "$alt_vorhanden" = true ]; then
        print_warning "An installation already exists in $APP_DIR"
        if prompt_yes_no "Overwrite existing installation?" "n"; then
            print_status "Creating a backup..."
            sudo mv "$APP_DIR" "$APP_DIR.backup.$(date +%Y%m%d_%H%M%S)"
        else
            print_error "Installation cancelled"
            exit 1
        fi
    fi

    # Create directory
    sudo mkdir -p "$APP_DIR"
    sudo chown -R ${SUDO_USER:-$(whoami)}:${SUDO_USER:-$(whoami)} "$APP_DIR"

    # Create data directory for database, logs, and config files
    sudo mkdir -p "$APP_DIR/data"
    sudo chown -R ${SUDO_USER:-$(whoami)}:${SUDO_USER:-$(whoami)} "$APP_DIR/data"

    print_success "Directory created"
}

install_font_awesome() {
    print_status "Installing Font-Awesome locally..."

    cd "$APP_DIR"

    if [ ! -d "static" ]; then
        print_error "Static directory not found!"
        return 1
    fi

    # Download Font-Awesome if not present
    if [ ! -f "static/font-awesome.min.css" ]; then
        cd /tmp
        print_status "Downloading Font Awesome 6.5.1..."
        curl -L "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" \
            -o font-awesome.min.css > /dev/null 2>&1

        # Download webfonts too
        mkdir -p webfonts
        for font in fa-solid-900.woff2 fa-regular-400.woff2 fa-brands-400.woff2; do
            curl -L "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/$font" \
                -o "webfonts/$font" > /dev/null 2>&1
        done

        # Fix paths in CSS (CDN uses ../webfonts, we use /static/webfonts)
        sed -i 's|../webfonts|/static/webfonts|g' font-awesome.min.css

        # Move to static directory
        mv font-awesome.min.css "$APP_DIR/static/"
        mv webfonts "$APP_DIR/static/"

        print_success "Font-Awesome installed"
    else
        print_success "Font-Awesome already present"
    fi

    cd "$APP_DIR"
}

clone_repository() {
    print_step "Cloning the repository"

    # Check if script was started FROM a repo directory
    # Support both source (.py) and obfuscated (dist/.so) installations
    if [ -f "$SCRIPT_DIR/install.sh" ] && { [ -f "$SCRIPT_DIR/web_app.py" ] || [ -f "$SCRIPT_DIR/start.py" ] || [ -d "$SCRIPT_DIR/dist" ]; }; then
        print_status "Script is running from repository - copying files..."
        print_status "Source: $SCRIPT_DIR"

        # Detect installation type
        if [ -d "$SCRIPT_DIR/dist" ] && [ -f "$SCRIPT_DIR/start.py" ]; then
            print_status "Detected: an obfuscated installation (.so files)"
        elif [ -f "$SCRIPT_DIR/web_app.py" ]; then
            print_status "Detected: a source installation (.py files)"
        fi

        # Copy from the script directory to APP_DIR
        if [ "$SCRIPT_DIR" = "$APP_DIR" ]; then
            print_warning "Script is already running in $APP_DIR - skipping copy"
            cd "$APP_DIR"
            return 0
        fi

        # Create temp copy to avoid issues
        print_status "Copying the repository to $APP_DIR..."
        sudo cp -r "$SCRIPT_DIR"/* "$APP_DIR/"

        # Copy hidden files too (like .git if present)
        sudo cp -r "$SCRIPT_DIR"/.* "$APP_DIR/" 2>/dev/null || true

        sudo chown -R ${SUDO_USER:-$(whoami)}:${SUDO_USER:-$(whoami)} "$APP_DIR"

        cd "$APP_DIR"
        print_success "Repository files copied"
        return 0
    fi

    # Try to clone from GitHub
    print_status "Cloning from GitHub..."

    git clone "$REPO_URL" "$APP_DIR" 2>&1 | tee -a "$LOG_FILE"
    # PIPESTATUS: a failed clone used to count as success, and the rest of
    # the installation then ran against an empty folder.
    if [ "${PIPESTATUS[0]}" -eq 0 ]; then
        cd "$APP_DIR"
        print_success "Repository cloned"
    else
        print_warning "GitHub clone failed (private repo?)"

        # Check if repo exists in /tmp or common locations
        local POSSIBLE_PATHS=(
            "/tmp/3d-printer-web-app"
            "/media/psf/Home/user/3d-printer-web-app"
            "$HOME/3d-printer-web-app"
        )

        for path in "${POSSIBLE_PATHS[@]}"; do
            # Check for both source and obfuscated installations
            if [ -d "$path" ] && { [ -f "$path/web_app.py" ] || [ -f "$path/start.py" ] || [ -d "$path/dist" ]; }; then
                print_status "Found: $path - copying the files..."
                sudo cp -r "$path" "$APP_DIR"
                sudo chown -R ${SUDO_USER:-$(whoami)}:${SUDO_USER:-$(whoami)} "$APP_DIR"
                cd "$APP_DIR"
                print_success "Repository files copied"
                return 0
            fi
        done

        print_error "Repository could not be found!"
        echo
        echo -e "${YELLOW}Solutions:${NC}"
        echo -e "  1. Use quick-install.sh (downloads obfuscated .so files):"
        echo -e "     ${CYAN}curl -fsSL ${REPO_URL/github.com/raw.githubusercontent.com}/main/quick-install.sh -o quick-install.sh && bash quick-install.sh${NC}"
        echo
        echo -e "  2. Or clone the repo beforehand:"
        echo -e "     ${CYAN}git clone ${REPO_URL}.git${NC}"
        echo -e "     ${CYAN}cd $(basename "$REPO_URL")${NC}"
        echo -e "     ${CYAN}sudo ./install.sh${NC}"
        echo
        echo -e "  3. Or copy it into /tmp:"
        echo -e "     ${CYAN}cp -r /path/to/repo /tmp/3d-printer-web-app${NC}"
        echo -e "     ${CYAN}sudo /tmp/3d-printer-web-app/install.sh${NC}"
        echo
        return 1
    fi
}

set_script_permissions() {
    print_step "Setting the script permissions"

    cd "$APP_DIR"

    # Make shell scripts executable
    if [ -f "manage.sh" ]; then
        chmod +x manage.sh
        print_success "manage.sh is executable"
    fi

    if [ -f "tools/manage.sh" ]; then
        chmod +x tools/manage.sh
        print_success "tools/manage.sh is executable"
    fi

    # Make other scripts executable if they exist
    if [ -d "scripts" ]; then
        chmod +x scripts/*.sh 2>/dev/null || true
        print_success "Scripts in scripts/ are executable"
    fi
}

deploy_obfuscated_files() {
    print_step "Deploying obfuscated files"

    cd "$APP_DIR"

    # Check if this is an obfuscated installation
    if [ ! -d "dist" ]; then
        print_status "No dist/ folder found - skipping (source installation)"
        return 0
    fi

    print_status "Deploying compiled .so files from dist/..."

    # Copy all .so files from dist/ to their respective locations
    # dist/ already has the correct structure (routes/, services/, etc.)
    local so_count=0

    # Find all .so files in dist/
    while IFS= read -r -d '' so_file; do
        # Get relative path from dist/
        local rel_path="${so_file#dist/}"
        local target_dir=$(dirname "$rel_path")
        local target_file="$APP_DIR/$rel_path"

        # Create target directory if needed
        if [ "$target_dir" != "." ]; then
            mkdir -p "$APP_DIR/$target_dir"
        fi

        # Copy .so file to target location
        cp "$so_file" "$target_file"
        ((so_count++))

    done < <(find dist -name "*.so" -print0)

    if [ $so_count -gt 0 ]; then
        print_success "Deployed $so_count compiled .so files"
        print_status "Installation type: Obfuscated (binary)"
    else
        print_warning "No .so files found in dist/ - this may be an issue"
    fi
}

setup_python_env() {
    print_step "Setting up the Python virtual environment"

    cd "$APP_DIR"

    # Verify requirements.txt exists
    if [ ! -f "requirements.txt" ]; then
        print_error "requirements.txt not found in $APP_DIR"
        print_status "Available files:"
        ls -la "$APP_DIR" | head -20
        return 1
    fi

    # Check if venv module is available (should have been installed in install_system_deps)
    print_status "Checking python3-venv and ensurepip..."

    local PYTHON_VERSION=$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    local venv_ok=true

    # Test 1: venv module
    if ! "$PYTHON_BIN" -m venv --help > /dev/null 2>&1; then
        print_error "venv module is NOT available!"
        venv_ok=false
    fi

    # Test 2: ensurepip module (critical for venv creation)
    if ! "$PYTHON_BIN" -c "import ensurepip" > /dev/null 2>&1; then
        print_error "ensurepip is NOT available!"
        print_error "This is required for venv creation."
        venv_ok=false
    fi

    if [ "$venv_ok" = false ]; then
        print_error "python3-venv was not correctly installed in install_system_deps()."

        echo -e "${YELLOW}Last attempt: installing python3-venv packages...${NC}"
        echo -e "${CYAN}Trying the following packages:${NC}"
        echo -e "  1. python${PYTHON_VERSION}-venv (version-specific)"
        echo -e "  2. python3-venv (generic)"

        if ! wait_for_apt; then
            print_error "apt is not available"
            return 1
        fi

        # Try both packages
        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "python${PYTHON_VERSION}-venv" python3-venv 2>&1 | tee -a "$LOG_FILE"

        # Verify again - both tests
        if ! "$PYTHON_BIN" -m venv --help > /dev/null 2>&1; then
            print_error "Could not install venv module!"
            echo
            echo -e "${RED}Error diagnosis:${NC}"
            echo -e "Python version: ${YELLOW}$PYTHON_VERSION${NC}"
            echo -e "Python path: ${YELLOW}$(which python3)${NC}"
            echo
            echo -e "${CYAN}Installed Python packages:${NC}"
            dpkg -l | grep python3 | grep -E "(venv|ensurepip)" || echo "No venv/ensurepip packages found!"
            echo
            echo -e "${YELLOW}Please install manually:${NC}"
            echo -e "  ${CYAN}sudo apt-get install python${PYTHON_VERSION}-venv${NC}"
            return 1
        fi

        if ! "$PYTHON_BIN" -c "import ensurepip" > /dev/null 2>&1; then
            print_error "Could not install ensurepip!"
            echo
            echo -e "${RED}Error diagnosis:${NC}"
            echo -e "Python version: ${YELLOW}$PYTHON_VERSION${NC}"
            echo -e "Python path: ${YELLOW}$(which python3)${NC}"
            echo
            echo -e "${CYAN}Installed Python packages:${NC}"
            dpkg -l | grep python3 | grep -E "(venv|ensurepip)" || echo "No venv/ensurepip packages found!"
            echo
            echo -e "${YELLOW}Please install manually:${NC}"
            echo -e "  ${CYAN}sudo apt-get install python${PYTHON_VERSION}-venv${NC}"
            return 1
        fi

        print_success "python3-venv was reinstalled"
    else
        print_success "python3-venv and ensurepip are available"
    fi

    # Create venv
    print_status "Creating virtual environment..."
    "$PYTHON_BIN" -m venv venv 2>&1 | tee -a "$LOG_FILE"
    # PIPESTATUS: `if ! cmd | tee` negated tee, so a failed venv was never
    # noticed at all.
    if [ "${PIPESTATUS[0]}" -ne 0 ]; then
        print_error "VEnv could not be created"
        echo
        echo -e "${RED}Error diagnosis:${NC}"
        echo -e "Working directory: ${YELLOW}$(pwd)${NC}"
        echo -e "Permissions: ${YELLOW}$(ls -ld . | awk '{print $1, $3, $4}')${NC}"
        echo
        echo -e "${CYAN}Last error lines from log:${NC}"
        tail -10 "$LOG_FILE"
        return 1
    fi

    # Activate venv
    if [ ! -f "venv/bin/activate" ]; then
        print_error "venv/bin/activate not found"
        return 1
    fi

    source venv/bin/activate

    # Upgrade pip
    print_status "Updating pip..."
    pip install --upgrade pip > /dev/null 2>&1

    # Install requirements - SHOW OUTPUT!
    print_status "Installing Python packages (this may take 5-10 minutes)..."
    echo -e "${YELLOW}   (Progress will be shown, please wait...)${NC}"
    echo -e "${YELLOW}   Note: gpiod errors are OK (only needed for GPIO)${NC}"

    # pip ALWAYS returns exit code 0, even if individual packages fail!
    # Therefore: Do not rely on exit code, check output instead
    local pip_log="/tmp/pip_install_$$.log"
    pip install -r requirements.txt 2>&1 | tee "$pip_log"
    local pip_exit=$?

    # Check for critical errors in output
    if grep -q "ERROR: Failed building wheel for gpiod" "$pip_log"; then
        print_warning "gpiod could not be compiled (only needed for GPIO)"
        echo -e "${YELLOW}   This is normal on systems without GPIO hardware${NC}"
    fi

    if grep -q "Successfully installed" "$pip_log"; then
        print_status "Some packages were installed"
    else
        print_warning "No packages were installed - check logs"
    fi

    # Verify critical packages (WICHTIGSTER CHECK!)
    print_status "Verifying critical packages..."
    local CRITICAL_PACKAGES="flask flask-socketio paho-mqtt requests pillow"
    local missing=""

    for pkg in $CRITICAL_PACKAGES; do
        if ! pip show "$pkg" > /dev/null 2>&1; then
            missing="$missing $pkg"
        fi
    done

    if [ -n "$missing" ]; then
        print_error "Critical packages missing:$missing"
        echo
        echo -e "${RED}Error diagnosis:${NC}"
        echo -e "${CYAN}Last 30 lines from pip install:${NC}"
        tail -30 "$pip_log"
        echo
        echo -e "${YELLOW}Possible causes:${NC}"
        echo -e "  1. python${PYTHON_VERSION}-dev missing (for compilation)"
        echo -e "  2. Network problems during download"
        echo -e "  3. Missing build dependencies"
        echo
        echo -e "${CYAN}Diagnostic commands:${NC}"
        echo -e "  ${WHITE}python3 -c 'import Python'${NC}  # Checks Python.h"
        echo -e "  ${WHITE}dpkg -l | grep python${PYTHON_VERSION}-dev${NC}"
        echo -e "  ${WHITE}which gcc${NC}"
        rm -f "$pip_log"
        return 1
    fi

    # Check for optional packages
    print_status "Checking optional packages..."
    if ! pip show gpiod > /dev/null 2>&1; then
        print_warning "gpiod not installed (optional, only for GPIO)"
    else
        print_success "gpiod installed"
    fi

    rm -f "$pip_log"
    print_success "Python environment set up"
    print_status "Installed packages: $(pip list | wc -l)"
}

# ============================================================================
# CONFIGURATION
# ============================================================================

configure_app() {
    print_step "${WRENCH} Configuration"

    echo -e "${CYAN}Creating the initial configuration file...${NC}"
    echo -e "${YELLOW}⚠️  Printer and HomeAssistant will be configured later in web setup!${NC}"
    echo

    # Spoolman - Auto-detect if running
    echo
    echo -e "${YELLOW}━━━ Spoolman Filament Manager ━━━${NC}"

    # Check if Spoolman is running
    SPOOLMAN_URL=""
    LOCAL_IP=$(hostname -I | awk '{print $1}')

    if sudo docker ps | grep -q spoolman; then
        SPOOLMAN_URL="http://${LOCAL_IP}:7912"
        print_success "Spoolman detected at: $SPOOLMAN_URL"
        echo -e "${GREEN}   ✓ Container is running${NC}"

        # Verify it's actually responding
        if curl -s "http://localhost:7912/api/v1/health" > /dev/null 2>&1; then
            print_success "Spoolman is reachable"
        else
            print_warning "Spoolman is running but not responding yet (still starting?)"
        fi
    else
        print_status "Spoolman container not found"
        echo -e "${YELLOW}Note: Spoolman was skipped or installation failed${NC}"
        read -p "Spoolman URL (or Enter for default) [http://192.168.1.10:7912]: " CUSTOM_URL
        SPOOLMAN_URL=${CUSTOM_URL:-"http://192.168.1.10:7912"}
    fi

    # Create minimal config - printer and HA are configured in the web setup
    print_status "Creating a minimal configuration file..."

    # Local server IP for the CORS origins — the primary non-localhost one.
    SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' | grep -v '^127\.' || echo "")

    # Fallback: Versuche ip route
    if [ -z "$SERVER_IP" ]; then
        SERVER_IP=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K[0-9.]+' || echo "")
    fi

    # Build the CORS origins array
    CORS_ORIGINS=""
    if [ -n "$SERVER_IP" ]; then
        print_status "Server IP detected: $SERVER_IP"
        CORS_ORIGINS="\"https://$SERVER_IP:5002\", \"http://$SERVER_IP:5002\""
    else
        print_warning "Could not detect server IP - CORS origins will use intelligent whitelist"
        CORS_ORIGINS=""
    fi

    # Ensure data directory exists
    mkdir -p "$APP_DIR/data"

    cat > "$APP_DIR/data/config.json" << EOF
{
  "setup_completed": false,
  "external_domain": "$EXTERNAL_DOMAIN",
  "cors": {
    "allowed_origins": [$CORS_ORIGINS]
  },
  "homeassistant": {
    "ha_url": "",
    "token": "",
    "entity_id": "",
    "entity_names": {},
    "entities": []
  },
  "mqtt": {
    "bambu_ip": "",
    "bambu_serial": "",
    "bambu_access_code": "",
    "printer_name": "",
    "printer_model": "",
    "developer_mode": true,
    "lan_only": true
  },
  "ui": {
    "default_camera_size": 2
  },
  "automation": {
    "auto_light_on_mqtt": true,
    "auto_light_only_dark": true,
    "dark_start_hour": 18,
    "dark_end_hour": 8
  },
  "auto_power_off": {
    "enabled": false,
    "minutes_after_print": 15,
    "minutes_idle": 60
  },
  "ustreamer": {
    "enabled": false,
    "pi5_ip": "",
    "port": 8888,
    "username": "",
    "password": "",
    "current_quality": "normal"
  },
  "spoolman": {
    "enabled": true,
    "url": "$SPOOLMAN_URL",
    "external_url": "$SPOOLMAN_URL",
    "auto_track": true,
    "low_filament_threshold": 100
  },
  "license": {
    "license_path": "/opt/printer-web-app/license.json"
  },
  "costs": {
    "filament_per_kg": 21.0,
    "power_per_kwh": 0.285
  },
  "debug": {
    "log_mqtt_raw": false,
    "log_status_changes": false
  }
}
EOF

    # On macOS credentials go into the keychain
    # (services/keychain_service.py). Linux has none — there `keychain_get`
    # simply returns None, and the printer access code, the Meross password
    # and the HA token stay in clear text in this file. That is why it
    # belongs to nobody else.
    chmod 600 "$APP_DIR/data/config.json"
    sudo chown ${SUDO_USER:-$(whoami)}:${SUDO_USER:-$(whoami)} "$APP_DIR/data/config.json"

    print_success "Minimal configuration created"
    print_status "Printer and HomeAssistant will be configured in web setup"
    print_warning "Linux has no keychain: credentials are stored"
    print_warning "in clear text in data/config.json (set to 600)."
}

# ============================================================================
# SSL CERTIFICATES
# ============================================================================

generate_ssl_certificates() {
    print_step "${LOCK} Create SSL certificates"

    # Generated in ONE place: services/cert_manager.py — the same one the
    # server uses at startup to renew an expiring certificate automatically
    # (services/ssl_context.py). The renewal only works off our own root CA,
    # so the certificate has to come from there.
    #
    # What gets generated:
    #   ca-cert.pem / ca-key.pem       our own root CA (10 years)
    #   cert.pem / key.pem             the server certificate (825 days)
    #   server-cert.p12 / ca-cert.p12  for Android

    # The certificates live in data/certs/ (services/paths.py,
    # zertifikatsordner). They used to be looked for loose in data/, and they
    # were made by tools/create_cert.py -- which ships in NO installation, so
    # on every fresh install that call failed, and `if cmd | tee` reported it
    # as success (14sep26). Now the installer calls the very module the
    # server uses at start: it creates what is missing and leaves a valid
    # certificate alone, so running it again is harmless.
    local CERTS="$APP_DIR/data/certs"
    local PY="$APP_DIR/venv/bin/python"
    [ -x "$PY" ] || PY="python3"

    (cd "$APP_DIR" && "$PY" -c "
import sys
sys.path.insert(0, '.')
from services.cert_manager import ensure_certificate
ensure_certificate('')
") 2>&1 | tee -a "$LOG_FILE"

    if [ "${PIPESTATUS[0]}" -eq 0 ] && [ -f "$CERTS/cert.pem" ] && [ -f "$CERTS/ca-cert.pem" ]; then
        sudo chown -R ${SUDO_USER:-$(whoami)}:${SUDO_USER:-$(whoami)} "$APP_DIR/data" 2>/dev/null || true
        print_success "Certificates ready in $CERTS"
        print_status "For a browser without warnings: trust the CA once on every device —"
        print_status "the setup wizard and Settings → Security show how (Trust this device)"
        print_status "The server renews them itself, 30 days before they expire."
    else
        # Not fatal: the server makes them itself on its first start
        # (services/ssl_context.py). Saying so beats a silent gap.
        print_warning "Certificates were not created now — the server creates them on its first start"
        print_status "They will then be in $CERTS"
    fi
}

# ============================================================================
# SYSTEMD SERVICE
# ============================================================================

setup_systemd_service() {
    print_step "Setting up the systemd service"

    print_status "Creating the service..."

    # Determine which Python file to use (support both source and obfuscated)
    local PYTHON_MAIN
    if [ -f "$APP_DIR/start.py" ] && [ -d "$APP_DIR/dist" ]; then
        PYTHON_MAIN="start.py"
        print_status "Using obfuscated version (start.py)"
    elif [ -f "$APP_DIR/web_app.py" ]; then
        PYTHON_MAIN="web_app.py"
        print_status "Using source version (web_app.py)"
    else
        print_error "Neither start.py nor web_app.py found!"
        return 1
    fi

    sudo tee /etc/systemd/system/$SERVICE_NAME.service > /dev/null << EOF
[Unit]
Description=3D Printer Web Dashboard
After=network.target

[Service]
Type=simple
User=${SUDO_USER:-$(whoami)}
WorkingDirectory=$APP_DIR
Environment="PATH=$APP_DIR/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ExecStart=$APP_DIR/venv/bin/python $APP_DIR/start.py
Restart=always
# Exit code 42 is the server asking to be restarted -- the button in the web
# UI uses it (routes/system.py). Without this line systemd counts every one of
# those as a failure, and StartLimitBurst=5 then refuses to start the service
# at all after five restarts in a row: the server stays down until someone
# runs `systemctl reset-failed` by hand (01sep26, seen on the Pi).
SuccessExitStatus=42
# One second, the same as the macOS app waits after exit 42
# (PrinterWebApp.swift). Ten stood here: of a 12.7 s restart on the Pi
# (14sep26) ten were this wait, the server itself is up 1.3 s after systemd
# starts it. A crash loop is still caught -- by the default StartLimitBurst=5
# in 10 s, after which the service stays down, as the macOS app does after any
# crash.
RestartSec=1

[Install]
WantedBy=multi-user.target
EOF

    # Reload systemd
    sudo systemctl daemon-reload
    sudo systemctl enable $SERVICE_NAME > /dev/null 2>&1

    print_success "Service created ($PYTHON_MAIN)"
}

# ============================================================================
# FIREWALL
# ============================================================================

configure_firewall() {
    print_step "Configuring the firewall"

    if ! command -v ufw &> /dev/null; then
        print_warning "UFW not installed, skipping firewall setup"
        return
    fi

    print_status "Opening required ports..."

    sudo ufw allow 5555/tcp comment 'Printer Dashboard HTTPS' > /dev/null 2>&1
    sudo ufw allow 7912/tcp comment 'Spoolman' > /dev/null 2>&1

    print_success "Firewall configured"
}

# ============================================================================
# FIREBASE SETUP GUIDE
# ============================================================================

show_firebase_guide() {
    print_step "${FIRE} Firebase Cloud Messaging (FCM) Setup"

    echo -e "${CYAN}FCM enables push notifications on your smartphone!${NC}"
    echo

    if ! prompt_yes_no "Do you want to set up FCM now?" "n"; then
        print_warning "FCM setup skipped"
        echo -e "${YELLOW}   ${ARROW} You can set up FCM later with ./scripts/setup_firebase.sh${NC}"
        return
    fi

    echo
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}   FIREBASE SETUP GUIDE${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo
    echo -e "${WHITE}Step-by-step guide:${NC}"
    echo
    echo -e "${GREEN}1.${NC} Open: ${CYAN}https://console.firebase.google.com${NC}"
    echo -e "${GREEN}2.${NC} Click 'Add project' (or select existing)"
    echo -e "${GREEN}3.${NC} Enter a project name (e.g. 'printer-dashboard')"
    echo -e "${GREEN}4.${NC} Google Analytics: ${YELLOW}optional${NC} (can be disabled)"
    echo -e "${GREEN}5.${NC} Wait until project is created"
    echo
    echo -e "${CYAN}Create the service account key:${NC}"
    echo -e "${GREEN}6.${NC} Project settings ${YELLOW}(gear icon)${NC}"
    echo -e "${GREEN}7.${NC} Tab: ${YELLOW}Service accounts${NC}"
    echo -e "${GREEN}8.${NC} Click: ${YELLOW}Generate new private key${NC}"
    echo -e "${GREEN}9.${NC} Confirm with ${YELLOW}'Generate key'${NC}"
    echo -e "${GREEN}10.${NC} The JSON file is downloaded"
    echo
    echo -e "${CYAN}Enable the Cloud Messaging API:${NC}"
    echo -e "${GREEN}11.${NC} Project settings → ${YELLOW}Cloud Messaging${NC}"
    echo -e "${GREEN}12.${NC} If needed: ${YELLOW}enable the Cloud Messaging API${NC}"
    echo

    read -p "Press Enter when you have downloaded the JSON file..."

    echo
    echo -e "${CYAN}Enter the path to the downloaded JSON file:${NC}"
    echo -e "${YELLOW}(For instance: ~/Downloads/projectname-firebase-adminsdk-xxxxx.json)${NC}"
    read -p "> " FIREBASE_KEY

    if [ -n "$FIREBASE_KEY" ] && [ -f "$FIREBASE_KEY" ]; then
        sudo cp "$FIREBASE_KEY" "$APP_DIR/serviceAccountKey.json"
        sudo chown ${SUDO_USER:-$(whoami)}:${SUDO_USER:-$(whoami)} "$APP_DIR/serviceAccountKey.json"
        print_success "Firebase key installed!"

        echo
        echo -e "${GREEN}   ${ARROW} Mobile App Setup:${NC}"
        echo -e "${WHITE}   See: $APP_DIR/docs/SETUP_FIREBASE.md${NC}"
        echo -e "${WHITE}   For iOS App: $APP_DIR/docs/SETUP_IOS_APP.md${NC}"
        echo -e "${WHITE}   For Android App: $APP_DIR/docs/SETUP_ANDROID_APP.md${NC}"
    else
        print_warning "Firebase setup skipped"
        echo -e "${YELLOW}   ${ARROW} You can set up FCM later with ./scripts/setup_firebase.sh${NC}"
    fi
}

# ============================================================================
# FINAL STEPS
# ============================================================================

start_application() {
    print_step "${ROCKET} Starting the application"

    print_status "Starting services..."

    # Start Spoolman if exists
    if [ -f "$APP_DIR/docker-compose.yml" ]; then
        cd "$APP_DIR"
        sudo docker-compose up -d > /dev/null 2>&1
    fi

    # Start main app
    sudo systemctl start $SERVICE_NAME

    sleep 3

    if sudo systemctl is-active --quiet $SERVICE_NAME; then
        print_success "All services running!"
    else
        print_error "Service could not be started"
        echo -e "${YELLOW}   Logs: sudo journalctl -u $SERVICE_NAME -f${NC}"
    fi
}

show_completion_message() {
    local LOCAL_IP=$(hostname -I | awk '{print $1}')
    local SETUP_URL="https://${LOCAL_IP}:5555/static/setup.html"

    echo
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}   ✓ Installation Successful!${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo

    # Additional info (optional - can be skipped)
    echo -e "${CYAN}📋 Installed Services:${NC}"
    echo -e "${WHITE}   ✓ Dashboard: https://${LOCAL_IP}:5555${NC}"

    if sudo docker ps | grep -q spoolman; then
        echo -e "${WHITE}   ✓ Spoolman: http://${LOCAL_IP}:7912${NC}"
    fi

    echo
    echo -e "${CYAN}📷 Camera:${NC}"
    echo -e "${WHITE}   The server reads the printer camera itself and streams it live;${NC}"
    echo -e "${WHITE}   ffmpeg makes the single frames. Nothing else to install.${NC}"
    echo

    echo -e "${CYAN}🔒 Certificate:${NC}"
    echo -e "${WHITE}   Self-signed by the server's own CA. Trust it once per device and${NC}"
    echo -e "${WHITE}   the browser warning goes away — the dashboard then runs offline too.${NC}"
    echo -e "${WHITE}   Certificate: ${YELLOW}https://${LOCAL_IP}:5555/ca.crt${NC}"
    echo -e "${WHITE}   iPhone/iPad: ${YELLOW}https://${LOCAL_IP}:5555/ca.mobileconfig${NC}"
    echo -e "${WHITE}   Steps per system: last wizard page, or Settings → Security.${NC}"
    echo

    echo -e "${CYAN}🔐 Credentials:${NC}"
    echo -e "${WHITE}   No keychain on Linux — access code, Meross password${NC}"
    echo -e "${WHITE}   and HA token sit in clear text in ${YELLOW}data/config.json${WHITE} (chmod 600).${NC}"
    echo

    echo -e "${CYAN}💻 Useful Commands:${NC}"
    echo -e "${WHITE}   Check status:  ${YELLOW}sudo systemctl status $SERVICE_NAME${NC}"
    echo -e "${WHITE}   View logs:     ${YELLOW}sudo journalctl -u $SERVICE_NAME -f${NC}"
    echo -e "${WHITE}   Restart:       ${YELLOW}sudo systemctl restart $SERVICE_NAME${NC}"
    echo

    # MOST IMPORTANT PART - AT THE END, BIG AND PROMINENT!
    echo
    echo -e "${YELLOW}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║                                                          ║${NC}"
    echo -e "${YELLOW}║  ${WHITE}🚀 IMPORTANT: Complete the Web Setup!${YELLOW}             ║${NC}"
    echo -e "${YELLOW}║                                                          ║${NC}"
    echo -e "${YELLOW}╚══════════════════════════════════════════════════════════╝${NC}"
    echo
    echo -e "${WHITE}The setup page will open automatically in your browser.${NC}"
    echo
    echo -e "${CYAN}📝 Setup Steps:${NC}"
    echo -e "${WHITE}   1️⃣  Accept the license agreement${NC}"
    echo -e "${WHITE}   2️⃣  Change the default password${NC}"
    echo -e "${WHITE}   3️⃣  Configure your printer (Bambu Lab)${NC}"
    echo -e "${WHITE}   4️⃣  Connect Home Assistant (optional)${NC}"
    echo
    echo -e "${RED}⚠️  First login: ${YELLOW}admin${RED} / initial password in ${YELLOW}data/initial_password.txt${NC}"
    echo -e "${RED}   Set your own password in the first-login wizard (file is then deleted).${NC}"
    echo
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}   Setup URL: ${WHITE}${SETUP_URL}${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo

    # Try to open browser automatically
    sleep 2

    echo -e "${CYAN}🌐 Opening browser...${NC}"

    # Detect the actual user (when running with sudo)
    ACTUAL_USER="${SUDO_USER:-$USER}"

    # Try to get DISPLAY from user's environment
    if [ -n "$SUDO_USER" ]; then
        USER_DISPLAY=$(su - "$SUDO_USER" -c 'echo $DISPLAY' 2>/dev/null)
        [ -n "$USER_DISPLAY" ] && export DISPLAY="$USER_DISPLAY"
    fi

    # Detect browser opener command and run as actual user
    if command -v xdg-open &> /dev/null; then
        # Linux
        if [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then
            su - "$SUDO_USER" -c "DISPLAY=${DISPLAY:-:0} xdg-open '$SETUP_URL'" &>/dev/null &
        else
            DISPLAY=${DISPLAY:-:0} xdg-open "$SETUP_URL" &>/dev/null &
        fi
        print_success "Browser opened with xdg-open"
    elif command -v open &> /dev/null; then
        # macOS
        if [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then
            su - "$SUDO_USER" -c "open '$SETUP_URL'" &>/dev/null &
        else
            open "$SETUP_URL" &>/dev/null &
        fi
        print_success "Browser opened with open"
    elif command -v wslview &> /dev/null; then
        # WSL (Windows Subsystem for Linux)
        wslview "$SETUP_URL" &>/dev/null &
        print_success "Browser opened with wslview"
    else
        # Fallback: try common browsers directly
        if command -v firefox &> /dev/null; then
            if [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then
                su - "$SUDO_USER" -c "DISPLAY=${DISPLAY:-:0} firefox '$SETUP_URL'" &>/dev/null &
            else
                DISPLAY=${DISPLAY:-:0} firefox "$SETUP_URL" &>/dev/null &
            fi
            print_success "Browser opened with Firefox"
        elif command -v chromium-browser &> /dev/null; then
            if [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then
                su - "$SUDO_USER" -c "DISPLAY=${DISPLAY:-:0} chromium-browser '$SETUP_URL'" &>/dev/null &
            else
                DISPLAY=${DISPLAY:-:0} chromium-browser "$SETUP_URL" &>/dev/null &
            fi
            print_success "Browser opened with Chromium"
        elif command -v google-chrome &> /dev/null; then
            if [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then
                su - "$SUDO_USER" -c "DISPLAY=${DISPLAY:-:0} google-chrome '$SETUP_URL'" &>/dev/null &
            else
                DISPLAY=${DISPLAY:-:0} google-chrome "$SETUP_URL" &>/dev/null &
            fi
            print_success "Browser opened with Chrome"
        else
            print_warning "Could not open browser automatically"
            echo -e "${YELLOW}   Please open manually: ${WHITE}${SETUP_URL}${NC}"
        fi
    fi

    echo
    echo -e "${CYAN}🚀 Enjoy your 3D Printer Web App!${NC}"
    echo
}

# ============================================================================
# MAIN INSTALLATION FLOW
# ============================================================================

main() {
    print_banner

    # IMPORTANT: Save the directory where script was started BEFORE any cd commands!
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    SCRIPT_CALLED_FROM="$(pwd)"

    print_status "Script started from: $SCRIPT_CALLED_FROM"
    print_status "Script directory: $SCRIPT_DIR"

    # Check prerequisites
    check_root

    # Detect system
    PLATFORM=$(detect_platform)
    DISTRO=$(get_distro)
    CURRENT_USER=${SUDO_USER:-$(whoami)}

    print_status "Platform: $PLATFORM"
    print_status "Distribution: $DISTRO"
    print_status "User: $CURRENT_USER"
    echo

    # Confirm installation
    if ! prompt_yes_no "Do you want to start the installation?" "y"; then
        print_error "Installation cancelled"
        exit 0
    fi

    # Installation steps
    if ! require_python; then
        print_error "Installation cancelled."
        exit 1
    fi

    install_system_deps
    install_bambustudio
    install_docker

    # Install Docker services FIRST (before config, so we know the URLs)
    install_spoolman

    setup_app_directory
    clone_repository
    set_script_permissions
    deploy_obfuscated_files

    install_font_awesome
    setup_python_env

    # Now configure app (Docker services are running, we know the URLs)
    configure_app
    generate_ssl_certificates

    # Optional components
    install_cloudflare_tunnel
    show_firebase_guide

    # Finalize
    setup_systemd_service
    configure_firewall
    start_application

    # Show installation summary
    show_installation_summary

    show_completion_message

    # Log file location
    echo -e "${BLUE}Installation log: $LOG_FILE${NC}"
    echo
}

# Run main installation
main "$@"
