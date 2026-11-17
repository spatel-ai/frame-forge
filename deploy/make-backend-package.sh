#!/usr/bin/env bash
# Builds dist/frameforge-backend.tar.gz: what the EC2 host needs, and never a secret.
# Contents: backend/ (without .env files, .venv, data, caches), docker-compose.prod.yml,
# docker-compose.aws.yml and deploy/ (without local or secret env files).
# Run from anywhere: deploy/make-backend-package.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
OUT_DIR="$ROOT/dist"
PKG="$OUT_DIR/frameforge-backend.tar.gz"
mkdir -p "$OUT_DIR"

for f in backend/Dockerfile docker-compose.prod.yml docker-compose.aws.yml deploy/Caddyfile.aws; do
  [ -e "$f" ] || { echo "Missing $f - run this from a complete checkout." >&2; exit 1; }
done

# macOS tar would add AppleDouble files; keep them out.
export COPYFILE_DISABLE=1

tar -czf "$PKG" \
  --exclude='.env' --exclude='.env.*' --exclude='*.env' \
  --exclude='backend/.venv' --exclude='backend/data' \
  --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='.pytest_cache' --exclude='.mypy_cache' --exclude='.ruff_cache' \
  --exclude='.DS_Store' \
  backend docker-compose.prod.yml docker-compose.aws.yml deploy

# Safety check: refuse to hand out a package that contains any env file.
# backend/.env.example would be harmless, but the rule is simple: no file named like an env file,
# so the excludes above remove those too. (deploy/aws.env.example etc. are documentation only.)
if tar -tzf "$PKG" | grep -E '(^|/)\.env($|\.)|\.env$' | grep -v -E '\.env\.example$'; then
  rm -f "$PKG"
  echo "REFUSED: an env file ended up in the package (listed above). Package deleted." >&2
  exit 1
fi

SIZE="$(du -h "$PKG" | cut -f1)"
echo "No .env file is included: env files are excluded on purpose (the server keeps its own backend/.env)."
echo "Package: $PKG ($SIZE)"
echo
echo "Upload with the AWS CLI (replace BUCKET and REGION, shown in the stack Outputs):"
echo "  aws s3 cp dist/frameforge-backend.tar.gz s3://BUCKET/deploy/frameforge-backend.tar.gz --region REGION"
echo
echo "Or in the AWS console: S3 > the frameforge-videos-... bucket > create folder 'deploy' (if missing)"
echo "  > Upload > pick $PKG."
echo "Then on the server: sudo frameforge-deploy"
