#!/usr/bin/env bash
# One-time setup on a fresh machine: dependencies, the Office UI, Playwright's Chromium, .env, then `forge doctor`.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

# Node 24: use nvm's if present, otherwise whatever node is on PATH
NODE24="$(ls -d "$HOME"/.nvm/versions/node/v24.* 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$NODE24" ] && export PATH="$NODE24/bin:$PATH"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  echo "FORGE needs Node 24 or newer (found: $(node -v 2>/dev/null || echo none)). Install it, e.g. 'nvm install 24', then rerun ./setup.sh" >&2
  exit 1
fi

echo "==> factory dependencies";        npm ci --no-audit --no-fund
echo "==> Office UI";                   (cd office && npm ci --no-audit --no-fund && npm run build)
echo "==> Playwright Chromium (for QA)"; (cd office && npx playwright install chromium)
if [ ! -f .env ]; then cp .env.example .env; echo "==> created .env: put your ANTHROPIC_API_KEY in it"; fi

echo; ./forge doctor || true
echo
echo "Next:  ./forge console            (Office at http://127.0.0.1:4300/office/)"
echo "       ./forge run samples/briefs/wheels2go.md --budget 20"
