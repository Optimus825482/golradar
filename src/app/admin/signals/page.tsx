'use client';

import { useEffect, useState, useCallback } from 'react';

function authFetch(path: string) {
  const token = sessionStorage.getItem('admin_token');
  return fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
  });
}

interface SignalStats {
  totalSignals: number;
  signalsWithGoal: number;
  signalsWithoutGoal: number;
  signalsPending: number;
  correctPredictions: number;
  incorrectPredictions: number;
  accuracyRate: number;
  goalAfterSignalRate: number;
  brierScore: number;
  buckets: Array<{
    range: string; min: number; max: number; total: number; goals: number; correct: number; goalRate: number; accuracy: number;
  }>;
  levelDistribution: Record<string, { total: number; goals: number; correct: number }>;
}

export default function AdminSignalsPage() {
  const [stats, setStats] = useState<SignalStats | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await authFetch(`/api/goal-signals?action=stats&days=${days}`);
      if (resp.ok) {
        const data = await resp.json();
        setStats(data);
      }
    } catch (e) { /* silent */ }
    setLoading(false);
  }, [days]);

  useEffect(() => { load(); }, [load]);

  if (loading || !stats) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const total = stats.totalSignals;
  const buckets = stats.buckets?.filter(b => b.total > 0) || [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black text-gray-800">📡 Sinyal Kayıtları</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Tüm gol sinyalleri — level, taraf, dakika, sonuç bazlı analiz
          </p>
        </div>
        <div className="flex gap-1 bg-gray-100 p-0.5 rounded-lg">
          {[7, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`text-[11px] px-3 py-1.5 rounded-md font-semibold transition-all ${
                days === d ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {d === 7 ? '7g' : d === 30 ? '30g' : '90g'}
            </button>
          ))}
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPICard label="Toplam" value={total.toString()} color="#6366f1" sub="sinyal" />
        <KPICard label="Başarılı" value={stats.correctPredictions.toString()} color="#10b981"
          sub={`${(stats.accuracyRate * 100).toFixed(1)}%`} />
        <KPICard label="Gol" value={stats.signalsWithGoal.toString()} color="#f79520"
          sub={`${(stats.goalAfterSignalRate * 100).toFixed(1)}%`} />
        <KPICard label="Başarısız" value={stats.signalsWithoutGoal.toString()} color="#ef4444"
          sub="gol yok" />
        <KPICard label="Bekleyen" value={stats.signalsPending.toString()} color="#8b5cf6"
          sub="henüz maç bitmedi" />
      </div>

      {/* Level Distribution */}
      {Object.keys(stats.levelDistribution || {}).length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-5 rounded-full bg-gradient-to-b from-orange-400 to-red-500" />
            <h3 className="text-sm font-bold text-gray-800">Sinyal Seviye Dağılımı</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(stats.levelDistribution).map(([level, d]) => {
              type LevelStyle = { bg: string; text: string; border: string; bar: string };
              const colors: Record<string, LevelStyle> = {
                low: { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-300', bar: '#8e8e8e' },
                medium: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-300', bar: '#f79520' },
                high: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-300', bar: '#f79520' },
                critical: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-300', bar: '#ef4444' },
              };
              const c: LevelStyle = colors[level] ?? colors.low;
              const pct = d.total > 0 ? (d.goals / d.total) * 100 : 0;
              return (
                <div key={level} className={`rounded-lg border-2 ${c.border} ${c.bg} p-3`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-[10px] font-bold uppercase tracking-wide ${c.text}`}>{level}</span>
                    <span className="text-[10px] text-gray-500 font-mono">{d.total}</span>
                  </div>
                  <div className="text-2xl font-black text-gray-800 mb-2">{d.goals}</div>
                  <div className="h-1.5 bg-white/60 rounded-full overflow-hidden mb-1">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c.bar }} />
                  </div>
                  <div className="text-[10px] text-gray-500">{pct.toFixed(0)}% gol · {d.correct} doğru</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Probability Buckets */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1.5 h-5 rounded-full bg-gradient-to-b from-emerald-400 to-green-500" />
          <h3 className="text-sm font-bold text-gray-800">Olasılık Bucket Analizi (Kalibrasyon)</h3>
        </div>
        {buckets.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">Henüz bucket verisi yok</p>
        ) : (
          <div className="space-y-2">
            {buckets.map(b => {
              const isAggressive = b.goalRate > b.max / 100 + 0.05;
              const isConservative = b.goalRate < b.min / 100 - 0.05;
              const calibration = isAggressive ? 'agresif' : isConservative ? 'muhafazakâr' : 'kalibre';
              return (
                <div key={b.range} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
                  <span className="w-16 font-mono text-[11px] text-gray-700">{b.range}</span>
                  <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden relative">
                    <div className="absolute inset-y-0 bg-gray-300/30" style={{ width: `${b.max}%` }} />
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${b.goalRate * 100}%`, background: b.goalRate >= 0.4 ? '#10b981' : b.goalRate >= 0.2 ? '#f59e0b' : '#ef4444' }} />
                  </div>
                  <span className="w-12 text-right text-[11px] text-gray-500 font-mono">{b.total}</span>
                  <span className="w-14 text-right text-[11px] font-bold text-gray-700">{(b.goalRate * 100).toFixed(0)}%</span>
                  <span className={`w-20 text-[10px] font-bold uppercase ${
                    isAggressive ? 'text-emerald-600' : isConservative ? 'text-red-600' : 'text-indigo-600'
                  }`}>{calibration}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Outcome Distribution */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <h3 className="text-sm font-bold text-gray-800 mb-3">📊 Sonuç Dağılımı (Stacked)</h3>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-[11px] text-gray-500 mb-1.5">
              <span>Doğru / Yanlış / Gol Yok / Bekleyen</span>
              <span className="font-mono font-bold">{total} sinyal</span>
            </div>
            <div className="h-4 rounded-full overflow-hidden flex bg-gray-100">
              {stats.correctPredictions > 0 && (
                <div className="h-full transition-all duration-700" style={{ width: `${(stats.correctPredictions / Math.max(1, total)) * 100}%`, background: '#10b981' }} />
              )}
              {stats.incorrectPredictions > 0 && (
                <div className="h-full transition-all duration-700" style={{ width: `${(stats.incorrectPredictions / Math.max(1, total)) * 100}%`, background: '#ef4444' }} />
              )}
              {stats.signalsWithoutGoal > 0 && (
                <div className="h-full transition-all duration-700" style={{ width: `${(stats.signalsWithoutGoal / Math.max(1, total)) * 100}%`, background: '#94a3b8' }} />
              )}
              {stats.signalsPending > 0 && (
                <div className="h-full transition-all duration-700" style={{ width: `${(stats.signalsPending / Math.max(1, total)) * 100}%`, background: '#fbbf24' }} />
              )}
            </div>
            <div className="flex flex-wrap gap-3 mt-2 text-[10px]">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Doğru {stats.correctPredictions}</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500" /> Yanlış {stats.incorrectPredictions}</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-gray-400" /> Gol Yok {stats.signalsWithoutGoal}</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400" /> Bekleyen {stats.signalsPending}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Calibration Health */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <h3 className="text-sm font-bold text-gray-800 mb-3">🧮 Kalibrasyon Sağlığı</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard label="Brier Score" value={stats.brierScore.toFixed(4)}
            color={stats.brierScore < 0.2 ? '#10b981' : stats.brierScore < 0.3 ? '#f59e0b' : '#ef4444'}
            sub="düşük = iyi" />
          <KPICard label="Avg Predicted" value={(stats.buckets?.reduce((a, b) => a + (b.min + b.max) / 2 / 100 * b.total, 0) / Math.max(1, total)).toFixed(3)} color="#3b82f6" sub="model çıktısı" />
          <KPICard label="Avg Observed" value={(stats.signalsWithGoal / Math.max(1, total)).toFixed(3)} color="#10b981" sub="gerçekleşen" />
          <KPICard label="Goal %" value={`${(stats.goalAfterSignalRate * 100).toFixed(1)}%`} color="#f79520" sub="sinyal → gol" />
        </div>
      </div>
    </div>
  );
}

function KPICard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 bg-gradient-to-br from-gray-50 to-white">
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-xl font-black" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}
