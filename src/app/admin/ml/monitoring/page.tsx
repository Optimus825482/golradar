'use client';

import { useEffect, useState, useCallback } from 'react';
import { authFetch } from '@/lib/adminAuth';

interface MetricsPoint {
  date: string;
  brierScore: number;
  logLoss: number;
  accuracy: number;
  calibrationError: number;
  totalPredictions: number;
  totalGoals: number;
  avgCalibratedP: number;
  shadowBrierDelta: number | null;
  gbdtBrier: number | null;
  xgbBrier: number | null;
  inPlayBrier: number | null;
}

interface ModelWeight {
  name: string;
  version: string | null;
  isChampion: boolean;
  brierScore: number | null;
  weight: number;
  deltaBrier: number | null;
}

interface MonitoringData {
  series: MetricsPoint[];
  drift: {
    recentAvgBrier: number | null;
    priorAvgBrier: number | null;
    driftPct: number | null;
    direction: 'worse' | 'better' | 'stable' | null;
  };
  latestShadow: {
    date: string;
    delta: number | null;
    bestModel: 'gbdt' | 'xgb' | 'inplay' | null;
    gbdt: number | null;
    xgb: number | null;
    inPlay: number | null;
  } | null;
  totalDays: number;
}

export default function AdminMLMonitoringPage() {
  const [data, setData] = useState<MonitoringData | null>(null);
  const [weights, setWeights] = useState<ModelWeight[]>([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [monRes, wRes] = await Promise.all([
      authFetch(`/api/admin/ml/monitoring?days=${days}`),
      authFetch('/api/admin/ml/weights'),
    ]);
    if (monRes.ok) setData(await monRes.json());
    if (wRes.ok) {
      const wd = await wRes.json();
      if (wd?.weights) setWeights(wd.weights);
    }
    setLoading(false);
  }, [days]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 60s
  useEffect(() => {
    const i = setInterval(load, 60000);
    return () => clearInterval(i);
  }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex justify-center py-20">
        <p className="text-xs text-gray-400">Henüz monitoring verisi yok. Günlük job çalıştığında dolacak.</p>
      </div>
    );
  }

  const { series, drift, latestShadow } = data;
  const latest = series[series.length - 1];

  // Build weight map by model name from the weights API
  const weightMap = new Map<string, { weight: number; brier: number | null; isChampion: boolean }>();
  for (const w of weights) {
    if (w.isChampion || !weightMap.has(w.name)) {
      weightMap.set(w.name, { weight: w.weight, brier: w.brierScore, isChampion: w.isChampion });
    }
  }

  const modelBriers: Array<{ key: string; label: string; icon: string; brier: number | null; desc: string; champion: boolean }> = [
    { key: 'ruleBased', label: 'Kural Bazlı', icon: '🧠', brier: null, desc: '12 faktör heuristic', champion: true },
    { key: 'poisson', label: 'Poisson', icon: '📊', brier: null, desc: 'Dixon-Coles', champion: true },
    { key: 'elo', label: 'Elo', icon: '⚖️', brier: null, desc: 'Elo rating', champion: true },
    { key: 'gbdt', label: 'GBDT', icon: '🌳', brier: latest?.gbdtBrier ?? null, desc: 'Gradient Boosted', champion: !!weights.find(w => w.name === 'gbdt' && w.isChampion) },
    { key: 'xgb', label: 'XGBoost', icon: '⚡', brier: latest?.xgbBrier ?? null, desc: 'Champion XGB', champion: !!weights.find(w => w.name === 'xgb' && w.isChampion) },
    { key: 'inplay', label: 'InPlay5m', icon: '⚽', brier: latest?.inPlayBrier ?? null, desc: '5-dk horizon', champion: !!weights.find(w => w.name === 'inplay' && w.isChampion) },
  ];

  const weightOrder = ['ruleBased', 'poisson', 'elo', 'ml', 'teamStrength', 'inplay'];
  const weightLabels: Record<string, string> = {
    ruleBased: 'Kural', poisson: 'Poisson', elo: 'Elo',
    ml: 'ML', teamStrength: 'Takım', inplay: 'InPlay',
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black text-gray-800">📈 Model Başarı Monitoring</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Günlük Brier score trendi, drift detection ve shadow model takibi
          </p>
        </div>
        <div className="flex gap-1 bg-gray-100 p-0.5 rounded-lg">
          {[7, 30, 90, 180].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`text-[11px] px-3 py-1.5 rounded-md font-semibold transition-all ${
                days === d ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {d}g
            </button>
          ))}
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Bugün Brier" value={latest?.brierScore?.toFixed(4) ?? '-'}
          color={(latest?.brierScore ?? 1) < 0.2 ? '#10b981' : (latest?.brierScore ?? 1) < 0.3 ? '#f59e0b' : '#ef4444'}
          sub={latest ? latest.date : 'veri yok'} />
        <KPICard label="7g Ortalama" value={drift.recentAvgBrier?.toFixed(4) ?? '-'}
          color={(drift.recentAvgBrier ?? 1) < 0.2 ? '#10b981' : '#f59e0b'} sub="Brier" />
        <KPICard label="Drift" value={drift.driftPct != null ? `${drift.driftPct > 0 ? '+' : ''}${drift.driftPct.toFixed(2)}%` : '-'}
          color={drift.direction === 'better' ? '#10b981' : drift.direction === 'worse' ? '#ef4444' : drift.direction === 'stable' ? '#f59e0b' : '#6b7280'}
          sub={drift.direction === 'better' ? '↑ İyileşiyor' : drift.direction === 'worse' ? '↓ Kötüleşiyor' : drift.direction === 'stable' ? '→ Stabil' : 'Veri yok'} />
        <KPICard label="Champion" value={weights.find(w => w.isChampion)?.name ?? '—'}
          color="#8b5cf6" sub={latestShadow?.bestModel ? `Best shadow: ${latestShadow.bestModel}` : 'Henüz shadow yok'} />
      </div>

      {/* 6-Model Brier + Weight Cards */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
        {modelBriers.map(m => {
          const w = weightMap.get(m.key === 'ruleBased' ? 'ruleBased' : m.key);
          return (
            <div key={m.key} className={`rounded-lg border-2 p-2 text-center ${
              m.champion ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-100 bg-white'
            }`}>
              <div className="text-lg mb-0.5">{m.icon}</div>
              <div className="text-[10px] font-bold text-gray-800">{m.label}</div>
              {m.champion && <span className="text-[8px] px-1 rounded bg-emerald-100 text-emerald-700 font-bold">⭐CHAMPION</span>}
              <div className={`text-xs font-black mt-0.5 ${m.brier != null ? 'text-gray-900' : 'text-gray-400'}`}>
                {m.brier != null ? m.brier.toFixed(4) : '—'}
              </div>
              {w && (
                <div className="text-[9px] text-gray-500 mt-0.5">
                  {/* FIX: Tier weight'ı ensemble weight gibi gösterme.
                      Tier weight (0-1) model kalibrasyon güveni.
                      Gerçek ensemble weight computeEnsembleWeights ile normalize edilir. */}
                  tier: {(w.weight * 100).toFixed(0)}%
                  {w.brier != null && <span className="ml-1 text-gray-400">B:{w.brier.toFixed(3)}</span>}
                </div>
              )}
              <div className="text-[8px] text-gray-400 mt-0.5">{m.desc}</div>
            </div>
          );
        })}
      </div>

      {/* New Features Status */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <h2 className="text-sm font-bold text-gray-800 mb-2">🚀 Yeni Özellikler Durumu</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
          <div className="border border-gray-100 rounded-lg p-2">
            <div className="text-green-600 font-bold">✅ Beta Calibration</div>
            <div className="text-gray-500">Kalibrasyon sırası: Beta → Isotonic → Sigmoid+T</div>
          </div>
          <div className="border border-gray-100 rounded-lg p-2">
            <div className="text-green-600 font-bold">✅ Temperature Scaling</div>
            <div className="text-gray-500">T=1.0 (nötr). Kalibrasyonla ayarlanabilir.</div>
          </div>
          <div className="border border-gray-100 rounded-lg p-2">
            <div className="text-green-600 font-bold">✅ Per-Model Calibration</div>
            <div className="text-gray-500">calibrateModelOutput() — her model ayrı kalibre</div>
          </div>
          <div className="border border-gray-100 rounded-lg p-2">
            <div className="text-green-600 font-bold">✅ Bayesian Model Avg</div>
            <div className="text-gray-500">Brier-based posterior weights (σ=0.25)</div>
          </div>
          <div className="border border-gray-100 rounded-lg p-2">
            <div className="text-green-600 font-bold">✅ Trend LSTM</div>
            <div className="text-gray-500">Sliding window pressure + trend detection</div>
          </div>
          <div className="border border-gray-100 rounded-lg p-2">
            <div className="text-green-600 font-bold">✅ Online Weight Update</div>
            <div className="text-gray-500">Son 500 sinyal accuracy-based weight ayarı</div>
          </div>
          <div className="border border-gray-100 rounded-lg p-2">
            <div className="text-green-600 font-bold">✅ Stacking Meta-Model</div>
            <div className="text-gray-500">Logistic regression meta-model (ensemble alternatifi)</div>
          </div>
          <div className="border border-gray-100 rounded-lg p-2">
            <div className="text-green-600 font-bold">✅ ClubElo API</div>
            <div className="text-gray-500">clubelo.com bağımsız takım ratingi</div>
          </div>
        </div>
      </div>

      {/* Live Ensemble Weights from API */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1.5 h-5 rounded-full bg-gradient-to-b from-amber-400 to-orange-500" />
          <h3 className="text-sm font-bold text-gray-800">⚖️ Canlı Ensemble Weight Dağılımı</h3>
          <span className="text-[10px] text-gray-400 ml-auto">Brier-tier bazlı dinamik ağırlık</span>
        </div>
        {weights.length === 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-center">
            {weightOrder.map(name => (
              <div key={name} className="p-2 rounded-lg bg-gray-50 border border-gray-100">
                <div className="text-[9px] font-semibold text-gray-500 uppercase">{weightLabels[name] ?? name}</div>
                <div className="text-lg font-black text-indigo-600">—</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {weights.map(w => {
              const tierLabel = w.brierScore == null ? 'sırasız' :
                w.brierScore < 0.18 ? 'mükemmel' :
                w.brierScore < 0.25 ? 'iyi' :
                w.brierScore < 0.32 ? 'orta' :
                w.brierScore < 0.40 ? 'zayıf' : 'devre dışı';
              const tierColor = w.brierScore == null ? '#6b7280' :
                w.brierScore < 0.18 ? '#10b981' :
                w.brierScore < 0.25 ? '#22c55e' :
                w.brierScore < 0.32 ? '#f59e0b' :
                w.brierScore < 0.40 ? '#f97316' : '#ef4444';
              return (
                <div key={`${w.name}-${w.version}`} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2 text-[11px]">
                  <div className="w-16 font-bold text-gray-700">{w.name}</div>
                  {w.isChampion && <span className="text-[9px] px-1 rounded bg-emerald-100 text-emerald-700 font-bold">⭐CHAMPION</span>}
                  <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                    {/* FIX: Tier güveni göster (0-1), ensemble ağırlığı değil.
                        Gerçek ensemble weight normalize edilir (sum=1.0) ve
                        computeEnsembleWeights ile hesaplanır. */}
                    <div className="h-full rounded-full transition-all" style={{ width: `${w.weight * 100}%`, background: tierColor }} />
                  </div>
                  <span className="w-10 text-right font-mono font-bold text-gray-700">{(w.weight * 100).toFixed(0)}%</span>
                  <span className="w-24 text-right font-mono text-gray-600">{w.brierScore?.toFixed(4) ?? '—'}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: tierColor + '20', color: tierColor }}>
                    {tierLabel}
                  </span>
                  <span className="text-gray-400 font-mono">v{w.version ?? '—'}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Brier Score Trend Chart */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-5 rounded-full bg-gradient-to-b from-emerald-400 to-green-500" />
            <h3 className="text-sm font-bold text-gray-800">Brier Score Trendi (Günlük)</h3>
          </div>
          <div className="text-[10px] text-gray-500">{data.totalDays} gün veri</div>
        </div>
        {series.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6">Henüz ModelMetrics verisi yok.</p>
        ) : (
          <BrierChart series={series} />
        )}
      </div>

      {/* Daily Detail Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <h3 className="text-sm font-bold text-gray-800 mb-3">📋 Günlük Detay Tablosu</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="text-left py-2 px-2 font-semibold">Tarih</th>
                <th className="text-right py-2 px-2 font-semibold">Brier</th>
                <th className="text-right py-2 px-2 font-semibold">LogLoss</th>
                <th className="text-right py-2 px-2 font-semibold">Accuracy</th>
                <th className="text-right py-2 px-2 font-semibold">Kal. Hata</th>
                <th className="text-right py-2 px-2 font-semibold">Tahmin</th>
                <th className="text-right py-2 px-2 font-semibold">GBDT</th>
                <th className="text-right py-2 px-2 font-semibold">XGB</th>
                <th className="text-right py-2 px-2 font-semibold">InPlay</th>
              </tr>
            </thead>
            <tbody>
              {[...series].reverse().slice(0, 30).map((s) => (
                <tr key={s.date} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 px-2 font-mono text-gray-700">{s.date}</td>
                  <td className="py-2 px-2 text-right font-mono">
                    <span className={s.brierScore < 0.2 ? 'text-emerald-600 font-bold' : s.brierScore < 0.3 ? 'text-amber-600' : 'text-red-600'}>
                      {s.brierScore.toFixed(4)}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-gray-600">{s.logLoss.toFixed(4)}</td>
                  <td className="py-2 px-2 text-right font-mono text-gray-700">{(s.accuracy * 100).toFixed(1)}%</td>
                  <td className="py-2 px-2 text-right font-mono text-gray-600">{s.calibrationError.toFixed(3)}</td>
                  <td className="py-2 px-2 text-right font-mono text-gray-500">{s.totalPredictions}</td>
                  <td className="py-2 px-2 text-right font-mono">
                    <span className={s.gbdtBrier != null ? (s.gbdtBrier < 0.2 ? 'text-emerald-600' : 'text-amber-600') : 'text-gray-400'}>
                      {s.gbdtBrier?.toFixed(4) ?? '—'}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-gray-400">{s.xgbBrier?.toFixed(4) ?? '—'}</td>
                  <td className="py-2 px-2 text-right font-mono text-gray-400">{s.inPlayBrier?.toFixed(4) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[10px] text-gray-400 mt-2 text-center">
          XGBoost ve InPlay modelleri henüz champion promote edilmediği için Brier verisi yok.
          Admin → ML & Modeller sayfasından eğitim çalıştırıp promote edebilirsiniz.
        </div>
      </div>
    </div>
  );
}

function KPICard({ label, value, color, sub }: { label: string; value: string; color: string; sub: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-2xl font-black" style={{ color }}>{value}</div>
      <div className="text-[10px] text-gray-400 mt-1">{sub}</div>
    </div>
  );
}

function BrierChart({ series }: { series: MetricsPoint[] }) {
  const W = 800, H = 220, padL = 40, padR = 16, padT = 16, padB = 32;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const brierValues = series.map(s => s.brierScore);
  const minVal = Math.min(...brierValues, 0);
  const maxVal = Math.max(...brierValues, 0.5);
  const range = maxVal - minVal || 0.1;

  const xFor = (i: number) => padL + (i / Math.max(1, series.length - 1)) * innerW;
  const yFor = (v: number) => padT + (1 - (v - minVal) / range) * innerH;

  const path = series.map((s, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(s.brierScore)}`).join(' ');
  const areaPath = `${path} L ${xFor(series.length - 1)} ${yFor(minVal)} L ${xFor(0)} ${yFor(minVal)} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {[0, 0.25, 0.5, 0.75, 1].map(p => {
        const v = minVal + range * p;
        return (
          <g key={p}>
            <line x1={padL} x2={W - padR} y1={yFor(v)} y2={yFor(v)} stroke="#f1f5f9" strokeWidth={1} />
            <text x={padL - 6} y={yFor(v) + 3} fontSize={9} fill="#94a3b8" textAnchor="end">{v.toFixed(3)}</text>
          </g>
        );
      })}
      <path d={areaPath} fill="url(#brierGradient)" opacity={0.3} />
      <path d={path} fill="none" stroke="#10b981" strokeWidth={2} />
      {series.map((s, i) => (
        <circle key={s.date} cx={xFor(i)} cy={yFor(s.brierScore)} r={2.5} fill="#10b981" />
      ))}
      <defs>
        <linearGradient id="brierGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity={0.5} />
          <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
        </linearGradient>
      </defs>
      <line x1={padL} x2={W - padR} y1={yFor(0.2)} y2={yFor(0.2)} stroke="#10b981" strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />
      <text x={W - padR - 4} y={yFor(0.2) - 4} fontSize={8} fill="#10b981" textAnchor="end" fontWeight="bold">hedef 0.20</text>
    </svg>
  );
}
