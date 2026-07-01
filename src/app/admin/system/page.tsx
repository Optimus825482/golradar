'use client';

import { useState, useEffect } from 'react';
import { authFetch } from '@/lib/adminAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  RefreshCw,
  Server,
  Radio,
  FileJson,
  Database,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';

function StatusDot({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: ok ? '#16a34a' : '#dc2626' }}>
      <span className="size-2 rounded-full" style={{ background: ok ? '#16a34a' : '#dc2626' }} />
      {label ?? (ok ? 'Aktif' : 'Pasif')}
    </span>
  );
}

function StatBox({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="text-center p-3 rounded-lg bg-gray-50 border border-gray-100">
      <div className="text-[10px] font-semibold text-gray-400 uppercase mb-1">{label}</div>
      <div className="text-lg font-black" style={{ color: color ?? '#6366f1' }}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function SystemStatusPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [writerRes, mlRes, exportRes] = await Promise.all([
        authFetch('/api/cron/poll-matches').catch(() => null),
        authFetch('/api/admin/ml/status').catch(() => null),
        authFetch('/api/admin/ml/export').catch(() => null),
      ]);
      const writer = writerRes?.ok ? await writerRes.json() : null;
      const ml = mlRes?.ok ? await mlRes.json() : null;
      const exportData = exportRes?.ok ? await exportRes.json() : null;
      setData({ writer, ml, exportData });
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { const i = setInterval(load, 15000); return () => clearInterval(i); }, []);

  const { writer, ml, exportData } = data || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">🖥️ Sistem Durumu</h1>
          <p className="text-xs text-gray-500 mt-0.5">Cache, SSE writer, arka plan servisleri</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`size-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Yenile
        </Button>
      </div>

      {loading && !data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      )}

      {/* Writer / Cache */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileJson className="size-4 text-indigo-500" />
            Match Cache Writer
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!writer ? (
            <p className="text-sm text-gray-400">Writer henüz calismadi</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatBox label="Durum" value={writer.inFlight ? 'Çalışıyor' : 'Bekliyor'}
                color={writer.inFlight ? '#d97706' : '#16a34a'} />
              <StatBox label="Cache" value={writer.cacheSize === '≥1' ? 'DOLU' : 'BOŞ'}
                color={writer.cacheSize === '≥1' ? '#16a34a' : '#dc2626'} />
              <StatBox label="Son Başarı" value={writer.lastSuccessAt > 0 ? new Date(writer.lastSuccessAt).toLocaleTimeString() : '—'}
                color={writer.lastSuccessAt > 0 ? '#16a34a' : '#9ca3af'} />
              <StatBox label="Interval" value={`${(writer.intervalMs / 1000).toFixed(0)}sn`} color="#6366f1" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* SSE */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Radio className="size-4 text-emerald-500" />
            SSE Stream
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatBox label="Endpoint" value="/api/matches/stream" color="#6366f1" sub="EventSource" />
            <StatBox label="Heartbeat" value="25sn" color="#16a34a" sub="keep-alive" />
            <StatBox label="Client" value="useMatchStream" color="#7c3aed" sub="EventSource hook" />
          </div>
          <div className="mt-3 p-3 bg-gray-50 rounded-lg text-xs text-gray-600">
            <p className="font-semibold mb-1">📡 SSE Akış Mimarisi:</p>
            <ol className="list-decimal ml-4 space-y-0.5 text-gray-500">
              <li>MLScheduler her 5sn'de writer'i tetikler</li>
              <li>Writer /api/matches'e gider, JSON'u alır, cache'e yazar</li>
              <li>Event bus üzerinden snapshot publish edilir</li>
              <li>1000+ client push ile beslenir (polling yok)</li>
              <li>SSE bağlantısı koparsa polling fallback (5dk aralıkla)</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      {/* Scheduler */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="size-4 text-purple-500" />
            Scheduler
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!ml?.scheduler ? (
            <p className="text-sm text-gray-400">Scheduler bilgisi alinamadi</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatBox label="Durum" value={ml.scheduler.running ? 'Çalışıyor' : 'DURDU'}
                color={ml.scheduler.running ? '#16a34a' : '#dc2626'} />
              <StatBox label="Uptime" value={ml.scheduler.running ? `${Math.floor(ml.scheduler.uptimeMs / 3600000)}s` : '0s'}
                color="#6366f1" />
              <StatBox label="Son Export" value={ml.scheduler.lastExportDate || '—'} color="#7c3aed" />
              <StatBox label="Horizonlar" value={ml.scheduler.horizons?.join('/') || '—'} color="#d97706" sub="dakika" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Trainer Health */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Server className="size-4 text-orange-500" />
            Python Trainer Sidecar
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!ml?.trainer ? (
            <p className="text-sm text-gray-400">Trainer bilgisi yok</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatBox label="Enabled" value={ml.trainer.enabled ? 'Evet' : 'Hayır'}
                  color={ml.trainer.enabled ? '#16a34a' : '#dc2626'} />
                <StatBox label="Health" value={ml.trainer.health?.ok ? 'OK' : 'HATA'}
                  color={ml.trainer.health?.ok ? '#16a34a' : '#dc2626'} />
                <StatBox label="Uptime" value={ml.trainer.health?.uptimeSec ? `${ml.trainer.health.uptimeSec}s` : '—'} color="#6366f1" />
                <StatBox label="Kuyruk" value={String(ml.trainer.health?.queuedJobs ?? '?')} color="#d97706" sub="bekleyen iş" />
              </div>
              <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
                <span className="font-semibold">⚙️ Modeller:</span> xgb, gbdt, lightgbm, inplay, team-strength
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Backfill Status */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Database className="size-4 text-blue-500" />
            Backfill & Veri Tabanı
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Label Backfill</div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-500" />
                <span className="text-sm font-medium text-gray-700">2,039,727 satır etiketlendi</span>
              </div>
              <div className="text-[10px] text-gray-400 mt-1">100,718 pozitif (%4.94) — horizon-aware</div>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Champion Modeller</div>
              <div className="space-y-1">
                {ml?.champions ? Object.entries(ml.champions).map(([name, c]: [string, any]) => (
                  <div key={name} className="flex items-center justify-between text-xs">
                    <span className="font-medium text-gray-700 capitalize">{name}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-gray-500">{c.metrics?.auc != null ? `AUC ${c.metrics.auc.toFixed(3)}` : ''}</span>
                      <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">Champion</Badge>
                    </div>
                  </div>
                )) : <p className="text-xs text-gray-400">Veri yok</p>}
              </div>
            </div>
          </div>
          <div className="text-[10px] text-gray-400 bg-blue-50 p-2 rounded">
            💡 <strong>Not:</strong> Writer, SSE ve scheduler otomatik olarak MLScheduler ile başlar. Ayrıca bir cron job'ı gerekmez.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
