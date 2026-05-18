# Sermon-Search

Searches sermons.

## Workspace

- Package manager: **pnpm 9** (Corepack-provisioned via `packageManager` in root `package.json`).
- Node: **≥ 20** (pinned in `.nvmrc` and `engines.node`).
- Lint + format: **Biome** (`pnpm lint`, `pnpm format`).
- Workspace layout: `apps/{web,api,worker}` + `packages/types`; `infra/` reserved for docker-compose (C2 / C22).
- Per-app TS config extends `tsconfig.base.json` at the repo root.
- Environment variables: copy `.env.example` to `.env` for local development.
