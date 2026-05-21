#!/usr/bin/env bash
# Nightly pg_dump with rotation.
# Triggered by the sermon-search-pg-dump.timer systemd unit.
# Dumps land at /opt/sermon-search/backups/pgdump-<UTC-timestamp>.dump.
# Keeps the ${BACKUP_RETENTION_COUNT:-14} most-recent dumps; older files are pruned.
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

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
TMP="$BACKUP_DIR/pgdump-${TIMESTAMP}.tmp"
DEST="$BACKUP_DIR/pgdump-${TIMESTAMP}.dump"

echo "[pg-dump] starting dump → $DEST"

$COMPOSE exec -T postgres \
  pg_dump --format=custom --no-owner --no-acl \
  -U "$POSTGRES_USER" "$POSTGRES_DB" > "$TMP"

mv "$TMP" "$DEST"
echo "[pg-dump] dump complete: $DEST ($(du -sh "$DEST" | cut -f1))"

# Rotate: keep the N most recent .dump files; delete the rest.
mapfile -t ALL_DUMPS < <(ls -t "$BACKUP_DIR"/pgdump-*.dump 2>/dev/null)
if (( ${#ALL_DUMPS[@]} > KEEP )); then
  TO_DELETE=("${ALL_DUMPS[@]:$KEEP}")
  for f in "${TO_DELETE[@]}"; do
    echo "[pg-dump] pruning old dump: $f"
    rm -f "$f"
  done
fi

REMAINING=$(ls "$BACKUP_DIR"/pgdump-*.dump 2>/dev/null | wc -l | tr -d ' ')
echo "[pg-dump] done. $REMAINING dumps retained in $BACKUP_DIR"
