#!/bin/sh
set -e
uv run --no-sync alembic upgrade head
# Exactly ONE worker: the job poller and the payment reconciler run inside this process.
# Several workers would poll fal.ai and Razorpay several times over. Do not raise it.
exec uv run --no-sync uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000 --workers 1
