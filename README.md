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

## Semantic search (C16)

### Backfill embeddings

After ingesting transcripts, generate chunk embeddings with:

```sh
OPENAI_API_KEY=sk-... pnpm worker:run --embed
```

Prints a JSON summary: `{ videosProcessed, videosSkipped, chunksInserted, embeddingsInserted }`.
Re-runs are idempotent — videos whose chunk count already matches their embedding count are skipped.

### Query with semantic mode

```
GET /v1/search?q=the+bread+of+life&mode=semantic
```

Returns the same `SearchResponse` shape as `mode=fulltext`.

## LLM enrichment (C18)

### Enrich videos with topics, summaries, and scripture refs

After ingesting transcripts, generate per-video enrichment (summary, 5–10 topics, 1–3 scripture refs) with:

```sh
OPENAI_API_KEY=sk-... pnpm worker:run --enrich
```

Prints a JSON summary: `{ videosProcessed, videosSkipped, topicsInserted, refsInserted }`.
Re-runs are idempotent — videos already enriched at the same model version are skipped.
Use `--force` to re-run and overwrite existing enrichment:

```sh
OPENAI_API_KEY=sk-... pnpm worker:run --enrich --force
```

**Model:** OpenAI `gpt-4o-mini` via Structured Outputs (`response_format: json_schema`).
Override with `ENRICHMENT_MODEL=gpt-4o-mini` in `.env`.

**Cost estimate:** ~$0.0005 per video at 12k input chars + ~250 output chars using `gpt-4o-mini`.

**Schema choice:** A sibling `video_enrichments` table holds the summary, model metadata, and raw LLM
response — keeping `videos` stable and wide. Topics are normalised into a `topics(slug, label)` table
so multiple videos share the same row; `video_topics` is the join. `video_scripture_refs` holds the
filtered refs (regex-validated, capped at 3).

### Paraphrase example (seed corpus)

FTS misses paraphrased queries that semantic search finds. One verified pair from
the seed corpus (run `pnpm worker:run --embed` on the seeded data to reproduce):

| Query | FTS result | Semantic result |
|---|---|---|
| "nourishment for the soul" | no results | segment matching "I am the bread of life; whoever comes to me shall not hunger" |

The FTS query `plainto_tsquery('english', 'nourishment for the soul')` finds zero
rows because none of those tokens appear in the transcript. The semantic query
embeds the phrase and retrieves the most cosine-similar chunk, which covers the
"bread of life" passage — a paraphrase FTS cannot bridge.
