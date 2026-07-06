#!/bin/sh
set -eu

echo "[MIGRATION] Applying database migrations..."

# Wait for database to be ready
if [ -z "${DATABASE_URL:-}" ]; then
    echo "[MIGRATION] ERROR: DATABASE_URL is not set"
    exit 1
fi

DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:]*\):.*|\1|p')
DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"

echo "[MIGRATION] Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT}..."
for i in $(seq 1 60); do
    if node -e "require('net').createConnection({host:'${DB_HOST}',port:${DB_PORT}}).on('connect',()=>process.exit(0)).on('error',()=>{})" 2>/dev/null; then
        echo "[MIGRATION] ✅ PostgreSQL ready (${i}s)"
        break
    fi
    if [ $((i % 10)) -eq 0 ]; then
        echo "[MIGRATION] Waiting... (${i}s)"
    fi
    sleep 1
done

# Run Prisma migrations
PRISMA_BIN="node ./node_modules/prisma/build/index.js"

echo "[MIGRATION] Running prisma migrate deploy..."
NODE_ENV=production DATABASE_URL="$DATABASE_URL" \
    $PRISMA_BIN migrate deploy 2>&1

MIGRATE_EXIT=$?

if [ $MIGRATE_EXIT -ne 0 ]; then
    echo "[MIGRATION] ⚠️  migrate deploy failed, trying db push..."
    NODE_ENV=production DATABASE_URL="$DATABASE_URL" \
        $PRISMA_BIN db push 2>&1 || echo "[MIGRATION] ❌ db push also failed"
else
    echo "[MIGRATION] ✅ Migrations applied successfully"
fi

echo "[MIGRATION] Migration process complete"
