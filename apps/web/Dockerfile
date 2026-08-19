FROM node:20-bookworm-slim AS deps

ENV PNPM_HOME=/root/.local/share/pnpm \
    PATH=/root/.local/share/pnpm:$PATH

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/types/package.json ./packages/types/

RUN pnpm install --frozen-lockfile --filter @sermon-search/web...

# ---- builder ----
FROM deps AS builder

COPY packages/types ./packages/types
COPY apps/web ./apps/web

# Baked into the client bundle at build time; default matches prod domain.
ARG NEXT_PUBLIC_API_URL=https://sermonseek.ai
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN pnpm --filter @sermon-search/web build

# ---- runner ----
FROM node:20-bookworm-slim AS runner

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

COPY --from=builder /app/apps/web/.next/standalone ./
# With outputFileTracingRoot set to monorepo root, static assets sit alongside server.js.
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
# Landing-page screenshots and other static assets served from /.
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
