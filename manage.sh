#!/bin/bash
# 3D Printer Web App - Service Management
# Usage: ./manage.sh [COMMAND]
#
# Web App: start|stop|restart|status|logs|config|update|deploy
# License Server: license|license-start|license-stop|license-restart|license-status|license-logs|license-info
# System: pwa|health|info|cloudflare|desktop|access

APP_NAME="printer-web-app"
# Automatically detect app directory (where this script is located)
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="printer-web-app.service"

# License Server
LICENSE_SERVICE="license-server.service"
LICENSE_DIR="/opt/license-server"

# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Load external domain from config.json
get_external_domain() {
    if [ -f "$APP_DIR/data/config.json" ]; then
        EXTERNAL_DOMAIN=$(python3 -c "import json; print(json.load(open('$APP_DIR/data/config.json')).get('external_domain', ''))" 2>/dev/null)
        echo "${EXTERNAL_DOMAIN}"
    else
        echo ""
    fi
}

# Get external domain
EXTERNAL_DOMAIN=$(get_external_domain)

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Funktionen
start_service() {
    print_status "Starte $APP_NAME..."
    sudo systemctl start $SERVICE_NAME
    sleep 2
    if sudo systemctl is-active --quiet $SERVICE_NAME; then
        print_success "Service gestartet!"
        show_access_info
    else
        print_error "Service konnte nicht gestartet werden!"
        sudo systemctl status $SERVICE_NAME
    fi
}

stop_service() {
    print_status "Stoppe $APP_NAME..."
    sudo systemctl stop $SERVICE_NAME
    print_success "Service gestoppt!"
}

restart_service() {
    print_status "Starte $APP_NAME neu..."
    sudo systemctl restart $SERVICE_NAME
    sleep 3
    if sudo systemctl is-active --quiet $SERVICE_NAME; then
        print_success "Service erfolgreich neu gestartet!"
        show_access_info
    else
        print_error "Neustart fehlgeschlagen!"
        sudo systemctl status $SERVICE_NAME
    fi
}

show_status() {
    echo -e "${BLUE}=== Service Status ===${NC}"
    sudo systemctl status $SERVICE_NAME --no-pager
    echo
    echo -e "${BLUE}=== Resource Usage ===${NC}"
    ps aux | grep -E "(web_app|printer)" | grep -v grep
    echo
    echo -e "${BLUE}=== Network Connections ===${NC}"
    sudo netstat -tlnp | grep :5555 || echo "Port 5555 nicht gebunden"
    sudo netstat -tlnp | grep :443 || echo "Port 443 nicht gebunden"
}

show_logs() {
    echo -e "${BLUE}=== Live Logs (Ctrl+C zum Beenden) ===${NC}"

    # Log-Datei Location (in data directory)
    LOG_FILE="$APP_DIR/data/printer.log"

    if [ -f "$LOG_FILE" ]; then
        echo -e "${YELLOW}Zeige Logs aus $LOG_FILE${NC}"
        echo -e "${YELLOW}Die letzten 100 Zeilen + neue Einträge${NC}"
        echo
        tail -n 100 -f "$LOG_FILE"  # -n 50 zeigt die letzten 50 Zeilen
    else
        # Fallback auf journalctl falls Log-Datei nicht existiert
        echo -e "${YELLOW}Log-Datei nicht gefunden, verwende System-Logs${NC}"
        sudo journalctl -u $SERVICE_NAME -n 100 -f --no-pager
    fi
}

edit_config() {
    if [ -f "$APP_DIR/data/config.json" ]; then
        print_status "Öffne Konfiguration..."
        sudo nano "$APP_DIR/data/config.json"

        read -p "Konfiguration geändert? Service neu starten? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            restart_service
        fi
    else
        print_error "Konfigurationsdatei nicht gefunden: $APP_DIR/data/config.json"
    fi
}

update_app() {
    print_status "Aktualisiere App..."

    # Backup der Konfiguration
    if [ -f "$APP_DIR/data/config.json" ]; then
        cp "$APP_DIR/data/config.json" "$APP_DIR/data/config.json.backup"
        print_status "Konfiguration gesichert"
    fi

    # Service stoppen
    sudo systemctl stop $SERVICE_NAME

    # Git Pull
    cd "$APP_DIR"
    print_status "Lade Updates von GitHub..."
    git pull

    # Plattform erkennen und .so Dateien deployen
    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64|amd64) PLATFORM="x86_64" ;;
        aarch64|arm64) PLATFORM="aarch64" ;;
        *) PLATFORM="" ;;
    esac

    DIST_SOURCE="dist_${PLATFORM}"
    if [ -n "$PLATFORM" ] && [ -d "$DIST_SOURCE" ]; then
        print_status "Deploye $DIST_SOURCE → dist/ ($PLATFORM)"
        rm -rf dist
        cp -r "$DIST_SOURCE" dist
        SO_COUNT=$(find dist -name '*.so' 2>/dev/null | wc -l)
        print_success "$SO_COUNT .so Dateien deployed ($PLATFORM)"
    else
        print_warning "Kein $DIST_SOURCE Ordner gefunden - überspringe .so Deployment"
    fi

    # Dependencies aktualisieren
    if [ -d "venv" ]; then
        source venv/bin/activate
        pip install --upgrade -r requirements.txt -q
    fi

    # Service wieder starten
    sudo systemctl start $SERVICE_NAME

    sleep 2
    if sudo systemctl is-active --quiet $SERVICE_NAME; then
        print_success "Update abgeschlossen! Service läuft."
    else
        print_error "Service konnte nicht gestartet werden!"
        echo "Prüfe mit: sudo journalctl -u $SERVICE_NAME -n 50"
    fi
}

show_access_info() {
    IP_ADDRESS=$(hostname -I | awk '{print $1}')
    echo
    echo -e "${GREEN}=== Zugriff auf Web App ===${NC}"
    echo "🔒 Lokal HTTPS:    https://$IP_ADDRESS:5555"
    if [ -n "$EXTERNAL_DOMAIN" ]; then
        echo "🌐 Extern:         https://$EXTERNAL_DOMAIN (via Cloudflare)"
        echo "📱 Mobile Lokal:   https://$IP_ADDRESS:5555"
        echo "📱 Mobile Extern:  https://$EXTERNAL_DOMAIN"
    else
        echo "📱 Mobile Lokal:   https://$IP_ADDRESS:5555"
    fi
    echo "⚠️  Lokal: Selbst-signiertes Zertifikat → 'Trotzdem fortfahren'"
    if [ -n "$EXTERNAL_DOMAIN" ]; then
        echo "✅ Extern: Gültiges SSL via Cloudflare"
    fi
    echo
}

install_desktop_shortcut() {
    DESKTOP_FILE="$HOME/Desktop/printer-web-app.desktop"
    IP_ADDRESS=$(hostname -I | awk '{print $1}')

    cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=3D Printer Web App (HTTPS)
Comment=3D Drucker Dashboard - Sichere Verbindung
Exec=xdg-open https://$IP_ADDRESS:5555
Icon=applications-internet
Terminal=false
Categories=Network;
EOF

    chmod +x "$DESKTOP_FILE"
    print_success "Desktop-Verknüpfung erstellt: $DESKTOP_FILE"
}

show_system_info() {
    echo -e "${BLUE}=== System Information ===${NC}"
    echo "Hostname: $(hostname)"
    echo "IP Address: $(hostname -I | awk '{print $1}')"
    echo "OS: $(lsb_release -d | cut -f2)"
    echo "Kernel: $(uname -r)"
    echo "Uptime: $(uptime -p)"
    echo
    echo -e "${BLUE}=== App Information ===${NC}"
    echo "App Directory: $APP_DIR"
    echo "Config File: $APP_DIR/data/config.json"
    echo "Service File: /etc/systemd/system/$SERVICE_NAME"
    echo "Python Version: $(cd $APP_DIR && source venv/bin/activate && python --version)"
    echo
    echo -e "${BLUE}=== Cloudflare Tunnel Status ===${NC}"
    if sudo systemctl is-active --quiet cloudflared; then
        echo "Cloudflare Tunnel: ✅ Aktiv"
        if [ -n "$EXTERNAL_DOMAIN" ]; then
            echo "Externe URL: https://$EXTERNAL_DOMAIN"
        fi
    else
        echo "Cloudflare Tunnel: ❌ Nicht aktiv"
    fi
    echo
    echo -e "${BLUE}=== SSL Certificate ===${NC}"
    if [ -f "$APP_DIR/data/cert.pem" ]; then
        echo "Certificate: $APP_DIR/data/cert.pem ✅"
        echo "Private Key: $APP_DIR/data/key.pem ✅"
        if [ -f "$APP_DIR/data/cert.cer" ]; then
            echo "Windows Cert: $APP_DIR/data/cert.cer ✅"
        else
            echo "Windows Cert: $APP_DIR/data/cert.cer ❌"
        fi
    else
        print_error "SSL-Zertifikat nicht gefunden in $APP_DIR/data/"
    fi
    echo
    echo -e "${BLUE}=== Port Status ===${NC}"
    sudo netstat -tlnp | grep -E ":80|:443|:5555|:8883|:8888" | while read line; do
        echo "  $line"
    done
}

setup_pwa() {
    print_status "Richte PWA-Unterstützung ein..."
    echo

    # Zertifikat Check und erstellen falls nötig
    if [ ! -f "$APP_DIR/data/cert.pem" ]; then
        print_warning "Kein SSL-Zertifikat gefunden - erstelle neues..."
        mkdir -p "$APP_DIR/data"
        cd "$APP_DIR/data"

        # PWA-Zertifikat erstellen
        cat > create_cert_pwa.py << 'EOL'
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
import datetime
import ipaddress
import socket

# Private Key generieren
private_key = rsa.generate_private_key(
    public_exponent=65537,
    key_size=2048,
    backend=default_backend()
)

# IP-Adresse automatisch ermitteln
hostname = socket.gethostname()
local_ip = socket.gethostbyname(socket.gethostname())

# PWA-freundliches Zertifikat
subject = issuer = x509.Name([
    x509.NameAttribute(NameOID.COUNTRY_NAME, u"DE"),
    x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, u"Deutschland"),
    x509.NameAttribute(NameOID.LOCALITY_NAME, u"Local"),
    x509.NameAttribute(NameOID.ORGANIZATION_NAME, u"3D Printer PWA"),
    x509.NameAttribute(NameOID.COMMON_NAME, u"3d-printer.local"),
])

cert = x509.CertificateBuilder().subject_name(
    subject
).issuer_name(
    issuer
).public_key(
    private_key.public_key()
).serial_number(
    x509.random_serial_number()
).not_valid_before(
    datetime.datetime.now(datetime.UTC)
).not_valid_after(
    datetime.datetime.now(datetime.UTC) + datetime.timedelta(days=365)
).add_extension(
    x509.SubjectAlternativeName([
        x509.IPAddress(ipaddress.IPv4Address(local_ip)),
        x509.DNSName(u"3d-printer.local"),
        x509.DNSName(u"pi5.local"),
        x509.DNSName(u"localhost"),
    ]),
    critical=False,
).sign(private_key, hashes.SHA256(), default_backend())

# PEM und CER Format
with open("cert.pem", "wb") as f:
    f.write(cert.public_bytes(serialization.Encoding.PEM))

with open("cert.cer", "wb") as f:
    f.write(cert.public_bytes(serialization.Encoding.DER))

with open("key.pem", "wb") as f:
    f.write(private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    ))

print("✅ PWA-Zertifikat erstellt für IP:", local_ip)
EOL

        source venv/bin/activate
        python3 create_cert_pwa.py
        rm create_cert_pwa.py

        # Service neu starten für neues Zertifikat
        sudo systemctl restart $SERVICE_NAME
        print_success "Neues SSL-Zertifikat erstellt und Service neu gestartet"
    else
        print_success "✅ SSL-Zertifikat bereits vorhanden"
    fi

    echo
    echo -e "${BLUE}=== PWA Setup Anleitung ===${NC}"
    echo
    echo -e "${YELLOW}Schritt 1 - Windows Hosts-Datei:${NC}"
    echo "Als Administrator: C:\\Windows\\System32\\drivers\\etc\\hosts"
    echo "Zeile hinzufügen: $(hostname -I | awk '{print $1}')    3d-printer.local"
    echo

    echo -e "${YELLOW}Schritt 2 - Zertifikat nach Windows:${NC}"
    if [ -f "$APP_DIR/cert.cer" ]; then
        echo "Download: scp pi@$(hostname -I | awk '{print $1}'):$APP_DIR/cert.cer ."
        echo "PowerShell (als Admin): Import-Certificate -FilePath cert.cer -CertStoreLocation Cert:\\LocalMachine\\Root"
    fi
    echo

    echo -e "${YELLOW}Schritt 3 - PWA Installation:${NC}"
    echo "1. https://3d-printer.local:5555 aufrufen"
    echo "2. 'Trotzdem fortfahren' bei Zertifikatswarnung"
    echo "3. Chrome: ⋮ → App installieren"
    echo "4. Edge: ⋮ → Apps → Diese Seite als App installieren"
    echo

    echo -e "${YELLOW}Alternative - Browser Flags:${NC}"
    echo "Chrome: chrome://flags/#unsafely-treat-insecure-origin-as-secure"
    echo "Hinzufügen: https://3d-printer.local:5555"
    echo
}

check_health() {
    echo -e "${BLUE}=== Health Check ===${NC}"

    # Service Status
    if sudo systemctl is-active --quiet $SERVICE_NAME; then
        print_success "✅ Service läuft"
    else
        print_error "❌ Service nicht aktiv"
    fi

    # Port Check
    if sudo netstat -tlnp | grep -q :5555; then
        print_success "✅ Port 5555 gebunden"
    else
        print_error "❌ Port 5555 nicht erreichbar"
    fi

    # SSL Check
    if [ -f "$APP_DIR/data/cert.pem" ] && [ -f "$APP_DIR/data/key.pem" ]; then
        print_success "✅ SSL-Zertifikat vorhanden"
    else
        print_error "❌ SSL-Zertifikat fehlt (in $APP_DIR/data/)"
    fi

    # Config Check
    if [ -f "$APP_DIR/data/config.json" ]; then
        if python3 -c "import json; json.load(open('$APP_DIR/data/config.json'))" 2>/dev/null; then
            print_success "✅ Konfiguration gültig"
        else
            print_error "❌ Konfiguration fehlerhaft"
        fi
    else
        print_error "❌ Konfigurationsdatei fehlt"
    fi

    # HTTPS Check
    HTTP_CODE=$(curl -k -s -o /dev/null -w "%{http_code}" --connect-timeout 5 https://localhost:5555)
    if [ "$HTTP_CODE" == "200" ] || [ "$HTTP_CODE" == "302" ] || [ "$HTTP_CODE" == "301" ]; then
        print_success "✅ HTTPS Endpoint erreichbar (Code: $HTTP_CODE)"
    else
        # Fallback: Teste mit IP
        IP_ADDRESS=$(hostname -I | awk '{print $1}')
        HTTP_CODE2=$(curl -k -s -o /dev/null -w "%{http_code}" --connect-timeout 5 https://$IP_ADDRESS:5555)
        if [ "$HTTP_CODE2" == "200" ] || [ "$HTTP_CODE2" == "302" ] || [ "$HTTP_CODE2" == "301" ]; then
            print_success "✅ HTTPS Endpoint erreichbar via IP (Code: $HTTP_CODE2)"
        else
            print_warning "⚠️ HTTPS Endpoint lokal nicht testbar (Cloudflare Origin Cert)"
            if [ -n "$EXTERNAL_DOMAIN" ]; then
                print_status "   Teste externe URL..."
                if curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "https://$EXTERNAL_DOMAIN" | grep -q "200\|301\|302"; then
                    print_success "   ✅ Externe URL erreichbar"
                else
                    print_error "   ❌ Auch externe URL nicht erreichbar"
                fi
            else
                print_status "   Keine externe Domain konfiguriert"
            fi
        fi
    fi

    # Cloudflare Tunnel Check
    if sudo systemctl is-active --quiet cloudflared; then
        print_success "✅ Cloudflare Tunnel läuft"
    else
        print_warning "⚠️ Cloudflare Tunnel nicht aktiv (externe Zugriffe nicht möglich)"
    fi

    # Disk Space
    DISK_USAGE=$(df $APP_DIR | awk 'NR==2 {print $5}' | sed 's/%//')
    if [ "$DISK_USAGE" -lt 90 ]; then
        print_success "✅ Festplattenspeicher OK ($DISK_USAGE%)"
    else
        print_warning "⚠️  Festplattenspeicher knapp ($DISK_USAGE%)"
    fi
}

manage_cloudflare() {
    echo -e "${BLUE}=== Cloudflare Tunnel Management ===${NC}"
    echo
    echo "1) Status anzeigen"
    echo "2) Tunnel starten"
    echo "3) Tunnel stoppen"
    echo "4) Tunnel neustarten"
    echo "5) Logs anzeigen"
    echo
    read -p "Auswahl (1-5): " choice

    case $choice in
        1)
            sudo systemctl status cloudflared --no-pager
            ;;
        2)
            sudo systemctl start cloudflared
            print_success "Cloudflare Tunnel gestartet"
            ;;
        3)
            sudo systemctl stop cloudflared
            print_success "Cloudflare Tunnel gestoppt"
            ;;
        4)
            sudo systemctl restart cloudflared
            print_success "Cloudflare Tunnel neu gestartet"
            ;;
        5)
            sudo journalctl -u cloudflared -f --no-pager
            ;;
        *)
            print_error "Ungültige Auswahl"
            ;;
    esac
}

# ==================== DEPLOY FUNKTIONEN ====================

deploy_app() {
    cd "$APP_DIR"

    # Git Pull
    print_status "Git Pull..."
    git pull origin main

    # Plattform erkennen und .so Dateien deployen
    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64|amd64) PLATFORM="x86_64" ;;
        aarch64|arm64) PLATFORM="aarch64" ;;
        *) PLATFORM="" ;;
    esac

    DIST_SOURCE="dist_${PLATFORM}"
    if [ -n "$PLATFORM" ] && [ -d "$DIST_SOURCE" ]; then
        print_status "Deploye $DIST_SOURCE → dist/ ($PLATFORM)"
        rm -rf dist
        cp -r "$DIST_SOURCE" dist
        SO_COUNT=$(find dist -name '*.so' 2>/dev/null | wc -l)
        print_success "$SO_COUNT .so Dateien deployed ($PLATFORM)"
    fi

    # Restart
    sudo systemctl restart printer-web-app

    sleep 2
    if sudo systemctl is-active --quiet printer-web-app; then
        print_success "Deployment erfolgreich! Service läuft."
    else
        print_error "Service konnte nicht gestartet werden!"
    fi
}

# ==================== LICENSE SERVER FUNKTIONEN ====================

license_start() {
    print_status "Starte License Server..."
    if [ ! -d "$LICENSE_DIR" ]; then
        print_error "License Server nicht installiert: $LICENSE_DIR"
        print_status "Führe './license_server/install.sh' aus, um den License Server zu installieren"
        exit 1
    fi

    sudo systemctl start $LICENSE_SERVICE
    sleep 2
    if sudo systemctl is-active --quiet $LICENSE_SERVICE; then
        print_success "License Server gestartet!"
        license_show_info
    else
        print_error "License Server konnte nicht gestartet werden!"
        sudo systemctl status $LICENSE_SERVICE
    fi
}

license_stop() {
    print_status "Stoppe License Server..."
    sudo systemctl stop $LICENSE_SERVICE
    print_success "License Server gestoppt!"
}

license_restart() {
    print_status "Starte License Server neu..."
    sudo systemctl restart $LICENSE_SERVICE
    sleep 2
    if sudo systemctl is-active --quiet $LICENSE_SERVICE; then
        print_success "License Server erfolgreich neu gestartet!"
        license_show_info
    else
        print_error "Neustart fehlgeschlagen!"
        sudo systemctl status $LICENSE_SERVICE
    fi
}

license_status() {
    echo -e "${BLUE}=== License Server Status ===${NC}"
    sudo systemctl status $LICENSE_SERVICE --no-pager
    echo
    echo -e "${BLUE}=== Port Status ===${NC}"
    sudo netstat -tlnp | grep :5556 || echo "Port 5556 nicht gebunden"
    echo
    echo -e "${BLUE}=== Recent Logs ===${NC}"
    if [ -f "$LICENSE_DIR/logs/license-server.log" ]; then
        tail -n 20 "$LICENSE_DIR/logs/license-server.log"
    else
        sudo journalctl -u $LICENSE_SERVICE -n 20 --no-pager
    fi
}

license_logs() {
    echo -e "${BLUE}=== License Server Live Logs (Ctrl+C zum Beenden) ===${NC}"
    echo

    LOG_FILE="$LICENSE_DIR/logs/license-server.log"
    ERROR_LOG="$LICENSE_DIR/logs/license-server-error.log"

    if [ -f "$LOG_FILE" ]; then
        echo -e "${YELLOW}Zeige Logs aus $LOG_FILE${NC}"
        echo -e "${YELLOW}Die letzten 30 Zeilen + neue Einträge${NC}"
        echo
        tail -n 30 -f "$LOG_FILE" "$ERROR_LOG" 2>/dev/null
    else
        echo -e "${YELLOW}Log-Datei nicht gefunden, verwende System-Logs${NC}"
        sudo journalctl -u $LICENSE_SERVICE -n 30 -f --no-pager
    fi
}

license_show_info() {
    IP_ADDRESS=$(hostname -I | awk '{print $1}')
    echo
    echo -e "${GREEN}=== License Server Zugriff ===${NC}"
    echo "🔒 URL:              http://$IP_ADDRESS:5556"
    echo "📁 Verzeichnis:      $LICENSE_DIR"
    echo "📋 Logs:             $LICENSE_DIR/logs/"
    echo "🔑 Public Key:       $LICENSE_DIR/public_key.pem"
    echo "🔐 Private Key:      $LICENSE_DIR/private_key.pem"
    echo "💾 Lizenzdatenbank:  $LICENSE_DIR/licenses_db.json"
    echo
}

license_manage() {
    echo -e "${BLUE}=== License Server Management ===${NC}"
    echo

    # Status prüfen
    if sudo systemctl is-active --quiet $LICENSE_SERVICE; then
        print_success "Status: ✅ Läuft"
    else
        print_warning "Status: ❌ Gestoppt"
    fi

    echo
    echo "1) Starten"
    echo "2) Stoppen"
    echo "3) Neustarten"
    echo "4) Status anzeigen"
    echo "5) Logs anzeigen"
    echo "6) Info anzeigen"
    echo
    read -p "Auswahl (1-6): " choice

    case $choice in
        1)
            license_start
            ;;
        2)
            license_stop
            ;;
        3)
            license_restart
            ;;
        4)
            license_status
            ;;
        5)
            license_logs
            ;;
        6)
            license_show_info
            ;;
        *)
            print_error "Ungültige Auswahl"
            ;;
    esac
}

show_help() {
    echo -e "${BLUE}3D Printer Web App - Service Manager (HTTPS)${NC}"
    echo
    echo "Usage: $0 [COMMAND]"
    echo
    echo -e "${GREEN}=== Web App Commands ===${NC}"
    echo "  start           Startet den Web App Service"
    echo "  stop            Stoppt den Web App Service"
    echo "  restart         Startet den Service neu"
    echo "  status          Zeigt Service-Status und Systeminfo"
    echo "  logs            Zeigt Live-Logs"
    echo "  config          Bearbeitet die Konfigurationsdatei"
    echo "  update          Aktualisiert App und Dependencies"
    echo "  deploy          Git Pull + Service Restart (wie deploy.sh)"
    echo
    echo -e "${GREEN}=== License Server Commands ===${NC}"
    echo "  license         License Server Management-Menü"
    echo "  license-start   Startet den License Server"
    echo "  license-stop    Stoppt den License Server"
    echo "  license-restart Startet den License Server neu"
    echo "  license-status  Zeigt License Server Status"
    echo "  license-logs    Zeigt License Server Logs"
    echo "  license-info    Zeigt License Server Info"
    echo
    echo -e "${GREEN}=== System Commands ===${NC}"
    echo "  cloudflare      Verwaltet Cloudflare Tunnel"
    echo "  pwa             PWA-Setup Anleitung und Zertifikat-Erstellung"
    echo "  health          Führt System-Health-Check durch"
    echo "  info            Zeigt detaillierte Systeminfos"
    echo "  desktop         Erstellt Desktop-Verknüpfung"
    echo "  access          Zeigt Zugriffsinformationen"
    echo
    echo "Beispiele:"
    echo "  $0 restart          # Web App Service neu starten"
    echo "  $0 logs             # Web App Live-Logs anzeigen"
    echo "  $0 deploy           # Git Pull + Restart (Deployment)"
    echo "  $0 license          # License Server Menü"
    echo "  $0 license-restart  # License Server neu starten"
    echo "  $0 health           # System prüfen"
}

# Hauptlogik
case "$1" in
    # Web App Commands
    start)
        start_service
        ;;
    stop)
        stop_service
        ;;
    restart)
        restart_service
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs
        ;;
    config)
        edit_config
        ;;
    update)
        update_app
        ;;
    deploy)
        deploy_app
        ;;

    # License Server Commands
    license)
        license_manage
        ;;
    license-start)
        license_start
        ;;
    license-stop)
        license_stop
        ;;
    license-restart)
        license_restart
        ;;
    license-status)
        license_status
        ;;
    license-logs)
        license_logs
        ;;
    license-info)
        license_show_info
        ;;

    # System Commands
    pwa)
        setup_pwa
        ;;
    health)
        check_health
        ;;
    info)
        show_system_info
        ;;
    cloudflare)
        manage_cloudflare
        ;;
    desktop)
        install_desktop_shortcut
        ;;
    access)
        show_access_info
        ;;

    # Help
    *)
        show_help
        exit 1
        ;;
esac
