#!/usr/bin/env bash
# R1-08: ONE real video test (owner-approved, about $0.64, at most about $0.70).
# Real voice and video from fal.ai; voices over 12 s are refused; no payment screen (credits
# are added with the development grant command); email goes out through Gmail (USER_EMAIL).
# Prints no secret values.
set -euo pipefail

cd "$(dirname "$0")"                      # backend/
LOG="/private/tmp/claude-501/-Users-shubham-dev-Documents-organization-docs-desktop2-vvdo/92e2dfaf-ba24-4162-b961-c96941fb0a92/scratchpad/backend.log"

[ -f .env ] || { echo "backend/.env not found"; exit 1; }
set -a; source .env; set +a

for v in FAL_KEY USER_EMAIL USER_EMAIL_PASSWORD; do
  [ -n "${!v:-}" ] || { echo "Missing $v in backend/.env"; exit 1; }
done
echo "Checks: FAL_KEY, USER_EMAIL and USER_EMAIL_PASSWORD are set."

(cd .. && docker compose up -d db)
uv run alembic upgrade head

echo "Starting backend on http://127.0.0.1:8000 with REAL AI (fal.ai), 12-second limit."
echo "Log: $LOG"
AVATAR_PROVIDER=fal AVATAR_PAYMENTS=mock AVATAR_ENV=development AVATAR_MAX_AUDIO_SECONDS=12 \
  uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 \
  2>&1 | tee "$LOG"
