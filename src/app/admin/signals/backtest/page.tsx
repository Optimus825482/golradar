'use client';

import { useEffect, useState } from 'react';
import { authFetch, KPICard } from '@/lib/adminAuth';

interface BucketResult {
	  bucket: string;
	  count: number;
	  avgPredicted: number;
	  observedRate: number;
	  brier: number | null;
	  calibrationError: number;
	  gap: number;
	}
	
	interface ReplayResult {
	  wouldFireCount: number;
	  fireRate: number;
	  brierRaw: number;
	  brierCalibrated: number;
	  observedGoalRate: number;
	  positiveAndFired: number;
	  // 🥇 PRİMER METRİK: Gol zamanına göre başarı
	  goalPrimary: {
	    excellent: number;  // ≤5dk
	    good: number;       // 5-10dk
	    late: number;       // 10-15dk
	    fail: number;       // gol olmadı
	    pending: number;    // henüz belli değil
	    excellentRate: number;
	    goodRate: number;
	    lateRate: number;
	    failRate: number;
	    successRate: number;
	  };
	  // 🥈 İKİNCİL METRİK: Yön doğruluğu
	  sideAccuracy: {
	    correct: number;
	    incorrect: number;
	    rate: number;
	  };
	  // Lig bazlı F8 kalibrasyon bilgisi
	  leagueCalibration?: string;
	}

interface BacktestResponse {
  ok: boolean;
  mode: 'replay' | 'bucket';
  days: number;
  totalRows: number;
  message?: string;
  overallBrier?: number;
  buckets?: BucketResult[];
  replay?: ReplayResult;
}

export default function AdminSignalsBacktestPage() {
  const [mode, setMode] = useState<'replay' | 'bucket'>('bucket');
  const [days, setDays] = useState(30);
  const [horizonMin, setHorizonMin] = useState<number | null>(null);
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/admin/signals/backtest', {
        method: 'POST',
        body: JSON.stringify({ mode, days, horizonMin }),
      });
      const data = await res.json();
      if (data.ok) setResult(data);
      else setError(data.error || 'Backtest başarısız');
    } catch (e) {
      setError('Bağlantı hatası');
    }
    setLoading(false);
  };

  // Auto-run backtest on mount so historical results render by default.
  useEffect(() => { run(); }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-gray-800">🧪 Sinyal Algoritması Backtest</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Geçmiş tahminleri yeniden hesapla, kalibrasyon doğrula, algoritma tuning için metrik üret
        </p>
      </div>

      {error && (
        <div className="rounded-lg px-4 py-2.5 bg-red-50 text-red-700 border border-red-200 text-sm">{error}</div>
      )}

      {/* Konfig */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold text-gray-600 mb-2 uppercase tracking-wide">Mod</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMode('bucket')}
                className={`p-3 rounded-lg border-2 text-left transition-all ${
                  mode === 'bucket' ? 'border-indigo-400 bg-indigo-50/50' : 'border-gray-200'
                }`}>
                <div className="text-base mb-1">📊</div>
                <div className="text-[12px] font-bold text-gray-800">Bucket Analizi</div>
                <div className="text-[10px] text-gray-500">Olasılık bucket × gerçekleşme</div>
              </button>
              <button type="button" onClick={() => setMode('replay')}
                className={`p-3 rounded-lg border-2 text-left transition-all ${
                  mode === 'replay' ? 'border-indigo-400 bg-indigo-50/50' : 'border-gray-200'
                }`}>
                <div className="text-base mb-1">⏪</div>
                <div className="text-[12px] font-bold text-gray-800">Replay</div>
                <div className="text-[10px] text-gray-500">Sinyal üretimi simülasyonu</div>
              </button>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Periyot</label>
              <div className="flex gap-1">
                {[7, 30, 90, 180].map(d => (
                  <button key={d} type="button" onClick={() => setDays(d)}
                    className={`flex-1 py-2 text-sm font-bold rounded-lg border-2 ${
                      days === d ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'
                    }`}>
                    {d}g
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                Sinyal Ufku
              </label>
              <div className="flex gap-1">
                <button type="button" onClick={() => setHorizonMin(null)}
                  className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg border ${
                    horizonMin === null ? 'border-purple-400 bg-purple-50 text-purple-700' : 'border-gray-200 text-gray-500'
                  }`}>
                  Tümü
                </button>
                {[5, 10, 15, 30, 60].map(h => (
                  <button key={h} type="button" onClick={() => setHorizonMin(h)}
                    className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg border ${
                      horizonMin === h ? 'border-purple-400 bg-purple-50 text-purple-700' : 'border-gray-200 text-gray-500'
                    }`}>
                    {h}dk
                  </button>
                ))}
              </div>
            </div>
            <button onClick={run} disabled={loading}
              className="w-full px-4 py-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-bold rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all disabled:opacity-50">
              {loading ? '⏳ Çalışıyor...' : '🚀 Backtest Başlat'}
            </button>
          </div>
        </div>
      </div>

      {/* Sonuç — Bucket */}
      {result?.mode === 'bucket' && result.buckets && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-800">📊 Bucket Backtest Sonucu</h2>
            <span className="text-[10px] text-gray-500">
              {result.totalRows} tahmin · {result.days}g · Overall Brier: {result.overallBrier?.toFixed(4)}
            </span>
          </div>
          {result.totalRows === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">{result.message || 'Veri yok'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-500">
                    <th className="text-left py-2 px-2 font-semibold">Bucket</th>
                    <th className="text-right py-2 px-2 font-semibold">N</th>
                    <th className="text-right py-2 px-2 font-semibold">Avg Predicted</th>
                    <th className="text-right py-2 px-2 font-semibold">Observed</th>
                    <th className="text-right py-2 px-2 font-semibold">Gap</th>
                    <th className="text-right py-2 px-2 font-semibold">Brier</th>
                    <th className="text-right py-2 px-2 font-semibold">Kal. Hata</th>
                  </tr>
                </thead>
                <tbody>
                  {result.buckets.map(b => (
                    <tr key={b.bucket} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 px-2 font-mono font-bold text-gray-700">{b.bucket}</td>
                      <td className="py-2 px-2 text-right font-mono text-gray-600">{b.count}</td>
                      <td className="py-2 px-2 text-right font-mono text-gray-600">{(b.avgPredicted * 100).toFixed(1)}%</td>
                      <td className="py-2 px-2 text-right font-mono">
                        <span className={
                          b.observedRate >= 0.4 ? 'text-emerald-600 font-bold' :
                          b.observedRate >= 0.2 ? 'text-amber-600' : 'text-red-600'
                        }>
                          {(b.observedRate * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right font-mono">
                        <span className={Math.abs(b.gap) < 0.05 ? 'text-emerald-600' : Math.abs(b.gap) < 0.15 ? 'text-amber-600' : 'text-red-600'}>
                          {b.gap > 0 ? '+' : ''}{(b.gap * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right font-mono">
                        <span className={b.brier != null && b.brier < 0.2 ? 'text-emerald-600' : 'text-gray-600'}>
                          {b.brier?.toFixed(4) ?? '—'}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right font-mono">
                        <span className={b.calibrationError < 0.1 ? 'text-emerald-600' : 'text-amber-600'}>
                          {(b.calibrationError * 100).toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

	      {/* Sonuç — Replay */}
	      {result?.mode === 'replay' && result.replay && (
	        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
	          <h2 className="text-sm font-bold text-gray-800 mb-3">⏪ Replay Simülasyon Sonucu</h2>
	          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
	            <KPICard label="Toplam Tahmin" value={result.totalRows.toString()} color="#6366f1" />
	            <KPICard label="Sinyal Üretirdi" value={result.replay.wouldFireCount.toString()} color="#f79520"
	              sub={`${(result.replay.fireRate * 100).toFixed(1)}% fire rate`} />
	            <KPICard label="Gözlem Gol %" value={`${(result.replay.observedGoalRate * 100).toFixed(1)}%`} color="#10b981" />
	            <KPICard label="Brier (Raw)" value={result.replay.brierRaw.toFixed(4)} color="#94a3b8" sub="ham model" />
	            <KPICard label="Brier (Calibrated)" value={result.replay.brierCalibrated.toFixed(4)}
	              color={result.replay.brierCalibrated < 0.2 ? '#10b981' : '#f59e0b'} sub="calibrated" />
	            <KPICard label="Pozitif ve Fire" value={result.replay.positiveAndFired.toString()} color="#8b5cf6"
	              sub="gol oldu + sinyal vardı" />
	          </div>

	          {/* 🥇 PRİMER METRİK: Gol Zamanı Başarısı */}
	          {result.replay.goalPrimary && (
	            <div className="mt-4 pt-4 border-t border-gray-100">
	              <div className="flex items-center gap-2 mb-3">
	                <span className="text-base">🥇</span>
	                <h3 className="text-sm font-bold text-gray-800">Gol Zamanı Başarısı (Primer Metrik)</h3>
	              </div>
	              <div className="grid grid-cols-5 gap-2 mb-2">
	                <div className="text-center p-2 rounded-lg bg-emerald-50 border border-emerald-200">
	                  <div className="text-[10px] font-semibold text-emerald-700 uppercase">Excellent</div>
	                  <div className="text-lg font-black text-emerald-600">{result.replay.goalPrimary.excellent}</div>
	                  <div className="text-[10px] text-emerald-500">≤5dk</div>
	                </div>
	                <div className="text-center p-2 rounded-lg bg-emerald-50 border border-emerald-200">
	                  <div className="text-[10px] font-semibold text-emerald-700 uppercase">Good</div>
	                  <div className="text-lg font-black text-emerald-600">{result.replay.goalPrimary.good}</div>
	                  <div className="text-[10px] text-emerald-500">5-10dk</div>
	                </div>
	                <div className="text-center p-2 rounded-lg bg-amber-50 border border-amber-200">
	                  <div className="text-[10px] font-semibold text-amber-700 uppercase">Late</div>
	                  <div className="text-lg font-black text-amber-600">{result.replay.goalPrimary.late}</div>
	                  <div className="text-[10px] text-amber-500">10-15dk</div>
	                </div>
	                <div className="text-center p-2 rounded-lg bg-red-50 border border-red-200">
	                  <div className="text-[10px] font-semibold text-red-700 uppercase">Fail</div>
	                  <div className="text-lg font-black text-red-600">{result.replay.goalPrimary.fail}</div>
	                  <div className="text-[10px] text-red-500">gol yok</div>
	                </div>
	                <div className="text-center p-2 rounded-lg bg-gray-50 border border-gray-200">
	                  <div className="text-[10px] font-semibold text-gray-700 uppercase">Pending</div>
	                  <div className="text-lg font-black text-gray-600">{result.replay.goalPrimary.pending}</div>
	                  <div className="text-[10px] text-gray-500">bekliyor</div>
	                </div>
	              </div>
	              <div className="flex items-center gap-4 text-xs">
	                <div className="flex items-center gap-1">
	                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
	                  <span>Excellent: {(result.replay.goalPrimary.excellentRate * 100).toFixed(1)}%</span>
	                </div>
	                <div className="flex items-center gap-1">
	                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
	                  <span>Good: {(result.replay.goalPrimary.goodRate * 100).toFixed(1)}%</span>
	                </div>
	                <div className="flex items-center gap-1">
	                  <span className="w-2 h-2 rounded-full bg-amber-400" />
	                  <span>Late: {(result.replay.goalPrimary.lateRate * 100).toFixed(1)}%</span>
	                </div>
	                <div className="flex items-center gap-1">
	                  <span className="w-2 h-2 rounded-full bg-red-400" />
	                  <span>Fail: {(result.replay.goalPrimary.failRate * 100).toFixed(1)}%</span>
	                </div>
	                <div className="font-bold text-gray-800">
	                  🎯 Başarı: {(result.replay.goalPrimary.successRate * 100).toFixed(1)}%
	                </div>
	              </div>
	              {/* Progress bar */}
	              <div className="h-3 rounded-full overflow-hidden flex mt-2 bg-gray-100">
	                {result.replay.goalPrimary.excellent > 0 && (
	                  <div className="h-full bg-emerald-600 transition-all" style={{ width: `${(result.replay.goalPrimary.excellent / Math.max(1, result.replay.goalPrimary.excellent + result.replay.goalPrimary.good + result.replay.goalPrimary.late + result.replay.goalPrimary.fail)) * 100}%` }} />
	                )}
	                {result.replay.goalPrimary.good > 0 && (
	                  <div className="h-full bg-emerald-400 transition-all" style={{ width: `${(result.replay.goalPrimary.good / Math.max(1, result.replay.goalPrimary.excellent + result.replay.goalPrimary.good + result.replay.goalPrimary.late + result.replay.goalPrimary.fail)) * 100}%` }} />
	                )}
	                {result.replay.goalPrimary.late > 0 && (
	                  <div className="h-full bg-amber-400 transition-all" style={{ width: `${(result.replay.goalPrimary.late / Math.max(1, result.replay.goalPrimary.excellent + result.replay.goalPrimary.good + result.replay.goalPrimary.late + result.replay.goalPrimary.fail)) * 100}%` }} />
	                )}
	                {result.replay.goalPrimary.fail > 0 && (
	                  <div className="h-full bg-red-400 transition-all" style={{ width: `${(result.replay.goalPrimary.fail / Math.max(1, result.replay.goalPrimary.excellent + result.replay.goalPrimary.good + result.replay.goalPrimary.late + result.replay.goalPrimary.fail)) * 100}%` }} />
	                )}
	              </div>
	            </div>
	          )}

	          {/* 🥈 İKİNCİL METRİK: Yön Doğruluğu */}
	          {result.replay.sideAccuracy && (
	            <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-3 gap-3 text-center">
	              <div>
	                <div className="text-[10px] font-semibold text-gray-500 uppercase">Yön Doğru</div>
	                <div className="text-xl font-black text-emerald-600">{result.replay.sideAccuracy.correct}</div>
	              </div>
	              <div>
	                <div className="text-[10px] font-semibold text-gray-500 uppercase">Yön Yanlış</div>
	                <div className="text-xl font-black text-red-600">{result.replay.sideAccuracy.incorrect}</div>
	              </div>
	              <div>
	                <div className="text-[10px] font-semibold text-gray-500 uppercase">Yön Doğruluk</div>
	                <div className="text-xl font-black text-indigo-600">{(result.replay.sideAccuracy.rate * 100).toFixed(1)}%</div>
	              </div>
	            </div>
	          )}
	        </div>
	      )}
    </div>
  );
}
