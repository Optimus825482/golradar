#!/bin/bash
# === OptimusVet Veri Kurtarma Scripti ===
# Sunucuda calistir: bash /root/optimusvet-kurtarma.sh
# Ciktiyi paylas, analiz edeyim.

echo "=========================================="
echo "  OPTIMUSVET VERI KURTARMA RAPORU"
echo "  Tarih: $(date)"
echo "=========================================="

echo ""
echo "=== 1. TUM VOLUMELER (tarih + boyut) ==="
docker volume ls --format '{{.Name}}' | while read vol; do
  created=$(docker volume inspect "$vol" --format '{{.CreatedAt}}' 2>/dev/null)
  size=$(du -sh /var/lib/docker/volumes/"$vol"/_data 2>/dev/null | cut -f1)
  echo "$created | $(printf '%10s' "$size") | $vol"
done | sort -r

echo ""
echo "=== 2. POSTGRES VOLUME ICERIKLERI ==="
for vol in $(docker volume ls -q --filter "name=postgres" --filter "name=data"); do
  echo "--- Volume: $vol ---"
  ls -laR /var/lib/docker/volumes/"$vol"/_data/ 2>/dev/null | head -30
  echo ""
done

echo ""
echo "=== 3. ESKI POSTGRES CONTAINER KALINTILARI ==="
find /var/lib/docker/containers/ -name "config.v2.json" -mtime -31 -exec sh -c '
  id=$(basename $(dirname $(dirname {})))
  name=$(docker ps -a --filter "id=$id" --format "{{.Names}}" 2>/dev/null)
  if [ -z "$name" ]; then
    echo "Orphan container: $id"
    grep -o "optimusvet\|OPTIMUSVET\|optimus" {} 2>/dev/null && echo "  ^^^ OPTIMUSVET FOUND ^^^"
  fi
' \; 2>/dev/null

echo ""
echo "=== 4. DISK UZERINDE POSTGRES DATA DIZINLERI ==="
find /var/lib/docker/overlay2/ -path "*/diff/var/lib/postgresql/data/base" -type d 2>/dev/null | while read d; do
  parent=$(echo "$d" | rev | cut -d'/' -f5- | rev)
  echo "--- $d ---"
  ls "$d" 2>/dev/null
  # Check if optimusvet data exists
  find "$parent" -name "optimusvet" -type d 2>/dev/null | head -5
  echo ""
done

echo ""
echo "=== 5. ESKI POSTGRES IMAGE LAYER'LARI ==="
docker image ls --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedAt}}' | grep postgres

echo ""
echo "=== 6. COOLIFY APPLICATION KONFIGURASYONU ==="
echo "--- $HOME/applications/trrd41gm2s96tyz1cgwda32k ---"
ls -la /data/coolify/applications/trrd41gm2s96tyz1cgwda32k/ 2>/dev/null

echo ""
echo "=== 7. COOLIFY DEPLOYMENT LOGLARI (son 20) ==="
docker exec coolify-db psql -U coolify -d coolify -c "SELECT id, status, created_at FROM application_deployment_queues WHERE application_uuid = 'trrd41gm2s96tyz1cgwda32k' ORDER BY created_at DESC LIMIT 20;" 2>/dev/null

echo ""
echo "=== 8. OPTIMUSVET APP DOCKER LOGLARI ==="
docker logs $(docker ps -q --filter "name=app-trrd41") --tail 20 2>&1 | grep -i "database\|error\|table\|migration\|prisma"

echo ""
echo "=== 9. TUM DURDURULMUS CONTAINER'LAR ==="
docker ps -a --format '{{.Names}}\t{{.Status}}\t{{.CreatedAt}}' | grep -v "Up " | head -20

echo ""
echo "=== 10. SISTEM DOSYA SISTEMI KONTROL ==="
df -h /
echo ""
du -sh /var/lib/docker/ 2>/dev/null

echo ""
echo "=========================================="
echo "  RAPOR TAMAMLANDI"
echo "=========================================="
