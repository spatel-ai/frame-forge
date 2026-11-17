#!/usr/bin/env bash
# Puts the real API domain into frontend/vercel.json (replaces API_DOMAIN_PLACEHOLDER).
# Usage: deploy/vercel-setup.sh api.example.com
set -euo pipefail

DOMAIN="${1:-}"
if [[ ! "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
  echo "Usage: deploy/vercel-setup.sh api.example.com   (lower-case domain, no https://)" >&2
  exit 1
fi

FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/frontend/vercel.json"
if grep -q "API_DOMAIN_PLACEHOLDER" "$FILE"; then
  tmp="$(mktemp)"
  sed "s/API_DOMAIN_PLACEHOLDER/$DOMAIN/g" "$FILE" > "$tmp"
  cat "$tmp" > "$FILE"
  rm -f "$tmp"
  echo "frontend/vercel.json now proxies /api/* to https://$DOMAIN/api/*"
  echo "(Do not commit this change if you keep the placeholder in git.)"
elif grep -q "https://$DOMAIN/api/" "$FILE"; then
  echo "frontend/vercel.json already points at $DOMAIN. Nothing to do."
else
  echo "frontend/vercel.json has no placeholder and a different domain. Restore it with:" >&2
  echo "  git checkout frontend/vercel.json" >&2
  exit 1
fi
