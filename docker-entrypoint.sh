#!/bin/sh
set -eu

echo "[ENTRYPOINT] Starting golradar..."

# ── Resolve DATABASE_URL ──
# Coolify injects DATABASE_URL automatically when a PostgreSQL
# database is linked to this service in the Coolify UI.
if [ -z "${DATABASE_URL:-}" ]; then
    echo "[FATAL] DATABASE_URL is not set. Link a PostgreSQL database in Coolify."
    exit 1
fi

# Mask password for logging
MASKED_URL=$(echo "$DATABASE_URL" | sed 's/:.*@/:***@/g')
echo "[DB] DATABASE_URL: $MASKED_URL"

# Extract host/port from DATABASE_URL for connectivity check
DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:]*\):.*|\1|p')
DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

echo "[DB] Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT}..."
DB_READY=0
for i in $(seq 1 90); do
    if node -e "require('net').createConnection({host:'${DB_HOST}',port:${DB_PORT}}).on('connect',()=>process.exit(0)).on('error',()=>{})" 2>/dev/null; then
        echo "[DB] PostgreSQL ready after ${i}s"
        DB_READY=1
        break
    fi
    if [ $((i % 15)) -eq 0 ]; then
        echo "[DB] Still waiting... (${i}s)"
    fi
    sleep 1
done

if [ "$DB_READY" -ne 1 ]; then
    echo "[ERROR] PostgreSQL not reachable after 90s at ${DB_HOST}:${DB_PORT}"
    echo "[ERROR] Continuing anyway — Prisma will show a detailed error."
fi

# ── Prisma schema sync ─────────────────────────────────────────
echo "[DB] Syncing schema..."
cd /app/web

if [ "${PRISMA_ACCEPT_DATA_LOSS:-}" = "1" ]; then
    echo "[DB] Running prisma db push --accept-data-loss..."
    NODE_ENV=production DATABASE_URL="$DATABASE_URL" \
        node ./node_modules/prisma/build/index.js db push --accept-data-loss 2>&1 || true
else
    echo "[DB] Running prisma migrate deploy..."
    if ! NODE_ENV=production DATABASE_URL="$DATABASE_URL" \
        node ./node_modules/prisma/build/index.js migrate deploy 2>&1; then
        echo "[WARN] migrate deploy failed, trying db push..."
        NODE_ENV=production DATABASE_URL="$DATABASE_URL" \
            node ./node_modules/prisma/build/index.js db push 2>&1 || true
    fi
fi
echo "[DB] Schema sync complete"

# ── Start Next.js ──
echo "[WEB] Starting Next.js on port ${PORT:-3000}..."
NODE_ENV=production DATABASE_URL="$DATABASE_URL" PORT=${PORT:-3000} bun server.js &
WEB_PID=$!
echo "[OK] Next.js started (PID $WEB_PID)"

# ── Start Nesine-live relay ──
if [ -f /app/nesine/index.ts ]; then
    echo "[NESINE] Starting relay..."
    cd /app/nesine
    CORS_LIST=$(echo "${SOCKET_CORS_ORIGIN:-http://localhost:3000}" | tr ',' ' ')
    NODE_ENV=production SOCKET_CORS_ORIGIN="${CORS_LIST}" bun index.ts &
    NESINE_PID=$!
    echo "[OK] Nesine relay started (PID $NESINE_PID)"
else
    NESINE_PID=""
fi

# ── Graceful shutdown ──
cleanup() {
    echo "[SHUTDOWN] Stopping..."
    [ -n "$NESINE_PID" ] && kill $NESINE_PID 2>/dev/null || true
    kill $WEB_PID 2>/dev/null || true
    wait 2>/dev/null || true
}
trap cleanup SIGINT SIGTERM

wait -n 2>/dev/null || wait
