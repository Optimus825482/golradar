# ── Stage 1: Install deps ──
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ── Stage 2: Build Next.js ──
FROM deps AS build
WORKDIR /app
COPY prisma ./prisma
RUN bunx prisma generate
COPY . .
RUN bun run build

# ── Stage 3: All-in-One Runtime (PostgreSQL + Next.js + Nesine) ──
FROM postgres:16-alpine
LABEL description="golradar — single container with PostgreSQL"

ENV NODE_ENV=production
ENV PORT=3000

# Install bun
RUN apk add --no-cache curl bash && \
    curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Copy Next.js standalone
COPY --from=build /app/.next/standalone /app/web
COPY --from=build /app/.next/static /app/web/.next/static
COPY --from=build /app/public /app/web/public
COPY --from=build /app/prisma /app/web/prisma

# Prisma client for runtime
COPY --from=build /app/node_modules/.prisma /root/.prisma

# Copy Nesine relay
WORKDIR /app/nesine
COPY --from=build /app/mini-services/nesine-live/package.json ./
COPY --from=build /app/mini-services/nesine-live/bun.lock ./
RUN bun install --frozen-lockfile
COPY --from=build /app/mini-services/nesine-live/index.ts ./
COPY --from=build /app/mini-services/shared /app/shared

# Entrypoint
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

WORKDIR /app/web
EXPOSE 3000 3003

ENTRYPOINT ["docker-entrypoint.sh"]
