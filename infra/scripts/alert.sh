#!/usr/bin/env bash
# Webhook alert handler, called by the sermon-search-alert@.service template
# on any job failure. Posts a JSON payload to ALERT_WEBHOOK_URL.
#
# Usage: alert.sh <failed-unit-name>
#
# If ALERT_WEBHOOK_URL is unset, logs a journal line and exits 0 (opt-in).
set -euo pipefail

UNIT="${1:-unknown}"

# Source env for ALERT_WEBHOOK_URL.
# shellcheck disable=SC1091
[[ -f /opt/sermon-search/repo/.env ]] && source /opt/sermon-search/repo/.env

WEBHOOK="${ALERT_WEBHOOK_URL:-}"

if [[ -z "$WEBHOOK" ]]; then
  echo "[alert] ALERT_WEBHOOK_URL is not set — skipping webhook for failed unit: $UNIT"
  exit 0
fi

HOST=$(hostname -f 2>/dev/null || hostname)

# Capture the last 40 journal lines for the failed unit.
JOURNAL=$(journalctl -u "$UNIT" -n 40 --no-pager --output=short-iso 2>/dev/null || echo "(journal unavailable)")

# Escape for JSON: replace backslash, double-quote, newline, tab.
escape_json() {
  printf '%s' "$1" \
    | sed 's/\\/\\\\/g; s/"/\\"/g' \
    | awk '{printf "%s\\n", $0}' \
    | sed '$ s/\\n$//'
}

ESCAPED_JOURNAL=$(escape_json "$JOURNAL")

PAYLOAD=$(cat <<JSON
{
  "text": "*[sermon-search] Job failed on ${HOST}*\nUnit: \`${UNIT}\`\n\`\`\`\n${ESCAPED_JOURNAL}\n\`\`\`"
}
JSON
)

echo "[alert] posting webhook for failed unit: $UNIT"

# Failures here are logged but don't propagate — we must not loop-trigger another alert.
curl --silent --show-error --max-time 10 \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "$WEBHOOK" || echo "[alert] webhook POST failed (non-fatal)"
