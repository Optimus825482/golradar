#!/bin/bash
set -euo pipefail

echo "[ENTRYPOINT] Starting golradar..."

# ── Wait for PostgreSQL to be ready ──
DB_HOST="${DATABASE_HOST:-postgres}"
DB_PORT="${DATABASE_PORT:-5432}"

echo "[DB] Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT}..."
for i in $(seq 1 60); do
    if nc -z "${DB_HOST}" "${DB_PORT}" 2>/dev/null; then
        break
    fi
    sleep 1
done

# ── Prisma db push (run migrations) ──
echo "[DB] Running prisma db push..."
cd /app/web
NODE_ENV=production ./node_modules/.bin/prisma db push 2>&1 || echo "[WARN] prisma db push skipped"

# ── Start Next.js via npm start ──
echo "[WEB] Starting Next.js (npm run start)..."
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
    npm run start &
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
    # Send SIGTERM to npm/node process tree
    pkill -f "next start" 2>/dev/null || true
    kill $WEB_PID 2>/dev/null || true
    wait 2>/dev/null || true
}
trap cleanup SIGINT SIGTERM

wait
