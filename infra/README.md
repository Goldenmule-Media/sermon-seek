# infra

Infrastructure configuration for Sermon-Search.

## Recurring jobs (systemd timers)

All recurring jobs run as **host-level systemd oneshot services** that call
`docker compose exec -T worker` into the running worker container.
This gives per-run logs via `journalctl` and clean failure alerting via
`OnFailure=` without a sidecar cron container.

### Schedule

| Job | Unit | Cadence | What runs |
|-----|------|---------|-----------|
| nightly pg_dump | `sermon-search-pg-dump` | daily 02:00 UTC | `infra/scripts/pg-dump.sh` |
| view-stats refresh | `sermon-search-view-stats` | daily 03:00 UTC | worker `--view-stats` |
| caption smoke-test | `sermon-search-smoke-test` | daily 04:00 UTC | worker `--smoke-test` |
| RSS upload poll | `sermon-search-rss-poll` | hourly at :17 | worker `--rss-poll` |

Unit files live in `infra/systemd/` and are installed to `/etc/systemd/system/`
by `deploy.sh --setup` (and kept up-to-date on each deploy).

All timers have `Persistent=true` so a missed fire (e.g. host was down) catches
up on the next boot.

### Observability

```bash
# See all timers and their next fire time:
systemctl list-timers 'sermon-search-*'

# Inspect the last run of a job:
journalctl -u sermon-search-smoke-test.service -n 100 --no-pager

# Force a job to run immediately:
systemctl start sermon-search-smoke-test.service
```

---

## Backups

### Nightly pg_dump

`infra/scripts/pg-dump.sh` is triggered by `sermon-search-pg-dump.timer` daily
at 02:00 UTC. Dumps land at:

```
/opt/sermon-search/backups/pgdump-<UTC-timestamp>.dump
```

Files are in PostgreSQL custom format (`--format=custom`) so a single table or
the whole DB can be restored selectively via `pg_restore`.

**Rotation:** the script keeps the `BACKUP_RETENTION_DAYS` (default `14`) most
recent dump files and deletes older ones. Set `BACKUP_RETENTION_DAYS` in
`.env.prod` to change the window.

**Restore a dump:**

```bash
# on the EC2 host
docker compose -f /opt/sermon-search/repo/infra/docker-compose.prod.yml \
  --project-directory /opt/sermon-search/repo \
  exec -T postgres \
  pg_restore --clean --if-exists --no-owner --no-acl \
  -U sermon_search -d sermon_search \
  /backups/pgdump-<timestamp>.dump
```

### EBS snapshot policy (manual, v1)

Set up an AWS Data Lifecycle Manager (DLM) lifecycle policy on the EBS volume
that holds `/opt/sermon-search/`:

| Setting | Value |
|---------|-------|
| Schedule | Daily at 03:30 UTC (30 min after pg_dump completes) |
| Retain | 7 snapshots |
| Tags | `Name=sermon-search-data` |

**To configure via AWS Console:**
1. EC2 → Elastic Block Store → Lifecycle Manager → Create lifecycle policy.
2. Resource type: Volume. Tags: `Name=sermon-search-data`.
3. Schedule: every 24 hours starting 03:30 UTC.
4. Retain: 7 snapshots.

EBS snapshots capture the entire `/opt/sermon-search/` tree (Postgres data,
worker cache, and the backup dumps themselves) in one consistent point-in-time
copy that survives instance replacement.

**Follow-up (out of scope for v1):** off-host replication of dump files to S3
or Backblaze for georedundancy.

---

## Alerting

Job failures send a webhook POST to `ALERT_WEBHOOK_URL` (set in `.env.prod`).
The payload is `{"text": "..."}`, compatible with Slack and Discord incoming
webhooks. Leave `ALERT_WEBHOOK_URL` blank to disable (alerting is opt-in).

The `sermon-search-alert@.service` template is wired via `OnFailure=` in each
job's service unit. The instance name (`%i`) is the failed unit name, and the
alert script captures the last 40 journal lines to include in the message.

### Test the alert handler

```bash
# Trigger the alert handler manually for the smoke-test unit:
systemctl start sermon-search-alert@sermon-search-smoke-test.service

# Check the alert was sent:
journalctl -u sermon-search-alert@sermon-search-smoke-test.service -n 20 --no-pager
```

### Induce a smoke-test failure (exit criteria check)

```bash
# 1. Temporarily break the smoke-test by setting an invalid video ID:
#    In /opt/sermon-search/repo/.env, set: SMOKE_TEST_VIDEO_ID=invalid_id
#    Then restart the stack so the worker container picks up the new env:
docker compose -f /opt/sermon-search/repo/infra/docker-compose.prod.yml \
  --project-directory /opt/sermon-search/repo restart worker

# 2. Force the smoke-test to run:
systemctl start sermon-search-smoke-test.service

# 3. Confirm failure + alert:
journalctl -u sermon-search-smoke-test.service -n 20 --no-pager
journalctl -u 'sermon-search-alert@*' -n 20 --no-pager

# 4. Restore the real video ID and restart worker.
```

---

## nginx path-prefix routing (`infra/nginx/sermon-search.conf`)

### What it does

`sermon-search.conf` is a drop-in nginx snippet that implements path-prefix
multi-tenancy routing (see the [Per-church namespacing wiki page][wiki]):

- `/<church>/...` — proxied to the Next.js app **with** `X-Church-Slug: <church>` set.
- `/`, `/about`, `/privacy`, `/terms`, `/_next/...` — proxied **without** `X-Church-Slug`.

The church-prefix regex `[a-z0-9-]+` requires at least one character, so a
bare `/` request never matches it and falls through to the exact-match locations.

### How the app uses these headers

- Next.js reads `params.church` from the `[church]` dynamic segment (the URL
  prefix is not stripped — it passes through verbatim).
- The API also reads `X-Church-Slug` and cross-checks it against the `:church`
  path param. A mismatch returns HTTP 400; an unknown slug returns 404.

### Dropping the snippet into your prod nginx config

1. Copy the file into your server's nginx config directory, e.g.:

   ```
   /etc/nginx/sites-available/sermon-search.conf
   ```

2. Wrap it in a `server` block (supply your own TLS config):

   ```nginx
   server {
       listen 443 ssl;
       server_name example.com;

       # TLS — out of scope here; configure certbot / managed cert separately.

       include /etc/nginx/sites-available/sermon-search.conf;
   }
   ```

3. Point `upstream app` at your Next.js container. The default is `app:3000`
   (the service name in a Docker Compose stack). Change it to match your
   environment:

   ```nginx
   upstream app {
       server 127.0.0.1:3000;  # bare-metal / systemd
   }
   ```

   Or use `envsubst` to substitute at deploy time if you manage the config
   as a template.

4. Test and reload:

   ```bash
   nginx -t && nginx -s reload
   ```

### Adding more root-level (non-church) routes

Add an exact-match `location` block **without** `proxy_set_header X-Church-Slug`:

```nginx
location = /sitemap.xml {
    proxy_pass         http://app;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
    proxy_connect_timeout 10s;
}
```

### Quick smoke-check (replace `example.com` with your host)

```bash
# Church route — X-Church-Slug must be present
curl -sI https://example.com/jubileestl/search | grep -i x-church-slug
# Expected: nothing (nginx sets it on the upstream request, not the response)

# Verify the upstream actually receives it by checking app logs, or use a
# local test upstream that echoes headers back:
docker run --rm -p 9000:80 mendhak/http-https-echo &
# point upstream app → host.docker.internal:9000, then:
curl -s http://localhost/jubileestl/search | jq '.headers["x-church-slug"]'
# Expected: "jubileestl"

curl -s http://localhost/ | jq '.headers["x-church-slug"]'
# Expected: null
```

### Out of scope

- TLS / certificate provisioning (use Certbot, AWS ACM, or your platform's
  managed cert service).
- Actually deploying to production or modifying CI/CD pipelines.
- Root landing page content (separate card).
- nginx `worker_processes`, `keepalive`, rate-limiting, or other global tuning.

[wiki]: https://hotseat.thegoldenmule.com (Per-church namespacing — multi-tenancy)
