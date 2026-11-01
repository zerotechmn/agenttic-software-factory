#!/usr/bin/env bash
# Night build: run by the OpenClaw cron job `forge-night-build` (approved by Tuvshuu, 2026-10-17).
# Runs ONE sandboxed FORGE build of a brief with a hard budget cap, then sends a macOS notification.
# FORGE itself pauses on Claude usage limits and resumes when they lift.
set -uo pipefail
BRIEF="${1:-samples/briefs/dashboard/B-living-foundry.md}"
OUT="${2:-$HOME/forge-runs/dashboard-B}"
BUDGET="${3:-15}"
FACTORY="$HOME/factory"
NODE24="$(ls -d "$HOME"/.nvm/versions/node/v24.* 2>/dev/null | sort -V | tail -1)/bin"
export PATH="$NODE24:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
LOG="$OUT.log"
# Night runs usually wait on a known reset time: probe every 30 min (capped by the stated reset).
export FORGE_PROBE_MIN="${FORGE_PROBE_MIN:-30}"
notify() { osascript -e "display notification \"$1\" with title \"FORGE night build\"" >/dev/null 2>&1 || true; }

cd "$FACTORY"
# Never run two orchestrators on one project: if a build for $OUT is alive (even paused), leave it alone.
if pgrep -f "bin/forge.ts (run|resume) .*$OUT" >/dev/null || pgrep -f "bin/forge.ts resume $OUT" >/dev/null; then
  echo "[$(date)] a FORGE process for $OUT is already running; nothing to do" >> "$LOG"
  exit 0
fi
if grep -q '"phase": "done"' "$OUT/.forge/state.json" 2>/dev/null; then
  echo "[$(date)] $OUT already finished; nothing to do" >> "$LOG"
  exit 0
fi
if [ -f "$OUT/.forge/state.json" ]; then
  echo "[$(date)] resuming existing run in $OUT" >> "$LOG"
  ./forge resume "$OUT" --budget "$BUDGET" --no-serve >> "$LOG" 2>&1
else
  echo "[$(date)] starting $BRIEF → $OUT (budget \$$BUDGET)" >> "$LOG"
  ./forge run "$BRIEF" --out "$OUT" --budget "$BUDGET" --no-serve >> "$LOG" 2>&1
fi
code=$?
summary="$(grep -E '^phase: ' "$LOG" | tail -1 | sed 's/\x1b\[[0-9;]*m//g')"
echo "[$(date)] finished (exit $code) $summary" >> "$LOG"
notify "exit $code · ${summary:-see $LOG}"
exit $code
