#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# install-local-worker.sh — install the local worker launchd agents (macOS).
#
# Sets up two always-on agents so the worker runs on THIS machine with no
# manual commands:
#   com.sermonseek.tunnel  — SSH tunnel to prod Postgres (localhost:15432)
#   com.sermonseek.worker  — the `--serve` daemon (scripts/worker-local-serve.sh)
#
# Usage:
#   scripts/install-local-worker.sh -i <key.pem> <user@host>
#
# Re-running re-installs (unload + load). Requires node + yt-dlp on your PATH
# (their dirs are baked into the worker agent's PATH, since launchd doesn't
# inherit your shell PATH). Reads creds from .env.prod at run time.
# ---------------------------------------------------------------------------

SSH_KEY=""
SSH_TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -i) SSH_KEY="$2"; shift 2 ;;
    *)  SSH_TARGET="$1"; shift ;;
  esac
done
[[ -n "$SSH_KEY" && -n "$SSH_TARGET" ]] || {
  echo "usage: $0 -i <key.pem> <user@host>" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TPL="$ROOT/infra/local"
DEST="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs"
mkdir -p "$DEST" "$LOG_DIR"

command -v node  >/dev/null || { echo "node not on PATH" >&2; exit 1; }
command -v yt-dlp >/dev/null || { echo "yt-dlp not on PATH" >&2; exit 1; }
[[ -f "$ROOT/.env.prod" ]] || { echo ".env.prod not found in $ROOT" >&2; exit 1; }

# PATH baked into the worker agent — must include node + yt-dlp.
RUN_PATH="$(dirname "$(command -v node)"):$(dirname "$(command -v yt-dlp)"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

render() {
  sed -e "s#@SSH_KEY@#${SSH_KEY}#g" \
      -e "s#@SSH_TARGET@#${SSH_TARGET}#g" \
      -e "s#@REPO@#${ROOT}#g" \
      -e "s#@LOG_DIR@#${LOG_DIR}#g" \
      -e "s#@PATH@#${RUN_PATH}#g" \
      "$1"
}

for label in com.sermonseek.tunnel com.sermonseek.worker; do
  out="$DEST/$label.plist"
  render "$TPL/$label.plist" > "$out"
  launchctl unload "$out" 2>/dev/null || true
  launchctl load "$out"
  echo "loaded $out"
done

echo
echo "Done. Tail logs:   tail -f $LOG_DIR/sermonseek-{tunnel,worker}.log"
echo "Status:            launchctl list | grep sermonseek"
echo "Stop:              launchctl unload $DEST/com.sermonseek.{worker,tunnel}.plist"
