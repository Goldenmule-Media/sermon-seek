#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# run-worker-local.sh — run the worker on THIS machine against the PROD DB.
#
# Why: YouTube blocks caption fetches (yt-dlp) from the EC2 datacenter IP with a
# "confirm you're not a bot" challenge. Running the worker locally makes yt-dlp
# egress from your residential IP, which YouTube serves normally. Metadata still
# comes from the YouTube Data API key; only the yt-dlp scrape needs the good IP.
#
# It opens an SSH tunnel to the prod Postgres (published on the host at
# 127.0.0.1:5432) and runs the worker CLI against it. DB/keys are read from
# .env.prod so nothing is hard-coded here.
#
# Usage:
#   scripts/run-worker-local.sh -i <key.pem> <user@host> -- <worker args…>
#
# Examples (everything after `--` is passed verbatim to the worker CLI):
#   # backfill captions for an already-discovered church, from your IP:
#   scripts/run-worker-local.sh -i key.pem ubuntu@HOST -- --church new-horizon --transcripts
#   # then embeddings / enrichment / related (these use OpenAI, not yt-dlp):
#   scripts/run-worker-local.sh -i key.pem ubuntu@HOST -- --church new-horizon --embed
#   scripts/run-worker-local.sh -i key.pem ubuntu@HOST -- --church new-horizon --enrich
#
# NOTE: this writes to the PRODUCTION database. yt-dlp must be on your PATH.
# ---------------------------------------------------------------------------

SSH_KEY=""
TARGET=""
LOCAL_PORT="${LOCAL_PORT:-15432}"
WORKER_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -i)        SSH_KEY="$2"; shift 2 ;;
    --port)    LOCAL_PORT="$2"; shift 2 ;;
    --)        shift; WORKER_ARGS=("$@"); break ;;
    *)         TARGET="$1"; shift ;;
  esac
done

[[ -n "$TARGET" ]] || { echo "usage: $0 [-i key.pem] <user@host> -- <worker args…>" >&2; exit 1; }
[[ ${#WORKER_ARGS[@]} -gt 0 ]] || { echo "no worker args after '--'" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ -f "$ROOT/.env.prod" ]] || { echo ".env.prod not found in $ROOT" >&2; exit 1; }
command -v yt-dlp >/dev/null || { echo "yt-dlp not on PATH (needed for --transcripts)" >&2; exit 1; }

getenv() { grep -E "^$1=" "$ROOT/.env.prod" | head -1 | cut -d= -f2-; }

PROD_DB_URL="$(getenv DATABASE_URL)"
[[ -n "$PROD_DB_URL" ]] || { echo "DATABASE_URL missing from .env.prod" >&2; exit 1; }
# Repoint the prod URL's host:port (…@host:port/db) at the local tunnel.
LOCAL_DB_URL="$(printf '%s' "$PROD_DB_URL" | sed -E "s#@[^/]+/#@127.0.0.1:${LOCAL_PORT}/#")"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
[[ -n "$SSH_KEY" ]] && SSH_OPTS+=(-i "$SSH_KEY")

CTRL="$(mktemp -u "${TMPDIR:-/tmp}/sermon-tunnel.XXXXXX")"
cleanup() { ssh -S "$CTRL" -O exit "$TARGET" 2>/dev/null || true; }
trap cleanup EXIT

echo "[local-worker] tunneling 127.0.0.1:${LOCAL_PORT} -> ${TARGET} prod postgres…"
ssh "${SSH_OPTS[@]}" -fN -M -S "$CTRL" -L "${LOCAL_PORT}:127.0.0.1:5432" "$TARGET"

echo "[local-worker] running: worker ${WORKER_ARGS[*]}"
cd "$ROOT/apps/worker"
DATABASE_URL="$LOCAL_DB_URL" \
CACHE_DIR="${CACHE_DIR:-$ROOT/.cache-prod-worker}" \
YOUTUBE_API_KEY="$(getenv YOUTUBE_API_KEY)" \
OPENAI_API_KEY="$(getenv OPENAI_API_KEY)" \
ENRICHMENT_MODEL="$(getenv ENRICHMENT_MODEL)" \
  ./node_modules/.bin/tsx src/cli/run.ts "${WORKER_ARGS[@]}"
