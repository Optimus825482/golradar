#!/bin/bash
set -e

echo "[ENTRYPOINT] Bootstrapping..."

# ── Set PostgreSQL password ──
PGPASS="${POSTGRES_PASSWORD:-golradar_secret}"

# ── Start PostgreSQL (built-in, already running near-entry but ensure) ──
# PostgreSQL 16 alpine: data directory pre-initialized by image
# Just configure and wait
PG_READY=0
for i in $(seq 1 60); do
    if pg_isready -q -U postgres; then
        PG_READY=1
        break
    fi
    sleep 1
done
if [ "$PG_READY" -eq 0 ]; then
    echo "[FATAL] PostgreSQL did not start"
    exit 1
fi
echo "[OK] PostgreSQL ready"

# Set password + create DB (skip if exists)
psql -U postgres -c "ALTER USER postgres WITH PASSWORD '${PGPASS}';" 2>/dev/null || true
psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'golradar_db'" | grep -q 1 || \
    psql -U postgres -c "CREATE DATABASE golradar_db"

export DATABASE_URL="postgresql://postgres:${PGPASS}@localhost:5432/golradar_db"

# ── Prisma migrate ──
cd /app/web
echo "[DB] Running prisma db push..."
NODE_ENV=production bunx prisma db push 2>&1 || echo "[WARN] prisma db push skipped"

# ── Start Next.js ──
NODE_ENV=production PORT=3000 DATABASE_URL="${DATABASE_URL}" \
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
echo "[OK] Next.js started"

# ── Start Nesine-live relay ──
cd /app/nesine
CORS_LIST=$(echo "${SOCKET_CORS_ORIGIN:-http://localhost:3000}" | tr ',' ' ')
NODE_ENV=production SOCKET_CORS_ORIGIN="${CORS_LIST}" bun index.ts &
echo "[OK] Nesine relay started"

# ── Shutdown hook ──
cleanup() {
    echo "[SHUTDOWN] Stopping all services..."
    kill $WEB_PID $NESINE_PID 2>/dev/null || true
    wait 2>/dev/null || true
}
trap cleanup SIGINT SIGTERM

wait
