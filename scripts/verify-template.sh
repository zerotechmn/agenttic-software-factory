#!/usr/bin/env bash
# Prove the house template is green from a clean copy: check, build, e2e, docker.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)/house"
rsync -a --exclude node_modules --exclude dist --exclude 'data/*.db*' "$HERE/templates/house/" "$TMP/"
cd "$TMP"
echo "== npm ci"; npm install --no-audit --no-fund --silent
echo "== check"; npm run check
echo "== build"; npm run build
echo "== playwright browsers"; npx playwright install chromium >/dev/null
echo "== e2e"; npm run e2e
if docker info >/dev/null 2>&1; then
  echo "== docker build"; docker build -q -t forge-house-verify . >/dev/null
  echo "docker build ok"
else
  echo "== docker not available, skipped"
fi
echo "TEMPLATE OK ($TMP)"
