#!/usr/bin/env bash
# Starts (and seeds) the backend used by the browser checks. Mock provider, mock payments, its own
# database. Never reads backend/.env: every setting is passed on the command line below.
#
#   e2e/scripts/e2e-backend.sh up      create the database, migrate, seed, leave the backend running
#   e2e/scripts/e2e-backend.sh down    stop it
#   e2e/scripts/e2e-backend.sh status
#   e2e/scripts/e2e-backend.sh reset   drop the e2e database (next `up` seeds again)
#
# The seed needs the dev server's address for the allowed origins and the sign-up link, so the
# dev server must be on a port in 5171-5179 (see README).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND="$(cd "$HERE/.." && pwd)"
BACKEND="$(cd "$FRONTEND/../backend" && pwd)"
STATE="$HERE/.state"
PORT="${E2E_BACKEND_PORT:-8010}"
DB_CONTAINER="${E2E_DB_CONTAINER:-avatar-db-1}"
DB_NAME="${E2E_DB_NAME:-frameforge_e2e}"
# The local development database of docker-compose.yml (credentials are written there, local only).
export E2E_DATABASE_URL="${E2E_DATABASE_URL:-postgresql+psycopg://avatar:avatar_dev@127.0.0.1:5432/$DB_NAME}"
export E2E_BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:5171}"
export E2E_BACKEND_LOG="${E2E_BACKEND_LOG:-$STATE/backend.log}"
PIDFILE="$STATE/backend.pid"
mkdir -p "$STATE"

ORIGINS=""
for p in 5171 5172 5173 5174 5175 5176 5177 5178 5179; do
  ORIGINS="$ORIGINS,http://127.0.0.1:$p,http://localhost:$p"
done
ORIGINS="${ORIGINS#,}"

stop_backend() {
  # `uv run` starts uvicorn as a child, so stop whatever listens on our port (never port 8000).
  local pids
  pids="$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -n "$pids" ]] && kill $pids 2>/dev/null || true
  rm -f "$PIDFILE"
  for _ in $(seq 1 20); do
    lsof -ti "tcp:$PORT" -sTCP:LISTEN >/dev/null 2>&1 || return 0
    sleep 0.5
  done
}

start_backend() { # $1 = poll interval in seconds
  # env -u: the owner's real mail login or S3 bucket, if exported in this shell, never reaches it.
  ( cd "$BACKEND" && exec env -u USER_EMAIL -u USER_EMAIL_PASSWORD -u AVATAR_S3_BUCKET -u FAL_KEY \
    AVATAR_PROVIDER=mock AVATAR_PAYMENTS=mock AVATAR_ENV=development \
    AVATAR_POLL_INTERVAL="$1" AVATAR_MAX_AUDIO_SECONDS=12 \
    AVATAR_DATA_DIR="$STATE/data" DATABASE_URL="$E2E_DATABASE_URL" \
    AVATAR_APP_URL="http://127.0.0.1:5171" AVATAR_ALLOWED_ORIGINS="$ORIGINS" \
    uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port "$PORT" \
  ) >>"$E2E_BACKEND_LOG" 2>&1 </dev/null &
  for _ in $(seq 1 60); do
    if curl -fs "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
      lsof -ti "tcp:$PORT" -sTCP:LISTEN | head -1 >"$PIDFILE"
      return 0
    fi
    sleep 1
  done
  echo "Backend did not start; see $E2E_BACKEND_LOG" >&2
  exit 1
}

case "${1:-}" in
  up)
    docker exec "$DB_CONTAINER" psql -U avatar -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
      || docker exec "$DB_CONTAINER" psql -U avatar -d postgres -c "CREATE DATABASE $DB_NAME"
    (cd "$BACKEND" && env DATABASE_URL="$E2E_DATABASE_URL" uv run alembic upgrade head)
    stop_backend
    # The seed talks to the backend through the dev server (which proxies /api), so it must be up.
    curl -fs -o /dev/null "$E2E_BASE_URL/" || {
      echo "Start the dev server first (see e2e/README.md): nothing answers at $E2E_BASE_URL" >&2
      exit 1
    }
    start_backend 1
    node "$HERE/seed/seed.ts" main
    stop_backend
    start_backend 86400 # no polling: the video approved next stays in progress
    node "$HERE/seed/seed.ts" late
    echo "e2e backend running on port $PORT (pid $(cat "$PIDFILE"))"
    ;;
  down) stop_backend ;;
  reset) # drop the e2e database and data folder; the next `up` seeds from scratch
    stop_backend
    docker exec "$DB_CONTAINER" psql -U avatar -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE)"
    rm -rf "$STATE/data" "$STATE/login.json" "$STATE/seed-state.json" "$E2E_BACKEND_LOG"
    ;;
  status) [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null && echo "running, pid $(cat "$PIDFILE"), port $PORT" || echo "not running" ;;
  *) echo "Usage: $0 up|down|status|reset" >&2; exit 2 ;;
esac
