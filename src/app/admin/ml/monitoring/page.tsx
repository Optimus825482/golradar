'use client';

import { useEffect, useState } from 'react';

function authFetch(path: string) {
  const token = sessionStorage.getItem('admin_token');
  return fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
  });
}

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
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    authFetch(`/api/admin/ml/monitoring?days=${days}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false); });
  }, [days]);

  if (loading || !data) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const { series, drift, latestShadow } = data;
  const latest = series[series.length - 1];

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
          color={
            drift.direction === 'better' ? '#10b981' :
            drift.direction === 'worse' ? '#ef4444' :
            drift.direction === 'stable' ? '#f59e0b' : '#6b7280'
          }
          sub={
            drift.direction === 'better' ? '↑ İyileşiyor' :
            drift.direction === 'worse' ? '↓ Kötüleşiyor' :
            drift.direction === 'stable' ? '→ Stabil' : 'Veri yok'
          } />
        <KPICard label="Shadow Δ" value={latestShadow?.delta != null ? `${latestShadow.delta > 0 ? '+' : ''}${latestShadow.delta.toFixed(4)}` : '-'}
          color={latestShadow?.delta != null && latestShadow.delta < 0 ? '#10b981' : '#6b7280'}
          sub={latestShadow?.bestModel ? `Best: ${latestShadow.bestModel}` : 'shadow yok'} />
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
          <p className="text-xs text-gray-400 text-center py-6">Henüz ModelMetrics verisi yok. Günlük job çalıştığında dolacak.</p>
        ) : (
          <BrierChart series={series} />
        )}
      </div>

      {/* Detailed Table */}
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
                  <td className="py-2 px-2 text-right font-mono text-gray-500">{s.gbdtBrier?.toFixed(4) ?? '—'}</td>
                  <td className="py-2 px-2 text-right font-mono text-gray-500">{s.xgbBrier?.toFixed(4) ?? '—'}</td>
                  <td className="py-2 px-2 text-right font-mono text-gray-500">{s.inPlayBrier?.toFixed(4) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
