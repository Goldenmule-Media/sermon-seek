# Worker image: Node 20 + Python 3 + a pinned yt-dlp.
#
# yt-dlp pin: 2026.3.17
#   Pinned so caption fetches are byte-reproducible across machines and CI. The
#   spec's "Operational practices" calls for a deliberate, manual bump policy:
#   bump only when YouTube ships an extractor-breaking change and the new
#   version's release notes confirm it, not on every yt-dlp release.
#
#   Canonical source for this version string lives at
#   apps/worker/src/captions/version.ts (YT_DLP_VERSION). The literal below
#   must be bumped together with that constant — the Docker build cannot
#   import TypeScript, so the coupling is review-enforced.
#
# Production compose lands in C22; this Dockerfile exists in C7 so the caption
# fetcher (apps/worker/src/captions/fetch.ts) has a reproducible runtime.

FROM node:20-bookworm-slim AS base

ENV PNPM_HOME=/root/.local/share/pnpm \
    PATH=/root/.local/share/pnpm:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    NODE_OPTIONS="--conditions=dist"

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        python3 \
        python3-venv \
        ca-certificates \
        curl \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/yt-dlp \
 && /opt/yt-dlp/bin/pip install 'yt-dlp==2026.3.17' \
 && ln -s /opt/yt-dlp/bin/yt-dlp /usr/local/bin/yt-dlp \
 && yt-dlp --version

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

# Workspace manifests first so installs cache cleanly.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/types/package.json ./packages/types/
COPY packages/db/package.json ./packages/db/
COPY packages/embeddings/package.json ./packages/embeddings/
COPY packages/scripture/package.json ./packages/scripture/
COPY packages/notifications/package.json ./packages/notifications/

RUN pnpm install --frozen-lockfile --filter @sermon-search/worker...

# Sources.
COPY packages/types ./packages/types
COPY packages/scripture ./packages/scripture
COPY packages/embeddings ./packages/embeddings
COPY packages/notifications ./packages/notifications
COPY packages/db ./packages/db
COPY apps/worker ./apps/worker

RUN pnpm --filter @sermon-search/worker... build

WORKDIR /app/apps/worker
CMD ["node", "dist/cli/run.js"]
