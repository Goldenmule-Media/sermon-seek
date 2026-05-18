# sermon-search

Monorepo for the sermon-search project. See the
[Local Development wiki page](02154991-8e3a-49d2-b167-dcec719f1322) for the
canonical setup guide.

## First-time setup

```sh
pnpm install
cp .env.example .env
```

Requires Node 20+ (see `.nvmrc`) and pnpm 9 (provisioned via Corepack from the
`packageManager` field in the root `package.json`).

## Layout

- `apps/web` — Next.js frontend (stub; real app lands in C13)
- `apps/api` — Fastify API (stub; lands in C11)
- `apps/worker` — Ingest worker CLI (stub; lands in C6)
- `packages/types` — Shared TypeScript types
- `packages/db` — Kysely client + migrations harness
- `infra/` — Docker compose and infra files (dev stack in C2; prod in C22)

## Root scripts

| Script             | What it does                                     |
| ------------------ | ------------------------------------------------ |
| `pnpm dev`         | Runs every workspace's `dev` script in parallel  |
| `pnpm build`       | `tsc` build across all workspaces                |
| `pnpm typecheck`   | `tsc --noEmit` across all workspaces             |
| `pnpm test`        | Runs every workspace's `test` script             |
| `pnpm lint`        | Biome lint + format check across the repo        |
| `pnpm format`      | Biome formatter (writes changes)                 |
| `pnpm db:migrate`  | Run pending Kysely migrations against `DATABASE_URL` |
| `pnpm db:reset`    | Drop, recreate, and remigrate the dev database   |
| `pnpm db:psql`     | Open `psql` inside the dev Postgres container    |

## Local Postgres

The dev stack runs a single `pgvector/pgvector:pg16` container. Bring it up
and apply migrations from a fresh checkout:

```sh
docker compose -f infra/docker-compose.dev.yml up -d postgres
pnpm db:migrate
```

`pnpm db:reset` drops and recreates the database before re-running migrations.
`pnpm db:psql` shells into the container with `psql` already connected.

### Integration test database

Worker integration tests require a separate throwaway database so they can never
truncate your dev data. Create it once, then set `TEST_DATABASE_URL` in your `.env`:

```sh
docker exec -it <postgres-container> psql -U postgres -c "CREATE DATABASE sermon_search_test;"
```

```
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/sermon_search_test
```

Migrations are applied automatically in `beforeAll`. When `TEST_DATABASE_URL` is
unset the integration test suite is silently skipped by `pnpm -r test`.
