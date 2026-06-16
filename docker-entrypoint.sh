#!/bin/sh
set -eu

echo "[ENTRYPOINT] Starting golradar..."

# DATABASE_URL is set by docker-compose.yaml
if [ -z "${DATABASE_URL:-}" ]; then
    echo "[FATAL] DATABASE_URL is not set!"
    exit 1
fi

MASKED_URL=$(echo "$DATABASE_URL" | sed 's/:.*@/:***@/g')
echo "[DB] DATABASE_URL: $MASKED_URL"

# Extract host/port from DATABASE_URL
DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:]*\):.*|\1|p')
DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
DB_HOST="${DB_HOST:-postgres}"
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
fi

# Prisma schema sync
echo "[DB] Syncing schema..."
cd /app/web

if [ "${PRISMA_ACCEPT_DATA_LOSS:-}" = "1" ]; then
    echo "[DB] ⚠️  PRISMA_ACCEPT_DATA_LOSS=1 — running db push --accept-data-loss (DESTRUCTIVE)"
    NODE_ENV=production DATABASE_URL="$DATABASE_URL" \
        node ./node_modules/prisma/build/index.js db push --accept-data-loss 2>&1 || true
else
    echo "[DB] Running prisma migrate deploy..."
    if ! NODE_ENV=production DATABASE_URL="$DATABASE_URL" \
        node ./node_modules/prisma/build/index.js migrate deploy 2>&1; then
        echo "[WARN] migrate deploy failed — trying db push (NON-DESTRUCTIVE)..."
        NODE_ENV=production DATABASE_URL="$DATABASE_URL" \
            node ./node_modules/prisma/build/index.js db push 2>&1 || true
    fi
fi
echo "[DB] Schema sync complete"

# ⚠️ DESTRUCTIVE — Only enabled via SIGNAL_RESET=1 env var
# This clears ALL signal records. DO NOT enable in production unless
# the Signal table schema has changed incompatibly.
if [ "${SIGNAL_RESET:-0}" = "1" ]; then
    echo "[DB] ⚠️  SIGNAL_RESET=1 — Clearing ALL Signal records (DESTRUCTIVE)"
    echo "[DB]    If this was not intentional, set SIGNAL_RESET=0 in docker-compose.yaml"
    NODE_ENV=production DATABASE_URL="$DATABASE_URL" \
        node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient({datasourceUrl:process.env.\$DATABASE_URL});p.\$executeRawUnsafe('DELETE FROM \"Signal\"').then(r=>{console.log('[DB] Signal table cleared ('+r+' rows)');process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})" 2>&1 || echo "[DB] Signal cleanup failed (ignored)"
fi

# Import FotMob teams from CSV into TeamMapping (only on first deploy)
# Set IMPORT_FOTMOB_TEAMS=1 to enable. Safe to keep at 0 after initial import.
if [ "${IMPORT_FOTMOB_TEAMS:-0}" = "1" ]; then
    echo "[DB] Importing FotMob teams (one-time initial seed)..."
    NODE_ENV=production DATABASE_URL="$DATABASE_URL" \
        node -e "
(async()=>{
const{PrismaClient}=require('@prisma/client'),fs=require('fs'),p=new PrismaClient({datasourceUrl:process.env.\$DATABASE_URL});
const raw=fs.readFileSync('docs/fotmob_teams.csv','utf-8'),lines=raw.trim().split('\n');

let c=0;
for(let i=1;i<lines.length;i++){
  const m=lines[i].match(/\"(\d+)\",\"([^\"]*)\",\"([^\"]*)\",\"([^\"]*)\",([^,]*),/);
  if(!m)continue;
  const name=m[2],slug=m[3],logoUrl=m[4],country=m[5].replace(/\"/g,'');
  const canonical=name.replace(/[^a-zA-Z0-9\s]/g,'').split(/\s+/).map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join('');
  try{await p.teamMapping.upsert({where:{canonicalName:canonical},create:{canonicalName:canonical,fotmobId:+m[1],fotmobName:name,fotmobSlug:slug,fotmobLogoUrl:logoUrl,country:country||undefined},update:{fotmobId:+m[1],fotmobName:name,fotmobSlug:slug,fotmobLogoUrl:logoUrl,country:country||undefined}});c++}catch(e){}
}
console.log('[DB] '+c+' FotMob teams imported');
await p.\$disconnect();
})()
" 2>&1 || echo "[DB] FotMob import failed (ignored)"
fi

# Start Next.js
echo "[WEB] Starting Next.js on port ${PORT:-3012}..."
NODE_ENV=production DATABASE_URL="$DATABASE_URL" HOSTNAME=0.0.0.0 PORT=${PORT:-3012} bun server.js &
WEB_PID=$!
echo "[OK] Next.js started (PID $WEB_PID)"

# Seed default admin user after Next.js is ready
echo "[AUTH] Seeding default admin user..."
SEED_READY=0
for i in $(seq 1 30); do
    if node -e "fetch('http://localhost:${PORT:-3012}/api/admin/auth?action=seed').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
        echo "[AUTH] Admin seed complete"
        SEED_READY=1
        break
    fi
    sleep 1
done
if [ "$SEED_READY" -ne 1 ]; then
    echo "[AUTH] WARNING: Could not seed admin user after 30s. Continuing..."
fi

# Start Nesine-live relay
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

cleanup() {
    echo "[SHUTDOWN] Stopping..."
    [ -n "$NESINE_PID" ] && kill $NESINE_PID 2>/dev/null || true
    kill $WEB_PID 2>/dev/null || true
    wait 2>/dev/null || true
}
trap cleanup SIGINT SIGTERM

wait -n 2>/dev/null || wait
