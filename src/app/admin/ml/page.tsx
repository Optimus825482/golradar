'use client';

import { useEffect, useState } from 'react';
import { fmtDate, fmtNum } from '@/lib/safeFormat';

function authFetch(path: string, init?: RequestInit) {
  const token = sessionStorage.getItem('admin_token');
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
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

interface ModelWeight {
  name: string;
  version: string | null;
  isChampion: boolean;
  brierScore: number | null;
  weight: number;
  status: 'active' | 'disabled' | 'archived';
  lastUpdated: string | null;
  /** shadow - champion Brier. Negative = shadow wins. Null for
   *  champions (no comparison) or when champion Brier is unknown. */
  deltaBrier: number | null;
}

export default function AdminMLPage() {
  const [artifacts, setArtifacts] = useState<ModelArtifact[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [weights, setWeights] = useState<ModelWeight[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    Promise.all([
      authFetch('/api/admin/ml/artifact').then(r => r.ok ? r.json() : null),
      authFetch('/api/admin/ml/status').then(r => r.ok ? r.json() : null),
      authFetch('/api/admin/ml/weights').then(r => r.ok ? r.json() : null),
    ]).then(([arts, st, w]) => {
      setArtifacts((arts?.artifacts || []).map((a: any) => ({
        ...a,
        metrics: typeof a.metrics === 'string' ? JSON.parse(a.metrics) : (a.metrics || {}),
      })));
      setStatus(st);
      setWeights(w?.weights || []);
      setLoading(false);
    });
  };

  const weightAction = async (name: string, version: string, action: 'archive' | 'disable' | 'promote') => {
    if (typeof window !== 'undefined' && !window.confirm(`${name}@${version} için "${action}" işlemi?`)) return;
    const res = await authFetch('/api/admin/ml/weights', {
      method: 'PUT',
      body: JSON.stringify({ name, version, action }),
    });
    const data = await res.json();
    if (data.ok) load();
    else if (typeof window !== 'undefined') window.alert(data.error || 'İşlem başarısız');
  };

  useEffect(() => {
    load();
    const i = setInterval(load, 30000);
    return () => clearInterval(i);
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
                  <span>Son: <b>{fmtDate(status.scheduler.lastExportAt)}</b></span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Weight Router */}
      {weights.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-5 rounded-full bg-gradient-to-b from-purple-400 to-indigo-500" />
              <h2 className="text-sm font-bold text-gray-800">⚖️ Weight Router (Brier Bazlı)</h2>
            </div>
            <span className="text-[10px] text-gray-400">
              Champion = 1.0 · 0.40+ → disabled · 0.50+ → archived
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th className="text-left py-2 px-2 font-semibold">Model</th>
                  <th className="text-center py-2 px-2 font-semibold">Sürüm</th>
                  <th className="text-center py-2 px-2 font-semibold">Tip</th>
                  <th className="text-right py-2 px-2 font-semibold">Brier</th>
                  <th className="text-right py-2 px-2 font-semibold">Δ vs Champion</th>
                  <th className="text-center py-2 px-2 font-semibold">Ağırlık</th>
                  <th className="text-center py-2 px-2 font-semibold">Durum</th>
                  <th className="text-center py-2 px-2 font-semibold">Aksiyon</th>
                </tr>
              </thead>
              <tbody>
                {weights.map((w) => (
                  <tr key={`${w.name}-${w.version}-${w.isChampion}`} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 px-2 font-bold text-gray-800">{w.name}</td>
                    <td className="py-2 px-2 text-center font-mono text-gray-600">{w.version || '—'}</td>
                    <td className="py-2 px-2 text-center">
                      {w.isChampion ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold">⭐ Champion</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-bold">Shadow</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right font-mono">
                      <span className={
                        w.brierScore == null ? 'text-gray-400' :
                        w.brierScore < 0.2 ? 'text-emerald-600 font-bold' :
                        w.brierScore < 0.3 ? 'text-amber-600' : 'text-red-600 font-bold'
                      }>
                        {w.brierScore?.toFixed(4) ?? '—'}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right text-[10px] font-mono">
                      {w.isChampion ? (
                        <span className="text-gray-400">—</span>
                      ) : w.deltaBrier == null ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <span className={
                          w.deltaBrier < -0.02 ? 'text-emerald-600 font-bold' :
                          w.deltaBrier > 0.02 ? 'text-red-600 font-bold' :
                          'text-amber-600'
                        }>
                          {w.deltaBrier > 0 ? '+' : ''}{w.deltaBrier.toFixed(4)}
                          {w.deltaBrier < -0.02 && ' ↓'}
                          {w.deltaBrier > 0.02 && ' ↑'}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-center">
                      <div className="inline-flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${
                            w.weight >= 0.75 ? 'bg-emerald-500' :
                            w.weight >= 0.5 ? 'bg-amber-500' :
                            w.weight > 0 ? 'bg-red-400' : 'bg-gray-300'
                          }`} style={{ width: `${w.weight * 100}%` }} />
                        </div>
                        <span className={`font-mono font-bold text-[11px] ${
                          w.weight >= 0.75 ? 'text-emerald-700' :
                          w.weight >= 0.5 ? 'text-amber-700' :
                          w.weight > 0 ? 'text-red-700' : 'text-gray-400'
                        }`}>
                          {w.weight.toFixed(2)}
                        </span>
                      </div>
                    </td>
                    <td className="py-2 px-2 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase ${
                        w.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                        w.status === 'disabled' ? 'bg-amber-100 text-amber-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {w.status}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center">
                      {!w.isChampion && w.status !== 'archived' && (
                        <div className="flex gap-1 justify-center">
                          {w.status === 'active' && (
                            <button onClick={() => weightAction(w.name, w.version!, 'promote')}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200 font-bold">
                              Promote
                            </button>
                          )}
                          <button onClick={() => weightAction(w.name, w.version!, 'disable')}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 font-bold">
                            Disable
                          </button>
                          <button onClick={() => weightAction(w.name, w.version!, 'archive')}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 hover:bg-red-200 font-bold">
                            Archive
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                <MetricTile label="Train Rows" value={fmtNum(champion.metrics.trainRows)} color="#f79520" />
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
                        <span className="text-gray-600">{fmtDate(s.createdAt)}</span>
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
