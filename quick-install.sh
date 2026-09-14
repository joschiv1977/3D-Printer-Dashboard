#!/bin/bash
#
# Quick Install Script for 3D Printer Web App (Obfuscated Version)
# Downloads compiled .so files for the current platform
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Repository settings
REPO_URL="https://github.com/joschiv1977/3D-Printer-Dashboard.git"
TEMP_DIR="/tmp/3d-printer-web-app-temp"

# Ask a yes/no question on the REAL terminal, never on this script's own
# stdin. Under `curl ... | bash` stdin IS the piped script text -- a plain
# `read` there consumes bytes of the script that follows it (seen in the
# wild: "cho: command not found", because `read` had already eaten the "e"
# off the next line's "echo"). /dev/tty is the terminal the user is actually
# sitting at, independent of stdin, and reading from there sidesteps the
# whole problem.
#
# Without a terminal at all -- piped into a fully detached `bash`, e.g. from
# cron or a CI runner -- nobody is there to answer. Both call sites already
# show a default in their own prompt text ("[y/N]"), so that is what gets
# used rather than aborting outright: the safe answer to both questions is
# already known, and stopping an otherwise-fine unattended install over a
# question would be worse than silently taking the side that was written in
# as the default.
#
# Sets REPLY, same as a plain `read`.
#
# The read is attempted directly rather than pre-checked with `[ -r /dev/tty
# ]`: that test only looks at the device node's permission bits, and stays
# true even with no controlling terminal at all -- where opening the device
# then fails at read time ("Device not configured"). Attempting the read and
# falling back on ANY failure covers both that case and a genuinely missing
# /dev/tty, with one code path.
ask_yes_no_tty() {
    local prompt="$1"
    if read -p "$prompt" -n 1 -r REPLY 2>/dev/null < /dev/tty; then
        echo
        return 0
    fi
    REPLY="n"
    echo
    echo -e "${YELLOW}[!] No terminal to ask on - using the default (N).${NC}"
    echo -e "${YELLOW}    Run this script directly, not through a pipe, to be asked.${NC}"
}

# Platform Detection
detect_platform() {
    local machine=$(uname -m)
    local os=$(uname -s)

    if [ "$os" != "Linux" ]; then
        echo "unsupported"
        return
    fi

    case "$machine" in
        x86_64|amd64)
            echo "x86_64"
            ;;
        aarch64|arm64)
            echo "aarch64"
            ;;
        armv7l|armv6l)
            echo "armv7l"
            ;;
        *)
            echo "unsupported"
            ;;
    esac
}

# Detect Python version
detect_python_version() {
    if command -v python3 &> /dev/null; then
        python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
    else
        echo "unknown"
    fi
}

echo -e "${CYAN}"
cat << "EOF"
    _____ ____    ____       _       __
   |__  // __ \  / __ \_____(_)___  / /____  _____
    /_ </ / / / / /_/ / ___/ / __ \/ __/ _ \/ ___/
  ___/ / /_/ / / ____/ /  / / / / / /_/  __/ /
 /____/_____/ /_/   /_/  /_/_/ /_/\__/\___/_/

EOF
echo -e "    3D Printer Dashboard - Quick Install (Obfuscated)"
echo -e "    (Downloads compiled .so files for your platform)"
echo -e "${NC}"
echo

# Platform Detection
PLATFORM=$(detect_platform)
PYTHON_VERSION=$(detect_python_version)

echo -e "${CYAN}[→] Detecting platform...${NC}"
echo -e "    Architecture: $(uname -m)"
echo -e "    OS: $(uname -s)"
echo -e "    Platform: ${GREEN}${PLATFORM}${NC}"
echo -e "    Python: ${GREEN}${PYTHON_VERSION}${NC}"
echo

if [ "$PLATFORM" = "unsupported" ]; then
    echo -e "${RED}[✗] Unsupported platform: $(uname -m)${NC}"
    echo -e "${YELLOW}    Supported: x86_64, aarch64 (ARM64), armv7l${NC}"
    exit 1
fi

if [ "$PYTHON_VERSION" = "unknown" ]; then
    echo -e "${RED}[✗] Python 3 not found!${NC}"
    echo -e "${YELLOW}    Please install Python 3.12: sudo apt-get install python3.12${NC}"
    exit 1
fi

# Check Python version >= 3.12
PYTHON_MAJOR=$(echo "$PYTHON_VERSION" | cut -d. -f1)
PYTHON_MINOR=$(echo "$PYTHON_VERSION" | cut -d. -f2)

if [ "$PYTHON_MAJOR" -lt 3 ] || ([ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 12 ]); then
    echo -e "${YELLOW}[!] Warning: found Python $PYTHON_VERSION${NC}"
    echo -e "${YELLOW}    Recommended: Python 3.12${NC}"
    echo -e "${YELLOW}    The .so files were compiled for Python 3.12!${NC}"
    echo
    ask_yes_no_tty "Continue anyway? [y/N] "
    if [[ ! $REPLY =~ ^[JjYy]$ ]]; then
        exit 1
    fi
fi

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo -e "${RED}[✗] Please do NOT run this as root!${NC}"
    echo -e "${YELLOW}    Run the script as a normal user.${NC}"
    exit 1
fi

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo -e "${YELLOW}[!] Git is not installed.${NC}"
    echo -e "${CYAN}    Installing Git...${NC}"
    sudo apt-get update -qq
    sudo apt-get install -y git
fi

echo -e "${CYAN}[→] Downloading compiled files from the repository...${NC}"
echo -e "    Repository: ${REPO_URL}"
echo -e "    Platform: dist_${PLATFORM}/"
echo

# Remove old directories if exist
rm -rf "$TEMP_DIR"

# Create temp directory
mkdir -p "$TEMP_DIR"
cd "$TEMP_DIR"

# Initialize sparse checkout
echo -e "${CYAN}[→] Initializing sparse checkout...${NC}"
git init -q
git remote add origin "$REPO_URL"
git config core.sparseCheckout true

# Create sparse-checkout file - load compiled dist and required files
#
# Every entry below is anchored with a leading "/": non-cone sparse-checkout
# patterns work like .gitignore, where an unanchored name (e.g. "static/")
# matches that name at ANY depth. Without the leading slash, "static/",
# "templates/", "data/" and "docs/" each also matched the same-named folder
# nested inside the OTHER platform's dist_*/ tree -- so an aarch64 install
# still pulled a stray dist_x86_64/static/lang/*.so (found 14sep26: git
# checked out dist_x86_64/ with only that one nested match, even though
# only "dist_${PLATFORM}/" itself was ever listed). Anchoring every pattern
# to the repository root is what keeps the other platform's directory out
# entirely, confirmed against the real repository.
echo -e "${CYAN}[→] Configuring required files...${NC}"
{
    # Compiled files for this platform ONLY -- the other platform's dist_*/
    # never matches any pattern here (see above).
    echo "/dist_${PLATFORM}/"

    # Start script
    echo "/start.py"

    # Installation scripts
    echo "/install.sh"
    echo "/manage.sh"

    # Configuration. No docker-compose.yml: install.sh writes it itself
    # (install_spoolman), a copy here only duplicated that.
    echo "/requirements.txt"

    # Assets (not compiled)
    echo "/static/"
    echo "/templates/"

    # The Bambu root CAs (data/bambu*.cert). Without them bambu_ssl falls
    # back to CERT_NONE and the MQTT connection to the printer stops checking
    # the certificate at all -- a silent downgrade, visible only as a warning
    # in the log (01sep26, seen after reinstalling the Pi). data/ holds
    # nothing else in this repository.
    echo "/data/"

    # Documentation. Spelled exactly as the files are named: a sparse
    # checkout matches case-sensitively, so "README.MD" fetched nothing at
    # all -- the file is README.md. Same trap as A1.png vs a1.png
    # (01sep26). BUILD_INSTRUCTIONS.md does not exist in this repository.
    echo "/README.md"
    echo "/README.de.md"

    echo "/docs/"

} > .git/info/sparse-checkout

# Pull only specified files
echo -e "${CYAN}[→] Downloading files (this may take a moment)...${NC}"
if ! git pull origin main -q 2>&1; then
    echo -e "${YELLOW}[!] 'main' branch not found, trying 'master'...${NC}"
    if ! git pull origin master -q 2>&1; then
        echo -e "${RED}[✗] Download failed!${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}[✓] Files downloaded successfully${NC}"
echo

# Check if platform-specific dist exists
if [ ! -d "dist_${PLATFORM}" ]; then
    echo -e "${RED}[✗] dist_${PLATFORM}/ not found!${NC}"
    echo -e "${YELLOW}    Platform ${PLATFORM} has not been compiled yet.${NC}"
    echo -e "${YELLOW}    Available platforms:${NC}"
    ls -d dist_*/ 2>/dev/null || echo "    No dist_* folders found"
    exit 1
fi

# Count .so files
SO_COUNT=$(find "dist_${PLATFORM}" -name "*.so" | wc -l)
echo -e "${GREEN}[✓] Platform-specific files:${NC}"
echo -e "    ✓ dist_${PLATFORM}/ (${SO_COUNT} .so files)"

# Check for required files
echo
echo -e "${GREEN}[✓] Downloaded files:${NC}"
[ -f "start.py" ] && echo -e "    ✓ start.py" || echo -e "    ${RED}✗ start.py${NC}"
[ -f "install.sh" ] && echo -e "    ✓ install.sh" || echo -e "    ${RED}✗ install.sh${NC}"
[ -f "requirements.txt" ] && echo -e "    ✓ requirements.txt" || echo -e "    ${RED}✗ requirements.txt${NC}"
[ -d "static" ] && echo -e "    ✓ static/" || echo -e "    ${YELLOW}✗ static/${NC}"
[ -d "templates" ] && echo -e "    ✓ templates/" || echo -e "    ${YELLOW}✗ templates/${NC}"

# Rename dist_platform to dist for easier deployment
echo
echo -e "${CYAN}[→] Preparing installation...${NC}"
if [ -d "dist" ]; then
    rm -rf dist
fi
mv "dist_${PLATFORM}" dist
echo -e "${GREEN}[✓] dist_${PLATFORM}/ → dist/${NC}"

# Check if install.sh exists
if [ ! -f "install.sh" ]; then
    echo -e "${RED}[✗] install.sh not found!${NC}"
    exit 1
fi

# Make scripts executable
chmod +x install.sh
chmod +x start.py 2>/dev/null || true

# Run installation with sudo
echo
echo -e "${CYAN}════════════════════════════════════════${NC}"
echo -e "${GREEN}[✓] Starting installation...${NC}"
echo -e "${CYAN}════════════════════════════════════════${NC}"
echo

# install.sh has its own interactive prompts throughout (confirm the
# install, retry-or-skip on a failed step, the Cloudflare and Firebase
# wizards) and needs a real terminal for all of them -- same reason as
# ask_yes_no_tty above. Probed here with a costless `: < /dev/tty` (opens
# and closes the device without reading a byte) so a genuinely
# non-interactive run gets one clear message instead of install.sh dying
# on its first prompt with a raw "Device not configured".
if : 2>/dev/null < /dev/tty; then
    # Run install.sh with sudo
    sudo ./install.sh < /dev/tty
else
    echo -e "${RED}[✗] No terminal available.${NC}"
    echo -e "${YELLOW}    install.sh asks its own questions (confirm the install, optional${NC}"
    echo -e "${YELLOW}    components, ...) and needs a real terminal for them.${NC}"
    echo -e "${YELLOW}    Run this script directly instead of through a pipe, for instance:${NC}"
    echo -e "${CYAN}      curl -fsSL ${REPO_URL%.git}/raw/main/quick-install.sh -o quick-install.sh${NC}"
    echo -e "${CYAN}      bash quick-install.sh${NC}"
    exit 1
fi

# Cleanup
echo
ask_yes_no_tty "Delete the temporary download directory? [y/N] "
if [[ $REPLY =~ ^[JjYy]$ ]]; then
    echo -e "${CYAN}[→] Deleting temporary directory...${NC}"
    cd /tmp
    rm -rf "$TEMP_DIR"
    echo -e "${GREEN}[✓] Cleanup complete${NC}"
else
    echo -e "${YELLOW}[!] Download directory remains: ${TEMP_DIR}${NC}"
fi

echo
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}   ✓ Installation complete!${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo
echo -e "${CYAN}Installed platform: ${GREEN}${PLATFORM}${NC}"
echo -e "${CYAN}Python version: ${GREEN}${PYTHON_VERSION}${NC}"
echo -e "${CYAN}Compiled .so files: ${GREEN}${SO_COUNT}${NC}"
echo
