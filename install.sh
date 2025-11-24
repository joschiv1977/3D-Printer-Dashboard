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
    clear
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
        docker-compose --version
        return 0
    fi

    print_status "Installing Docker..."

    # Add Docker's official GPG key
    sudo apt-get update > /dev/null 2>&1
    sudo apt-get install -y ca-certificates curl gnupg > /dev/null 2>&1 &
    spinner $!

    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/$(get_distro)/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg > /dev/null 2>&1
    sudo chmod a+r /etc/apt/keyrings/docker.gpg

    # Add repository
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$(get_distro) \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    # Install Docker Engine
    sudo apt-get update > /dev/null 2>&1
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin > /dev/null 2>&1 &
    spinner $!

    # Install docker-compose standalone
    sudo curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
        -o /usr/local/bin/docker-compose > /dev/null 2>&1
    sudo chmod +x /usr/local/bin/docker-compose

    # Add user to docker group
    sudo usermod -aG docker ${SUDO_USER:-$(whoami)}

    # Start Docker service
    sudo systemctl start docker
    sudo systemctl enable docker > /dev/null 2>&1

    print_success "Docker successfully installed"
    docker --version
    docker-compose --version

    print_warning "IMPORTANT: Please log out and log back in for Docker group to take effect!"
}

# ============================================================================
# SPOOLMAN INSTALLATION
# ============================================================================

install_spoolman() {
    print_step "${DOCKER} Install Spoolman Filament Manager"

    if ! check_docker; then
        print_error "Docker must be installed first!"
        return 1
    fi

    print_status "Richte Spoolman ein..."

    # Create data directory
    sudo mkdir -p "$APP_DIR/spoolman_data"
    sudo chown -R ${SUDO_USER:-$(whoami)}:${SUDO_USER:-$(whoami)} "$APP_DIR/spoolman_data"

    # Check if docker-compose.yml exists
    if [ ! -f "$APP_DIR/docker-compose.yml" ]; then
        print_status "Erstelle docker-compose.yml..."
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

    # Start Spoolman
    cd "$APP_DIR"
    sudo docker-compose up -d > /dev/null 2>&1 &
    spinner $!

    # Wait for container to start
    sleep 3

    if sudo docker ps | grep -q spoolman; then
        print_success "Spoolman is running on port 7912"
        echo -e "${GREEN}   ${ARROW} Web-UI: ${WHITE}http://$(hostname -I | awk '{print $1}'):7912${NC}"
    else
        print_error "Could not start Spoolman"
        return 1
    fi
}

# ============================================================================
# CLOUDFLARE TUNNEL
# ============================================================================

install_cloudflare_tunnel() {
    print_step "${CLOUD} Cloudflare Tunnel einrichten"

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
    echo -e "${WHITE}Folge diesen Schritten:${NC}"
    echo
    echo -e "${GREEN}1.${NC} Gehe zu: ${CYAN}https://one.dash.cloudflare.com${NC}"
    echo -e "${GREEN}2.${NC} Log in or create an account (free)"
    echo -e "${GREEN}3.${NC} Zero Trust → Networks → Tunnels → Create a tunnel"
    echo -e "${GREEN}4.${NC} Benenne den Tunnel (z.B. 'printer-dashboard')"
    echo -e "${GREEN}5.${NC} Choose: ${YELLOW}Debian (64-bit)${NC}"
    echo -e "${GREEN}6.${NC} Kopiere den Befehl: ${CYAN}cloudflared service install <TOKEN>${NC}"
    echo
    echo -e "${YELLOW}Execute the command now:${NC}"
    echo -e "${WHITE}(Der Befehl sieht aus wie: cloudflared service install eyJh...)${NC}"
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
        echo -e "    ${YELLOW}Subdomain:${NC} printer (oder wunschname)"
        echo -e "    ${YELLOW}Domain:${NC} Choose your domain (e.g. avecomp.net)"
        echo -e "    ${YELLOW}Service Type:${NC} HTTPS"
        echo -e "    ${YELLOW}URL:${NC} localhost:5555"
        echo -e "    ${YELLOW}No TLS Verify:${NC} ✓ (aktivieren)"
        echo
        echo -e "${CYAN}   Route 2 - License Server (WICHTIG!):${NC}"
        echo -e "    ${YELLOW}Subdomain:${NC} license"
        echo -e "    ${YELLOW}Domain:${NC} Gleiche Domain wie oben"
        echo -e "    ${YELLOW}Service Type:${NC} HTTPS"
        echo -e "    ${YELLOW}URL:${NC} localhost:5556"
        echo -e "    ${YELLOW}No TLS Verify:${NC} ✓ (aktivieren)"
        echo
        echo -e "${GREEN}8.${NC} Click 'Save tunnel' for both routes"
        echo

        # Externe Domain abfragen
        echo
        echo -e "${CYAN}Externe Domain konfigurieren:${NC}"
        read -p "Gib deine externe Domain ein (z.B. printer.meinedomain.com): " EXTERNAL_DOMAIN
        if [ -z "$EXTERNAL_DOMAIN" ]; then
            EXTERNAL_DOMAIN="printer.avecomp.net"
            print_warning "Keine Domain angegeben - verwende Fallback: printer.avecomp.net"
        fi

        # Enable and start service
        sudo systemctl enable cloudflared > /dev/null 2>&1
        sudo systemctl start cloudflared

        print_success "Cloudflare Tunnel eingerichtet!"
        echo -e "${GREEN}   ${ARROW} Web Dashboard: ${WHITE}https://$EXTERNAL_DOMAIN${NC}"
        # Extract base domain for license server
        BASE_DOMAIN=$(echo "$EXTERNAL_DOMAIN" | sed 's/^[^.]*\.//')
        if [ -n "$BASE_DOMAIN" ] && [ "$BASE_DOMAIN" != "$EXTERNAL_DOMAIN" ]; then
            echo -e "${GREEN}   ${ARROW} License Server: ${WHITE}https://license.$BASE_DOMAIN${NC}"
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

    # apt IST blockiert - zeige Warnung
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
    local PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    print_status "Detected Python version: $PYTHON_VERSION"

    # IMPORTANT: python3.x-dev AND python3.x-venv must be version-specific!
    local PACKAGES="python3-pip python${PYTHON_VERSION}-venv python${PYTHON_VERSION}-dev git curl wget"
    # Debian 13 / Python 3.13: Explicit gcc, g++ needed for numpy compilation
    PACKAGES="$PACKAGES build-essential gcc g++ cmake libssl-dev libffi-dev"
    PACKAGES="$PACKAGES libjpeg-dev zlib1g-dev libfreetype6-dev"
    PACKAGES="$PACKAGES redis-server ffmpeg libgpiod-dev python3-pil"
    PACKAGES="$PACKAGES xvfb libgl1-mesa-glx"  # For OrcaSlicer headless thumbnail generation

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

        # Zeige Ausgabe UND logge sie
        if sudo apt-get update 2>&1 | tee "$update_log"; then
            print_success "Package lists updated"
            rm -f "$update_log"
            break
        else
            retry=$((retry + 1))
            if [ $retry -lt $max_retries ]; then
                print_warning "Update failed, attempt $retry/$max_retries"

                # Zeige die letzten Fehlerzeilen
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
        if sudo DEBIAN_FRONTEND=noninteractive apt-get install -y $PACKAGES 2>&1 | tee -a "$LOG_FILE"; then
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
    if ! python3 -m venv --help > /dev/null 2>&1; then
        print_warning "venv module not found!"
        local venv_missing=true
    fi

    # Test 2: Check if ensurepip exists (required for venv creation)
    if ! python3 -c "import ensurepip" > /dev/null 2>&1; then
        print_warning "ensurepip module not found!"
        print_warning "python${PYTHON_VERSION}-venv does not appear to be correctly installed"
        local ensurepip_missing=true
    fi

    # If either test failed, install the correct package
    if [ "$venv_missing" = true ] || [ "$ensurepip_missing" = true ]; then
        print_status "Installing python${PYTHON_VERSION}-venv and python3-venv..."

        # Install both version-specific and generic packages
        if sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "python${PYTHON_VERSION}-venv" python3-venv 2>&1 | tee -a "$LOG_FILE"; then
            print_success "python3-venv Packages installed"
        else
            print_error "Could not install python3-venv!"
            return 1
        fi

        # Verify again with both tests
        if ! python3 -m venv --help > /dev/null 2>&1; then
            print_error "venv module is still not available!"
            print_status "Available python3 packages:"
            dpkg -l | grep python3 | grep -E "(venv|ensurepip)"
            return 1
        fi

        if ! python3 -c "import ensurepip" > /dev/null 2>&1; then
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

        if sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "python${PYTHON_VERSION}-dev" 2>&1 | tee -a "$LOG_FILE"; then
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

    # Verify Redis installation
    if ! command -v redis-server &> /dev/null; then
        print_warning "redis-server not found, trying redis..."
        wait_for_apt
        if ! sudo apt-get install -y redis 2>&1 | tee -a "$LOG_FILE"; then
            print_error "Could not install Redis!"
            return 1
        fi
    fi

    # Start Redis with proper error handling
    if command -v redis-server &> /dev/null || command -v redis-cli &> /dev/null; then
        print_status "Starting Redis..."

        # Try redis-server first, then redis
        if sudo systemctl start redis-server 2>/dev/null; then
            sudo systemctl enable redis-server > /dev/null 2>&1
            print_success "Redis started (redis-server)"
        elif sudo systemctl start redis 2>/dev/null; then
            sudo systemctl enable redis > /dev/null 2>&1
            print_success "Redis started (redis)"
        else
            print_error "Could not start Redis service"
            print_status "Trying manual start..."
            sudo redis-server --daemonize yes 2>&1 | tee -a "$LOG_FILE"
            sleep 2
        fi

        # Verify Redis is running
        sleep 2
        if redis-cli ping > /dev/null 2>&1; then
            print_success "Redis is running correctly"
        else
            print_warning "Redis does not respond to ping"
            print_status "Checking if Redis is running..."
            if pgrep -x redis-server > /dev/null; then
                print_success "Redis process is running (ping test failed, but OK)"
            else
                print_error "Redis is not running!"
                return 1
            fi
        fi
    else
        print_error "Redis not available!"
        return 1
    fi

    # Verify ffmpeg installation
    print_status "Checking if ffmpeg is installed..."
    if ! command -v ffmpeg &> /dev/null; then
        print_warning "ffmpeg not found - will be reinstalled..."

        if ! wait_for_apt; then
            print_error "apt is not available"
            return 1
        fi

        if sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ffmpeg 2>&1 | tee -a "$LOG_FILE"; then
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

install_orcaslicer() {
    print_step "🔪 Install OrcaSlicer"

    # Detect if desktop environment is available
    local HAS_DESKTOP=false
    if [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ] || systemctl is-active --quiet graphical.target 2>/dev/null; then
        HAS_DESKTOP=true
    fi

    local ARCH=$(uname -m)

    echo
    echo -e "${CYAN}Two installation methods available:${NC}"
    echo -e "  ${GREEN}1)${NC} ${YELLOW}DEB-Paket${NC} - System installation with desktop icon (Ubuntu Desktop)"
    echo -e "  ${GREEN}2)${NC} ${YELLOW}AppImage${NC}   - Portable version without desktop integration (Headless/Pi5)"
    echo

    if [ "$HAS_DESKTOP" = true ]; then
        print_status "Desktop environment detected - DEB package recommended"
        local DEFAULT_METHOD="deb"
    else
        print_status "Headless system detected - AppImage recommended"
        local DEFAULT_METHOD="appimage"
    fi

    echo
    echo -e "${CYAN}Which method do you want to use?${NC}"
    read -p "Choose [1=DEB, 2=AppImage, Enter=Default]: " -n 1 -r INSTALL_METHOD
    echo

    case "$INSTALL_METHOD" in
        1)
            INSTALL_METHOD="deb"
            ;;
        2)
            INSTALL_METHOD="appimage"
            ;;
        "")
            INSTALL_METHOD="$DEFAULT_METHOD"
            print_status "Using default: $DEFAULT_METHOD"
            ;;
        *)
            print_warning "Invalid choice, using default: $DEFAULT_METHOD"
            INSTALL_METHOD="$DEFAULT_METHOD"
            ;;
    esac

    echo

    # DEB-Installation
    if [ "$INSTALL_METHOD" = "deb" ]; then
        print_status "DEB installation selected - with desktop integration"

        local ORCA_SCRIPT="$SCRIPT_DIR/install-orca-ubuntu.sh"

        if [ ! -f "$ORCA_SCRIPT" ]; then
            print_error "install-orca-ubuntu.sh not found in $SCRIPT_DIR"
            print_warning "Falling back to AppImage..."
            INSTALL_METHOD="appimage"
        else
            # Make sure the script is executable
            if [ ! -x "$ORCA_SCRIPT" ]; then
                chmod +x "$ORCA_SCRIPT"
            fi

            # Run the installation script
            if bash "$ORCA_SCRIPT"; then
                echo
                print_success "OrcaSlicer DEB package successfully installed"
                return 0
            else
                print_error "DEB installation failed"
                print_warning "Falling back to AppImage..."
                INSTALL_METHOD="appimage"
            fi
        fi
    fi

    # AppImage-Installation (default for headless/fallback)
    if [ "$INSTALL_METHOD" = "appimage" ]; then
        print_status "AppImage installation selected - portable version"

        local ORCASLICER_URL=""
        local ORCASLICER_FILE=""

        case "$ARCH" in
            aarch64|arm64)
                ORCASLICER_URL="https://github.com/CodeMasterCody3D/OrcaSlicer/releases/download/arm64/OrcaSlicer_Linux_V2.3.0-devARM64.AppImage"
                ORCASLICER_FILE="OrcaSlicer_ARM64.AppImage"
                print_status "Detected architecture: ARM64 (Raspberry Pi)"
                ;;
            x86_64|amd64)
                ORCASLICER_URL="https://github.com/SoftFever/OrcaSlicer/releases/download/v2.3.1/OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.3.1.AppImage"
                ORCASLICER_FILE="OrcaSlicer_x64.AppImage"
                print_status "Detected architecture: x86_64"
                ;;
            *)
                print_error "Unsupported architecture: $ARCH"
                print_warning "OrcaSlicer must be installed manually"
                return 0
                ;;
        esac

        # Check if already installed
        if [ -f "$APP_DIR/orca-slicer" ]; then
            print_warning "OrcaSlicer AppImage is already installed: $APP_DIR/orca-slicer"
            if ! prompt_yes_no "Download and replace?" "n"; then
                print_status "OrcaSlicer will not be replaced"
                return 0
            fi
        fi

        # Download OrcaSlicer
        print_status "Downloading OrcaSlicer AppImage..."
        local TEMP_FILE="/tmp/$ORCASLICER_FILE"

        if ! wget -q --show-progress -O "$TEMP_FILE" "$ORCASLICER_URL"; then
            print_error "Download failed: $ORCASLICER_URL"
            print_warning "OrcaSlicer can be downloaded manually"
            return 0
        fi

        # Make executable
        chmod +x "$TEMP_FILE"

        # Move to app directory
        sudo mkdir -p "$APP_DIR"
        sudo mv "$TEMP_FILE" "$APP_DIR/orca-slicer"
        sudo chown ${SUDO_USER:-$(whoami)}:${SUDO_USER:-$(whoami)} "$APP_DIR/orca-slicer"

        # Verify installation
        if [ -f "$APP_DIR/orca-slicer" ] && [ -x "$APP_DIR/orca-slicer" ]; then
            print_success "OrcaSlicer AppImage installed: $APP_DIR/orca-slicer"

            # Test if it runs
            if "$APP_DIR/orca-slicer" --help &> /dev/null; then
                print_success "OrcaSlicer CLI works"
            else
                print_warning "OrcaSlicer CLI test failed (may be normal on headless systems)"
            fi
        else
            print_error "OrcaSlicer installation failed"
            return 1
        fi
    fi
}

# ============================================================================
# APP INSTALLATION
# ============================================================================

setup_app_directory() {
    print_step "${WRENCH} App-Verzeichnis einrichten"

    if [ -d "$APP_DIR" ]; then
        print_warning "App directory already exists"
        if prompt_yes_no "Overwrite existing installation?" "n"; then
            print_status "Erstelle Backup..."
            sudo mv "$APP_DIR" "$APP_DIR.backup.$(date +%Y%m%d_%H%M%S)"
        else
            print_error "Installation abgebrochen"
            exit 1
        fi
    fi

    # Create directory
    sudo mkdir -p "$APP_DIR"
    sudo chown -R ${SUDO_USER:-$(whoami)}:${SUDO_USER:-$(whoami)} "$APP_DIR"

    # Create data directory for database, logs, and config files
    sudo mkdir -p "$APP_DIR/data"
    sudo chown -R ${SUDO_USER:-$(whoami)}:${SUDO_USER:-$(whoami)} "$APP_DIR/data"

    print_success "Verzeichnis erstellt"
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
        print_status "Lade Font-Awesome 6.5.1 herunter..."
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
    print_step "Repository klonen"

    # Check if script was started FROM a repo directory
    # Support both source (.py) and obfuscated (dist/.so) installations
    if [ -f "$SCRIPT_DIR/install.sh" ] && { [ -f "$SCRIPT_DIR/web_app.py" ] || [ -f "$SCRIPT_DIR/start.py" ] || [ -d "$SCRIPT_DIR/dist" ]; }; then
        print_status "Script is running from repository - copying files..."
        print_status "Quelle: $SCRIPT_DIR"

        # Detect installation type
        if [ -d "$SCRIPT_DIR/dist" ] && [ -f "$SCRIPT_DIR/start.py" ]; then
            print_status "Erkannt: Obfuscated Installation (.so Dateien)"
        elif [ -f "$SCRIPT_DIR/web_app.py" ]; then
            print_status "Erkannt: Source Installation (.py Dateien)"
        fi

        # Copy from the script directory to APP_DIR
        if [ "$SCRIPT_DIR" = "$APP_DIR" ]; then
            print_warning "Script is already running in $APP_DIR - skipping copy"
            cd "$APP_DIR"
            return 0
        fi

        # Create temp copy to avoid issues
        print_status "Kopiere Repository nach $APP_DIR..."
        sudo cp -r "$SCRIPT_DIR"/* "$APP_DIR/"

        # Copy hidden files too (like .git if present)
        sudo cp -r "$SCRIPT_DIR"/.* "$APP_DIR/" 2>/dev/null || true

        sudo chown -R ${SUDO_USER:-$(whoami)}:${SUDO_USER:-$(whoami)} "$APP_DIR"

        cd "$APP_DIR"
        print_success "Repository-Dateien kopiert"
        return 0
    fi

    # Try to clone from GitHub
    print_status "Klone von GitHub..."

    if git clone "$REPO_URL" "$APP_DIR" 2>&1 | tee -a "$LOG_FILE"; then
        cd "$APP_DIR"
        print_success "Repository geklont"
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
                print_status "Gefunden: $path - kopiere Dateien..."
                sudo cp -r "$path" "$APP_DIR"
                sudo chown -R ${SUDO_USER:-$(whoami)}:${SUDO_USER:-$(whoami)} "$APP_DIR"
                cd "$APP_DIR"
                print_success "Repository-Dateien kopiert"
                return 0
            fi
        done

        print_error "Repository could not be found!"
        echo
        echo -e "${YELLOW}Solutions:${NC}"
        echo -e "  1. Use quick-install.sh (downloads obfuscated .so files):"
        echo -e "     ${CYAN}bash <(curl -s https://raw.githubusercontent.com/.../quick-install.sh)${NC}"
        echo
        echo -e "  2. Oder klone das Repo vorher:"
        echo -e "     ${CYAN}git clone https://github.com/joschiv1977/3d-printer-web-app.git${NC}"
        echo -e "     ${CYAN}cd 3d-printer-web-app${NC}"
        echo -e "     ${CYAN}sudo ./install.sh${NC}"
        echo
        echo -e "  3. Oder kopiere es nach /tmp:"
        echo -e "     ${CYAN}cp -r /path/to/repo /tmp/3d-printer-web-app${NC}"
        echo -e "     ${CYAN}sudo /tmp/3d-printer-web-app/install.sh${NC}"
        echo
        return 1
    fi
}

set_script_permissions() {
    print_step "Script-Berechtigungen setzen"

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
    print_step "Python Virtual Environment einrichten"

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

    local PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    local venv_ok=true

    # Test 1: venv module
    if ! python3 -m venv --help > /dev/null 2>&1; then
        print_error "venv module is NOT available!"
        venv_ok=false
    fi

    # Test 2: ensurepip module (critical for venv creation)
    if ! python3 -c "import ensurepip" > /dev/null 2>&1; then
        print_error "ensurepip is NOT available!"
        print_error "This is required for venv creation."
        venv_ok=false
    fi

    if [ "$venv_ok" = false ]; then
        print_error "python3-venv was not correctly installed in install_system_deps()."

        echo -e "${YELLOW}Letzter Versuch: Installing python3-venv Pakete...${NC}"
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
        if ! python3 -m venv --help > /dev/null 2>&1; then
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

        if ! python3 -c "import ensurepip" > /dev/null 2>&1; then
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
    if ! python3 -m venv venv 2>&1 | tee -a "$LOG_FILE"; then
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
    local CRITICAL_PACKAGES="flask flask-socketio paho-mqtt redis requests pillow"
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
    print_step "${WRENCH} Konfiguration"

    echo -e "${CYAN}Erstelle initiale Konfigurationsdatei...${NC}"
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
        print_success "Spoolman erkannt auf: $SPOOLMAN_URL"
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

    # Create minimal config - Drucker und HA werden im Web-Setup konfiguriert
    print_status "Erstelle minimale Konfigurationsdatei..."

    # Ermittle lokale Server IP für CORS Origins
    # Versuche die primäre nicht-localhost IP zu finden
    SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' | grep -v '^127\.' || echo "")

    # Fallback: Versuche ip route
    if [ -z "$SERVER_IP" ]; then
        SERVER_IP=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K[0-9.]+' || echo "")
    fi

    # Erstelle CORS Origins Array
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
    "pi5_ip": "192.168.178.2",
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

    sudo chown ${SUDO_USER:-$(whoami)}:${SUDO_USER:-$(whoami)} "$APP_DIR/data/config.json"

    print_success "Minimale Konfiguration erstellt"
    print_status "Printer and HomeAssistant will be configured in web setup"
}

# ============================================================================
# SSL CERTIFICATES
# ============================================================================

generate_ssl_certificates() {
    print_step "${LOCK} SSL-Zertifikate generieren"

    # Ensure data directory exists
    mkdir -p "$APP_DIR/data"

    cd "$APP_DIR" || {
        print_error "Could not change to $APP_DIR"
        return 1
    }

    print_status "Working directory: $(pwd)"

    # Check if certificates exist in data/ directory (new location)
    if [ -f "$APP_DIR/data/cert.pem" ] && [ -f "$APP_DIR/data/key.pem" ]; then
        print_warning "SSL certificates already exist in data/"
        return
    fi

    # Check if certificates exist in old location (backwards compatibility)
    if [ -f "$APP_DIR/cert.pem" ] && [ -f "$APP_DIR/key.pem" ]; then
        print_warning "SSL certificates exist in old location (root)"
        print_status "Moving certificates to data/ directory..."
        mv "$APP_DIR/cert.pem" "$APP_DIR/data/cert.pem"
        mv "$APP_DIR/key.pem" "$APP_DIR/data/key.pem"
        print_success "Certificates moved to data/"
        return
    fi

    print_status "Generiere selbst-signierte Zertifikate..."
    print_status "Ziel-Verzeichnis: $APP_DIR/data"

    LOCAL_IP=$(hostname -I | awk '{print $1}')

    openssl req -x509 -newkey rsa:4096 -nodes \
        -keyout "$APP_DIR/data/key.pem" -out "$APP_DIR/data/cert.pem" -days 365 \
        -subj "/C=DE/ST=State/L=City/O=SpeedKnuffel/CN=$LOCAL_IP" \
        > /dev/null 2>&1

    if [ ! -f "$APP_DIR/data/cert.pem" ] || [ ! -f "$APP_DIR/data/key.pem" ]; then
        print_error "Certificates were not created!"
        return 1
    fi

    chmod 600 "$APP_DIR/data/key.pem" "$APP_DIR/data/cert.pem"
    sudo chown ${SUDO_USER:-$(whoami)}:${SUDO_USER:-$(whoami)} "$APP_DIR/data/key.pem" "$APP_DIR/data/cert.pem"

    print_success "SSL-Zertifikate erstellt in $APP_DIR/data"
    print_status "cert.pem: $(ls -lh "$APP_DIR/data/cert.pem" | awk '{print $5}')"
    print_status "key.pem: $(ls -lh "$APP_DIR/data/key.pem" | awk '{print $5}')"
}

# ============================================================================
# SYSTEMD SERVICE
# ============================================================================

setup_systemd_service() {
    print_step "Systemd Service einrichten"

    print_status "Erstelle Service..."

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
After=network.target redis-server.service
Wants=redis-server.service

[Service]
Type=simple
User=${SUDO_USER:-$(whoami)}
WorkingDirectory=$APP_DIR
Environment="PATH=$APP_DIR/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ExecStart=$APP_DIR/venv/bin/python $APP_DIR/start.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

    # Reload systemd
    sudo systemctl daemon-reload
    sudo systemctl enable $SERVICE_NAME > /dev/null 2>&1

    print_success "Service erstellt ($PYTHON_MAIN)"
}

# ============================================================================
# FIREWALL
# ============================================================================

configure_firewall() {
    print_step "Firewall konfigurieren"

    if ! command -v ufw &> /dev/null; then
        print_warning "UFW not installed, skipping firewall setup"
        return
    fi

    print_status "Opening required ports..."

    sudo ufw allow 5555/tcp comment 'Printer Dashboard HTTPS' > /dev/null 2>&1
    sudo ufw allow 7912/tcp comment 'Spoolman' > /dev/null 2>&1

    print_success "Firewall konfiguriert"
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
    echo -e "${CYAN}   FIREBASE SETUP ANLEITUNG${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
    echo
    echo -e "${WHITE}Step-by-step guide:${NC}"
    echo
    echo -e "${GREEN}1.${NC} Öffne: ${CYAN}https://console.firebase.google.com${NC}"
    echo -e "${GREEN}2.${NC} Click 'Add project' (or select existing)"
    echo -e "${GREEN}3.${NC} Projektnamen eingeben (z.B. 'printer-dashboard')"
    echo -e "${GREEN}4.${NC} Google Analytics: ${YELLOW}Optional${NC} (kann deaktiviert werden)"
    echo -e "${GREEN}5.${NC} Wait until project is created"
    echo
    echo -e "${CYAN}Service Account Key erstellen:${NC}"
    echo -e "${GREEN}6.${NC} Projekteinstellungen ${YELLOW}(Zahnrad-Icon)${NC}"
    echo -e "${GREEN}7.${NC} Tab: ${YELLOW}Dienstkonten${NC}"
    echo -e "${GREEN}8.${NC} Klicke: ${YELLOW}Generate new private key${NC}"
    echo -e "${GREEN}9.${NC} Confirm with ${YELLOW}'Generate key'${NC}"
    echo -e "${GREEN}10.${NC} JSON-Datei wird heruntergeladen"
    echo
    echo -e "${CYAN}Cloud Messaging API aktivieren:${NC}"
    echo -e "${GREEN}11.${NC} Projekteinstellungen → ${YELLOW}Cloud Messaging${NC}"
    echo -e "${GREEN}12.${NC} Bei Bedarf: ${YELLOW}Cloud Messaging API aktivieren${NC}"
    echo

    read -p "Press Enter when you have downloaded the JSON file..."

    echo
    echo -e "${CYAN}Gib den Pfad zur heruntergeladenen JSON-Datei ein:${NC}"
    echo -e "${YELLOW}(Beispiel: ~/Downloads/projektname-firebase-adminsdk-xxxxx.json)${NC}"
    read -p "> " FIREBASE_KEY

    if [ -n "$FIREBASE_KEY" ] && [ -f "$FIREBASE_KEY" ]; then
        sudo cp "$FIREBASE_KEY" "$APP_DIR/serviceAccountKey.json"
        sudo chown ${SUDO_USER:-$(whoami)}:${SUDO_USER:-$(whoami)} "$APP_DIR/serviceAccountKey.json"
        print_success "Firebase key installed!"

        echo
        echo -e "${GREEN}   ${ARROW} Mobile App Setup:${NC}"
        echo -e "${WHITE}   Siehe: $APP_DIR/docs/SETUP_FIREBASE.md${NC}"
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
    print_step "${ROCKET} Anwendung starten"

    print_status "Starting services..."

    # Start Redis
    sudo systemctl start redis-server

    # Start Spoolman if exists
    if [ -f "$APP_DIR/docker-compose.yml" ]; then
        cd "$APP_DIR"
        sudo docker-compose up -d > /dev/null 2>&1
    fi

    # Start main app
    sudo systemctl start $SERVICE_NAME

    sleep 3

    if sudo systemctl is-active --quiet $SERVICE_NAME; then
        print_success "Alle Services laufen!"
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
    echo -e "${RED}⚠️  Default login: ${YELLOW}admin${RED} / ${YELLOW}admin123${NC}"
    echo -e "${RED}   Change this immediately for security!${NC}"
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
    install_system_deps
    install_orcaslicer
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
