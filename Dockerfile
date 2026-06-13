# ── Stage 1: Dependencies ──
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ── Stage 2: Build ──
FROM deps AS builder
WORKDIR /app

# Prisma schema (needed for generate)
COPY prisma ./prisma
RUN bunx prisma generate

# Source code
COPY . .

# Build standalone
RUN bun run build

# ── Stage 3: Production Runner ──
FROM oven/bun:1 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Prisma client needs to be available at runtime
COPY --from=builder /app/node_modules/.prisma /app/node_modules/.prisma
COPY --from=builder /app/prisma ./prisma

# Standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["bun", "server.js"]
