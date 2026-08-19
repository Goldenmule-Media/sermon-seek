#!/usr/bin/env bash
# Nightly pg_dump with rotation.
# Triggered by the sermon-search-pg-dump.timer systemd unit.
# Dumps land at /opt/sermon-search/backups/pgdump-<UTC-timestamp>.dump.
# Keeps the ${BACKUP_RETENTION_COUNT:-14} most-recent dumps; older files are pruned.
#
# Rotation runs BEFORE the dump (down to KEEP-1) so a successful run never needs
# more than KEEP dumps of disk at once. Pruning only after the write meant a full
# disk made pg_dump fail, `set -e` aborted the script before the prune, and nothing
# was ever reclaimed — a deadlock that silently skipped 49 nightly backups in 2026.
set -euo pipefail

BACKUP_DIR="/opt/sermon-search/backups"
COMPOSE_FILE="/opt/sermon-search/repo/infra/docker-compose.prod.yml"
COMPOSE="docker compose -f $COMPOSE_FILE --project-directory /opt/sermon-search/repo"

# Read only the three vars we need from .env without sourcing it.
# Sourcing executes arbitrary shell — comment lines and values with $, backticks,
# or special chars in URLs (e.g. ALERT_WEBHOOK_URL) would expand unexpectedly.
_env_file="/opt/sermon-search/repo/.env"
_read_env() {
  local key="$1"
  grep -E "^${key}=" "$_env_file" 2>/dev/null | head -1 | cut -d= -f2- | sed "s/^['\"]//;s/['\"]$//"
}
if [[ -f "$_env_file" ]]; then
  POSTGRES_USER="$(_read_env POSTGRES_USER)"
  POSTGRES_DB="$(_read_env POSTGRES_DB)"
  BACKUP_RETENTION_COUNT="$(_read_env BACKUP_RETENTION_COUNT)"
fi

POSTGRES_USER="${POSTGRES_USER:-sermon_search}"
POSTGRES_DB="${POSTGRES_DB:-sermon_search}"
KEEP="${BACKUP_RETENTION_COUNT:-14}"

if ! [[ "$KEEP" =~ ^[0-9]+$ ]] || (( KEEP < 1 )); then
  echo "[pg-dump] BACKUP_RETENTION_COUNT must be a positive integer, got '$KEEP'" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# List dumps newest-first. `|| true` keeps set -e happy when the glob matches nothing.
list_dumps() {
  ls -t "$BACKUP_DIR"/pgdump-*.dump 2>/dev/null || true
}

# Delete all but the $1 most-recent dumps.
prune_dumps() {
  local target="$1" f
  local -a dumps
  mapfile -t dumps < <(list_dumps)
  (( ${#dumps[@]} > target )) || return 0
  for f in "${dumps[@]:$target}"; do
    echo "[pg-dump] pruning old dump: $f"
    rm -f "$f"
  done
}

# Clear .tmp files left behind by earlier crashed runs. The prune globs *.dump only,
# so without this these orphans accumulate forever (56 of them, 1.2G, by Aug 2026).
# The systemd unit is Type=oneshot, so no concurrent run owns one of these.
shopt -s nullglob
STALE_TMPS=("$BACKUP_DIR"/pgdump-*.tmp)
shopt -u nullglob
if (( ${#STALE_TMPS[@]} > 0 )); then
  echo "[pg-dump] removing ${#STALE_TMPS[@]} stale .tmp file(s) from previous failed runs"
  rm -f "${STALE_TMPS[@]}"
fi

# Rotate to KEEP-1 first so this run's dump brings the total back to exactly KEEP.
prune_dumps "$(( KEEP - 1 ))"

# Refuse to start a dump we don't have room for, so the failure is loud (and trips
# OnFailure=) rather than leaving a truncated file behind. Size the estimate off the
# most recent dump plus 20% headroom; skip the check on a first-ever run.
mapfile -t EXISTING < <(list_dumps)
if (( ${#EXISTING[@]} > 0 )); then
  NEED_KB=$(( $(du -k "${EXISTING[0]}" | cut -f1) * 12 / 10 ))
  AVAIL_KB=$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print $4}')
  if (( AVAIL_KB < NEED_KB )); then
    echo "[pg-dump] insufficient disk space in $BACKUP_DIR:" \
         "need ~$(( NEED_KB / 1024 ))M, have $(( AVAIL_KB / 1024 ))M" >&2
    exit 1
  fi
fi

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
TMP="$BACKUP_DIR/pgdump-${TIMESTAMP}.tmp"
DEST="$BACKUP_DIR/pgdump-${TIMESTAMP}.dump"

# Don't leave this run's partial file behind if pg_dump dies partway through.
cleanup() {
  if [[ -f "$TMP" ]]; then
    echo "[pg-dump] removing partial dump: $TMP" >&2
    rm -f "$TMP"
  fi
  return 0
}
trap cleanup EXIT

echo "[pg-dump] starting dump → $DEST"

$COMPOSE exec -T postgres \
  pg_dump --format=custom --no-owner --no-acl \
  -U "$POSTGRES_USER" "$POSTGRES_DB" > "$TMP"

mv "$TMP" "$DEST"
echo "[pg-dump] dump complete: $DEST ($(du -sh "$DEST" | cut -f1))"

# Safety net: normally a no-op, since we already pruned to KEEP-1 above.
prune_dumps "$KEEP"

REMAINING=$(list_dumps | wc -l | tr -d ' ')
echo "[pg-dump] done. $REMAINING dumps retained in $BACKUP_DIR"
