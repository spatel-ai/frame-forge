#!/usr/bin/env bash
# Frameforge backend: one-shot production setup for a fresh Linux server (Amazon Linux 2023 or
# Ubuntu/Debian). Safe to run again: it only adds what is missing, then rebuilds and restarts.
#
#   bash server-setup.sh <api-domain> <git-repo-url> [branch]
#   e.g. bash server-setup.sh api.example.com https://github.com/you/frameforge.git development
#
# What it does:
#   1. installs Docker, the compose plugin and git; adds 2 GB swap on small servers
#   2. clones (or updates) the repository into ~/frameforge
#   3. writes deploy/server.env (API domain + a generated database password, kept on this server)
#   4. stops with instructions if backend/.env (your secrets) is not filled in yet
#   5. starts PostgreSQL, the API and Caddy (free Let's Encrypt certificate) with Docker
#   6. waits for the API and prints how to check it
#
# It never prints or uploads a secret. Open ports 80 and 443 in the firewall; the domain's A record
# must point to this server for the certificate to be issued.
set -euo pipefail

API_DOMAIN="${1:-}"
REPO_URL="${2:-}"
BRANCH="${3:-development}"
APP_DIR="${APP_DIR:-$HOME/frameforge}"
COMPOSE_VERSION="v2.29.7"

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }

[ -n "$API_DOMAIN" ] && [ -n "$REPO_URL" ] || die "usage: bash server-setup.sh <api-domain> <git-repo-url> [branch]"
case "$API_DOMAIN" in
  *.*) ;;
  *) die "'$API_DOMAIN' does not look like a domain (expected something like api.example.com)" ;;
esac
[ "$(id -u)" -ne 0 ] || die "run this as your normal user (it uses sudo where needed), not as root"

# ---- 1. packages -------------------------------------------------------------------------
say "Installing Docker and git (skipped if present)"
if ! command -v docker >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1; then
  if command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y docker git
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y
    sudo apt-get install -y docker.io git curl
  else
    die "unsupported system: install docker and git yourself, then run this again"
  fi
fi
sudo systemctl enable --now docker

if ! sudo docker compose version >/dev/null 2>&1; then
  say "Installing the Docker compose plugin $COMPOSE_VERSION"
  ARCH="$(uname -m)"
  sudo mkdir -p /usr/local/lib/docker/cli-plugins
  sudo curl -fsSL \
    "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-${ARCH}" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi
sudo docker compose version

# Swap: video encoding plus the database can exceed 2 GB of RAM for a moment.
MEM_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
if [ "$MEM_MB" -le 2200 ] && [ "$(swapon --noheadings | wc -l)" -eq 0 ]; then
  say "Adding 2 GB of swap (server has ${MEM_MB} MB of RAM)"
  sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  sudo sysctl -q vm.swappiness=10
fi

# ---- 2. code -----------------------------------------------------------------------------
if [ -d "$APP_DIR/.git" ]; then
  say "Updating the code in $APP_DIR ($BRANCH)"
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" checkout --quiet "$BRANCH"
  git -C "$APP_DIR" pull --quiet --ff-only origin "$BRANCH"
else
  say "Cloning the code into $APP_DIR ($BRANCH)"
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"
[ -f docker-compose.server.yml ] || die "docker-compose.server.yml is not in this branch ($BRANCH)"

# ---- 3. server settings (not secrets you typed; the DB password is generated here) ---------
if [ ! -f deploy/server.env ]; then
  say "Writing deploy/server.env (database password generated on this server)"
  umask 077
  {
    echo "API_DOMAIN=$API_DOMAIN"
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
  } > deploy/server.env
else
  # Keep the existing database password; only update the domain.
  sed -i "s/^API_DOMAIN=.*/API_DOMAIN=$API_DOMAIN/" deploy/server.env
fi
chmod 600 deploy/server.env

# ---- 4. the app's secrets ----------------------------------------------------------------
if [ ! -f backend/.env ]; then
  umask 077
  cat > backend/.env <<'EOF'
# Fill in every <...> value, then run the setup script again. Never commit or share this file.
AVATAR_ENV=production
AVATAR_PROVIDER=fal
FAL_KEY=<your fal.ai key>
AVATAR_MAX_AUDIO_SECONDS=12
AVATAR_PAYMENTS=razorpay
RAZORPAY_KEY_ID=<rzp_test_... or rzp_live_...>
RAZORPAY_KEY_SECRET=<its secret>
USER_EMAIL=<the Gmail address that sends emails>
USER_EMAIL_PASSWORD=<its 16-character Gmail App Password>
AVATAR_SUPPORT_EMAIL=<support address customers see>
# The WEBSITE's address (Vercel or your domain), not the API domain:
AVATAR_APP_URL=https://<your site address>
AVATAR_ALLOWED_ORIGINS=https://<your site address>
AVATAR_BANNERS=on
AVATAR_S3_BUCKET=<your S3 bucket name>
AWS_REGION=ap-south-1
EOF
  chmod 600 backend/.env
  die "backend/.env was created as a template. Fill it in:
    nano $APP_DIR/backend/.env
then run this script again with the same arguments."
fi
chmod 600 backend/.env
if grep -q '<[^>]*>' backend/.env; then
  die "backend/.env still has unfilled <...> values. Edit it:
    nano $APP_DIR/backend/.env
then run this script again."
fi
for name in AVATAR_ENV AVATAR_PROVIDER AVATAR_PAYMENTS AVATAR_APP_URL AVATAR_ALLOWED_ORIGINS; do
  grep -q "^${name}=." backend/.env || die "backend/.env has no value for $name"
done

# ---- 5. run ------------------------------------------------------------------------------
COMPOSE=(sudo docker compose --env-file deploy/server.env -f docker-compose.server.yml)
say "Building and starting PostgreSQL, the API and Caddy (the first build takes several minutes)"
"${COMPOSE[@]}" up -d --build

# ---- 6. check ----------------------------------------------------------------------------
say "Waiting for the API to answer"
OK=0
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8000/healthz >/dev/null 2>&1; then OK=1; break; fi
  sleep 3
done
"${COMPOSE[@]}" ps
if [ "$OK" -ne 1 ]; then
  echo
  echo "The API did not answer on this server. Its last log lines:"
  "${COMPOSE[@]}" logs --tail 40 backend || true
  die "the backend did not start. The lines above say why (a missing setting is the usual cause)."
fi

cat <<EOF

DONE. The API is running on this server.

  On this server:   curl http://127.0.0.1:8000/healthz
  From anywhere:    curl https://$API_DOMAIN/healthz
                    (needs the DNS A record for $API_DOMAIN pointing here and ports 80/443 open;
                     the certificate is issued on the first request and can take a minute)

  Logs:             cd $APP_DIR && sudo docker compose --env-file deploy/server.env -f docker-compose.server.yml logs -f backend
  Update later:     bash $APP_DIR/deploy/server-setup.sh $API_DOMAIN $REPO_URL $BRANCH
  Certificate log:  ... logs caddy

For S3 without keys: the instance role must allow Put/Get/Delete on <bucket>/videos/*, and the
instance metadata "hop limit" must be 2 (EC2 console > instance > Actions > Instance settings).
EOF
