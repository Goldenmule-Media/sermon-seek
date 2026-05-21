FROM node:20-bookworm-slim AS base

ENV PNPM_HOME=/root/.local/share/pnpm \
    PATH=/root/.local/share/pnpm:$PATH \
    NODE_OPTIONS="--conditions=dist"

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

# Workspace manifests first so installs cache cleanly.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY packages/types/package.json ./packages/types/
COPY packages/db/package.json ./packages/db/
COPY packages/embeddings/package.json ./packages/embeddings/
COPY packages/scripture/package.json ./packages/scripture/

RUN pnpm install --frozen-lockfile --filter @sermon-search/api...

# Sources.
COPY packages/types ./packages/types
COPY packages/scripture ./packages/scripture
COPY packages/embeddings ./packages/embeddings
COPY packages/db ./packages/db
COPY apps/worker ./apps/worker
COPY apps/api ./apps/api

RUN pnpm --filter @sermon-search/api... build

WORKDIR /app/apps/api

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3001/v1/health || exit 1

CMD ["node", "dist/index.js"]
