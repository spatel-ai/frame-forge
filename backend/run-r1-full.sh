#!/usr/bin/env bash
# R1-10: the full customer flow, owner-approved. Real voice and video (fal.ai, 12-s limit),
# Razorpay TEST mode payments (no real money; webhook off, D-064), real Gmail emails.
# Prints no secret values.
set -euo pipefail

cd "$(dirname "$0")"                      # backend/
LOG="/private/tmp/claude-501/-Users-shubham-dev-Documents-organization-docs-desktop2-vvdo/92e2dfaf-ba24-4162-b961-c96941fb0a92/scratchpad/backend.log"

[ -f .env ] || { echo "backend/.env not found"; exit 1; }
set -a; source .env; set +a

for v in FAL_KEY USER_EMAIL USER_EMAIL_PASSWORD RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET; do
  [ -n "${!v:-}" ] || { echo "Missing $v in backend/.env"; exit 1; }
done
case "$RAZORPAY_KEY_ID" in
  rzp_test_*) echo "Checks: fal, Gmail and a Razorpay TEST key are set." ;;
  *) echo "Refusing: RAZORPAY_KEY_ID is not a test key (must start with rzp_test_)."; exit 1 ;;
esac

(cd .. && docker compose up -d db)
uv run alembic upgrade head

echo "Starting backend on http://127.0.0.1:8000: REAL AI (fal.ai, 12-s limit), Razorpay TEST mode."
echo "Log: $LOG"
AVATAR_PROVIDER=fal AVATAR_PAYMENTS=razorpay AVATAR_ENV=development AVATAR_MAX_AUDIO_SECONDS=12 \
  RAZORPAY_WEBHOOK_SECRET= \
  uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 \
  2>&1 | tee "$LOG"
