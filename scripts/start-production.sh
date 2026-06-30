#!/bin/bash
# ── Production Start Script ──────────────────────────────────────
# Next.js + Push Server birlikte calistirir.
# Coolify deploy'da bu script CMD olarak kullanilir.
#
# Env vars:
#   PUSH_PORT=3004 (default)
#   PUSH_INTERNAL_URL=http://localhost:3028 (default)
#   NEXT_PUBLIC_PUSH_URL=https://domain.com:3004 (browser'dan WS baglantisi)
#   SOCKET_CORS_ORIGIN=https://domain.com

set -e

echo "[Start] Starting Push Server on port ${PUSH_PORT:-3004}..."
bun src/lib/pushServer.ts &
PUSH_PID=$!

echo "[Start] Starting Next.js on port 3028..."
NODE_ENV=production PORT=3028 bun .next/standalone/server.js &
NEXT_PID=$!

# Trap: her iki process'i de temizle
cleanup() {
  echo "[Start] Shutting down..."
  kill $NEXT_PID 2>/dev/null
  kill $PUSH_PID 2>/dev/null
  wait
}
trap cleanup SIGTERM SIGINT EXIT

# Herhangi biri olurse digerini de oldur
wait -n
kill $NEXT_PID 2>/dev/null
kill $PUSH_PID 2>/dev/null
wait
