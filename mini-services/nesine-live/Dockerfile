# ── Nesine Live WebSocket Relay ──
FROM oven/bun:1
WORKDIR /app

# Dependency caching — use nesine-live's own bun.lock (separate sub-package)
COPY mini-services/nesine-live/package.json mini-services/nesine-live/bun.lock ./
RUN bun install --frozen-lockfile

# Source (context = project root)
COPY mini-services/nesine-live/index.ts .
COPY mini-services/shared ./shared

EXPOSE 3003

CMD ["bun", "index.ts"]
