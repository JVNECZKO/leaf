#!/bin/bash
# ==============================================================
# 🌿 Leaf — Production Installer
# ==============================================================
# Supported: Ubuntu 22.04+, Debian 11+ and all derivatives
# Run as root: sudo bash install.sh
# Re-runnable: safe to run again to update the application
# ==============================================================
set -euo pipefail

# ── Colors ────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'
YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

step() { echo -e "\n${BOLD}${BLUE}▶ $*${NC}"; }
ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
info() { echo -e "  ${CYAN}→${NC} $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $*"; }
die()  { echo -e "\n${RED}✗ ERROR: $*${NC}\n" >&2; exit 1; }

# ── Preflight ─────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && die "Run as root: sudo bash install.sh"
[[ -f /etc/os-release ]] || die "Cannot detect OS"
source /etc/os-release

case "$ID" in
  debian|ubuntu) ;;
  *) [[ "${ID_LIKE:-}" == *debian* ]] || die "Only Debian/Ubuntu supported. Detected: $ID" ;;
esac

ARCH=$(dpkg --print-architecture)
[[ "$ARCH" == "amd64" || "$ARCH" == "arm64" ]] || die "Unsupported CPU architecture: $ARCH"

PROJ_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJ_ROOT/backend"
FRONTEND_DIR="$PROJ_ROOT/frontend"

[[ -d "$BACKEND_DIR" ]]           || die "backend/ not found. Run from project root."
[[ -d "$FRONTEND_DIR" ]]          || die "frontend/ not found. Run from project root."
[[ -f "$BACKEND_DIR/go.mod" ]]    || die "backend/go.mod not found."
[[ -f "$FRONTEND_DIR/package.json" ]] || die "frontend/package.json not found."

# ── Versions ──────────────────────────────────────────────────
GO_VERSION="1.24.0"
NODE_MAJOR="20"

# ── Banner ────────────────────────────────────────────────────
echo -e "\n${BOLD}${GREEN}🌿 Leaf — Production Installer${NC}"
echo -e "   OS:   ${CYAN}$PRETTY_NAME${NC}"
echo -e "   Arch: ${CYAN}$ARCH${NC}"
echo -e "   Dir:  ${CYAN}$PROJ_ROOT${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Configuration ─────────────────────────────────────────────
step "Configuration"

detect_ip() {
  timeout 5 curl -4 -sf https://api.ipify.org  2>/dev/null \
  || timeout 5 curl -4 -sf https://ifconfig.me 2>/dev/null \
  || hostname -I 2>/dev/null | awk '{print $1}' \
  || echo "localhost"
}

DEFAULT_IP=$(detect_ip)
echo ""
echo -e "  ${BOLD}Server address${NC} (IP or domain — users will access this)"
echo -e "  Detected: ${YELLOW}${DEFAULT_IP}${NC}"
read -r -p "  Enter IP or domain [${DEFAULT_IP}]: " SERVER_HOST
SERVER_HOST="${SERVER_HOST:-$DEFAULT_IP}"
# Strip trailing slash and protocol if user pasted a URL
SERVER_HOST="${SERVER_HOST#http://}"
SERVER_HOST="${SERVER_HOST#https://}"
SERVER_HOST="${SERVER_HOST%%/*}"
SERVER_URL="http://${SERVER_HOST}"

echo ""
echo -e "  ${BOLD}Admin account${NC}"
read -r -p "  Email [admin@example.com]: " ADMIN_EMAIL
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"

while true; do
  echo -n "  Password (min 8 chars): "
  read -r -s ADMIN_PASSWORD; echo ""
  [[ ${#ADMIN_PASSWORD} -lt 8 ]] && { echo -e "  ${RED}Too short.${NC}"; continue; }
  [[ "$ADMIN_PASSWORD" == *"'"* ]] && { echo -e "  ${RED}Single quotes not allowed.${NC}"; continue; }
  echo -n "  Confirm password: "
  read -r -s ADMIN_CONFIRM; echo ""
  [[ "$ADMIN_PASSWORD" == "$ADMIN_CONFIRM" ]] && break
  echo -e "  ${RED}Passwords don't match.${NC}"
done

JWT_SECRET=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -hex 16)

ok "URL:    $SERVER_URL"
ok "Admin:  $ADMIN_EMAIL"
ok "JWT + DB secrets generated"

# ── System packages ───────────────────────────────────────────
step "System packages (apt)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq

# Core tools
apt-get install -y -qq \
  curl wget git ca-certificates gnupg apt-transport-https \
  build-essential openssl lsb-release

# PostgreSQL + Nginx
apt-get install -y -qq postgresql postgresql-contrib nginx

# Chrome dependencies (package name changed in Ubuntu 24.04)
CHROME_DEPS=(
  fonts-liberation libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1
  libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0
  libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3
  libxkbcommon0 libxrandr2 libxshmfence1 libxss1
  libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0
)
apt-get install -y -qq "${CHROME_DEPS[@]}" 2>/dev/null || \
  apt-get install -y -qq --ignore-missing "${CHROME_DEPS[@]}" 2>/dev/null || true
# libasound2 was renamed in Ubuntu 24.04
apt-get install -y -qq libasound2t64 2>/dev/null \
  || apt-get install -y -qq libasound2 2>/dev/null || true

ok "System packages installed"

# ── Google Chrome / Chromium ──────────────────────────────────
step "Browser"

CHROME_BIN=""
if [[ "$ARCH" == "amd64" ]]; then
  if ! command -v google-chrome-stable &>/dev/null && ! command -v google-chrome &>/dev/null; then
    info "Downloading Google Chrome stable..."
    wget -q -O /tmp/chrome.deb \
      "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb"
    apt-get install -y -qq /tmp/chrome.deb 2>/dev/null \
      || { apt-get install -f -y -qq 2>/dev/null; apt-get install -y -qq /tmp/chrome.deb; }
    rm -f /tmp/chrome.deb
  fi
  CHROME_BIN=$(command -v google-chrome-stable 2>/dev/null \
             || command -v google-chrome 2>/dev/null || true)
else
  # arm64: use Chromium from system repos
  if ! command -v chromium &>/dev/null && ! command -v chromium-browser &>/dev/null; then
    apt-get install -y -qq chromium 2>/dev/null \
      || apt-get install -y -qq chromium-browser 2>/dev/null || true
  fi
  CHROME_BIN=$(command -v chromium 2>/dev/null \
             || command -v chromium-browser 2>/dev/null || true)
fi

[[ -n "$CHROME_BIN" ]] || die "Failed to install Chrome/Chromium. Check internet access."
ok "Browser: $CHROME_BIN"

# ── Go ────────────────────────────────────────────────────────
step "Go ${GO_VERSION}"

GO_BIN=/usr/local/go/bin/go
CURRENT_GO=$($GO_BIN version 2>/dev/null | grep -oP 'go\K[0-9]+\.[0-9]+(\.[0-9]+)?' || echo "")

if [[ "$CURRENT_GO" == "$GO_VERSION" ]]; then
  ok "Go ${GO_VERSION} already installed"
else
  info "Downloading Go ${GO_VERSION} for ${ARCH}..."
  wget -q -O /tmp/go.tar.gz \
    "https://go.dev/dl/go${GO_VERSION}.linux-${ARCH}.tar.gz"
  rm -rf /usr/local/go
  tar -C /usr/local -xzf /tmp/go.tar.gz
  rm -f /tmp/go.tar.gz
  echo 'export PATH=$PATH:/usr/local/go/bin' > /etc/profile.d/go.sh
  ok "Go $($GO_BIN version) installed"
fi

export PATH=$PATH:/usr/local/go/bin

# ── Node.js ───────────────────────────────────────────────────
step "Node.js ${NODE_MAJOR}"

if node --version 2>/dev/null | grep -q "^v${NODE_MAJOR}\."; then
  ok "Node.js $(node --version) already installed"
else
  info "Adding NodeSource repo..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs
  ok "Node.js $(node --version) installed"
fi

# ── PostgreSQL ────────────────────────────────────────────────
step "PostgreSQL"

systemctl enable postgresql --now >/dev/null 2>&1 || true
sleep 2

# Create user + database
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'leaf') THEN
    CREATE USER leaf WITH PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER USER leaf WITH PASSWORD '${DB_PASSWORD}';
  END IF;
END\$\$;
SELECT 'CREATE DATABASE leafdb'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'leafdb') \gexec
GRANT ALL PRIVILEGES ON DATABASE leafdb TO leaf;
ALTER DATABASE leafdb OWNER TO leaf;
SQL

DATABASE_URL="postgres://leaf:${DB_PASSWORD}@localhost:5432/leafdb?sslmode=disable"
ok "PostgreSQL: database 'leafdb', user 'leaf'"

# ── Environment files ─────────────────────────────────────────
step "Environment files"

# backend/.env
{
  echo "DATABASE_URL=${DATABASE_URL}"
  echo "PORT=8080"
  echo "MAX_BROWSERS=3"
  echo "ENRICHMENT_WORKERS=5"
  echo "PROXY_URL="
  echo "CHROME_PATH=${CHROME_BIN}"
  echo "HEADLESS=true"
  echo "ADMIN_EMAIL=${ADMIN_EMAIL}"
  printf "ADMIN_PASSWORD='%s'\n" "${ADMIN_PASSWORD}"
  echo "JWT_SECRET=${JWT_SECRET}"
} > "$BACKEND_DIR/.env"
chmod 600 "$BACKEND_DIR/.env"
ok "backend/.env (mode 600)"

# frontend/.env.local — NEXT_PUBLIC_* is baked into the build
{
  echo "NEXT_PUBLIC_API_URL=${SERVER_URL}"
} > "$FRONTEND_DIR/.env.local"
ok "frontend/.env.local (API → ${SERVER_URL})"

# ── Build backend ─────────────────────────────────────────────
step "Building backend"

cd "$BACKEND_DIR"
info "go build..."
/usr/local/go/bin/go build -o leaf-server . 2>&1
ok "leaf-server binary built"

# ── Build frontend ────────────────────────────────────────────
step "Building frontend"

cd "$FRONTEND_DIR"
info "Installing npm packages..."
if [[ -f package-lock.json ]]; then
  npm ci --silent 2>&1 | tail -3
else
  npm install --silent 2>&1 | tail -3
fi

info "next build..."
npm run build 2>&1 | tail -15
ok "Next.js built"

# ── Systemd services ──────────────────────────────────────────
step "Systemd services"

NPM_BIN=$(command -v npm)

cat > /etc/systemd/system/leaf-backend.service <<SERVICE
[Unit]
Description=Leaf Backend (Go)
Documentation=https://github.com/your/leaf
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=${BACKEND_DIR}
EnvironmentFile=${BACKEND_DIR}/.env
ExecStart=${BACKEND_DIR}/leaf-server
Restart=always
RestartSec=5
StartLimitIntervalSec=120
StartLimitBurst=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=leaf-backend

[Install]
WantedBy=multi-user.target
SERVICE

cat > /etc/systemd/system/leaf-frontend.service <<SERVICE
[Unit]
Description=Leaf Frontend (Next.js)
After=network.target leaf-backend.service

[Service]
Type=simple
User=root
WorkingDirectory=${FRONTEND_DIR}
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=${NPM_BIN} start
Restart=always
RestartSec=5
StartLimitIntervalSec=120
StartLimitBurst=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=leaf-frontend

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable leaf-backend leaf-frontend >/dev/null 2>&1
ok "leaf-backend.service  — enabled"
ok "leaf-frontend.service — enabled"

# ── Nginx ─────────────────────────────────────────────────────
step "Nginx (reverse proxy on port 80)"

mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled

cat > /etc/nginx/sites-available/leaf <<NGINX
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${SERVER_HOST} _;

    client_max_body_size 50M;

    # ── API (Go backend) ──────────────────────────────────
    location /api/ {
        proxy_pass          http://127.0.0.1:8080;
        proxy_http_version  1.1;
        proxy_set_header    Host              \$host;
        proxy_set_header    X-Real-IP         \$remote_addr;
        proxy_set_header    X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header    X-Forwarded-Proto \$scheme;
        proxy_read_timeout  300s;
        proxy_connect_timeout 10s;
        proxy_send_timeout  300s;
    }

    # ── WebSocket ─────────────────────────────────────────
    location /ws {
        proxy_pass          http://127.0.0.1:8080;
        proxy_http_version  1.1;
        proxy_set_header    Upgrade           \$http_upgrade;
        proxy_set_header    Connection        "Upgrade";
        proxy_set_header    Host              \$host;
        proxy_set_header    X-Real-IP         \$remote_addr;
        proxy_read_timeout  86400s;
        proxy_send_timeout  86400s;
    }

    # ── Health check (public) ─────────────────────────────
    location /health {
        proxy_pass http://127.0.0.1:8080;
    }

    # ── Frontend (Next.js) ────────────────────────────────
    location / {
        proxy_pass          http://127.0.0.1:3000;
        proxy_http_version  1.1;
        proxy_set_header    Upgrade           \$http_upgrade;
        proxy_set_header    Connection        "upgrade";
        proxy_set_header    Host              \$host;
        proxy_set_header    X-Real-IP         \$remote_addr;
        proxy_set_header    X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_cache_bypass  \$http_upgrade;
        proxy_read_timeout  60s;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/leaf /etc/nginx/sites-enabled/leaf
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

nginx -t
systemctl enable nginx >/dev/null 2>&1
systemctl restart nginx
ok "Nginx configured (port 80 → :3000 / :8080)"

# ── Start services ────────────────────────────────────────────
step "Starting services"

systemctl restart leaf-backend
info "Waiting for backend..."
HEALTHY=0
for i in $(seq 1 30); do
  if curl -sf http://localhost:8080/health >/dev/null 2>&1; then
    HEALTHY=1; ok "Backend is up"; break
  fi
  sleep 1
done
[[ $HEALTHY -eq 1 ]] || warn "Backend health check timed out — check: journalctl -u leaf-backend -n 50"

systemctl restart leaf-frontend
info "Waiting for frontend (this may take ~10s)..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000 >/dev/null 2>&1; then
    ok "Frontend is up"; break
  fi
  sleep 1
done

systemctl reload nginx 2>/dev/null || true

# ── Summary ───────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${BOLD}${GREEN}🌿 Leaf installed successfully!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "  ${BOLD}Access:${NC}"
echo -e "    URL:   ${BLUE}${SERVER_URL}${NC}"
echo -e "    Login: ${YELLOW}${ADMIN_EMAIL}${NC}"
echo ""
echo -e "  ${BOLD}Auto-start:${NC} ${GREEN}enabled${NC}"
echo -e "    Services restart automatically on crash and on server reboot."
echo ""
echo -e "  ${BOLD}Useful commands:${NC}"
echo -e "    systemctl status   leaf-backend leaf-frontend"
echo -e "    journalctl -u      leaf-backend  -f"
echo -e "    journalctl -u      leaf-frontend -f"
echo -e "    systemctl restart  leaf-backend leaf-frontend"
echo ""
echo -e "  ${BOLD}Update app:${NC}"
echo -e "    git pull && sudo bash install.sh"
echo ""
echo -e "  ${YELLOW}Firewall:${NC} make sure port 80 is open."
echo -e "    ufw allow 80/tcp    ${CYAN}# if using UFW${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
