'use client';

import { useEffect, useState } from 'react';
import { authFetch, KPICard } from '@/lib/adminAuth';

interface CalibrationBucket {
  range: string;
  min: number;
  max: number;
  total: number;
  goals: number;
  correct: number;
  goalRate: number;
  accuracy: number;
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
  avgPredictedP: number;
  avgObservedP: number;
  calibrationError: number;
  buckets: CalibrationBucket[];
  homeSideAccuracy: number;
  awaySideAccuracy: number;
  levelDistribution: Record<string, { total: number; goals: number; correct: number }>;
}

export default function AdminCalibrationPage() {
  const [stats, setStats] = useState<SignalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    authFetch(`/api/goal-signals?action=stats&days=${days}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setStats(d); setLoading(false); });
  }, [days]);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full" /></div>;
  if (!stats) return <div className="text-center py-20 text-gray-400">Veri yüklenemedi</div>;

  const buckets = stats.buckets?.filter(b => b.total > 0) || [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black text-gray-800">🎯 Kalibrasyon Analizi</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Tahmin vs gerçekleşme oranları, Brier score ve olasılık bucket analizi
          </p>
        </div>
        <div className="flex gap-1 bg-gray-100 p-0.5 rounded-lg">
          {[7, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`text-[11px] px-3 py-1.5 rounded-md font-semibold transition-all ${
                days === d ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {d === 7 ? '7g' : d === 30 ? '30g' : '90g'}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Brier Score" value={stats.brierScore.toFixed(4)}
          color={stats.brierScore < 0.2 ? '#10b981' : stats.brierScore < 0.3 ? '#f59e0b' : '#ef4444'}
          sub="Düşük = iyi" />
        <KPICard label="Kal. Hata" value={(stats.calibrationError * 100).toFixed(1) + '%'}
          color={stats.calibrationError < 0.1 ? '#10b981' : '#f59e0b'}
          sub="Tahmin-gözlem farkı" />
        <KPICard label="Ortalama P" value={stats.avgPredictedP.toFixed(3)} color="#5794f2" sub="Model çıktısı" />
        <KPICard label="Ortalama Gözlem" value={stats.avgObservedP.toFixed(3)} color="#10b981" sub="Gerçekleşen gol %" />
      </div>

      {/* Calibration Chart */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1.5 h-5 rounded-full bg-gradient-to-b from-indigo-400 to-purple-500" />
          <h3 className="text-sm font-bold text-gray-800">Kalibrasyon Skatter</h3>
          <span className="text-[10px] text-gray-400 ml-auto">İdeal: Diyagonal çizgi</span>
        </div>
        <CalibrationChart buckets={buckets} />
        <div className="flex items-center justify-center gap-4 mt-3 text-[10px] text-gray-500">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500" /> Üstünde (agresif)</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-indigo-500" /> Kalibre</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500" /> Altında (muhafazakâr)</span>
        </div>
      </div>

      {/* Side accuracy + Level distribution */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">🏠</span>
            <h3 className="text-sm font-bold text-gray-800">Yön Doğruluğu</h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SideBox label="Ev Sahibi" rate={stats.homeSideAccuracy} side="home" />
            <SideBox label="Deplasman" rate={stats.awaySideAccuracy} side="away" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">📊</span>
            <h3 className="text-sm font-bold text-gray-800">Seviye Dağılımı</h3>
          </div>
          <div className="space-y-2">
            {Object.entries(stats.levelDistribution || {}).map(([level, d]) => {
              const colors: Record<string, string> = { low: '#8e8e8e', medium: '#f79520', high: '#f79520', critical: '#ef4444' };
              const pct = d.total > 0 ? (d.goals / d.total) * 100 : 0;
              return (
                <div key={level}>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="font-semibold uppercase" style={{ color: colors[level] || '#8e8e8e' }}>{level}</span>
                    <span className="text-gray-500 font-mono">{d.total} sinyal · {d.goals} gol · {d.correct} doğru</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: colors[level] || '#8e8e8e' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Probability buckets */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <h3 className="text-sm font-bold text-gray-800 mb-3">📈 Olasılık Bucket Analizi</h3>
        {buckets.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">Henüz bucket verisi yok</p>
        ) : (
          <div className="space-y-2">
            {buckets.map(b => (
              <div key={b.range} className="flex items-center gap-3">
                <span className="w-16 font-mono text-[11px] text-gray-600">{b.range}</span>
                <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden relative">
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${b.goalRate * 100}%`, background: b.goalRate >= 0.4 ? '#10b981' : b.goalRate >= 0.2 ? '#f59e0b' : '#ef4444' }} />
                </div>
                <span className="w-12 text-right text-[11px] text-gray-500 font-mono">{b.total}</span>
                <span className="w-14 text-right font-bold text-[11px]"
                  style={{ color: b.goalRate >= 0.4 ? '#10b981' : b.goalRate >= 0.2 ? '#f59e0b' : '#ef4444' }}>
                  {(b.goalRate * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SideBox({ label, rate, side }: { label: string; rate: number; side: 'home' | 'away' }) {
  const color = side === 'home' ? '#f79520' : '#5794f2';
  return (
    <div className="rounded-lg p-3 border" style={{ borderColor: `${color}40`, background: `${color}08` }}>
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-2xl font-black" style={{ color }}>{(rate * 100).toFixed(1)}%</div>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden mt-2">
        <div className="h-full rounded-full" style={{ width: `${rate * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function CalibrationChart({ buckets }: { buckets: CalibrationBucket[] }) {
  const W = 600, H = 220, padL = 36, padR = 16, padT = 14, padB = 32;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xFor = (v: number) => padL + v * innerW;
  const yFor = (v: number) => padT + (1 - v) * innerH;

  if (buckets.length === 0) {
    return <p className="text-xs text-gray-400 text-center py-6">Bucket verisi yok</p>;
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {[0, 0.25, 0.5, 0.75, 1].map(g => (
        <g key={g}>
          <line x1={padL} x2={W - padR} y1={yFor(g)} y2={yFor(g)} stroke="#f1f5f9" strokeWidth={1} />
          <text x={padL - 6} y={yFor(g) + 3} fontSize={9} fill="#94a3b8" textAnchor="end">{(g * 100).toFixed(0)}%</text>
        </g>
      ))}
      <line x1={xFor(0)} y1={yFor(0)} x2={xFor(1)} y2={yFor(1)} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="4 4" />
      {buckets.map(b => {
        const mid = (b.min + b.max) / 2 / 100;
        const x0 = xFor(mid - 0.04);
        const x1 = xFor(mid + 0.04);
        const y = yFor(b.goalRate);
        const fill = b.goalRate > mid + 0.1 ? '#10b981' : b.goalRate < mid - 0.1 ? '#ef4444' : '#6366f1';
        return (
          <g key={b.range}>
            <rect x={x0} y={y} width={x1 - x0} height={H - padB - y} fill={fill} opacity={0.8} rx={2} />
            {b.total > 0 && (
              <text x={(x0 + x1) / 2} y={y - 3} fontSize={9} fill={fill} textAnchor="middle" fontWeight="bold">
                {(b.goalRate * 100).toFixed(0)}%
              </text>
            )}
            <text x={(x0 + x1) / 2} y={H - padB + 14} fontSize={9} fill="#64748b" textAnchor="middle">{b.range}</text>
            <text x={(x0 + x1) / 2} y={H - padB + 24} fontSize={8} fill="#94a3b8" textAnchor="middle">n={b.total}</text>
          </g>
        );
      })}
    </svg>
  );
}
