#!/bin/bash
# 3D Printer Server - Service Management (Cross-Platform: macOS + Linux)
# Usage: ./manage.sh [COMMAND]
#
# Web App: start|stop|restart|status|logs|config|update
# System: pwa|health|info|cloudflare|access
#
# Developer-only commands (deploy, license server) live in manage.private.sh,
# sourced below when that file sits next to this one -- never part of a
# customer installation. See docs/bauen-und-veroeffentlichen.md 3.4.

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
    print_status "Starting $APP_NAME..."
    if $IS_MACOS; then
        if launchctl list "$PLIST_LABEL" &>/dev/null; then
            print_warning "Service already loaded - restarting..."
            launchctl kickstart -k "gui/$(id -u)/$PLIST_LABEL"
        else
            launchctl load "$PLIST_FILE"
        fi
        sleep 3
        if is_service_running; then
            print_success "Service started!"
            show_access_info
        else
            print_error "Service could not be started!"
            echo "Check the logs: tail -f $APP_DIR/logs/app-error.log"
            launchctl list "$PLIST_LABEL" 2>/dev/null
        fi
    else
        sudo systemctl start $SERVICE_NAME
        sleep 2
        if is_service_running; then
            print_success "Service started!"
            show_access_info
        else
            print_error "Service could not be started!"
            sudo systemctl status $SERVICE_NAME
        fi
    fi
}

stop_service() {
    print_status "Stopping $APP_NAME..."
    if $IS_MACOS; then
        if launchctl list "$PLIST_LABEL" &>/dev/null; then
            launchctl unload "$PLIST_FILE"
            sleep 1
            print_success "Service stopped!"
        else
            print_warning "Service was not loaded"
        fi
    else
        sudo systemctl stop $SERVICE_NAME
        print_success "Service stopped!"
    fi
}

restart_service() {
    print_status "Restarting $APP_NAME..."
    if $IS_MACOS; then
        if launchctl list "$PLIST_LABEL" &>/dev/null; then
            launchctl kickstart -k "gui/$(id -u)/$PLIST_LABEL"
        else
            launchctl load "$PLIST_FILE"
        fi
        sleep 3
        if is_service_running; then
            print_success "Service restarted successfully!"
            show_access_info
        else
            print_error "Restart failed!"
            echo "Check the logs: tail -f $APP_DIR/logs/app-error.log"
        fi
    else
        sudo systemctl restart $SERVICE_NAME
        sleep 3
        if is_service_running; then
            print_success "Service restarted successfully!"
            show_access_info
        else
            print_error "Restart failed!"
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
            # Show the PID
            PID=$(launchctl list "$PLIST_LABEL" 2>/dev/null | grep '"PID"' | awk '{print $NF}' | tr -d ';')
            if [ -n "$PID" ] && [ "$PID" != "0" ]; then
                print_success "Service running (PID: $PID)"
            else
                EXIT_CODE=$(launchctl list "$PLIST_LABEL" 2>/dev/null | grep 'LastExitStatus' | awk '{print $NF}' | tr -d ';')
                print_error "Service not active (LastExitStatus: $EXIT_CODE)"
            fi
        else
            print_error "Service not loaded"
            echo "Start it with: ./manage.sh start"
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
        lsof -i :5555 -P -n 2>/dev/null | head -5 || echo "Port 5555 not bound"
    else
        sudo netstat -tlnp | grep :5555 || echo "Port 5555 not bound"
        sudo netstat -tlnp | grep :443 || echo "Port 443 not bound"
    fi
}

show_logs() {
    echo -e "${BLUE}=== Live logs (Ctrl+C to quit) ===${NC}"

    # Log file location (in the data directory)
    LOG_FILE="$APP_DIR/data/printer.log"

    if [ -f "$LOG_FILE" ]; then
        echo -e "${YELLOW}Showing the logs from $LOG_FILE${NC}"
        echo -e "${YELLOW}The last 100 lines + new entries${NC}"
        echo
        tail -n 100 -f "$LOG_FILE"
    else
        if $IS_MACOS; then
            # macOS: Gunicorn stdout/error logs
            STDOUT_LOG="$APP_DIR/logs/app-stdout.log"
            ERROR_LOG="$APP_DIR/logs/app-error.log"
            if [ -f "$STDOUT_LOG" ]; then
                echo -e "${YELLOW}Showing the app logs${NC}"
                tail -n 100 -f "$STDOUT_LOG" "$ERROR_LOG" 2>/dev/null
            else
                print_error "No log files found"
            fi
        else
            echo -e "${YELLOW}Log file not found, using the system logs${NC}"
            sudo journalctl -u $SERVICE_NAME -n 100 -f --no-pager
        fi
    fi
}

edit_config() {
    if [ -f "$APP_DIR/data/config.json" ]; then
        print_status "Opening the configuration..."
        if $IS_MACOS; then
            # macOS: nano oder default editor
            nano "$APP_DIR/data/config.json"
        else
            sudo nano "$APP_DIR/data/config.json"
        fi

        read -p "Configuration changed? Restart the service? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            restart_service
        fi
    else
        print_error "Configuration file not found: $APP_DIR/data/config.json"
    fi
}

update_app() {
    print_status "Updating the app..."

    # Back up the configuration
    if [ -f "$APP_DIR/data/config.json" ]; then
        cp "$APP_DIR/data/config.json" "$APP_DIR/data/config.json.backup"
        print_status "Configuration backed up"
    fi

    # Stop the service
    stop_service

    # Dependencies aktualisieren
    cd "$APP_DIR"
    source venv/bin/activate
    pip install --upgrade -r requirements.txt

    print_status "Put the new app files in place (web_app.py, templates/index.html)"
    read -p "Files updated? Press Enter to continue..."

    # Start the service again
    start_service

    print_success "Update complete!"
}

show_access_info() {
    IP_ADDRESS=$(get_ip_address)
    echo
    echo -e "${GREEN}=== Access to the web app ===${NC}"
    echo "🔒 Local HTTPS:    https://$IP_ADDRESS:5555"
    if [ -n "$EXTERNAL_DOMAIN" ]; then
        echo "🌐 External:       https://$EXTERNAL_DOMAIN (via Cloudflare)"
        echo "📱 Mobile local:   https://$IP_ADDRESS:5555"
        echo "📱 Mobile external: https://$EXTERNAL_DOMAIN"
    else
        echo "📱 Mobile local:   https://$IP_ADDRESS:5555"
    fi
    echo "⚠️  Local: self-signed certificate -> 'Proceed anyway'"
    if [ -n "$EXTERNAL_DOMAIN" ]; then
        echo "✅ External: valid SSL via Cloudflare"
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
            echo "Cloudflare tunnel: ✅ active"
        elif brew services list 2>/dev/null | grep cloudflared | grep -q started; then
            echo "Cloudflare tunnel: ✅ active (brew service)"
        else
            echo "Cloudflare tunnel: ❌ not active"
        fi
    else
        if sudo systemctl is-active --quiet cloudflared; then
            echo "Cloudflare tunnel: ✅ active"
        else
            echo "Cloudflare tunnel: ❌ not active"
        fi
    fi
    if [ -n "$EXTERNAL_DOMAIN" ]; then
        echo "External URL: https://$EXTERNAL_DOMAIN"
    fi

    echo
    echo -e "${BLUE}=== SSL Certificate ===${NC}"
    # Where the server keeps them (services/paths.zertifikatsordner).
    CERT_DIR="$APP_DIR/data/certs"
    if [ -f "$CERT_DIR/cert.pem" ]; then
        echo "Certificate: $CERT_DIR/cert.pem ✅"
        echo "Private Key: $CERT_DIR/key.pem ✅"
        # Show the expiry date
        EXPIRY=$( openssl x509 -enddate -noout -in "$CERT_DIR/cert.pem" 2>/dev/null | cut -d= -f2 )
        if [ -n "$EXPIRY" ]; then
            echo "Valid until: $EXPIRY"
        fi
        if [ -f "$CERT_DIR/ca-cert.pem" ]; then
            echo "Root CA:     $CERT_DIR/ca-cert.pem ✅ (trust it once on each device)"
        fi
    else
        print_error "SSL certificate not found in $CERT_DIR/ — the server creates it on its next start"
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
        lsof -i :5555 -P -n 2>/dev/null | grep LISTEN | head -3 || echo "  Port 5555 not bound"
        lsof -i :443 -P -n 2>/dev/null | grep LISTEN | head -3 || echo "  Port 443 not bound"
    else
        sudo netstat -tlnp | grep -E ":80|:443|:5555|:8883|:8888" | while read line; do
            echo "  $line"
        done
    fi
}

setup_pwa() {
    print_status "Setting up PWA support..."
    echo

    # The server makes its certificate itself on start (services/cert_manager,
    # signed by its own root CA in data/certs/). A second one built here would
    # carry a CA of its own that no device trusts -- and it landed in data/,
    # where the server never looks.
    if [ ! -f "$APP_DIR/data/certs/cert.pem" ]; then
        print_warning "No SSL certificate yet - the server creates it on start..."
        restart_service
        sleep 5
        if [ -f "$APP_DIR/data/certs/cert.pem" ]; then
            print_success "Certificate created: $APP_DIR/data/certs/cert.pem"
        else
            print_error "Still no certificate - see: sudo journalctl -u $SERVICE_NAME"
        fi
    else
        print_success "SSL certificate already present"
    fi
    if false; then
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
print(f"PWA certificate created for IP: {local_ip}")
PYEOF

        restart_service
        print_success "New SSL certificate created and the service restarted"
    else
        print_success "SSL certificate already present"
    fi

    IP_ADDRESS=$(get_ip_address)
    echo
    echo -e "${BLUE}=== PWA setup guide ===${NC}"
    echo
    echo -e "${YELLOW}Step 1 - the hosts file:${NC}"
    if $IS_MACOS; then
        echo "sudo nano /etc/hosts"
    else
        echo "As administrator: C:\\Windows\\System32\\drivers\\etc\\hosts"
    fi
    echo "Add this line: $IP_ADDRESS    3d-printer.local"
    echo

    echo -e "${YELLOW}Step 2 - install the certificate:${NC}"
    if $IS_MACOS; then
        echo "sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain $APP_DIR/data/cert.pem"
    else
        if [ -f "$APP_DIR/data/cert.cer" ]; then
            echo "Download: scp user@$IP_ADDRESS:$APP_DIR/data/cert.cer ."
            echo "PowerShell (as admin): Import-Certificate -FilePath cert.cer -CertStoreLocation Cert:\\LocalMachine\\Root"
        fi
    fi
    echo

    echo -e "${YELLOW}Step 3 - PWA installation:${NC}"
    echo "1. Open https://3d-printer.local:5555"
    echo "2. Choose 'Proceed anyway' on the certificate warning"
    echo "3. Chrome: ... -> Install app"
    echo "4. Safari: Share -> Add to Home Screen (iOS)"
    echo
}

check_health() {
    echo -e "${BLUE}=== Health Check ===${NC}"

    # Service Status
    if is_service_running; then
        print_success "Service running"
    else
        print_error "Service not active"
    fi

    # Port Check
    if $IS_MACOS; then
        if lsof -i :5555 -P -n 2>/dev/null | grep -q LISTEN; then
            print_success "Port 5555 bound"
        else
            print_error "Port 5555 unreachable"
        fi
    else
        if sudo netstat -tlnp | grep -q :5555; then
            print_success "Port 5555 bound"
        else
            print_error "Port 5555 unreachable"
        fi
    fi

    # SSL Check
    if [ -f "$APP_DIR/data/cert.pem" ] && [ -f "$APP_DIR/data/key.pem" ]; then
        print_success "SSL certificate present"
        # Check expiry
        if $IS_MACOS || command -v openssl &>/dev/null; then
            EXPIRY_DATE=$(openssl x509 -enddate -noout -in "$APP_DIR/data/cert.pem" 2>/dev/null | cut -d= -f2)
            if [ -n "$EXPIRY_DATE" ]; then
                echo "         Valid until: $EXPIRY_DATE"
            fi
        fi
    else
        print_error "SSL certificate missing (in $APP_DIR/data/)"
    fi

    # Config Check
    if [ -f "$APP_DIR/data/config.json" ]; then
        if "$APP_DIR/venv/bin/python3" -c "import json; json.load(open('$APP_DIR/data/config.json'))" 2>/dev/null; then
            print_success "Configuration valid"
        else
            print_error "Configuration broken"
        fi
    else
        print_error "Configuration file missing"
    fi

    # HTTPS Check
    HTTP_CODE=$(curl -k -s -o /dev/null -w "%{http_code}" --connect-timeout 5 https://localhost:5555)
    if [ "$HTTP_CODE" == "200" ] || [ "$HTTP_CODE" == "302" ] || [ "$HTTP_CODE" == "301" ]; then
        print_success "HTTPS endpoint reachable (code: $HTTP_CODE)"
    else
        IP_ADDRESS=$(get_ip_address)
        HTTP_CODE2=$(curl -k -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "https://$IP_ADDRESS:5555")
        if [ "$HTTP_CODE2" == "200" ] || [ "$HTTP_CODE2" == "302" ] || [ "$HTTP_CODE2" == "301" ]; then
            print_success "HTTPS endpoint reachable via IP (code: $HTTP_CODE2)"
        else
            print_warning "HTTPS endpoint not testable (code: localhost=$HTTP_CODE, IP=$HTTP_CODE2)"
            if [ -n "$EXTERNAL_DOMAIN" ]; then
                print_status "   Testing the external URL..."
                HTTP_CODE3=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "https://$EXTERNAL_DOMAIN")
                if [ "$HTTP_CODE3" == "200" ] || [ "$HTTP_CODE3" == "301" ] || [ "$HTTP_CODE3" == "302" ]; then
                    print_success "   External URL reachable"
                else
                    print_error "   External URL unreachable too"
                fi
            fi
        fi
    fi

    # Cloudflare Tunnel Check
    if $IS_MACOS; then
        if pgrep -x cloudflared &>/dev/null; then
            print_success "Cloudflare tunnel running"
        else
            print_warning "Cloudflare tunnel not active"
        fi
    else
        if sudo systemctl is-active --quiet cloudflared; then
            print_success "Cloudflare tunnel running"
        else
            print_warning "Cloudflare tunnel not active"
        fi
    fi

    # Disk Space
    if $IS_MACOS; then
        DISK_USAGE=$(df "$APP_DIR" | awk 'NR==2 {print $5}' | sed 's/%//')
    else
        DISK_USAGE=$(df "$APP_DIR" | awk 'NR==2 {print $5}' | sed 's/%//')
    fi
    if [ -n "$DISK_USAGE" ] && [ "$DISK_USAGE" -lt 90 ] 2>/dev/null; then
        print_success "Disk space OK ($DISK_USAGE%)"
    elif [ -n "$DISK_USAGE" ]; then
        print_warning "Disk space tight ($DISK_USAGE%)"
    fi

    # App Process Check
    echo
    PROCESS_COUNT=$(pgrep -f "start\.py" | wc -l | tr -d ' ')
    if [ "$PROCESS_COUNT" -gt 0 ]; then
        print_success "App process running ($PROCESS_COUNT)"
    else
        print_error "No app process found"
    fi

    # Memory Usage
    if $IS_MACOS; then
        MEM_MB=$(ps aux | grep "start\.py" | grep -v grep | awk '{sum += $6} END {printf "%.0f", sum/1024}')
        if [ -n "$MEM_MB" ] && [ "$MEM_MB" -gt 0 ] 2>/dev/null; then
            print_success "App memory use: ${MEM_MB} MB"
        fi
    fi
}

manage_cloudflare() {
    echo -e "${BLUE}=== Cloudflare Tunnel Management ===${NC}"
    echo

    # Show the status
    if $IS_MACOS; then
        if pgrep -x cloudflared &>/dev/null; then
            print_success "Status: running"
        else
            print_warning "Status: stopped"
        fi
    else
        if sudo systemctl is-active --quiet cloudflared; then
            print_success "Status: running"
        else
            print_warning "Status: stopped"
        fi
    fi

    echo
    echo "1) Show the status"
    echo "2) Start the tunnel"
    echo "3) Stop the tunnel"
    echo "4) Restart the tunnel"
    echo "5) Show the logs"
    echo
    read -p "Choice (1-5): " choice

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
                print_success "Cloudflare tunnel started"
            else
                sudo systemctl start cloudflared
                print_success "Cloudflare tunnel started"
            fi
            ;;
        3)
            if $IS_MACOS; then
                brew services stop cloudflared 2>/dev/null || launchctl unload ~/Library/LaunchAgents/com.cloudflare.cloudflared.plist
                print_success "Cloudflare tunnel stopped"
            else
                sudo systemctl stop cloudflared
                print_success "Cloudflare tunnel stopped"
            fi
            ;;
        4)
            if $IS_MACOS; then
                brew services restart cloudflared 2>/dev/null
                print_success "Cloudflare tunnel restarted"
            else
                sudo systemctl restart cloudflared
                print_success "Cloudflare tunnel restarted"
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
            print_error "Invalid selection"
            ;;
    esac
}

# ==================== SERVER LOG COMMANDS (macOS) ====================

show_server_logs() {
    echo -e "${BLUE}=== Server Logs ===${NC}"
    echo
    echo "1) Stdout log (the app output)"
    echo "2) Error log"
    echo "3) Both logs (live)"
    echo "4) Recent errors"
    echo
    read -p "Choice (1-4): " choice

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
            echo -e "${RED}=== Recent errors ===${NC}"
            grep -i -E "error|exception|traceback|critical" "$APP_DIR/logs/app-error.log" | tail -30
            echo
            grep -i -E "error|exception|traceback|critical" "$APP_DIR/logs/app-stdout.log" | tail -30
            ;;
        *)
            print_error "Invalid selection"
            ;;
    esac
}

# ==================== CLEAR LOGS ====================

clear_logs() {
    echo -e "${BLUE}=== Clearing the logs ===${NC}"
    echo
    echo "The following logs will be cleared:"

    TOTAL_SIZE=0
    for LOG in "$APP_DIR/logs/app-stdout.log" "$APP_DIR/logs/app-error.log" "$APP_DIR/data/printer.log"; do
        if [ -f "$LOG" ]; then
            SIZE=$(du -h "$LOG" | awk '{print $1}')
            echo "  $LOG ($SIZE)"
        fi
    done

    echo
    read -p "Really empty the logs? (y/N): " -n 1 -r
    echo

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        for LOG in "$APP_DIR/logs/app-stdout.log" "$APP_DIR/logs/app-error.log" "$APP_DIR/data/printer.log"; do
            if [ -f "$LOG" ]; then
                > "$LOG"
            fi
        done
        print_success "Logs emptied!"
    else
        print_status "Cancelled"
    fi
}

# ==================== HELP ====================

show_help() {
    if $IS_MACOS; then
        PLATFORM="macOS (launchd)"
    else
        PLATFORM="Linux (systemd)"
    fi

    echo -e "${BLUE}3D Printer Server - Service Manager${NC}"
    echo -e "Platform: ${GREEN}$PLATFORM${NC}"
    echo
    echo "Usage: $0 [COMMAND]"
    echo
    echo -e "${GREEN}=== Web App Commands ===${NC}"
    echo "  start           Starts the web app service"
    echo "  stop            Stops the web app service"
    echo "  restart         Restarts the service"
    echo "  status          Shows service status and system info"
    echo "  logs            Shows the live logs (app)"
    echo "  slogs           Gunicorn log menu (stdout/error)"
    echo "  config          Edits the configuration file"
    echo "  update          Updates the app and its dependencies"
    echo "  clear-logs      Empties every log file"
    echo
    echo -e "${GREEN}=== System Commands ===${NC}"
    echo "  cloudflare      Manages the Cloudflare tunnel"
    echo "  pwa             PWA setup instructions and certificate"
    echo "  health          Runs a system health check"
    echo "  info            Shows detailed system info"
    echo "  access          Shows the access information"

    # manage.private.sh, when sourced above, defines this and lists the
    # developer-only commands (deploy, license server) here.
    if declare -f private_help >/dev/null 2>&1; then
        private_help
    fi

    echo
    echo "Examples:"
    echo "  $0 restart          # restart the service"
    echo "  $0 logs             # show the app live logs"
    echo "  $0 slogs            # the Gunicorn logs"
    echo "  $0 health           # check the system"
    echo "  $0 info             # show the system info"
}

# manage.private.sh carries commands no customer installation needs (deploy,
# license server) -- see docs/bauen-und-veroeffentlichen.md 3.4. Sourced here,
# after every helper it relies on (print_status, restart_service, ...) is
# already defined, and before the dispatch below tries its commands.
[ -f "$APP_DIR/manage.private.sh" ] && . "$APP_DIR/manage.private.sh"

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
    clear-logs) clear_logs ;;

    # System Commands
    pwa)        setup_pwa ;;
    health)     check_health ;;
    info)       show_system_info ;;
    cloudflare) manage_cloudflare ;;
    access)     show_access_info ;;

    # Everything else: try the developer-only commands from manage.private.sh
    # (deploy, license server) when that file is loaded, before giving up.
    *)
        if declare -f private_dispatch >/dev/null 2>&1 && private_dispatch "$@"; then
            exit 0
        fi
        show_help
        exit 1
        ;;
esac
