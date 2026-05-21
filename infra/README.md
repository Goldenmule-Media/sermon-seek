# infra

Infrastructure configuration for Sermon-Search.

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
