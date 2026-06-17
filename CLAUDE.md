# Sermon-Search

Searches sermons.

## Workspace

- Package manager: **pnpm 9** (Corepack-provisioned via `packageManager` in root `package.json`).
- Node: **≥ 20** (pinned in `.nvmrc` and `engines.node`).
- Lint + format: **Biome** (`pnpm lint`, `pnpm format`).
- Workspace layout: `apps/{web,api,worker}` + `packages/types`; `infra/` reserved for docker-compose (C2 / C22).
- Per-app TS config extends `tsconfig.base.json` at the repo root.
- Environment variables: copy `.env.example` to `.env` for local development.
- Integration tests in `apps/api` and `apps/worker` share one `TEST_DATABASE_URL` database and `TRUNCATE` it in `beforeEach`, so their `test` scripts run with `--no-file-parallelism` — do not remove that flag or the files will stomp each other's rows (manifests as spurious 401s / missing-row failures).

## sermonseek-admin MCP

The `sermon-admin` CLI (`apps/cli`) doubles as an stdio MCP server, registered in `.mcp.json`, so its admin tools (`mcp__sermon-admin__*`) load automatically. Use them (via tool search to discover the full set) to inspect and operate a deployed instance: check worker/system health, browse churches and ingestion requests, read recent logs and the admin audit trail, and perform admin mutations like registering YouTube channels or refreshing channel metadata. Prefer these tools over shelling out to the CLI.

**Login / instance:** the server targets one configured instance, resolved in order — `--url`+`--key` flags → `--instance <name>` (config lookup) → `SERMON_ADMIN_URL`+`SERMON_ADMIN_KEY` env vars → the `currentInstance` saved in the CLI dotfile. If none is set, run `sermon-admin login` (or `sermon-admin config set-instance`) first.

**Local ingest worker (launchd):** the `Constantine-local` worker shown in `health` runs on the dev machine as a macOS LaunchAgent — `~/Library/LaunchAgents/com.sermonseek.worker.plist` (label `com.sermonseek.worker`), installed by `sermon-admin worker install`. It has `KeepAlive=true`, so a plain `kill`/`kill -9` just respawns it within `ThrottleInterval` (15s). To restart it cleanly: `launchctl kickstart -k gui/$(id -u)/com.sermonseek.worker`. Logs: `~/Library/Logs/sermonseek-worker.log`.

## Working with the assistant

- Do not use chrome-devtools (navigate_page, take_screenshot, list_pages, etc.) unless the user explicitly asks for browser interaction. Trust API-level verification (curl, typecheck, tests) and let the user drive the browser themselves.
- Do not claim work is "done", "ready", "verified", or "fixed" until you have actually run the relevant checks — at minimum `pnpm lint` and the package's `typecheck`, plus `test` and a build (`pnpm build` / `docker build`) where the change affects them. State precisely what you ran and what you did *not* run; if a check is impractical locally, say so and name it as an outstanding risk rather than implying completion.
@HOTSEAT.md
