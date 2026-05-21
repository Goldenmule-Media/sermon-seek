#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# deploy.sh — push sermon-search to a single EC2 host via rsync + docker compose
#
# Usage:
#   ./deploy.sh [--setup] [--domain <domain>] [-i <key.pem>] <user@host>
#
# --setup   Bootstrap a fresh Ubuntu host (Docker, dirs, ufw). Run once.
#           After setup, run again without --setup to deploy.
# ---------------------------------------------------------------------------

DOMAIN="sermonseek.ai"
SSH_KEY=""
SETUP=false
TARGET=""

# ── argument parser ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --setup)        SETUP=true; shift ;;
    --domain)       DOMAIN="$2"; shift 2 ;;
    -i)             SSH_KEY="$2"; shift 2 ;;
    -*)             echo "Unknown flag: $1" >&2; exit 1 ;;
    *)              TARGET="$1"; shift ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 [--setup] [--domain <domain>] [-i <key.pem>] <user@host>" >&2
  exit 1
fi

SSH_USER="${TARGET%%@*}"
SSH_HOST="${TARGET##*@}"
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o BatchMode=yes"
[[ -n "$SSH_KEY" ]] && SSH_OPTS="$SSH_OPTS -i $SSH_KEY"

COMPOSE_CMD="docker compose -f /opt/sermon-search/repo/infra/docker-compose.prod.yml --project-directory /opt/sermon-search/repo"

# ── helpers ──────────────────────────────────────────────────────────────────
say() { echo "[$(date '+%H:%M:%S')] $*"; }

remote() {
  # shellcheck disable=SC2086
  ssh $SSH_OPTS "$TARGET" "$@"
}

die() { echo "FATAL: $*" >&2; exit 1; }

# ── --setup mode ─────────────────────────────────────────────────────────────
if $SETUP; then
  say "=== SETUP MODE: bootstrapping $TARGET ==="

  remote bash -s <<'SETUP_SCRIPT'
set -euo pipefail

say() { echo "  [setup] $*"; }

say "apt update + base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates curl rsync ufw

if ! command -v docker &>/dev/null; then
  say "Installing Docker via get.docker.com"
  curl -fsSL https://get.docker.com | sh
else
  say "Docker already installed: $(docker --version)"
fi

# Ensure the login user (first non-root user or $SUDO_USER) is in the docker group.
# When called via SSH as ubuntu/ec2-user, $USER is that user.
TARGET_USER="${SUDO_USER:-$USER}"
if [[ "$TARGET_USER" != "root" ]]; then
  say "Adding $TARGET_USER to docker group"
  usermod -aG docker "$TARGET_USER"
fi

say "Creating /opt/sermon-search directory tree"
mkdir -p /opt/sermon-search/{repo,data/pgdata,data/cache,backups,caddy/data,caddy/config}
if [[ "${TARGET_USER:-root}" != "root" ]]; then
  chown -R "$TARGET_USER:$TARGET_USER" /opt/sermon-search
fi

say "Installing systemd units"
cp /opt/sermon-search/repo/infra/systemd/*.service /etc/systemd/system/
cp /opt/sermon-search/repo/infra/systemd/*.timer  /etc/systemd/system/
systemctl daemon-reload
# Enable timers (the alert@ template needs no explicit enable — instances start via OnFailure=).
for timer in \
  sermon-search-pg-dump.timer \
  sermon-search-view-stats.timer \
  sermon-search-smoke-test.timer \
  sermon-search-rss-poll.timer; do
  systemctl enable --now "$timer"
done
say "Systemd timers installed and enabled."

say "Configuring ufw firewall"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

say "Setup complete. Log out and back in (or run 'newgrp docker') if this is"
say "your first login after being added to the docker group, then run deploy.sh"
say "without --setup to deploy."
SETUP_SCRIPT

  say "=== Setup finished. Run './deploy.sh [-i key.pem] $TARGET' to deploy. ==="
  exit 0
fi

# ── default (deploy) mode ────────────────────────────────────────────────────
say "=== DEPLOY: $TARGET  domain=$DOMAIN ==="

# Step 1: warn on dirty working tree (don't block — useful for hotfixes)
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  say "WARNING: local working tree is dirty — deploying anyway"
fi

# Step 2: require .env.prod
[[ -f ".env.prod" ]] || die ".env.prod not found in $(pwd). Create it from .env.prod.example."

# Step 3: rsync repo to host
say "Syncing repo to $TARGET:/opt/sermon-search/repo/"
# shellcheck disable=SC2086
rsync -az --delete \
  -e "ssh $SSH_OPTS" \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='.env*' \
  --exclude='.hotseat/worktrees/' \
  --exclude='apps/**/dist/' \
  --exclude='apps/**/.next/' \
  --exclude='.cache/' \
  --exclude='.DS_Store' \
  ./ "$TARGET":/opt/sermon-search/repo/

# Step 4: copy .env.prod → remote .env
say "Copying .env.prod to $TARGET:/opt/sermon-search/repo/.env"
# shellcheck disable=SC2086
scp $SSH_OPTS .env.prod "$TARGET":/opt/sermon-search/repo/.env

# Step 5: build images on host
say "Building images on host (this takes ~2 min on first run)..."
remote "$COMPOSE_CMD build" \
  || die "docker compose build failed"

# Step 6: bring stack up
say "Starting services..."
remote "$COMPOSE_CMD up -d" \
  || die "docker compose up -d failed"

# Step 7: run migrations
# Use the pre-built JS directly to avoid the --env-file=../../.env flag in
# packages/db/package.json — env vars are already injected by compose env_file.
say "Running database migrations..."
remote "$COMPOSE_CMD exec -T api node /app/packages/db/dist/cli/migrate.js" \
  || die "database migrations failed"

# Step 7b: re-install systemd units if any changed (idempotent)
say "Re-installing systemd units (idempotent)..."
remote bash -s <<'UNITS_SCRIPT'
set -euo pipefail
CHANGED=false
for f in /opt/sermon-search/repo/infra/systemd/*.service \
          /opt/sermon-search/repo/infra/systemd/*.timer; do
  dest="/etc/systemd/system/$(basename "$f")"
  if ! diff -q "$f" "$dest" &>/dev/null 2>&1; then
    cp "$f" "$dest"
    CHANGED=true
  fi
done
if $CHANGED; then
  systemctl daemon-reload
  for timer in \
    sermon-search-pg-dump.timer \
    sermon-search-view-stats.timer \
    sermon-search-smoke-test.timer \
    sermon-search-rss-poll.timer; do
    systemctl restart "$timer" 2>/dev/null || systemctl enable --now "$timer"
  done
  echo "[units] updated and reloaded."
else
  echo "[units] no changes."
fi
UNITS_SCRIPT

# Step 8: poll service states for ~15 s
say "Polling service health (~15 s)..."
POLL_DEADLINE=$(( $(date +%s) + 15 ))
while true; do
  STATES=$(remote "$COMPOSE_CMD ps --format '{{.Service}}={{.State}}'" 2>/dev/null || true)
  BAD=$(echo "$STATES" | grep -E '=(restarting|exited|dead)' || true)
  if [[ -z "$BAD" ]]; then
    say "All services running."
    break
  fi
  if [[ $(date +%s) -ge $POLL_DEADLINE ]]; then
    echo "$STATES"
    die "Services in bad state after 15 s: $(echo "$BAD" | tr '\n' ' ')"
  fi
  sleep 1
done

# Step 9: post-deploy health checks from operator's machine
# Retry for up to 60 s to absorb Caddy first-cert ACME issuance.
say "Post-deploy health checks (retrying up to 60 s for TLS cert issuance)..."

check_url() {
  local url="$1"
  local deadline=$(( $(date +%s) + 60 ))
  while true; do
    if curl -fsSk --max-time 10 "$url" >/dev/null 2>&1; then
      say "OK  $url"
      return 0
    fi
    if [[ $(date +%s) -ge $deadline ]]; then
      die "Health check timed out after 60 s: $url"
    fi
    sleep 3
  done
}

check_url "https://$DOMAIN/v1/health"
check_url "https://$DOMAIN/"

say "=== Deploy complete: https://$DOMAIN/ ==="
