'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/adminAuth';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts';
import { TrendingUp, TrendingDown, Activity, Target, DollarSign, BarChart3, RefreshCw, AlertTriangle } from 'lucide-react';

const fmt = (v: number | null | undefined, d = 2): string => v == null || !Number.isFinite(v) ? '—' : v.toFixed(d);
const fmtPct = (v: number | null | undefined, d = 1): string => v == null ? '—' : `${(v * 100).toFixed(d)}%`;

export default function SuccessDashboard() {
  const [signals, setSignals] = useState<any>(null);
  const [pnl, setPnl] = useState<any>(null);
  const [modelMetrics, setModelMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(14);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      authFetch(`/api/goal-signals?action=stats&days=${days}`).then(r => r.json()).then(d => setSignals(d)).catch(() => {}),
      authFetch(`/api/admin/pnl?days=${days}`).then(r => r.json()).then(d => setPnl(d)).catch(() => {}),
      authFetch('/api/admin/ml/status').then(r => r.json()).then(d => setModelMetrics(d)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [days]);

  const overall = signals?.overall;
  const tiers = signals?.tiers;
  const champ = modelMetrics?.champions;
  const pnlStats = pnl?.stats;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-gray-800">📊 Başarı Gösterge Paneli</h1>
          <p className="text-xs text-gray-500 mt-0.5">Sinyal başarısı · Model durumu · Kâr/ROI · Günlük trend</p>
        </div>
        <div className="flex gap-1">
          {[7, 14, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)} className={`px-3 py-1.5 text-xs font-bold rounded-lg border-2 ${days === d ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'}`}>{d}g</button>
          ))}
        </div>
      </div>

      {loading && <div className="text-center py-10 text-gray-400 text-sm">⏳ Yükleniyor...</div>}
      {!loading && (
        <>
          {/* KPI Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPIBox label="Toplam Sinyal" value={fmt(overall?.totalSignals ?? 0, 0)} sub={signal(overall?.accuracyRate)} color={overall?.accuracyRate > 0.6 ? '#10b981' : '#f59e0b'} />
            <KPIBox label="Doğruluk" value={fmtPct(overall?.accuracyRate)} sub={signal(overall?.accuracyRate) + (overall?.accuracyRate > 0.6 ? ' ✓' : ' ⚠')} color={overall?.accuracyRate > 0.6 ? '#10b981' : '#f59e0b'} />
            <KPIBox label="Brier Score" value={fmt(overall?.brierScore)} sub={overall?.brierScore < 0.18 ? 'İyi ✓' : overall?.brierScore < 0.25 ? 'Orta ⚠' : 'Kötü ✗'} color={overall?.brierScore < 0.18 ? '#10b981' : overall?.brierScore < 0.25 ? '#f59e0b' : '#ef4444'} />
            <KPIBox label="Gol Sinyal Oranı" value={fmtPct(overall?.goalAfterSignalRate)} sub={`${overall?.signalsWithGoal ?? 0}/${overall?.totalSignals ?? 0}`} color="#8b5cf6" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            {champ && ['xgb', 'gbdt', 'inplay'].map(n => {
              const m = champ[n];
              if (!m) return null;
              return (
                <div key={n} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-gray-800">{n.toUpperCase()}</span>
                    <span className="text-[10px] text-gray-400">v{m.version}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[12px]">
                    <div><span className="text-gray-500">AUC</span><div className="font-bold" style={{ color: m.metrics?.auc > 0.8 ? '#10b981' : '#f59e0b' }}>{fmt(m.metrics?.auc, 3)}</div></div>
                    <div><span className="text-gray-500">Brier</span><div className="font-bold" style={{ color: m.metrics?.brier < 0.2 ? '#10b981' : '#ef4444' }}>{fmt(m.metrics?.brier)}</div></div>
                    <div><span className="text-gray-500">Doğru</span><div className="font-bold" style={{ color: m.metrics?.accuracy > 0.75 ? '#10b981' : '#f59e0b' }}>{fmtPct(m.metrics?.accuracy)}</div></div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Signal Tier Breakdown */}
          {tiers && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <h2 className="text-sm font-bold text-gray-800 mb-3">📡 Sinyal Tier Başarısı</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead><tr className="text-gray-500 border-b border-gray-200">
                    <th className="text-left py-2 font-semibold">Tier</th>
                    <th className="text-right py-2 font-semibold">Sinyal</th>
                    <th className="text-right py-2 font-semibold">Gol</th>
                    <th className="text-right py-2 font-semibold">Doğruluk</th>
                    <th className="text-right py-2 font-semibold">Gol/Sinyal</th>
                    <th className="text-right py-2 font-semibold">Ort P</th>
                    <th className="text-right py-2 font-semibold">Gözl. Oran</th>
                    <th className="text-right py-2 font-semibold">Brier</th>
                  </tr></thead>
                  <tbody>
                    {Object.entries(tiers).filter(([k]) => k !== 'unknown' && k !== 'radar').map(([key, t]: any) => {
                      const nonZero = t.total > 0;
                      const acc = nonZero ? t.correct / t.total : 0;
                      const goalRate = nonZero ? t.goals / t.total : 0;
                      const avgP = nonZero ? t.avgPredicted ?? 0 : 0;
                      const obs = nonZero ? t.goals / t.total : 0;
                      return (
                        <tr key={key} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-2 font-bold capitalize">{key === 'critical' ? '🔴' : key === 'high' ? '🟠' : key === 'medium' ? '🟡' : '⚪'} {key}</td>
                          <td className="text-right">{t.total}</td>
                          <td className="text-right">{t.goals}</td>
                          <td className="text-right font-bold" style={{ color: acc > 0.6 ? '#10b981' : '#f59e0b' }}>{fmtPct(acc)}</td>
                          <td className="text-right" style={{ color: goalRate > 0.3 ? '#10b981' : '#6b7280' }}>{fmtPct(goalRate)}</td>
                          <td className="text-right">{fmtPct(avgP)}</td>
                          <td className="text-right" style={{ color: Math.abs(avgP - obs) < 0.1 ? '#10b981' : '#f59e0b' }}>{fmtPct(obs)}</td>
                          <td className="text-right" style={{ color: (t.brier ?? 0.5) < 0.2 ? '#10b981' : '#f59e0b' }}>{fmt(t.brier)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* P&L */}
          {pnlStats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KPIBox label="Toplam Kâr" value={`${pnlStats.totalPnl > 0 ? '+' : ''}${fmt(pnlStats.totalPnl)} birim`} sub={`${pnlStats.totalSignals} sinyalde`} color={pnlStats.totalPnl > 0 ? '#10b981' : '#ef4444'} />
              <KPIBox label="Win Rate" value={fmtPct(pnlStats.winRate)} sub={`${pnlStats.won}/${pnlStats.totalSignals}`} color={pnlStats.winRate > 0.5 ? '#10b981' : '#f59e0b'} />
              <KPIBox label="ROI" value={`${pnlStats.roi >= 0 ? '+' : ''}${fmt(pnlStats.roi)}%`} sub="Yatırılan/Geri Dönen" color={pnlStats.roi > 0 ? '#10b981' : '#ef4444'} />
              <KPIBox label="Sharpe" value={fmt(pnlStats.sharpeRatio)} sub={pnlStats.sharpeRatio > 1 ? '✅ İyi' : '⚠️ Zayıf'} color={pnlStats.sharpeRatio > 1 ? '#10b981' : '#f59e0b'} />
            </div>
          )}

          {/* By day chart */}
          {signals?.dailyMetrics?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <h2 className="text-sm font-bold text-gray-800 mb-3">📈 Günlük Brier & Doğruluk</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={signals.dailyMetrics}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left" domain={[0, 1]} tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="right" domain={[0, 1]} orientation="right" tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line yAxisId="left" type="monotone" dataKey="brier" stroke="#ef4444" strokeWidth={2} dot={false} name="Brier" />
                    <Line yAxisId="right" type="monotone" dataKey="accuracy" stroke="#10b981" strokeWidth={2} dot={false} name="Doğruluk" />
                    <ReferenceLine y={0.18} yAxisId="left" stroke="#10b981" strokeDasharray="4 4" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function KPIBox({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-lg font-black" style={{ color: color ?? '#374151' }}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function signal(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v >= 0.80) return '🟢'; if (v >= 0.60) return '🟡'; return '🔴';
}
