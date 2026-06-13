#!/bin/bash
set -euo pipefail

echo "[ENTRYPOINT] Bootstrapping..."

PG_VER="${POSTGRES_MAJOR:-16}"
PGDATA="${PGDATA:-/var/lib/postgresql/data}"
PGPASS="${POSTGRES_PASSWORD:-golradar_secret}"

# ── Initialize data directory on first run ──
if [ ! -d "${PGDATA}/base" ]; then
    echo "[DB] Initializing PostgreSQL ${PG_VER}..."
    mkdir -p "${PGDATA}"
    chown -R postgres:postgres "${PGDATA}"
    su - postgres -c "initdb -D '${PGDATA}' -E UTF8 --locale=en_US.UTF-8"
fi

# ── Start PostgreSQL ──
echo "[DB] Starting PostgreSQL..."
su - postgres -c "pg_ctl -D '${PGDATA}' -l /tmp/pg.log -w start"
sleep 2

# Set password + create DB
psql -U postgres -c "ALTER USER postgres WITH PASSWORD '${PGPASS}';" &>/dev/null || true
psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'golradar_db'" | grep -q 1 || \
    psql -U postgres -c "CREATE DATABASE golradar_db"

export DATABASE_URL="postgresql://postgres:${PGPASS}@localhost:5432/golradar_db"

# ── Prisma ──
cd /app/web
echo "[DB] Running prisma db push..."
NODE_ENV=production bun x prisma db push 2>&1 || echo "[WARN] prisma db push skipped"

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

# ── Start Nesine-live ──
cd /app/nesine
CORS_LIST=$(echo "${SOCKET_CORS_ORIGIN:-http://localhost:3000}" | tr ',' ' ')
NODE_ENV=production SOCKET_CORS_ORIGIN="${CORS_LIST}" bun index.ts &
echo "[OK] Nesine relay started"

# ── Graceful shutdown ──
cleanup() {
    echo "[SHUTDOWN] Stopping..."
    kill $WEB_PID $NESINE_PID 2>/dev/null || true
    wait 2>/dev/null || true
    su - postgres -c "pg_ctl -D '${PGDATA}' stop" 2>/dev/null || true
}
trap cleanup SIGINT SIGTERM

wait
