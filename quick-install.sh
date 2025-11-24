#!/bin/bash
#
# Quick Install Script für 3D Printer Web App (Obfuscated Version)
# Lädt kompilierte .so Dateien für die aktuelle Platform
#

set -e

# Farben für Ausgabe
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Repository-Einstellungen
REPO_URL="https://github.com/joschiv1977/3D-Printer-Dashboard.git"
TEMP_DIR="/tmp/3d-printer-web-app-temp"

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
echo -e "    3D Drucker Dashboard - Quick Install (Obfuscated)"
echo -e "    (Lädt kompilierte .so Dateien für Ihre Platform)"
echo -e "${NC}"
echo

# Platform Detection
PLATFORM=$(detect_platform)
PYTHON_VERSION=$(detect_python_version)

echo -e "${CYAN}[→] Platform-Erkennung...${NC}"
echo -e "    Architektur: $(uname -m)"
echo -e "    OS: $(uname -s)"
echo -e "    Platform: ${GREEN}${PLATFORM}${NC}"
echo -e "    Python: ${GREEN}${PYTHON_VERSION}${NC}"
echo

if [ "$PLATFORM" = "unsupported" ]; then
    echo -e "${RED}[✗] Nicht unterstützte Platform: $(uname -m)${NC}"
    echo -e "${YELLOW}    Unterstützt: x86_64, aarch64 (ARM64), armv7l${NC}"
    exit 1
fi

if [ "$PYTHON_VERSION" = "unknown" ]; then
    echo -e "${RED}[✗] Python 3 nicht gefunden!${NC}"
    echo -e "${YELLOW}    Bitte installiere Python 3.12: sudo apt-get install python3.12${NC}"
    exit 1
fi

# Check Python version >= 3.12
PYTHON_MAJOR=$(echo "$PYTHON_VERSION" | cut -d. -f1)
PYTHON_MINOR=$(echo "$PYTHON_VERSION" | cut -d. -f2)

if [ "$PYTHON_MAJOR" -lt 3 ] || ([ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 12 ]); then
    echo -e "${YELLOW}[!] Warnung: Python $PYTHON_VERSION gefunden${NC}"
    echo -e "${YELLOW}    Empfohlen: Python 3.12${NC}"
    echo -e "${YELLOW}    Die .so Dateien wurden für Python 3.12 kompiliert!${NC}"
    echo
    read -p "Trotzdem fortfahren? [j/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[JjYy]$ ]]; then
        exit 1
    fi
fi

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo -e "${RED}[✗] Bitte NICHT als root ausführen!${NC}"
    echo -e "${YELLOW}    Führe das Script als normaler Benutzer aus.${NC}"
    exit 1
fi

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo -e "${YELLOW}[!] Git ist nicht installiert.${NC}"
    echo -e "${CYAN}    Installiere Git...${NC}"
    sudo apt-get update -qq
    sudo apt-get install -y git
fi

echo -e "${CYAN}[→] Lade kompilierte Dateien aus Repository...${NC}"
echo -e "    Repository: ${REPO_URL}"
echo -e "    Platform: dist_${PLATFORM}/"
echo

# Remove old directories if exist
rm -rf "$TEMP_DIR"

# Create temp directory
mkdir -p "$TEMP_DIR"
cd "$TEMP_DIR"

# Initialize sparse checkout
echo -e "${CYAN}[→] Initialisiere Sparse Checkout...${NC}"
git init -q
git remote add origin "$REPO_URL"
git config core.sparseCheckout true

# Create sparse-checkout file - load compiled dist and required files
echo -e "${CYAN}[→] Konfiguriere benötigte Dateien...${NC}"
{
    # Compiled files for this platform
    echo "dist_${PLATFORM}/"

    # Start scripts
    echo "start.py"
    echo "deploy_platform.py"

    # Installation scripts
    echo "install.sh"
    echo "manage.sh"
    echo "printer-web-app.service"

    # Configuration
    echo "requirements.txt"
    echo "docker-compose.yml"

    # Assets (not compiled)
    echo "static/"
    echo "templates/"
    echo "profiles/"

    # Documentation
    echo "README.MD"
    echo "BUILD_INSTRUCTIONS.md"

    # Non-Python files still needed
    echo "BambuP1Streamer/"
    echo "docs/"

} > .git/info/sparse-checkout

# Pull only specified files
echo -e "${CYAN}[→] Lade Dateien herunter (das kann etwas dauern)...${NC}"
if ! git pull origin main -q 2>&1; then
    echo -e "${YELLOW}[!] 'main' Branch nicht gefunden, versuche 'master'...${NC}"
    if ! git pull origin master -q 2>&1; then
        echo -e "${RED}[✗] Download fehlgeschlagen!${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}[✓] Dateien erfolgreich geladen${NC}"
echo

# Check if platform-specific dist exists
if [ ! -d "dist_${PLATFORM}" ]; then
    echo -e "${RED}[✗] dist_${PLATFORM}/ nicht gefunden!${NC}"
    echo -e "${YELLOW}    Die Platform ${PLATFORM} wurde noch nicht kompiliert.${NC}"
    echo -e "${YELLOW}    Verfügbare Platforms:${NC}"
    ls -d dist_*/ 2>/dev/null || echo "    Keine dist_* Ordner gefunden"
    exit 1
fi

# Count .so files
SO_COUNT=$(find "dist_${PLATFORM}" -name "*.so" | wc -l)
echo -e "${GREEN}[✓] Platform-spezifische Dateien:${NC}"
echo -e "    ✓ dist_${PLATFORM}/ (${SO_COUNT} .so Dateien)"

# Check for required files
echo
echo -e "${GREEN}[✓] Geladene Dateien:${NC}"
[ -f "start.py" ] && echo -e "    ✓ start.py" || echo -e "    ${RED}✗ start.py${NC}"
[ -f "deploy_platform.py" ] && echo -e "    ✓ deploy_platform.py" || echo -e "    ${YELLOW}✗ deploy_platform.py (optional)${NC}"
[ -f "install.sh" ] && echo -e "    ✓ install.sh" || echo -e "    ${RED}✗ install.sh${NC}"
[ -f "requirements.txt" ] && echo -e "    ✓ requirements.txt" || echo -e "    ${RED}✗ requirements.txt${NC}"
[ -d "static" ] && echo -e "    ✓ static/" || echo -e "    ${YELLOW}✗ static/${NC}"
[ -d "templates" ] && echo -e "    ✓ templates/" || echo -e "    ${YELLOW}✗ templates/${NC}"

# Rename dist_platform to dist for easier deployment
echo
echo -e "${CYAN}[→] Bereite Installation vor...${NC}"
if [ -d "dist" ]; then
    rm -rf dist
fi
mv "dist_${PLATFORM}" dist
echo -e "${GREEN}[✓] dist_${PLATFORM}/ → dist/${NC}"

# Check if install.sh exists
if [ ! -f "install.sh" ]; then
    echo -e "${RED}[✗] install.sh nicht gefunden!${NC}"
    exit 1
fi

# Make scripts executable
chmod +x install.sh
chmod +x start.py 2>/dev/null || true
chmod +x deploy_platform.py 2>/dev/null || true

# Run installation with sudo
echo
echo -e "${CYAN}════════════════════════════════════════${NC}"
echo -e "${GREEN}[✓] Starte Installation...${NC}"
echo -e "${CYAN}════════════════════════════════════════${NC}"
echo

# Run install.sh with sudo
sudo ./install.sh < /dev/tty

# Cleanup
echo
read -p "Möchtest du das temporäre Download-Verzeichnis löschen? [j/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[JjYy]$ ]]; then
    echo -e "${CYAN}[→] Lösche temporäres Verzeichnis...${NC}"
    cd /tmp
    rm -rf "$TEMP_DIR"
    echo -e "${GREEN}[✓] Bereinigung abgeschlossen${NC}"
else
    echo -e "${YELLOW}[!] Download-Verzeichnis bleibt: ${TEMP_DIR}${NC}"
fi

echo
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}   ✓ Installation abgeschlossen!${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo
echo -e "${CYAN}Installierte Platform: ${GREEN}${PLATFORM}${NC}"
echo -e "${CYAN}Python Version: ${GREEN}${PYTHON_VERSION}${NC}"
echo -e "${CYAN}Kompilierte .so Dateien: ${GREEN}${SO_COUNT}${NC}"
echo
