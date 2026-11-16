#!/usr/bin/env bash
# One command that checks the backend (T-105). Stops at the first failure.
# Mock provider only; nothing here reaches a paid service. Needs the database (docker compose up -d db).
set -euo pipefail
cd "$(dirname "$0")"

echo "==> ruff check"
uv run ruff check .
echo "==> ruff format --check"
uv run ruff format --check .
echo "==> mypy"
uv run mypy
echo "==> pytest"
uv run pytest -q
