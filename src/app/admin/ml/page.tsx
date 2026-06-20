'use client';

import { useEffect, useState } from 'react';

function authFetch(path: string) {
  const token = sessionStorage.getItem('admin_token');
  return fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
  });
}

interface ModelArtifact {
  id: string;
  name: string;
  version: string;
  isChampion: boolean;
  createdAt: string;
  metrics: Record<string, number>;
  artifactPath: string;
  sha256: string;
  bytes: number | null;
}

const MODEL_NAMES: Record<string, { label: string; color: string; description: string }> = {
  gbdt: { label: 'GBDT (Champion)', color: '#3cb15c', description: 'Gradient Boosted Decision Trees — ana üretim modeli' },
  xgb: { label: 'XGBoost', color: '#5794f2', description: 'Aşırı gradyan artırma — yüksek doğruluk potansiyeli' },
  inplay: { label: 'InPlay 5dk', color: '#9178d9', description: 'Canlı maç 5-dakikalık gol olasılığı modeli' },
  'team-strength': { label: 'Takım Gücü', color: '#f79520', description: 'Kalman filter takım güç tahmini' },
  'xt-grid': { label: 'xT Grid', color: '#56a6d9', description: 'Expected Threat — pozisyon bazlı tehlike' },
};

export default function AdminMLPage() {
  const [artifacts, setArtifacts] = useState<ModelArtifact[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      authFetch('/api/admin/ml/artifact').then(r => r.ok ? r.json() : null),
      authFetch('/api/admin/ml/status').then(r => r.ok ? r.json() : null),
    ]).then(([arts, st]) => {
      setArtifacts((arts?.artifacts || []).map((a: any) => ({
        ...a,
        metrics: typeof a.metrics === 'string' ? JSON.parse(a.metrics) : (a.metrics || {}),
      })));
      setStatus(st);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" /></div>;

  // Group by name
  const byName: Record<string, ModelArtifact[]> = {};
  for (const a of artifacts) {
    if (!byName[a.name]) byName[a.name] = [];
    byName[a.name].push(a);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-gray-800">🤖 ML & Modeller</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Champion / Shadow artifactlar, eğitim metrikleri ve pipeline durumu
        </p>
      </div>

      {/* Trainer status */}
      {status?.trainer && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <span className={`w-3 h-3 rounded-full ${status.trainer.health?.ok ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              <div>
                <div className="text-sm font-bold text-gray-800">Trainer Sidecar</div>
                <div className="text-[11px] text-gray-500">
                  {status.trainer.health?.ok ? 'Çalışıyor' : 'Çalışmıyor'}
                  {status.trainer.health?.latencyMs ? ` · ${status.trainer.health.latencyMs}ms` : ''}
                </div>
              </div>
            </div>
            {status.scheduler && (
              <div className="flex flex-wrap gap-3 text-[11px] text-gray-600">
                <span>Export: <b>{status.scheduler.exportRunning ? 'Aktif' : 'Pasif'}</b></span>
                <span>InPlay: <b>{status.scheduler.inplayRunning ? 'Aktif' : 'Pasif'}</b></span>
                {status.scheduler.lastExportAt && (
                  <span>Son: <b>{new Date(status.scheduler.lastExportAt).toLocaleString('tr-TR')}</b></span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Model sections */}
      {Object.keys(MODEL_NAMES).map(name => {
        const meta = MODEL_NAMES[name];
        const versions = byName[name] || [];
        const champion = versions.find(v => v.isChampion);
        const shadows = versions.filter(v => !v.isChampion);

        return (
          <div key={name} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
              <div className="w-1.5 h-7 rounded-full" style={{ background: meta.color }} />
              <div className="flex-1">
                <div className="text-sm font-bold text-gray-800">{meta.label}</div>
                <div className="text-[11px] text-gray-500">{meta.description}</div>
              </div>
              {champion ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold border border-emerald-200">
                  ✓ CHAMPION
                </span>
              ) : (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-bold border border-gray-200">
                  No champion
                </span>
              )}
            </div>

            {champion && (
              <div className="p-4 grid grid-cols-2 md:grid-cols-5 gap-3 bg-gradient-to-br from-emerald-50/40 to-white">
                <MetricTile label="Sürüm" value={`v${champion.version}`} color={meta.color} />
                <MetricTile label="Brier" value={(champion.metrics.brier ?? 0).toFixed(4)} color={champion.metrics.brier && champion.metrics.brier < 0.2 ? '#10b981' : '#f59e0b'} />
                <MetricTile label="LogLoss" value={(champion.metrics.logLoss ?? champion.metrics.log_loss ?? 0).toFixed(4)} color="#5794f2" />
                <MetricTile label="Accuracy" value={`${((champion.metrics.accuracy ?? 0) * 100).toFixed(1)}%`} color="#9178d9" />
                <MetricTile label="Train Rows" value={(champion.metrics.trainRows ?? 0).toLocaleString()} color="#f79520" />
              </div>
            )}

            {shadows.length > 0 && (
              <div className="px-4 py-3 border-t border-gray-100">
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Shadow Modelleri ({shadows.length})
                </div>
                <div className="space-y-1.5">
                  {shadows.slice(0, 5).map(s => (
                    <div key={s.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-[11px]">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-gray-500">v{s.version}</span>
                        <span className="text-gray-400">·</span>
                        <span className="text-gray-600">{new Date(s.createdAt).toLocaleDateString('tr-TR')}</span>
                      </div>
                      <div className="flex items-center gap-3 font-mono">
                        <span>Brier <b className="text-gray-700">{(s.metrics.brier ?? 0).toFixed(4)}</b></span>
                        <span>Acc <b className="text-gray-700">{((s.metrics.accuracy ?? 0) * 100).toFixed(1)}%</b></span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {versions.length === 0 && (
              <div className="p-4 text-center text-[11px] text-gray-400">
                Bu model için henüz artifact yok. Eğitim pipeline'ı çalıştırın.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MetricTile({ label, value, color = '#5794f2' }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="text-center">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-lg font-black" style={{ color }}>{value}</div>
    </div>
  );
}
