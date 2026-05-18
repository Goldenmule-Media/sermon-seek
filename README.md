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
- `infra/` — Docker compose and infra files (lands in C2 / C22)

## Root scripts

| Script             | What it does                                     |
| ------------------ | ------------------------------------------------ |
| `pnpm dev`         | Runs every workspace's `dev` script in parallel  |
| `pnpm build`       | `tsc` build across all workspaces                |
| `pnpm typecheck`   | `tsc --noEmit` across all workspaces             |
| `pnpm test`        | Runs every workspace's `test` script             |
| `pnpm lint`        | Biome lint + format check across the repo        |
| `pnpm format`      | Biome formatter (writes changes)                 |
