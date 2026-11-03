#!/usr/bin/env bash
# Opens a real payment form against the live checkout. Prints NO_REPLY when
# healthy (the automation stays quiet) and a short Hebrew alert when not.
# Override the target with SMOKE_URL, or SMOKE_FORCE_FAIL=1 to test the alert.
set -uo pipefail

URL="${SMOKE_URL:-https://rikma.binushka.com/api/checkout/}"
BODY='{"items":[{"id":"birth-hoop","quantity":1}],"shipping":"pickup","firstName":"בדיקת","lastName":"תשלום","phone":"0501234567","email":"smoke-test@example.com"}'

if [ "${SMOKE_FORCE_FAIL:-0}" = "1" ]; then
  echo "🚨 התראת בדיקה — ערוץ ההתראות של החנות מחובר ופעיל ✅"
  exit 0
fi

out=$(curl -sS --max-time 45 -w '\n%{http_code}' -X POST "$URL" \
  -H 'Content-Type: application/json' -d "$BODY" 2>&1)
code=$(printf '%s' "$out" | tail -n 1)
json=$(printf '%s' "$out" | sed '$d')

if [ "$code" = "200" ] && printf '%s' "$json" | grep -q '"url"'; then
  # Payment form opened; keep the channel quiet.
  echo NO_REPLY
  exit 0
fi

printf '🚨 פתיחת התשלום נכשלה (HTTP %s)\n' "$code"
printf 'בדיקה: %s\n' "$(date -u '+%Y-%m-%d %H:%M UTC')"
printf 'תשובה: %s\n' "$(printf '%s' "$json" | head -c 300)"
exit 0
