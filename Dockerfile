# ── Stage 1: Install deps ──
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install

# ── Stage 2: Build Next.js (memory capped) ──
FROM deps AS build
WORKDIR /app
COPY prisma ./prisma
RUN bunx prisma generate
COPY . .
ENV NODE_OPTIONS=--max-old-space-size=384
RUN bun run build

# ── Stage 3: All-in-One Runtime (PostgreSQL + Next.js + Nesine) ──
FROM postgres:16-alpine
LABEL description="golradar — single container with PostgreSQL"

ENV NODE_ENV=production
ENV PORT=3000

# Install bun (runtime)
RUN apk add --no-cache curl bash && \
    curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Next.js standalone output
COPY --from=build /app/.next/standalone /app/web
COPY --from=build /app/.next/static /app/web/.next/static
COPY --from=build /app/public /app/web/public
COPY --from=build /app/prisma /app/web/prisma

# Prisma client + CLI for runtime (pin v6.11.1)
COPY --from=build /app/node_modules/.prisma /app/web/node_modules/.prisma
COPY --from=build /app/node_modules/prisma /app/web/node_modules/prisma
COPY --from=build /app/node_modules/@prisma /app/web/node_modules/@prisma

# Nesine-live relay
WORKDIR /app/nesine
COPY --from=build /app/mini-services/nesine-live/package.json ./
COPY --from=build /app/mini-services/nesine-live/bun.lock ./
RUN bun install
COPY --from=build /app/mini-services/nesine-live/index.ts ./
COPY --from=build /app/mini-services/shared /app/shared

# Entrypoint
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

WORKDIR /app/web
EXPOSE 3000 3003

ENTRYPOINT ["docker-entrypoint.sh"]
