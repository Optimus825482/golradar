'use client';

import { useEffect, useState } from 'react';
import { authFetch, KPICard } from '@/lib/adminAuth';

	interface CalibrationBucket {
	  range: string;
	  min: number;
	  max: number;
	  count: number;
	  goalCount: number;
	  observedRate: number;
	  avgCalibratedP: number;
	}
	
	interface CalibrationData {
	  totalPredictions: number;
	  totalGoals: number;
	  brierScore: number;
	  logLoss: number;
	  accuracy: number;
	  calibrationError: number;
	  bins: CalibrationBucket[];
	  lastUpdated: number;
	}
	
	export default function AdminCalibrationPage() {
	  const [stats, setStats] = useState<CalibrationData | null>(null);
	  const [loading, setLoading] = useState(true);
	  const [days, setDays] = useState(30);
	  const [calRunMsg, setCalRunMsg] = useState<string | null>(null);
	
	  const load = () => {
	    setLoading(true);
	    authFetch(`/api/calibration?action=stats&days=${days}`)
	      .then(r => r.ok ? r.json() : null)
	      .then(d => { setStats(d); setLoading(false); });
	  };
	
	  useEffect(() => { load(); }, [days]);
	
  const runAutoCalibrate = async () => {
    setCalRunMsg(null);
    try {
      const res = await authFetch('/api/calibration?action=autocalibrate');
      const data = await res.json();
      if (data.success) {
        setCalRunMsg(`✓ Brier ${data.brierBefore.toFixed(4)} → ${data.brierAfter.toFixed(4)} (${data.improvement})`);
        load();
      } else {
        setCalRunMsg(`✗ ${data.message || 'Başarısız'}`);
      }
    } catch { setCalRunMsg('✗ Bağlantı hatası'); }
  };

	  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full" /></div>;
	  if (!stats) return <div className="text-center py-20 text-gray-400">Veri yüklenemedi</div>;

	  const buckets = (stats as any).bins?.filter((b: any) => b.count > 0) || [];

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
		        <KPICard label="Brier Score" value={stats.brierScore != null ? stats.brierScore.toFixed(4) : '—'}
		          color={stats.brierScore != null ? (stats.brierScore < 0.2 ? '#10b981' : stats.brierScore < 0.3 ? '#f59e0b' : '#ef4444') : '#6b7280'}
		          sub="Düşük = iyi" />
		        <KPICard label="Kal. Hata" value={stats.calibrationError != null ? (stats.calibrationError * 100).toFixed(1) + '%' : '—'}
		          color={stats.calibrationError != null ? (stats.calibrationError < 0.1 ? '#10b981' : '#f59e0b') : '#6b7280'}
		          sub="Tahmin-gözlem farkı" />
		        <KPICard label="Ortalama P" value={stats.bins?.length > 0
		          ? (stats.bins.reduce((a, b) => a + b.avgCalibratedP * b.count, 0) / Math.max(1, stats.totalPredictions)).toFixed(3)
		          : '—'} color="#5794f2" sub="Model çıktısı" />
		        <KPICard label="Ortalama Gözlem" value={stats.totalPredictions > 0 ? (stats.totalGoals / stats.totalPredictions).toFixed(3) : '—'} color="#10b981" sub="Gerçekleşen gol %" />
		      </div>

	      {/* Manual Auto-Calibrate Button */}
	      <div className="flex items-center gap-2">
	        <button onClick={runAutoCalibrate}
	          className="text-xs px-4 py-1.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all">
	          🔄 Otomatik Kalibrasyon Çalıştır
	        </button>
	        {calRunMsg && <span className="text-xs text-gray-600">{calRunMsg}</span>}
	      </div>

	      {/* Calibration Eğrisi */}
	      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
	        <div className="flex items-center gap-2 mb-3">
	          <div className="w-1.5 h-5 rounded-full bg-gradient-to-b from-indigo-400 to-purple-500" />
	          <h3 className="text-sm font-bold text-gray-800">Kalibrasyon Eğrisi (Tahmin vs Gerçek)</h3>
	          <span className="text-[10px] text-gray-400 ml-auto">İdeal: Diyagonal çizgi</span>
	        </div>
	        <CalibrationChart buckets={buckets} />
	        <div className="flex items-center justify-center gap-4 mt-3 text-[10px] text-gray-500">
	          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500" /> Agresif (tahmin &lt; gözlem)</span>
	          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-indigo-500" /> Kalibre</span>
	          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500" /> Muhafazakâr (tahmin &gt; gözlem)</span>
	        </div>
	      </div>

	      {/* Olasılık Bucket Analizi */}
	      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
	        <h3 className="text-sm font-bold text-gray-800 mb-3">📈 Olasılık Bucket Analizi (rawScore)</h3>
	        {buckets.length === 0 ? (
	          <p className="text-xs text-gray-400 text-center py-4">Henüz bucket verisi yok</p>
	        ) : (
	          <div className="space-y-2">
	            {buckets.map(b => {
	              const gap = b.observedRate - b.avgCalibratedP;
	              const isAgresif = gap > 0.05;
	              const isConservative = gap < -0.05;
	              return (
	                <div key={b.range} className="flex items-center gap-3">
	                  <span className="w-16 font-mono text-[11px] text-gray-600">{b.range}</span>
	                  <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden relative">
	                    <div className="h-full rounded-full transition-all"
	                      style={{ width: `${b.observedRate * 100}%`, background: b.observedRate >= 0.4 ? '#10b981' : b.observedRate >= 0.2 ? '#f59e0b' : '#ef4444' }} />
	                    <div className="absolute inset-y-0 border-r-2 border-dashed border-gray-400" style={{ left: `${b.avgCalibratedP * 100}%` }} />
	                  </div>
	                  <span className="w-12 text-right text-[11px] text-gray-500 font-mono">{b.count}</span>
	                  <span className="w-14 text-right font-bold text-[11px]"
	                    style={{ color: b.observedRate >= 0.4 ? '#10b981' : b.observedRate >= 0.2 ? '#f59e0b' : '#ef4444' }}>
	                    {(b.observedRate * 100).toFixed(0)}%
	                  </span>
	                  <span className={`w-16 text-[9px] font-bold uppercase ${isAgresif ? 'text-emerald-600' : isConservative ? 'text-red-600' : 'text-indigo-600'}`}>
	                    {isAgresif ? 'Agresif' : isConservative ? 'Muhafazakâr' : 'Kalibre'}
	                  </span>
	                </div>
	              );
	            })}
	          </div>
	        )}
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
	        const px = b.avgCalibratedP;
	        const py = b.observedRate;
	        const bw = 0.06;
	        const x0 = xFor(px - bw);
	        const x1 = xFor(px + bw);
	        const y = yFor(py);
	        const fill = py > px + 0.1 ? '#10b981' : py < px - 0.1 ? '#ef4444' : '#6366f1';
	        return (
	          <g key={b.range}>
	            <rect x={x0} y={y} width={x1 - x0} height={H - padB - y} fill={fill} opacity={0.8} rx={2} />
	            {b.count > 0 && (
	              <text x={(x0 + x1) / 2} y={y - 3} fontSize={9} fill={fill} textAnchor="middle" fontWeight="bold">
	                {(py * 100).toFixed(0)}%
	              </text>
	            )}
	            <text x={(x0 + x1) / 2} y={H - padB + 14} fontSize={9} fill="#64748b" textAnchor="middle">{b.range}</text>
	            <text x={(x0 + x1) / 2} y={H - padB + 24} fontSize={8} fill="#94a3b8" textAnchor="middle">n={b.count}</text>
	          </g>
	        );
	      })}
	    </svg>
	  );
	}
