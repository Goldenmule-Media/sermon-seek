#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# scripts/seed-remote-db.sh — bootstrap remote Postgres from local Postgres
#
# Usage:
#   ./scripts/seed-remote-db.sh [-i <key.pem>] <user@host>
#
# One-shot. Safe to repeat after a schema migration as long as schema versions
# still match. Does NOT seed .cache/ — the worker repopulates lazily.
# ---------------------------------------------------------------------------

SSH_KEY=""
TARGET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -i)  SSH_KEY="$2"; shift 2 ;;
    -*)  echo "Unknown flag: $1" >&2; exit 1 ;;
    *)   TARGET="$1"; shift ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 [-i <key.pem>] <user@host>" >&2
  exit 1
fi

SSH_HOST="${TARGET##*@}"
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o BatchMode=yes"
[[ -n "$SSH_KEY" ]] && SSH_OPTS="$SSH_OPTS -i $SSH_KEY"

COMPOSE_CMD="docker compose -f /opt/sermon-search/repo/infra/docker-compose.prod.yml --project-directory /opt/sermon-search/repo"
TIMESTAMP=$(date -u '+%Y%m%dT%H%M%SZ')
REMOTE_DUMP_PATH="/opt/sermon-search/backups/seed-${TIMESTAMP}.dump"
LOCAL_DUMP=""

say()    { echo "[$(date '+%H:%M:%S')] $*"; }
die()    { echo "FATAL: $*" >&2; exit 1; }
remote() { ssh $SSH_OPTS "$TARGET" "$@"; }  # shellcheck disable=SC2086

cleanup() {
  [[ -n "$LOCAL_DUMP" && -f "$LOCAL_DUMP" ]] && rm -f "$LOCAL_DUMP"
}
trap cleanup EXIT

# ── Step 1: local preconditions ───────────────────────────────────────────────
say "Checking local prerequisites..."

[[ -n "${DATABASE_URL:-}" ]] \
  || die "DATABASE_URL is not set. Source your .env and retry."

command -v pg_dump >/dev/null 2>&1 \
  || die "pg_dump not found on PATH. Install postgresql-client and retry."

command -v psql >/dev/null 2>&1 \
  || die "psql not found on PATH. Install postgresql-client and retry."

# ── Step 1 (cont): remote preconditions ──────────────────────────────────────
say "Checking remote host $SSH_HOST..."

remote "test -d /opt/sermon-search/data/pgdata" \
  || die "/opt/sermon-search/data/pgdata not found on $SSH_HOST. Run deploy.sh --setup and deploy.sh first."

# Check postgres container is healthy/running (exit 0 when status contains "healthy" or "running")
POSTGRES_STATE=$(remote "$COMPOSE_CMD ps --format '{{.State}}' postgres" 2>/dev/null || true)
[[ "$POSTGRES_STATE" == *"running"* || "$POSTGRES_STATE" == *"healthy"* ]] \
  || die "Remote postgres container is not running (state: '${POSTGRES_STATE:-unknown}'). Run deploy.sh first."

# ── Step 2: schema version check ─────────────────────────────────────────────
say "Comparing schema versions..."

LOCAL_MIGRATION=$(psql "$DATABASE_URL" -tAc \
  "SELECT name FROM kysely_migration ORDER BY name DESC LIMIT 1" 2>/dev/null || true)
[[ -n "$LOCAL_MIGRATION" ]] \
  || die "Could not read local schema version — is the local DB migrated?"

# shellcheck disable=SC2086
REMOTE_MIGRATION=$(ssh $SSH_OPTS "$TARGET" bash 2>/dev/null <<EOS || true
$COMPOSE_CMD exec -T postgres sh -c 'psql -U "\$POSTGRES_USER" -d "\$POSTGRES_DB" -tAc "SELECT name FROM kysely_migration ORDER BY name DESC LIMIT 1"'
EOS
)
[[ -n "$REMOTE_MIGRATION" ]] \
  || die "Could not read remote schema version — did migrations run on the remote? Run deploy.sh first."

if [[ "$LOCAL_MIGRATION" != "$REMOTE_MIGRATION" ]]; then
  die "Schema version mismatch.
  Local:  $LOCAL_MIGRATION
  Remote: $REMOTE_MIGRATION
Run deploy.sh to apply migrations on the remote, then retry seed-remote-db.sh."
fi

say "Schema versions match: $LOCAL_MIGRATION"

# ── Step 3: dump local DB ─────────────────────────────────────────────────────
LOCAL_DUMP=$(mktemp /tmp/sermon-search-seed-XXXXXX.dump)
say "Dumping local DB to $LOCAL_DUMP..."

pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --exclude-table-data='audit*' \
  "$DATABASE_URL" \
  -f "$LOCAL_DUMP"

DUMP_SIZE=$(du -h "$LOCAL_DUMP" | cut -f1)
say "Dump complete: $DUMP_SIZE"

# ── Step 4: copy dump to remote ───────────────────────────────────────────────
say "Copying dump to $SSH_HOST:$REMOTE_DUMP_PATH..."
# shellcheck disable=SC2086
scp $SSH_OPTS "$LOCAL_DUMP" "$TARGET":"$REMOTE_DUMP_PATH"

# ── Step 5: confirmation prompt ───────────────────────────────────────────────
say "Gathering row counts for confirmation..."

count_local() {
  psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM $1" 2>/dev/null || echo "?"
}

count_remote() {
  local TABLE="$1"
  # shellcheck disable=SC2086
  ssh $SSH_OPTS "$TARGET" bash 2>/dev/null <<EOS || echo "?"
$COMPOSE_CMD exec -T postgres sh -c 'psql -U "\$POSTGRES_USER" -d "\$POSTGRES_DB" -tAc "SELECT COUNT(*) FROM $TABLE"'
EOS
}

LOCAL_VIDEOS=$(count_local videos)
LOCAL_SEGMENTS=$(count_local transcript_segments)
REMOTE_VIDEOS=$(count_remote videos)
REMOTE_SEGMENTS=$(count_remote transcript_segments)

echo ""
echo "┌─────────────────────────────────────────────────────────┐"
echo "│  ⚠  DESTRUCTIVE OPERATION — remote DB will be replaced  │"
echo "├─────────────────────────────────────────────────────────┤"
printf "│  Remote host         : %-33s│\n" "$SSH_HOST"
printf "│  Remote dump path    : %-33s│\n" "$(basename "$REMOTE_DUMP_PATH")"
echo "├─────────────────────────────────────────────────────────┤"
printf "│  %-24s local=%-8s remote=%-7s│\n" "videos"               "$LOCAL_VIDEOS"   "$REMOTE_VIDEOS"
printf "│  %-24s local=%-8s remote=%-7s│\n" "transcript_segments"  "$LOCAL_SEGMENTS" "$REMOTE_SEGMENTS"
echo "└─────────────────────────────────────────────────────────┘"
echo ""

read -r -p "Type 'yes' to proceed with restore: " CONFIRM </dev/tty
if [[ "$CONFIRM" != "yes" ]]; then
  echo "Aborted."
  exit 1
fi

# ── Step 6: restore ───────────────────────────────────────────────────────────
say "Restoring dump on remote..."

# The backups dir is bind-mounted to /backups inside the postgres container.
# shellcheck disable=SC2086
ssh $SSH_OPTS "$TARGET" bash <<EOS
$COMPOSE_CMD exec -T postgres sh -c 'pg_restore --clean --if-exists --no-owner --no-acl -U "\$POSTGRES_USER" -d "\$POSTGRES_DB" /backups/seed-${TIMESTAMP}.dump'
EOS

say "Restore complete."

# ── Step 7: post-restore row count check ──────────────────────────────────────
say "Verifying post-restore row counts..."

check_counts() {
  local TABLE="$1"
  local LOCAL_COUNT="$2"
  local AFTER_COUNT

  AFTER_COUNT=$(count_remote "$TABLE")

  if [[ "$LOCAL_COUNT" == "?" || "$AFTER_COUNT" == "?" ]]; then
    say "WARNING: could not verify row count for $TABLE (local=$LOCAL_COUNT remote=$AFTER_COUNT)"
    return 0
  fi

  # Integer arithmetic — scale to avoid floating-point dependency.
  # Pass if |after - local| * 100 <= local  (i.e. within 1%)
  local DIFF=$(( AFTER_COUNT - LOCAL_COUNT ))
  [[ $DIFF -lt 0 ]] && DIFF=$(( -DIFF ))

  if (( LOCAL_COUNT > 0 && DIFF * 100 > LOCAL_COUNT )); then
    die "Row count mismatch on $TABLE exceeds ±1%: local=$LOCAL_COUNT remote_after=$AFTER_COUNT"
  fi

  say "OK  $TABLE: local=$LOCAL_COUNT remote=$AFTER_COUNT"
}

check_counts videos              "$LOCAL_VIDEOS"
check_counts transcript_segments "$LOCAL_SEGMENTS"

say "=== Seed complete. Remote DB on $SSH_HOST is ready. ==="
