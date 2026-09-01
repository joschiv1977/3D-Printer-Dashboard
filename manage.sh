#!/bin/bash
# 3D Printer Web App - Service Management (Cross-Platform: macOS + Linux)
# Usage: ./manage.sh [COMMAND]
#
# Web App: start|stop|restart|status|logs|config|update|deploy
# System: pwa|health|info|cloudflare|access

APP_NAME="printer-web-app"
# Automatically detect app directory (where this script is located)
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ==================== OS DETECTION ====================
OS_TYPE="$(uname -s)"
case "$OS_TYPE" in
    Darwin)
        IS_MACOS=true
        IS_LINUX=false
        PLIST_LABEL="com.printerwebapp"
        PLIST_FILE="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
        ;;
    Linux)
        IS_MACOS=false
        IS_LINUX=true
        SERVICE_NAME="printer-web-app.service"
        ;;
    *)
        echo "Unsupported OS: $OS_TYPE"
        exit 1
        ;;
esac


# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ==================== HELPER FUNCTIONS ====================

# Load external domain from config.json
get_external_domain() {
    if [ -f "$APP_DIR/data/config.json" ]; then
        EXTERNAL_DOMAIN=$("$APP_DIR/venv/bin/python3" -c "import json; print(json.load(open('$APP_DIR/data/config.json')).get('external_domain', ''))" 2>/dev/null)
        echo "${EXTERNAL_DOMAIN}"
    else
        echo ""
    fi
}

# Get IP address (cross-platform)
get_ip_address() {
    if $IS_MACOS; then
        # Prefer en0 (WiFi/Ethernet), fallback to other interfaces
        IP=$(ipconfig getifaddr en0 2>/dev/null)
        if [ -z "$IP" ]; then
            IP=$(ipconfig getifaddr en1 2>/dev/null)
        fi
        if [ -z "$IP" ]; then
            IP=$(ifconfig | grep 'inet ' | grep -v '127.0.0.1' | head -1 | awk '{print $2}')
        fi
        echo "${IP:-127.0.0.1}"
    else
        hostname -I | awk '{print $1}'
    fi
}

# Get external domain
EXTERNAL_DOMAIN=$(get_external_domain)

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[OK]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ==================== CAMERA SERVER - go2rtc (macOS) ====================

# Match OUR go2rtc only. `pgrep -f go2rtc` catches every process carrying the
# word in its command line -- on a machine running Home Assistant that
# includes its own (seen on the Pi, 01sep26). The config file name is unique.
GO2RTC_MUSTER="${GO2RTC_MUSTER:-go2rtc.yaml}"

# Check if camera server should be used (macOS + ustreamer enabled in config)
should_use_camera_server() {
    if $IS_MACOS && [ -f "$APP_DIR/data/config.json" ]; then
        USTREAMER_ENABLED=$("$APP_DIR/venv/bin/python3" -c "import json; print(json.load(open('$APP_DIR/data/config.json')).get('ustreamer',{}).get('enabled', False))" 2>/dev/null)
        [ "$USTREAMER_ENABLED" = "True" ]
    else
        return 1
    fi
}

CAMERA_PLIST_LABEL="com.printerwebapp.camera"
CAMERA_PLIST_FILE="$HOME/Library/LaunchAgents/${CAMERA_PLIST_LABEL}.plist"

start_camera_server() {
    if ! should_use_camera_server; then
        return
    fi

    if pgrep -f "$GO2RTC_MUSTER" &>/dev/null; then
        print_status "Camera Server (go2rtc) bereits gestartet"
        return
    fi

    if [ -f "$CAMERA_PLIST_FILE" ]; then
        print_status "Starte Camera Server (go2rtc via launchctl)..."
        launchctl load "$CAMERA_PLIST_FILE" 2>/dev/null
        sleep 2
        if pgrep -f "$GO2RTC_MUSTER" &>/dev/null; then
            print_success "Camera Server (go2rtc) gestartet"
        else
            print_error "Camera Server (go2rtc) konnte nicht gestartet werden"
        fi
    else
        print_warning "Camera LaunchAgent nicht gefunden: $CAMERA_PLIST_FILE"
    fi
}

stop_camera_server() {
    if pgrep -f "$GO2RTC_MUSTER" &>/dev/null; then
        print_status "Stoppe Camera Server (go2rtc)..."
        if [ -f "$CAMERA_PLIST_FILE" ]; then
            launchctl unload "$CAMERA_PLIST_FILE" 2>/dev/null
        fi
        pkill -f "$GO2RTC_MUSTER" 2>/dev/null
        sleep 1
        print_success "Camera Server (go2rtc) gestoppt"
    fi
}

restart_camera_server() {
    stop_camera_server
    sleep 1
    start_camera_server
}

# ==================== SERVICE MANAGEMENT ====================

# Check if service is running
is_service_running() {
    if $IS_MACOS; then
        launchctl list "$PLIST_LABEL" &>/dev/null && \
        launchctl list "$PLIST_LABEL" 2>/dev/null | grep -q '"PID"'
    else
        sudo systemctl is-active --quiet $SERVICE_NAME
    fi
}

start_service() {
    print_status "Starte $APP_NAME..."
    if $IS_MACOS; then
        start_camera_server
        if launchctl list "$PLIST_LABEL" &>/dev/null; then
            print_warning "Service bereits geladen - starte neu..."
            launchctl kickstart -k "gui/$(id -u)/$PLIST_LABEL"
        else
            launchctl load "$PLIST_FILE"
        fi
        sleep 3
        if is_service_running; then
            print_success "Service gestartet!"
            show_access_info
        else
            print_error "Service konnte nicht gestartet werden!"
            echo "Prüfe Logs: tail -f $APP_DIR/logs/app-error.log"
            launchctl list "$PLIST_LABEL" 2>/dev/null
        fi
    else
        sudo systemctl start $SERVICE_NAME
        sleep 2
        if is_service_running; then
            print_success "Service gestartet!"
            show_access_info
        else
            print_error "Service konnte nicht gestartet werden!"
            sudo systemctl status $SERVICE_NAME
        fi
    fi
}

stop_service() {
    print_status "Stoppe $APP_NAME..."
    if $IS_MACOS; then
        stop_camera_server
        if launchctl list "$PLIST_LABEL" &>/dev/null; then
            launchctl unload "$PLIST_FILE"
            sleep 1
            print_success "Service gestoppt!"
        else
            print_warning "Service war nicht geladen"
        fi
    else
        sudo systemctl stop $SERVICE_NAME
        print_success "Service gestoppt!"
    fi
}

restart_service() {
    print_status "Starte $APP_NAME neu..."
    if $IS_MACOS; then
        stop_camera_server
        start_camera_server
        if launchctl list "$PLIST_LABEL" &>/dev/null; then
            launchctl kickstart -k "gui/$(id -u)/$PLIST_LABEL"
        else
            launchctl load "$PLIST_FILE"
        fi
        sleep 3
        if is_service_running; then
            print_success "Service erfolgreich neu gestartet!"
            show_access_info
        else
            print_error "Neustart fehlgeschlagen!"
            echo "Prüfe Logs: tail -f $APP_DIR/logs/app-error.log"
        fi
    else
        sudo systemctl restart $SERVICE_NAME
        sleep 3
        if is_service_running; then
            print_success "Service erfolgreich neu gestartet!"
            show_access_info
        else
            print_error "Neustart fehlgeschlagen!"
            sudo systemctl status $SERVICE_NAME
        fi
    fi
}

show_status() {
    echo -e "${BLUE}=== Service Status ===${NC}"

    if $IS_MACOS; then
        if launchctl list "$PLIST_LABEL" &>/dev/null; then
            launchctl list "$PLIST_LABEL"
            echo
            # PID anzeigen
            PID=$(launchctl list "$PLIST_LABEL" 2>/dev/null | grep '"PID"' | awk '{print $NF}' | tr -d ';')
            if [ -n "$PID" ] && [ "$PID" != "0" ]; then
                print_success "Service läuft (PID: $PID)"
            else
                EXIT_CODE=$(launchctl list "$PLIST_LABEL" 2>/dev/null | grep 'LastExitStatus' | awk '{print $NF}' | tr -d ';')
                print_error "Service nicht aktiv (LastExitStatus: $EXIT_CODE)"
            fi
        else
            print_error "Service nicht geladen"
            echo "Starten mit: ./manage.sh start"
        fi
    else
        sudo systemctl status $SERVICE_NAME --no-pager
    fi

    echo
    echo -e "${BLUE}=== Resource Usage ===${NC}"
    ps aux | grep -E "(start\.py|web_app)" | grep -v grep
    echo

    echo -e "${BLUE}=== Network Connections ===${NC}"
    if $IS_MACOS; then
        lsof -i :5555 -P -n 2>/dev/null | head -5 || echo "Port 5555 nicht gebunden"
    else
        sudo netstat -tlnp | grep :5555 || echo "Port 5555 nicht gebunden"
        sudo netstat -tlnp | grep :443 || echo "Port 443 nicht gebunden"
    fi
}

show_logs() {
    echo -e "${BLUE}=== Live Logs (Ctrl+C zum Beenden) ===${NC}"

    # Log-Datei Location (in data directory)
    LOG_FILE="$APP_DIR/data/printer.log"

    if [ -f "$LOG_FILE" ]; then
        echo -e "${YELLOW}Zeige Logs aus $LOG_FILE${NC}"
        echo -e "${YELLOW}Die letzten 100 Zeilen + neue Einträge${NC}"
        echo
        tail -n 100 -f "$LOG_FILE"
    else
        if $IS_MACOS; then
            # macOS: Gunicorn stdout/error logs
            STDOUT_LOG="$APP_DIR/logs/app-stdout.log"
            ERROR_LOG="$APP_DIR/logs/app-error.log"
            if [ -f "$STDOUT_LOG" ]; then
                echo -e "${YELLOW}Zeige App Logs${NC}"
                tail -n 100 -f "$STDOUT_LOG" "$ERROR_LOG" 2>/dev/null
            else
                print_error "Keine Log-Dateien gefunden"
            fi
        else
            echo -e "${YELLOW}Log-Datei nicht gefunden, verwende System-Logs${NC}"
            sudo journalctl -u $SERVICE_NAME -n 100 -f --no-pager
        fi
    fi
}

edit_config() {
    if [ -f "$APP_DIR/data/config.json" ]; then
        print_status "Öffne Konfiguration..."
        if $IS_MACOS; then
            # macOS: nano oder default editor
            nano "$APP_DIR/data/config.json"
        else
            sudo nano "$APP_DIR/data/config.json"
        fi

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
    stop_service

    # Dependencies aktualisieren
    cd "$APP_DIR"
    source venv/bin/activate
    pip install --upgrade -r requirements.txt

    print_status "Gib neue App-Dateien ein (web_app.py, templates/index.html)"
    read -p "Dateien aktualisiert? Weiter mit Enter..."

    # Service wieder starten
    start_service

    print_success "Update abgeschlossen!"
}

show_access_info() {
    IP_ADDRESS=$(get_ip_address)
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
    echo "⚠️  Lokal: Selbst-signiertes Zertifikat -> 'Trotzdem fortfahren'"
    if [ -n "$EXTERNAL_DOMAIN" ]; then
        echo "✅ Extern: Gültiges SSL via Cloudflare"
    fi
    echo
}

show_system_info() {
    echo -e "${BLUE}=== System Information ===${NC}"
    echo "Hostname: $(hostname)"
    echo "IP Address: $(get_ip_address)"

    if $IS_MACOS; then
        echo "OS: $(sw_vers -productName) $(sw_vers -productVersion) ($(uname -m))"
        echo "Kernel: $(uname -r)"
        echo "Uptime: $(uptime | sed 's/.*up /up /' | sed 's/,.*//')"
    else
        echo "OS: $(lsb_release -d 2>/dev/null | cut -f2 || cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '"')"
        echo "Kernel: $(uname -r)"
        echo "Uptime: $(uptime -p 2>/dev/null || uptime)"
    fi

    echo
    echo -e "${BLUE}=== App Information ===${NC}"
    echo "App Directory: $APP_DIR"
    echo "Config File: $APP_DIR/data/config.json"
    if $IS_MACOS; then
        echo "Service Plist: $PLIST_FILE"
    else
        echo "Service File: /etc/systemd/system/$SERVICE_NAME"
    fi
    echo "Python Version: $("$APP_DIR/venv/bin/python3" --version 2>&1)"
    echo "Flask Version: $("$APP_DIR/venv/bin/pip" show flask 2>/dev/null | grep Version | awk '{print $2}')"

    echo
    echo -e "${BLUE}=== Cloudflare Tunnel Status ===${NC}"
    if $IS_MACOS; then
        if pgrep -x cloudflared &>/dev/null; then
            echo "Cloudflare Tunnel: ✅ Aktiv"
        elif brew services list 2>/dev/null | grep cloudflared | grep -q started; then
            echo "Cloudflare Tunnel: ✅ Aktiv (brew service)"
        else
            echo "Cloudflare Tunnel: ❌ Nicht aktiv"
        fi
    else
        if sudo systemctl is-active --quiet cloudflared; then
            echo "Cloudflare Tunnel: ✅ Aktiv"
        else
            echo "Cloudflare Tunnel: ❌ Nicht aktiv"
        fi
    fi
    if [ -n "$EXTERNAL_DOMAIN" ]; then
        echo "Externe URL: https://$EXTERNAL_DOMAIN"
    fi

    echo
    echo -e "${BLUE}=== SSL Certificate ===${NC}"
    if [ -f "$APP_DIR/data/cert.pem" ]; then
        echo "Certificate: $APP_DIR/data/cert.pem ✅"
        echo "Private Key: $APP_DIR/data/key.pem ✅"
        # Ablaufdatum anzeigen
        EXPIRY=$( openssl x509 -enddate -noout -in "$APP_DIR/data/cert.pem" 2>/dev/null | cut -d= -f2 )
        if [ -n "$EXPIRY" ]; then
            echo "Gültig bis: $EXPIRY"
        fi
        if [ -f "$APP_DIR/data/cert.cer" ]; then
            echo "Windows Cert: $APP_DIR/data/cert.cer ✅"
        fi
    else
        print_error "SSL-Zertifikat nicht gefunden in $APP_DIR/data/"
    fi

    echo
    echo -e "${BLUE}=== Log Files ===${NC}"
    if [ -f "$APP_DIR/data/printer.log" ]; then
        LOG_SIZE=$(du -h "$APP_DIR/data/printer.log" | awk '{print $1}')
        echo "App Log:     $APP_DIR/data/printer.log ($LOG_SIZE)"
    fi
    if [ -f "$APP_DIR/logs/app-stdout.log" ]; then
        LOG_SIZE=$(du -h "$APP_DIR/logs/app-stdout.log" | awk '{print $1}')
        echo "Stdout Log:  $APP_DIR/logs/app-stdout.log ($LOG_SIZE)"
    fi
    if [ -f "$APP_DIR/logs/app-error.log" ]; then
        LOG_SIZE=$(du -h "$APP_DIR/logs/app-error.log" | awk '{print $1}')
        echo "Error Log:   $APP_DIR/logs/app-error.log ($LOG_SIZE)"
    fi

    echo
    echo -e "${BLUE}=== Port Status ===${NC}"
    if $IS_MACOS; then
        lsof -i :5555 -P -n 2>/dev/null | grep LISTEN | head -3 || echo "  Port 5555 nicht gebunden"
        lsof -i :443 -P -n 2>/dev/null | grep LISTEN | head -3 || echo "  Port 443 nicht gebunden"
    else
        sudo netstat -tlnp | grep -E ":80|:443|:5555|:8883|:8888" | while read line; do
            echo "  $line"
        done
    fi
}

setup_pwa() {
    print_status "Richte PWA-Unterstützung ein..."
    echo

    # Zertifikat Check und erstellen falls nötig
    if [ ! -f "$APP_DIR/data/cert.pem" ]; then
        print_warning "Kein SSL-Zertifikat gefunden - erstelle neues..."
        mkdir -p "$APP_DIR/data"

        # PWA-Zertifikat erstellen
        "$APP_DIR/venv/bin/python3" - << 'PYEOF'
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
import datetime, ipaddress, socket, os

app_dir = os.environ.get('APP_DIR', '.')
data_dir = os.path.join(app_dir, 'data')

private_key = rsa.generate_private_key(
    public_exponent=65537, key_size=2048, backend=default_backend()
)

hostname = socket.gethostname()
try:
    local_ip = socket.gethostbyname(hostname)
except:
    local_ip = "127.0.0.1"

subject = issuer = x509.Name([
    x509.NameAttribute(NameOID.COUNTRY_NAME, u"DE"),
    x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, u"Deutschland"),
    x509.NameAttribute(NameOID.ORGANIZATION_NAME, u"3D Printer PWA"),
    x509.NameAttribute(NameOID.COMMON_NAME, u"3d-printer.local"),
])

cert = x509.CertificateBuilder().subject_name(subject).issuer_name(issuer).public_key(
    private_key.public_key()
).serial_number(x509.random_serial_number()).not_valid_before(
    datetime.datetime.now(datetime.UTC)
).not_valid_after(
    datetime.datetime.now(datetime.UTC) + datetime.timedelta(days=365)
).add_extension(
    x509.SubjectAlternativeName([
        x509.IPAddress(ipaddress.IPv4Address(local_ip)),
        x509.DNSName(u"3d-printer.local"),
        x509.DNSName(u"localhost"),
    ]), critical=False,
).sign(private_key, hashes.SHA256(), default_backend())

with open(os.path.join(data_dir, "cert.pem"), "wb") as f:
    f.write(cert.public_bytes(serialization.Encoding.PEM))
with open(os.path.join(data_dir, "cert.cer"), "wb") as f:
    f.write(cert.public_bytes(serialization.Encoding.DER))
with open(os.path.join(data_dir, "key.pem"), "wb") as f:
    f.write(private_key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption()
    ))
print(f"PWA-Zertifikat erstellt fuer IP: {local_ip}")
PYEOF

        restart_service
        print_success "Neues SSL-Zertifikat erstellt und Service neu gestartet"
    else
        print_success "SSL-Zertifikat bereits vorhanden"
    fi

    IP_ADDRESS=$(get_ip_address)
    echo
    echo -e "${BLUE}=== PWA Setup Anleitung ===${NC}"
    echo
    echo -e "${YELLOW}Schritt 1 - Hosts-Datei:${NC}"
    if $IS_MACOS; then
        echo "sudo nano /etc/hosts"
    else
        echo "Als Administrator: C:\\Windows\\System32\\drivers\\etc\\hosts"
    fi
    echo "Zeile hinzufügen: $IP_ADDRESS    3d-printer.local"
    echo

    echo -e "${YELLOW}Schritt 2 - Zertifikat installieren:${NC}"
    if $IS_MACOS; then
        echo "sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain $APP_DIR/data/cert.pem"
    else
        if [ -f "$APP_DIR/data/cert.cer" ]; then
            echo "Download: scp user@$IP_ADDRESS:$APP_DIR/data/cert.cer ."
            echo "PowerShell (als Admin): Import-Certificate -FilePath cert.cer -CertStoreLocation Cert:\\LocalMachine\\Root"
        fi
    fi
    echo

    echo -e "${YELLOW}Schritt 3 - PWA Installation:${NC}"
    echo "1. https://3d-printer.local:5555 aufrufen"
    echo "2. 'Trotzdem fortfahren' bei Zertifikatswarnung"
    echo "3. Chrome: ... -> App installieren"
    echo "4. Safari: Teilen -> Zum Home-Bildschirm (iOS)"
    echo
}

check_health() {
    echo -e "${BLUE}=== Health Check ===${NC}"

    # Service Status
    if is_service_running; then
        print_success "Service läuft"
    else
        print_error "Service nicht aktiv"
    fi

    # Port Check
    if $IS_MACOS; then
        if lsof -i :5555 -P -n 2>/dev/null | grep -q LISTEN; then
            print_success "Port 5555 gebunden"
        else
            print_error "Port 5555 nicht erreichbar"
        fi
    else
        if sudo netstat -tlnp | grep -q :5555; then
            print_success "Port 5555 gebunden"
        else
            print_error "Port 5555 nicht erreichbar"
        fi
    fi

    # SSL Check
    if [ -f "$APP_DIR/data/cert.pem" ] && [ -f "$APP_DIR/data/key.pem" ]; then
        print_success "SSL-Zertifikat vorhanden"
        # Check expiry
        if $IS_MACOS || command -v openssl &>/dev/null; then
            EXPIRY_DATE=$(openssl x509 -enddate -noout -in "$APP_DIR/data/cert.pem" 2>/dev/null | cut -d= -f2)
            if [ -n "$EXPIRY_DATE" ]; then
                echo "         Gültig bis: $EXPIRY_DATE"
            fi
        fi
    else
        print_error "SSL-Zertifikat fehlt (in $APP_DIR/data/)"
    fi

    # Config Check
    if [ -f "$APP_DIR/data/config.json" ]; then
        if "$APP_DIR/venv/bin/python3" -c "import json; json.load(open('$APP_DIR/data/config.json'))" 2>/dev/null; then
            print_success "Konfiguration gültig"
        else
            print_error "Konfiguration fehlerhaft"
        fi
    else
        print_error "Konfigurationsdatei fehlt"
    fi

    # HTTPS Check
    HTTP_CODE=$(curl -k -s -o /dev/null -w "%{http_code}" --connect-timeout 5 https://localhost:5555)
    if [ "$HTTP_CODE" == "200" ] || [ "$HTTP_CODE" == "302" ] || [ "$HTTP_CODE" == "301" ]; then
        print_success "HTTPS Endpoint erreichbar (Code: $HTTP_CODE)"
    else
        IP_ADDRESS=$(get_ip_address)
        HTTP_CODE2=$(curl -k -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "https://$IP_ADDRESS:5555")
        if [ "$HTTP_CODE2" == "200" ] || [ "$HTTP_CODE2" == "302" ] || [ "$HTTP_CODE2" == "301" ]; then
            print_success "HTTPS Endpoint erreichbar via IP (Code: $HTTP_CODE2)"
        else
            print_warning "HTTPS Endpoint nicht testbar (Code: localhost=$HTTP_CODE, IP=$HTTP_CODE2)"
            if [ -n "$EXTERNAL_DOMAIN" ]; then
                print_status "   Teste externe URL..."
                HTTP_CODE3=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "https://$EXTERNAL_DOMAIN")
                if [ "$HTTP_CODE3" == "200" ] || [ "$HTTP_CODE3" == "301" ] || [ "$HTTP_CODE3" == "302" ]; then
                    print_success "   Externe URL erreichbar"
                else
                    print_error "   Auch externe URL nicht erreichbar"
                fi
            fi
        fi
    fi

    # Cloudflare Tunnel Check
    if $IS_MACOS; then
        if pgrep -x cloudflared &>/dev/null; then
            print_success "Cloudflare Tunnel läuft"
        else
            print_warning "Cloudflare Tunnel nicht aktiv"
        fi
    else
        if sudo systemctl is-active --quiet cloudflared; then
            print_success "Cloudflare Tunnel läuft"
        else
            print_warning "Cloudflare Tunnel nicht aktiv"
        fi
    fi

    # Disk Space
    if $IS_MACOS; then
        DISK_USAGE=$(df "$APP_DIR" | awk 'NR==2 {print $5}' | sed 's/%//')
    else
        DISK_USAGE=$(df "$APP_DIR" | awk 'NR==2 {print $5}' | sed 's/%//')
    fi
    if [ -n "$DISK_USAGE" ] && [ "$DISK_USAGE" -lt 90 ] 2>/dev/null; then
        print_success "Festplattenspeicher OK ($DISK_USAGE%)"
    elif [ -n "$DISK_USAGE" ]; then
        print_warning "Festplattenspeicher knapp ($DISK_USAGE%)"
    fi

    # App Process Check
    echo
    PROCESS_COUNT=$(pgrep -f "start\.py" | wc -l | tr -d ' ')
    if [ "$PROCESS_COUNT" -gt 0 ]; then
        print_success "App Prozess läuft ($PROCESS_COUNT)"
    else
        print_error "Kein App-Prozess gefunden"
    fi

    # Memory Usage
    if $IS_MACOS; then
        MEM_MB=$(ps aux | grep "start\.py" | grep -v grep | awk '{sum += $6} END {printf "%.0f", sum/1024}')
        if [ -n "$MEM_MB" ] && [ "$MEM_MB" -gt 0 ] 2>/dev/null; then
            print_success "App Speicherverbrauch: ${MEM_MB} MB"
        fi
    fi
}

manage_cloudflare() {
    echo -e "${BLUE}=== Cloudflare Tunnel Management ===${NC}"
    echo

    # Status anzeigen
    if $IS_MACOS; then
        if pgrep -x cloudflared &>/dev/null; then
            print_success "Status: Läuft"
        else
            print_warning "Status: Gestoppt"
        fi
    else
        if sudo systemctl is-active --quiet cloudflared; then
            print_success "Status: Läuft"
        else
            print_warning "Status: Gestoppt"
        fi
    fi

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
            if $IS_MACOS; then
                brew services info cloudflared 2>/dev/null || launchctl list | grep cloudflared
            else
                sudo systemctl status cloudflared --no-pager
            fi
            ;;
        2)
            if $IS_MACOS; then
                brew services start cloudflared 2>/dev/null || launchctl load ~/Library/LaunchAgents/com.cloudflare.cloudflared.plist
                print_success "Cloudflare Tunnel gestartet"
            else
                sudo systemctl start cloudflared
                print_success "Cloudflare Tunnel gestartet"
            fi
            ;;
        3)
            if $IS_MACOS; then
                brew services stop cloudflared 2>/dev/null || launchctl unload ~/Library/LaunchAgents/com.cloudflare.cloudflared.plist
                print_success "Cloudflare Tunnel gestoppt"
            else
                sudo systemctl stop cloudflared
                print_success "Cloudflare Tunnel gestoppt"
            fi
            ;;
        4)
            if $IS_MACOS; then
                brew services restart cloudflared 2>/dev/null
                print_success "Cloudflare Tunnel neu gestartet"
            else
                sudo systemctl restart cloudflared
                print_success "Cloudflare Tunnel neu gestartet"
            fi
            ;;
        5)
            if $IS_MACOS; then
                if [ -f "$HOME/.cloudflared/cloudflared.log" ]; then
                    tail -f "$HOME/.cloudflared/cloudflared.log"
                else
                    log show --predicate 'process == "cloudflared"' --last 30m --style syslog
                fi
            else
                sudo journalctl -u cloudflared -f --no-pager
            fi
            ;;
        *)
            print_error "Ungültige Auswahl"
            ;;
    esac
}

# ==================== DEPLOY FUNKTIONEN ====================

deploy_app() {
    print_status "Deployment starten..."

    # Source = Git Repo, Target = Prod Server
    # Immer Einweg: Git Code → Prod (nie umgekehrt!)
    SOURCE_DIR="$HOME/Github/3d-printer-web-app"
    PROD_DIR="$HOME/printer-web-app"

    # Wenn manage.sh aus dem Git-Repo läuft, deploy zum Prod-Verzeichnis
    if [ -d "$APP_DIR/.git" ]; then
        SOURCE_DIR="$APP_DIR"
    fi

    if [ "$SOURCE_DIR" = "$PROD_DIR" ]; then
        print_error "Source und Prod sind identisch - Deploy nicht möglich"
        echo "Source: $SOURCE_DIR"
        echo "Prod:   $PROD_DIR"
        return 1
    fi

    if [ ! -d "$SOURCE_DIR" ]; then
        print_error "Source-Verzeichnis nicht gefunden: $SOURCE_DIR"
        return 1
    fi

    if [ ! -d "$PROD_DIR" ]; then
        print_error "Prod-Verzeichnis nicht gefunden: $PROD_DIR"
        echo "Erstelle mit: mkdir -p $PROD_DIR"
        return 1
    fi

    print_status "Sync von $SOURCE_DIR nach $PROD_DIR..."
    rsync -av \
          --exclude='venv' --exclude='__pycache__' \
          --exclude='.git' --exclude='node_modules' \
          --exclude='electron-app' --exclude='build' \
          --exclude='data' --exclude='android' \
          --exclude='iOS' --exclude='.idea' \
          --exclude='macos_app' --exclude='timelapse' \
          --exclude='logs' --exclude='*.pyc' \
          --exclude='license_client' --exclude='license_server' \
          "$SOURCE_DIR/" "$PROD_DIR/"
    restart_service
    print_success "Deployment erfolgreich! ($SOURCE_DIR → $PROD_DIR)"
}

# ==================== SERVER LOG COMMANDS (macOS) ====================

show_server_logs() {
    echo -e "${BLUE}=== Server Logs ===${NC}"
    echo
    echo "1) Stdout Log (App-Ausgabe)"
    echo "2) Error Log (Fehler)"
    echo "3) Beide Logs (live)"
    echo "4) Letzte Fehler"
    echo
    read -p "Auswahl (1-4): " choice

    case $choice in
        1)
            tail -n 100 -f "$APP_DIR/logs/app-stdout.log"
            ;;
        2)
            tail -n 100 -f "$APP_DIR/logs/app-error.log"
            ;;
        3)
            tail -n 50 -f "$APP_DIR/logs/app-stdout.log" "$APP_DIR/logs/app-error.log"
            ;;
        4)
            echo -e "${RED}=== Letzte Fehler ===${NC}"
            grep -i -E "error|exception|traceback|critical" "$APP_DIR/logs/app-error.log" | tail -30
            echo
            grep -i -E "error|exception|traceback|critical" "$APP_DIR/logs/app-stdout.log" | tail -30
            ;;
        *)
            print_error "Ungültige Auswahl"
            ;;
    esac
}

# ==================== CLEAR LOGS ====================

clear_logs() {
    echo -e "${BLUE}=== Logs bereinigen ===${NC}"
    echo
    echo "Folgende Logs werden geleert:"

    TOTAL_SIZE=0
    for LOG in "$APP_DIR/logs/app-stdout.log" "$APP_DIR/logs/app-error.log" "$APP_DIR/data/printer.log"; do
        if [ -f "$LOG" ]; then
            SIZE=$(du -h "$LOG" | awk '{print $1}')
            echo "  $LOG ($SIZE)"
        fi
    done

    echo
    read -p "Logs wirklich leeren? (y/N): " -n 1 -r
    echo

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        for LOG in "$APP_DIR/logs/app-stdout.log" "$APP_DIR/logs/app-error.log" "$APP_DIR/data/printer.log"; do
            if [ -f "$LOG" ]; then
                > "$LOG"
            fi
        done
        print_success "Logs geleert!"
    else
        print_status "Abgebrochen"
    fi
}

# ==================== HELP ====================

show_help() {
    if $IS_MACOS; then
        PLATFORM="macOS (launchd)"
    else
        PLATFORM="Linux (systemd)"
    fi

    echo -e "${BLUE}3D Printer Web App - Service Manager${NC}"
    echo -e "Platform: ${GREEN}$PLATFORM${NC}"
    echo
    echo "Usage: $0 [COMMAND]"
    echo
    echo -e "${GREEN}=== Web App Commands ===${NC}"
    echo "  start           Startet den Web App Service"
    echo "  stop            Stoppt den Web App Service"
    echo "  restart         Startet den Service neu"
    echo "  status          Zeigt Service-Status und Systeminfo"
    echo "  logs            Zeigt Live-Logs (App)"
    echo "  glogs           Gunicorn Log-Menü (stdout/error)"
    echo "  config          Bearbeitet die Konfigurationsdatei"
    echo "  update          Aktualisiert App und Dependencies"
    echo "  deploy          Sync von Source + Service Restart"
    echo "  clear-logs      Leert alle Log-Dateien"
    echo
    echo -e "${GREEN}=== System Commands ===${NC}"
    echo "  cloudflare      Verwaltet Cloudflare Tunnel"
    echo "  pwa             PWA-Setup Anleitung und Zertifikat"
    echo "  health          Führt System-Health-Check durch"
    echo "  info            Zeigt detaillierte Systeminfos"
    echo "  access          Zeigt Zugriffsinformationen"
    echo
    echo "Beispiele:"
    echo "  $0 restart          # Service neu starten"
    echo "  $0 logs             # App Live-Logs anzeigen"
    echo "  $0 glogs            # Gunicorn Logs"
    echo "  $0 health           # System prüfen"
    echo "  $0 deploy           # Source-Dateien deployen"
    echo "  $0 info             # Systeminfo anzeigen"
}

# ==================== HAUPTLOGIK ====================

case "$1" in
    # Web App Commands
    start)      start_service ;;
    stop)       stop_service ;;
    restart)    restart_service ;;
    status)     show_status ;;
    logs)       show_logs ;;
    slogs)      show_server_logs ;;
    config)     edit_config ;;
    update)     update_app ;;
    deploy)     deploy_app ;;
    clear-logs) clear_logs ;;

    # Camera Commands (macOS)
    camera-restart) restart_camera_server "$2" "$3" "$4" ;;
    camera-start)   start_camera_server "$2" "$3" "$4" "$5" ;;
    camera-stop)    stop_camera_server ;;

    # System Commands
    pwa)        setup_pwa ;;
    health)     check_health ;;
    info)       show_system_info ;;
    cloudflare) manage_cloudflare ;;
    access)     show_access_info ;;

    # Help
    *)          show_help; exit 1 ;;
esac
