#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# worker-local-serve.sh — run the worker `--serve` daemon on THIS machine.
#
# Why: YouTube bot-blocks caption fetches (yt-dlp) from the EC2 datacenter IP.
# Running the worker locally makes yt-dlp egress from a residential IP. The
# daemon polls the prod `ingestion_requests` queue, claims requests, and runs
# the full pipeline (captions → embed → enrich → related), finalizing status.
#
# Connects to the prod DB over an SSH tunnel on 127.0.0.1:$LOCAL_PORT. The
# tunnel must already be up — it's owned by the com.sermonseek.tunnel launchd
# agent, or for a manual run:
#   ssh -N -L 15432:127.0.0.1:5432 <user@host>
#
# Normally launched (and kept alive) by the com.sermonseek.worker launchd
# agent; safe to run by hand for testing. Ctrl-C stops it.
#
# Requirements on PATH: yt-dlp, node. Reads creds from .env.prod.
# ---------------------------------------------------------------------------

LOCAL_PORT="${LOCAL_PORT:-15432}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env.prod}"

[[ -f "$ENV_FILE" ]] || { echo "env file not found: $ENV_FILE" >&2; exit 1; }
command -v yt-dlp >/dev/null || { echo "yt-dlp not on PATH (needed for caption fetches)" >&2; exit 1; }

getenv() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

PROD_DB_URL="$(getenv DATABASE_URL)"
[[ -n "$PROD_DB_URL" ]] || { echo "DATABASE_URL missing from $ENV_FILE" >&2; exit 1; }
# Repoint the prod URL's host:port (…@host:port/db) at the local tunnel.
LOCAL_DB_URL="$(printf '%s' "$PROD_DB_URL" | sed -E "s#@[^/]+/#@127.0.0.1:${LOCAL_PORT}/#")"

# Only export vars that are non-empty: run.ts treats an empty (but defined)
# LIMITED_INGEST_TOKEN_CAP / ENRICHMENT_MODEL as a hard error / bad value, so
# skipping them lets the worker fall back to its built-in defaults.
ENVV=()
addenv() { [[ -n "$2" ]] && ENVV+=("$1=$2"); }

addenv DATABASE_URL "$LOCAL_DB_URL"
addenv CACHE_DIR "${CACHE_DIR:-$ROOT/.cache-prod-worker}"
addenv YOUTUBE_API_KEY "$(getenv YOUTUBE_API_KEY)"
addenv OPENAI_API_KEY "$(getenv OPENAI_API_KEY)"
addenv ENRICHMENT_MODEL "$(getenv ENRICHMENT_MODEL)"
addenv WEB_BASE_URL "$(getenv WEB_BASE_URL)"
addenv LIMITED_INGEST_TOKEN_CAP "$(getenv LIMITED_INGEST_TOKEN_CAP)"
# Log shipping → prod ring buffer (visible via `sermon-admin logs tail --source worker`).
addenv ADMIN_API_KEY "$(getenv ADMIN_API_KEY)"
addenv WORKER_API_URL "${WORKER_API_URL:-https://sermonseek.ai}"
addenv WORKER_ID "${WORKER_ID:-$(hostname -s)-local}"

echo "[worker-local] starting --serve against 127.0.0.1:${LOCAL_PORT} (WORKER_ID=${WORKER_ID:-$(hostname -s)-local})"
cd "$ROOT/apps/worker"
exec env "${ENVV[@]}" ./node_modules/.bin/tsx src/cli/run.ts --serve
