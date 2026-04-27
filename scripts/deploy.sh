#!/usr/bin/env bash
# NeonSlither one-shot deploy script for Ubuntu/Debian VPS.
# Idempotent — re-running upgrades the running container.
#
# Usage (as root or with sudo):
#   ./scripts/deploy.sh                        # interactive
#   DOMAIN=play.example.com EMAIL=me@x.com \
#     STRIPE_SECRET= STRIPE_WEBHOOK= STRIPE_PRICE= \
#     SENTRY_DSN= ./scripts/deploy.sh          # non-interactive

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  C_R=$'\033[31m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_B=$'\033[34m'; C_0=$'\033[0m'
else
  C_R=''; C_G=''; C_Y=''; C_B=''; C_0=''
fi
log()  { echo "${C_B}==>${C_0} $*"; }
ok()   { echo "${C_G}✓${C_0} $*"; }
warn() { echo "${C_Y}!${C_0} $*"; }
die()  { echo "${C_R}✗${C_0} $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Please run as root (sudo $0)"

INSTALL_DIR="/opt/slither"
CONTAINER="slither"
IMAGE="slither:latest"
DATA_DIR="$INSTALL_DIR/data"
ENV_FILE="$INSTALL_DIR/.env"
BRANCH="${BRANCH:-claude/review-game-feedback-0WhTe}"
REPO="${REPO:-https://github.com/Mkzrt22/slither-io.git}"

# ── 0. Detect OS ─────────────────────────────────────────────────────────────
. /etc/os-release
case "$ID" in
  ubuntu|debian) ok "Detected $PRETTY_NAME";;
  *) warn "Untested distro $ID — proceeding anyway";;
esac

# ── 1. Prerequisites ─────────────────────────────────────────────────────────
log "Updating apt cache"
apt-get update -qq

PKGS=(curl ca-certificates ufw cron)
for p in "${PKGS[@]}"; do
  dpkg -s "$p" >/dev/null 2>&1 || apt-get install -y -qq "$p" >/dev/null
done
ok "Base packages installed"

# Docker
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker"
  curl -fsSL https://get.docker.com | sh >/dev/null
  systemctl enable --now docker
fi
ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

# Node (used to generate the secret if not set)
if ! command -v node >/dev/null 2>&1; then
  log "Installing Node.js 20 (used to generate TOKEN_SECRET only)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "Node $(node --version)"

# ── 2. Inputs (interactive if not set in env) ────────────────────────────────
prompt() { local var=$1 msg=$2 def=${3-}; local val
  eval "val=\${$var-}"
  if [[ -n "$val" ]]; then return; fi
  # Read from the controlling terminal so this works when the script is piped
  # (curl ... | bash). Falls back to stdin if no tty (e.g. CI).
  local in_fd=0
  if [[ -r /dev/tty ]]; then exec 3</dev/tty; in_fd=3; fi
  if [[ -n "$def" ]]; then read -rp "$msg [$def]: " val <&$in_fd; val="${val:-$def}"
  else                       read -rp "$msg: " val <&$in_fd
  fi
  [[ $in_fd -eq 3 ]] && exec 3<&-
  eval "$var=\"$val\""
}

prompt DOMAIN  "Domain (blank = serve on raw IP:3000, no HTTPS)" ""
prompt PORT    "External port to expose"                          "3000"
if [[ -n "$DOMAIN" ]]; then
  prompt EMAIL "Email for Let's Encrypt"                          ""
  PUBLIC_URL="https://$DOMAIN"
else
  PUBLIC_URL="http://$(hostname -I | awk '{print $1}'):${PORT}"
fi

prompt CONFIGURE_STRIPE "Configure Stripe? (y/N)"                 "n"
if [[ "$CONFIGURE_STRIPE" =~ ^[Yy] ]]; then
  prompt STRIPE_SECRET   "STRIPE_SECRET_KEY"        ""
  prompt STRIPE_WEBHOOK  "STRIPE_WEBHOOK_SECRET"    ""
  prompt STRIPE_PRICE    "STRIPE_PRICE_ID"          ""
fi
prompt SENTRY_DSN "Sentry DSN (blank = disabled)"   ""

# ── 3. Clone or update repo ──────────────────────────────────────────────────
if [[ -d "$INSTALL_DIR/.git" ]]; then
  log "Updating existing checkout"
  git -C "$INSTALL_DIR" fetch --quiet origin
  git -C "$INSTALL_DIR" checkout --quiet "$BRANCH"
  git -C "$INSTALL_DIR" reset --hard --quiet "origin/$BRANCH"
else
  log "Cloning $REPO into $INSTALL_DIR"
  rm -rf "$INSTALL_DIR"
  git clone --quiet --branch "$BRANCH" "$REPO" "$INSTALL_DIR"
fi
mkdir -p "$DATA_DIR"
ok "Repo ready at $INSTALL_DIR ($(git -C "$INSTALL_DIR" rev-parse --short HEAD))"

# ── 4. .env file ─────────────────────────────────────────────────────────────
TOKEN_SECRET=""
if [[ -f "$ENV_FILE" ]] && grep -q '^TOKEN_SECRET=' "$ENV_FILE"; then
  TOKEN_SECRET=$(grep '^TOKEN_SECRET=' "$ENV_FILE" | cut -d= -f2-)
  ok "Reusing existing TOKEN_SECRET"
else
  TOKEN_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  ok "Generated new TOKEN_SECRET"
fi

cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3000
PUBLIC_URL=$PUBLIC_URL
TOKEN_SECRET=$TOKEN_SECRET
LOG_LEVEL=info
DATA_DIR=/app/data
SENTRY_DSN=${SENTRY_DSN:-}
STRIPE_SECRET_KEY=${STRIPE_SECRET:-}
STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK:-}
STRIPE_PRICE_ID=${STRIPE_PRICE:-}
BACKUP_KEEP=14
EOF
chmod 600 "$ENV_FILE"
ok "Wrote $ENV_FILE"

# ── 5. Build + (re)start container ───────────────────────────────────────────
log "Building Docker image"
docker build -q -t "$IMAGE" "$INSTALL_DIR" >/dev/null

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  log "Stopping & removing previous container"
  docker stop "$CONTAINER" >/dev/null || true
  docker rm   "$CONTAINER" >/dev/null
fi

log "Starting container on 127.0.0.1:${PORT}"
PUBLISH_FLAG="-p 127.0.0.1:${PORT}:3000"
[[ -z "$DOMAIN" ]] && PUBLISH_FLAG="-p ${PORT}:3000"   # no nginx → bind public

docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  --env-file "$ENV_FILE" \
  $PUBLISH_FLAG \
  -v "$DATA_DIR:/app/data" \
  "$IMAGE" >/dev/null
sleep 2
ok "Container is up: $(docker ps --format '{{.Status}}' --filter "name=$CONTAINER")"

# ── 6. nginx + Let's Encrypt (only if domain) ────────────────────────────────
if [[ -n "$DOMAIN" ]]; then
  log "Installing nginx + certbot"
  apt-get install -y -qq nginx python3-certbot-nginx >/dev/null

  cat > "/etc/nginx/sites-available/slither" <<NGINX
server {
  server_name $DOMAIN;
  listen 80;

  location / {
    proxy_pass http://127.0.0.1:${PORT};
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 86400;
  }
}
NGINX
  ln -sf /etc/nginx/sites-available/slither /etc/nginx/sites-enabled/slither
  rm -f /etc/nginx/sites-enabled/default
  nginx -t >/dev/null 2>&1 || die "nginx config test failed"
  systemctl reload nginx

  if [[ -n "${EMAIL:-}" ]]; then
    log "Requesting Let's Encrypt certificate for $DOMAIN"
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || \
      warn "certbot failed (DNS not pointing to this VPS yet?) — fix DNS and re-run later: certbot --nginx -d $DOMAIN -m $EMAIL --agree-tos --redirect"
  else
    warn "No email given — skipping HTTPS. Run later: certbot --nginx -d $DOMAIN"
  fi
fi

# ── 7. Firewall ──────────────────────────────────────────────────────────────
log "Configuring ufw"
ufw allow 22/tcp >/dev/null
if [[ -n "$DOMAIN" ]]; then
  ufw allow 80/tcp  >/dev/null
  ufw allow 443/tcp >/dev/null
else
  ufw allow "${PORT}/tcp" >/dev/null
fi
yes | ufw enable >/dev/null 2>&1 || true
ok "Firewall: $(ufw status | head -1)"

# ── 8. Cron backup (3am daily, prunes to 14 copies) ──────────────────────────
log "Installing cron backup"
CRON_LINE="0 3 * * * docker exec $CONTAINER node /app/scripts/backup-sqlite.js >> /var/log/slither-backup.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'slither/scripts/backup-sqlite\|slither node\|slither-backup' || true; echo "$CRON_LINE" ) | crontab -
ok "Cron installed (daily 03:00)"

# ── 9. Smoke test ────────────────────────────────────────────────────────────
log "Smoke test"
sleep 1
HEALTH=$(curl -fsS "http://127.0.0.1:${PORT}/healthz" || echo "FAIL")
if [[ "$HEALTH" == "FAIL" ]]; then
  die "/healthz did not respond — check: docker logs $CONTAINER"
fi
ok "/healthz → $HEALTH"

# ── Done ─────────────────────────────────────────────────────────────────────
echo
echo "${C_G}══════════════════════════════════════════════════════════════════${C_0}"
echo "${C_G}  Deployment complete.${C_0}"
echo "${C_G}══════════════════════════════════════════════════════════════════${C_0}"
echo "  URL          : ${PUBLIC_URL}"
echo "  Logs         : docker logs -f $CONTAINER"
echo "  Restart      : docker restart $CONTAINER"
echo "  Update       : cd $INSTALL_DIR && git pull && docker build -t $IMAGE . && docker stop $CONTAINER && docker rm $CONTAINER"
echo "                 (or just re-run this script — it's idempotent)"
echo "  Backup now   : docker exec $CONTAINER node /app/scripts/backup-sqlite.js"
echo "  Backups dir  : $DATA_DIR/backups"
echo "  Env file     : $ENV_FILE  (chmod 600 — keep secret)"
echo
