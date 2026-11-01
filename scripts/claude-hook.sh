#!/bin/sh
# Claude Code hook → FORGE console (display only: the office shows interactive sessions as visitors).
# Never blocks, never prints (stdout from some hooks is fed back to Claude), always exits 0.
body=$(cat)
printf '%s' "$body" | curl -s -m 1 -X POST -H 'Content-Type: application/json' --data-binary @- \
  "${FORGE_CONSOLE_URL:-http://127.0.0.1:4300}/api/claude-event" >/dev/null 2>&1 &
exit 0
