#!/bin/sh
set -eu

echo "[ENTRYPOINT] Starting golradar..."

# ── Wait for PostgreSQL to be ready ──
DB_HOST="${DATABASE_HOST:-postgres}"
DB_PORT="${DATABASE_PORT:-5432}"

echo "[DB] Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT}..."
DB_READY=0
for i in $(seq 1 90); do
    if node -e "require('net').createConnection({host:'${DB_HOST}',port:${DB_PORT}}).on('connect',()=>process.exit(0)).on('error',()=>{})" 2>/dev/null; then
        echo "[DB] PostgreSQL ready after ${i}s"
        DB_READY=1
        break
    fi
    sleep 1
done
if [ "$DB_READY" -ne 1 ]; then
    echo "[FATAL] PostgreSQL not reachable after 90s at ${DB_HOST}:${DB_PORT}"
    exit 1
fi

# ── Prisma schema sync ─────────────────────────────────────────
# Production: use prisma migrate deploy (safe, no data loss).
# CI/dev: set PRISMA_ACCEPT_DATA_LOSS=1 to use db push (may drop columns).
echo "[DB] Syncing schema..."
cd /app/web
if [ "${PRISMA_ACCEPT_DATA_LOSS:-}" = "1" ]; then
    echo "[DB] WARNING: --accept-data-loss is SET. Destructive changes WILL be applied."
    echo "[DB] Running prisma db push --accept-data-loss..."
    if ! NODE_ENV=production node ./node_modules/prisma/build/index.js db push --accept-data-loss 2>&1; then
        echo "[FATAL] prisma db push failed — refusing to start app"
        exit 1
    fi
else
    echo "[DB] Running prisma migrate deploy..."
    if ! NODE_ENV=production node ./node_modules/prisma/build/index.js migrate deploy 2>&1; then
        echo "[WARN] prisma migrate deploy failed. Trying db push as fallback..."
        echo "[WARN] Set PRISMA_ACCEPT_DATA_LOSS=1 to skip this warning."
        if ! NODE_ENV=production node ./node_modules/prisma/build/index.js db push 2>&1; then
            echo "[FATAL] prisma schema sync failed — refusing to start app"
            exit 1
        fi
    fi
fi
echo "[DB] Schema in sync"

# ── Start Next.js via npm start ──
echo "[WEB] Starting Next.js (bun server.js)..."
NODE_ENV=production PORT=3000 \
    DATABASE_URL="${DATABASE_URL:-postgresql://postgres:golradar_secret@postgres:5432/golradar_db}" \
    NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}" \
    NEXT_PUBLIC_SOCKET_URL="${NEXT_PUBLIC_SOCKET_URL:-http://localhost:3003}" \
    SOCKET_CORS_ORIGIN="${SOCKET_CORS_ORIGIN:-http://localhost:3000}" \
    RADAR_THRESHOLD="${RADAR_THRESHOLD:-65}" \
    SIGNAL_5MIN_THRESHOLD="${SIGNAL_5MIN_THRESHOLD:-0.25}" \
    POISSON_BLEND_WEIGHT="${POISSON_BLEND_WEIGHT:-0.25}" \
    MAX_PRESSURE_SNAPSHOTS="${MAX_PRESSURE_SNAPSHOTS:-540}" \
    NESINE_API_TIMEOUT="${NESINE_API_TIMEOUT:-10000}" \
    FOTMOB_API_TIMEOUT="${FOTMOB_API_TIMEOUT:-10000}" \
    GOALOO_API_TIMEOUT="${GOALOO_API_TIMEOUT:-15000}" \
    SCOREMER_API_TIMEOUT="${SCOREMER_API_TIMEOUT:-15000}" \
    NEXT_PUBLIC_PWA_THEME_COLOR="${NEXT_PUBLIC_PWA_THEME_COLOR:-#10b981}" \
    bun server.js &
WEB_PID=$!
echo "[OK] Next.js started (PID $WEB_PID)"

# ── Start Nesine-live in background ──
echo "[NESINE] Starting relay..."
cd /app/nesine
CORS_LIST=$(echo "${SOCKET_CORS_ORIGIN:-http://localhost:3000}" | tr ',' ' ')
NODE_ENV=production SOCKET_CORS_ORIGIN="${CORS_LIST}" bun index.ts &
NESINE_PID=$!
echo "[OK] Nesine relay started (PID $NESINE_PID)"

# ── Graceful shutdown ──
cleanup() {
    echo "[SHUTDOWN] Stopping..."
    kill $NESINE_PID 2>/dev/null || true
    kill $WEB_PID 2>/dev/null || true
    wait 2>/dev/null || true
}
trap cleanup SIGINT SIGTERM

wait
