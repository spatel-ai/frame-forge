#!/usr/bin/env bash
# Razorpay TEST-mode run (T-407). Payments use your test keys from backend/.env;
# video generation stays on mock, so fal.ai is never called. Prints no secret values.
set -euo pipefail

cd "$(dirname "$0")"                      # backend/
LOG="/private/tmp/claude-501/-Users-shubham-dev-Documents-organization-docs-desktop2-vvdo/92e2dfaf-ba24-4162-b961-c96941fb0a92/scratchpad/backend.log"

[ -f .env ] || { echo "backend/.env not found"; exit 1; }

# Load .env into this process only (nothing is echoed).
set -a; source .env; set +a

# Fail early, without showing values. The webhook is optional (D-064): this run uses none.
for v in RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET; do
  [ -n "${!v:-}" ] || { echo "Missing $v in backend/.env"; exit 1; }
done
case "$RAZORPAY_KEY_ID" in
  rzp_test_*) echo "Key check: test key found (rzp_test_…)." ;;
  *) echo "Refusing: RAZORPAY_KEY_ID is not a test key (must start with rzp_test_)."; exit 1 ;;
esac

# Database up and tables current.
(cd .. && docker compose up -d db)
uv run alembic upgrade head

# Start: Razorpay payments, mock video, development environment, no webhook. Payments are
# confirmed by the browser's verify (fetches the payment by id from Razorpay's API) and, if the
# tab is closed, by reconciliation polling Razorpay every minute for orders older than 2 minutes.
echo "Starting backend on http://127.0.0.1:8000 (log: $LOG)"
echo "Webhook: off. Payments confirmed by API (verify + reconciliation every minute)."
AVATAR_PAYMENTS=razorpay AVATAR_PROVIDER=mock FAL_KEY= AVATAR_ENV=development \
  RAZORPAY_WEBHOOK_SECRET= \
  uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 \
  2>&1 | tee "$LOG"
