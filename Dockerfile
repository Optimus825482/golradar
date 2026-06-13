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

# ── Stage 3: App Runtime Container (no postgres, separate container) ──
FROM oven/bun:1-alpine
LABEL description="golradar — web app + nesine relay"

ENV NODE_ENV=production
ENV PORT=3000

# nodejs for prisma CLI
RUN apk add --no-cache nodejs

# Next.js standalone
COPY --from=build /app/.next/standalone /app/web
COPY --from=build /app/.next/static /app/web/.next/static
COPY --from=build /app/public /app/web/public
COPY --from=build /app/prisma /app/web/prisma

# Prisma CLI + client
COPY --from=build /app/node_modules/.prisma /app/web/node_modules/.prisma
COPY --from=build /app/node_modules/prisma /app/web/node_modules/prisma
COPY --from=build /app/node_modules/@prisma /app/web/node_modules/@prisma
COPY --from=build /app/node_modules/.bin /app/web/node_modules/.bin

# Nesine-live relay
WORKDIR /app/nesine
COPY --from=build /app/mini-services/nesine-live/package.json ./
COPY --from=build /app/mini-services/nesine-live/bun.lock ./
RUN bun install
COPY --from=build /app/mini-services/nesine-live/index.ts ./
COPY --from=build /app/mini-services/shared /app/shared

WORKDIR /app/web
EXPOSE 3000 3003

# Graceful start — wait for postgres, then start both
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
CMD ["/docker-entrypoint.sh"]
