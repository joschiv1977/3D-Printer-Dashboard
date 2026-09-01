#!/bin/bash
# OrcaSlicer Installation for Ubuntu/Debian
# Fixed for Ubuntu (not Termux/Android)

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}======================================${NC}"
echo -e "${CYAN}OrcaSlicer Installation for Ubuntu${NC}"
echo -e "${CYAN}======================================${NC}"
echo

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}❌ This script must be run as root!${NC}"
    echo "   Please use: sudo bash install-orca-ubuntu.sh"
    exit 1
fi

# Get the actual user (not root)
ACTUAL_USER="${SUDO_USER:-$USER}"
ACTUAL_HOME=$(getent passwd "$ACTUAL_USER" | cut -d: -f6)

echo -e "${GREEN}📋 Installation for user: $ACTUAL_USER${NC}"
echo -e "${GREEN}📂 Home: $ACTUAL_HOME${NC}"
echo

# Detect architecture
ARCH=$(uname -m)
echo -e "${CYAN}🔍 Detected architecture: $ARCH${NC}"

# Set download URL based on architecture
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    DEB_FILE="OrcaSlicer_UbuntuLinux_V2.3.0-devARM64.deb"
    DOWNLOAD_URL="https://github.com/CodeMasterCody3D/OrcaSlicer/releases/download/arm64/$DEB_FILE"
    echo -e "${GREEN}✓ Downloading ARM64 version${NC}"
elif [ "$ARCH" = "x86_64" ] || [ "$ARCH" = "amd64" ]; then
    DEB_FILE="OrcaSlicer_Linux_V2.3.1.deb"
    DOWNLOAD_URL="https://github.com/SoftFever/OrcaSlicer/releases/download/v2.3.1/$DEB_FILE"
    echo -e "${GREEN}✓ Downloading x86_64 version${NC}"
else
    echo -e "${RED}❌ Unsupported architecture: $ARCH${NC}"
    exit 1
fi

# --- Step 0: Install ImageMagick first (needed later) ---
echo
echo -e "${CYAN}📦 Installing ImageMagick...${NC}"
if command -v convert &> /dev/null; then
    echo -e "${GREEN}✓ ImageMagick is already installed${NC}"
else
    apt-get update > /dev/null 2>&1
    apt-get install -y imagemagick
    echo -e "${GREEN}✓ ImageMagick installed${NC}"
fi

# --- Step 1: Download and Install OrcaSlicer ---
echo
echo -e "${CYAN}📥 Downloading OrcaSlicer...${NC}"
wget -q --show-progress -O "/tmp/$DEB_FILE" "$DOWNLOAD_URL"

echo
echo -e "${CYAN}📦 Installing OrcaSlicer...${NC}"
dpkg -i "/tmp/$DEB_FILE" 2>&1 | grep -v "Warnung"

echo -e "${CYAN}🔧 Fixing missing dependencies...${NC}"
apt-get install -f -y > /dev/null 2>&1

echo -e "${GREEN}✓ OrcaSlicer installed${NC}"

# Clean up deb file
rm -f "/tmp/$DEB_FILE"

# --- Step 2: Download and Convert Icon ---
echo
echo -e "${CYAN}🖼️  Downloading icon...${NC}"

if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    ICO_FILE_URL="https://github.com/CodeMasterCody3D/OrcaSlicer/releases/download/arm64/OrcaSlicer.ico"
else
    # For x86_64, extract icon from installed application
    ICO_FILE_URL="https://github.com/SoftFever/OrcaSlicer/raw/main/resources/images/OrcaSlicerLogo.ico"
fi

ICO_FILE_PATH="/tmp/OrcaSlicer.ico"
PNG_FILE_PATH="/tmp/OrcaSlicer.png"

wget -q -O "$ICO_FILE_PATH" "$ICO_FILE_URL"

if [ ! -f "$ICO_FILE_PATH" ]; then
    echo -e "${RED}⚠️  Icon could not be downloaded${NC}"
    echo -e "${YELLOW}   Installation continues without icon${NC}"
    ICO_FILE_PATH=""
fi

# --- Step 3: Convert ICO to PNG ---
if [ -n "$ICO_FILE_PATH" ] && [ -f "$ICO_FILE_PATH" ]; then
    echo -e "${CYAN}🎨 Converting icon to PNG...${NC}"

    # Try to convert icon (handle different formats)
    if convert "$ICO_FILE_PATH" -resize 256x256 "$PNG_FILE_PATH" 2>/dev/null; then
        echo -e "${GREEN}✓ Icon converted${NC}"
    else
        echo -e "${YELLOW}⚠️  Icon conversion failed${NC}"
        PNG_FILE_PATH=""
    fi
fi

# --- Step 4: Install Icon System-Wide ---
if [ -n "$PNG_FILE_PATH" ] && [ -f "$PNG_FILE_PATH" ]; then
    ICON_DIR="/usr/share/icons/hicolor/256x256/apps"

    echo -e "${CYAN}📂 Installing icon system-wide...${NC}"
    mkdir -p "$ICON_DIR"
    cp "$PNG_FILE_PATH" "$ICON_DIR/orca-slicer.png"
    echo -e "${GREEN}✓ Icon installed in $ICON_DIR${NC}"

    # Update icon cache
    if command -v gtk-update-icon-cache &> /dev/null; then
        gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true
    fi

    ICON_PATH="$ICON_DIR/orca-slicer.png"
else
    echo -e "${YELLOW}⚠️  No icon available${NC}"
    ICON_PATH="application-x-executable"
fi

# --- Step 5: Create Desktop Shortcut ---
echo
echo -e "${CYAN}🔗 Creating desktop shortcut...${NC}"

DESKTOP_DIR="$ACTUAL_HOME/Desktop"
SHORTCUT_FILE="$DESKTOP_DIR/OrcaSlicer.desktop"

# Create Desktop directory if it doesn't exist
su - "$ACTUAL_USER" -c "mkdir -p '$DESKTOP_DIR'"

# Create desktop shortcut
cat > "$SHORTCUT_FILE" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=OrcaSlicer
Comment=3D Printer Slicing Software
Exec=/usr/bin/orca-slicer %F
Icon=$ICON_PATH
Terminal=false
Categories=Graphics;3DGraphics;Engineering;
MimeType=model/stl;application/sla;
StartupNotify=true
EOF

# Set correct permissions and owner
chown "$ACTUAL_USER:$ACTUAL_USER" "$SHORTCUT_FILE"
chmod +x "$SHORTCUT_FILE"

echo -e "${GREEN}✓ Desktop shortcut created${NC}"

# Also create in applications menu
APPS_DIR="/usr/share/applications"
mkdir -p "$APPS_DIR"
cp "$SHORTCUT_FILE" "$APPS_DIR/orca-slicer.desktop"
echo -e "${GREEN}✓ Application menu entry created${NC}"

# Clean up temp files
rm -f "$ICO_FILE_PATH" "$PNG_FILE_PATH"

# --- Final Summary ---
echo
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}✅ Installation completed!${NC}"
echo -e "${GREEN}======================================${NC}"
echo
echo -e "${CYAN}📋 Installation details:${NC}"
echo -e "   • OrcaSlicer Binary: ${YELLOW}/usr/bin/orca-slicer${NC}"
echo -e "   • Desktop shortcut: ${YELLOW}$DESKTOP_DIR/OrcaSlicer.desktop${NC}"
echo -e "   • Application menu: ${YELLOW}$APPS_DIR/orca-slicer.desktop${NC}"

if [ -n "$ICON_PATH" ] && [ -f "$ICON_PATH" ]; then
    echo -e "   • Icon: ${YELLOW}$ICON_PATH${NC}"
fi

echo
echo -e "${CYAN}🚀 Starting:${NC}"
echo -e "   • Desktop: Double-click on OrcaSlicer icon"
echo -e "   • Terminal: ${YELLOW}orca-slicer${NC}"
echo -e "   • Application menu: Search for 'OrcaSlicer'"
echo