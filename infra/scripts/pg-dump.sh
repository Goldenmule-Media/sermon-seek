#!/usr/bin/env bash
# Nightly pg_dump with rotation.
# Triggered by the sermon-search-pg-dump.timer systemd unit.
# Dumps land at /opt/sermon-search/backups/pgdump-<UTC-timestamp>.dump.
# Keeps the ${BACKUP_RETENTION_DAYS:-14} most-recent dumps; older files are pruned.
set -euo pipefail

BACKUP_DIR="/opt/sermon-search/backups"
COMPOSE_FILE="/opt/sermon-search/repo/infra/docker-compose.prod.yml"
COMPOSE="docker compose -f $COMPOSE_FILE --project-directory /opt/sermon-search/repo"

# Source env for POSTGRES_USER, POSTGRES_DB, and BACKUP_RETENTION_DAYS.
# shellcheck disable=SC1091
[[ -f /opt/sermon-search/repo/.env ]] && source /opt/sermon-search/repo/.env

POSTGRES_USER="${POSTGRES_USER:-sermon_search}"
POSTGRES_DB="${POSTGRES_DB:-sermon_search}"
KEEP="${BACKUP_RETENTION_DAYS:-14}"

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
