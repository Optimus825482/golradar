#!/bin/sh
set -eu

echo "[ENTRYPOINT] Starting Optimus Gol Radari..."
echo "[ENTRYPOINT] Domain: https://radar.erkanerdem.online"

# ── Database Check ──────────────────────────────────────────────
if [ -z "${DATABASE_URL:-}" ]; then
    echo "[FATAL] DATABASE_URL is not set!"
    echo "[FATAL] PostgreSQL bağlantısı eksik. docker-compose.coolify.yml'yi kontrol edin."
    exit 1
fi

MASKED_URL=$(echo "$DATABASE_URL" | sed 's/:.*@/:***@/g')
echo "[DB] Bağlanıyor: $MASKED_URL"

# Extract host/port from DATABASE_URL
DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:]*\):.*|\1|p')
DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"

# ── Wait for PostgreSQL ──────────────────────────────────────────
echo "[DB] PostgreSQL bekleniyor (${DB_HOST}:${DB_PORT})..."
DB_READY=0
for i in $(seq 1 120); do
    if node -e "require('net').createConnection({host:'${DB_HOST}',port:${DB_PORT}}).on('connect',()=>process.exit(0)).on('error',()=>{})" 2>/dev/null; then
        echo "[DB] ✅ PostgreSQL hazır (${i}s)"
        DB_READY=1
        break
    fi
    if [ $((i % 15)) -eq 0 ]; then
        echo "[DB] Hâlâ bekleniyor... (${i}s)"
    fi
    sleep 1
done

if [ "$DB_READY" -ne 1 ]; then
    echo "[WARN] PostgreSQL 120sn içinde erişilemedi, devam ediliyor..."
fi

# ── Prisma Schema Sync ────────────────────────────────────────────
echo "[DB] Veritabanı şeması senkronize ediliyor..."

PRISMA_BIN="node ./node_modules/prisma/build/index.js"

# migrate deploy dene, olmazsa db push dene (non-destructive)
if ! NODE_ENV=production DATABASE_URL="$DATABASE_URL" \
    $PRISMA_BIN migrate deploy 2>&1; then
    echo "[DB] migrate deploy başarısız → db push deneniyor..."
    NODE_ENV=production DATABASE_URL="$DATABASE_URL" \
        $PRISMA_BIN db push 2>&1 || echo "[WARN] db push de başarısız, elle müdahale gerekebilir"
    # db push başarılı olduysa failed migration'ı resolve et (P3009 hatasını önle)
    echo "[DB] db push tamam, failed migration'lar resolve ediliyor..."
    $PRISMA_BIN migrate resolve --applied 20260624_174500_backfill_predictions 2>/dev/null || true
fi
echo "[DB] ✅ Şema senkronizasyonu tamam"

# ── Destructive Ops ──────────────────────────────────────────────
if [ "${SIGNAL_RESET:-0}" = "1" ]; then
    echo "[DB] ⚠️  Tüm Signal kayıtları temizleniyor"
    NODE_ENV=production DATABASE_URL="$DATABASE_URL" \
        node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient({datasourceUrl:process.env.DATABASE_URL});p.\$executeRawUnsafe('DELETE FROM \"Signal\"').then(r=>{console.log('[DB] Signal tablosu temizlendi ('+r+' satır)');process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})" 2>&1 || true
fi

# ── FotMob Team Import (İLK KURULUM) ─────────────────────────────
if [ "${IMPORT_FOTMOB_TEAMS:-0}" = "1" ] && [ -f "docs/fotmob_teams.csv" ]; then
    echo "[DB] FotMob takım verileri içe aktarılıyor..."
    NODE_ENV=production DATABASE_URL="$DATABASE_URL" \
        node -e "
(async()=>{
const{PrismaClient}=require('@prisma/client'),fs=require('fs'),p=new PrismaClient({datasourceUrl:process.env.DATABASE_URL});
const raw=fs.readFileSync('docs/fotmob_teams.csv','utf-8'),lines=raw.trim().split('\n');
let c=0;
for(let i=1;i<lines.length;i++){
  const m=lines[i].match(/\"(\d+)\",\"([^\"]*)\",\"([^\"]*)\",\"([^\"]*)\",([^,]*),/);
  if(!m)continue;
  const name=m[2],slug=m[3],logoUrl=m[4],country=m[5].replace(/\"/g,'');
  const canonical=name.replace(/[^a-zA-Z0-9\s]/g,'').split(/\s+/).map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join('');
  try{await p.teamMapping.upsert({where:{canonicalName:canonical},create:{canonicalName:canonical,fotmobId:+m[1],fotmobName:name,fotmobSlug:slug,fotmobLogoUrl:logoUrl,country:country||undefined},update:{fotmobId:+m[1],fotmobName:name,fotmobSlug:slug,fotmobLogoUrl:logoUrl,country:country||undefined}});c++}catch(e){}
}
console.log('[DB] '+c+' FotMob takım içe aktarıldı');
await p.\$disconnect();
})()
" 2>&1 || echo "[WARN] FotMob import başarısız"
fi

# ── Admin Seed (init.ts ile zaten yapılır, bu ek güvence) ────────
echo "[AUTH] Admin kullanıcısı kontrol ediliyor..."
NODE_ENV=production DATABASE_URL="$DATABASE_URL" \
    node -e "
(async()=>{
const{PrismaClient}=require('@prisma/client'),crypto=require('crypto');
const p=new PrismaClient({datasourceUrl:process.env.DATABASE_URL});
const existing=await p.user.findUnique({where:{username:'admin'}});
if(!existing){
  const salt=crypto.randomBytes(32).toString('hex');
  const hash=crypto.pbkdf2Sync('admin123',salt,100000,64,'sha256').toString('hex');
  await p.user.create({data:{username:'admin',passwordHash:hash,passwordSalt:salt,mustChangePassword:true}});
  console.log('[AUTH] ✅ Admin kullanıcısı oluşturuldu (admin / admin123)');
}else{
  console.log('[AUTH] ✅ Admin kullanıcısı zaten var');
}
await p.\$disconnect();
})()
" 2>&1 || echo "[WARN] Admin seed başarısız"

# ── Start Next.js ────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════"
echo "  OPTIMUS GOL RADARI"
echo "  Domain: https://radar.erkanerdem.online"
echo "  Admin:  /admin"
echo "  Login:  admin / admin123"
echo "═══════════════════════════════════════════════"
echo ""

exec node server.js


# Ensure legacy artifact paths resolve
mkdir -p /app/web/data
ln -sfn /app/data/ml-models /app/web/data/ml-models 2>/dev/null || true
for model in xgb gbdt inplay; do
  latest=$(ls /app/data/ml-models/${model}-v*.json 2>/dev/null | grep -v ready | sort -V | tail -1)
  if [ -n "$latest" ] && [ ! -f "/app/data/ml-models/${model}-v1.0.1.json" ]; then
    cp -f "$latest" "/app/data/ml-models/${model}-v1.0.1.json"
    [ -f "${latest%.json}.ready" ] && cp -f "${latest%.json}.ready" "/app/data/ml-models/${model}-v1.0.1.ready"
  fi
done
