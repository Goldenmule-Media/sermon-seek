FROM node:20-bookworm-slim AS deps

ENV PNPM_HOME=/root/.local/share/pnpm \
    PATH=/root/.local/share/pnpm:$PATH

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/admin/package.json ./apps/admin/
COPY packages/types/package.json ./packages/types/

RUN pnpm install --frozen-lockfile --filter @sermon-search/admin...

# ---- builder ----
FROM deps AS builder

COPY packages/types ./packages/types
COPY apps/admin ./apps/admin

ARG NEXT_PUBLIC_API_URL=https://sermonseek.ai
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN pnpm --filter @sermon-search/admin build

# ---- runner ----
FROM node:20-bookworm-slim AS runner

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

COPY --from=builder /app/apps/admin/.next/standalone ./
COPY --from=builder /app/apps/admin/.next/static ./apps/admin/.next/static

EXPOSE 3000

CMD ["node", "apps/admin/server.js"]
