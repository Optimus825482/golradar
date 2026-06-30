'use client';

import { useState } from 'react';
import { authFetch, KPICard } from '@/lib/adminAuth';
import { simulateProfit, signalsToBetRecords, type SimulationResult, type BetRecord } from '@/lib/simulationMetrics';
import { TrendingUp, TrendingDown, Minus, RefreshCw } from 'lucide-react';

export default function ProfitSimulationPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [records, setRecords] = useState<BetRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [useKelly, setUseKelly] = useState(true);
  const [flatStake, setFlatStake] = useState(1);
  const [tierFilter, setTierFilter] = useState<string>('all');

  async function runSimulation() {
    setLoading(true);
    setError(null);
    setResult(null);
    setRecords([]);
    try {
      const res = await authFetch(`/api/goal-signals?action=stats&days=${days}`);
      const stats = await res.json();
      let signals = stats?.recentSignals ?? [];

      if (signals.length === 0) { setError('Sinyal bulunamadi'); return; }

      // Tier filter
      if (tierFilter !== 'all') {
        signals = signals.filter((s: any) => (s.signalLevel ?? 'low') === tierFilter);
      }

      if (signals.length === 0) { setError(`Secilen tier'da sinyal yok (${tierFilter})`); return; }

      const betRecords = signalsToBetRecords(signals, flatStake, useKelly);
      const simResult = simulateProfit(betRecords);
      setResult(simResult);
      setRecords(betRecords.slice(-50).reverse()); // son 50 sinyal, en yeni once
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-black text-gray-800">📈 Kar Simulasyonu</h1>
      <p className="text-xs text-gray-500">
        Gecmis sinyallere hypothetical bahis. Kelly Criterion ile optimal stake hesaplama.
        Her sinyalde odds = 1/calibratedP.
      </p>

      {/* Controls */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-[11px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Periyot</label>
            <div className="flex gap-1">
              {[7, 30, 60, 90].map(d => (
                <button key={d} onClick={() => setDays(d)}
                  className={`flex-1 py-2 text-sm font-bold rounded-lg border-2 ${days === d ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'}`}>{d}g</button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Stake</label>
            <div className="flex gap-1">
              <button onClick={() => { setUseKelly(false); setFlatStake(1); }}
                className={`flex-1 py-2 text-xs font-bold rounded-lg border-2 ${!useKelly && flatStake === 1 ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-600'}`}>1 birim</button>
              <button onClick={() => { setUseKelly(true); }}
                className={`flex-1 py-2 text-xs font-bold rounded-lg border-2 ${useKelly ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'}`}>Kelly %25</button>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Sinyal Seviyesi</label>
            <div className="flex gap-1">
              {['all', 'high', 'medium', 'low'].map(t => (
                <button key={t} onClick={() => setTierFilter(t)}
                  className={`flex-1 py-2 text-[10px] font-bold rounded-lg border-2 ${tierFilter === t ? 'border-purple-400 bg-purple-50 text-purple-700' : 'border-gray-200 text-gray-600'}`}>
                  {t === 'all' ? 'Tumu' : t === 'high' ? 'HIGH' : t === 'medium' ? 'MED' : 'LOW'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-end">
            <button onClick={runSimulation} disabled={loading}
              className="w-full py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-bold rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all disabled:opacity-50">
              {loading ? '⏳ Hesaplaniyor...' : '🚀 Calistir'}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded text-sm">{error}</div>}

      {result && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KPICard label="Toplam Sinyal" value={String(result.totalSignals)} color="#6366f1" />
            <KPICard label="Kazanan" value={String(result.wonBets)} color="#10b981" sub={`%${(result.winRate * 100).toFixed(1)} kazanma`} />
            <KPICard label="Kaybeden" value={String(result.lostBets)} color="#ef4444" />
            <KPICard label="Ort. Odds" value={String(result.avgOdds)} color="#8b5cf6" />
            <KPICard label="Sharpe" value={String(result.sharpeRatio)} color={result.sharpeRatio > 1 ? '#10b981' : '#f59e0b'} />
          </div>

          {/* Profit */}
          <div className="bg-white rounded-lg border overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b font-semibold text-sm">💰 Kar/Zarar</div>
            <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-gray-500">Yatirilan</div>
                <div className="text-lg font-bold">{result.totalStaked} birim</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Geri Donen</div>
                <div className="text-lg font-bold">{result.totalReturned} birim</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Kar</div>
                <div className={`text-lg font-bold ${result.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {result.profit >= 0 ? '+' : ''}{result.profit} birim
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">ROI</div>
                <div className={`text-lg font-bold ${result.roi >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  %{result.roi}
                </div>
              </div>
            </div>
          </div>

          {/* Risk Metrics */}
          <div className="bg-white rounded-lg border overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b font-semibold text-sm">📊 Risk Metrikleri</div>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-gray-100">
                  <td className="py-2 px-3 font-medium">Sharpe Ratio</td>
                  <td className="py-2 px-3">{result.sharpeRatio > 1 ? '✅' : result.sharpeRatio > 0 ? '⚠️' : '❌'} {result.sharpeRatio}</td>
                  <td className="py-2 px-3 text-xs text-gray-500">&gt;1 iyi, &gt;2 cok iyi</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 px-3 font-medium">Max Drawdown</td>
                  <td className="py-2 px-3 text-red-600">{result.maxDrawdown} birim</td>
                  <td className="py-2 px-3 text-xs text-gray-500">En buyuk tepe-tabana dusus</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 px-3 font-medium">Win Rate</td>
                  <td className="py-2 px-3">%{(result.winRate * 100).toFixed(1)}</td>
                  <td className="py-2 px-3 text-xs text-gray-500">Kazanan bahis orani</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-medium">Stake Tipi</td>
                  <td className="py-2 px-3">{useKelly ? 'Kelly Criterion (cap=%25)' : `Flat ${flatStake} birim`}</td>
                  <td className="py-2 px-3 text-xs text-gray-500">{useKelly ? 'Edge-based optimal stake' : 'Sabit bahis miktari'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Per-signal breakdown */}
          {records.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-800">📋 Son {records.length} Sinyal Detayi</h3>
                <span className="text-[10px] text-gray-400">En yeni 50 sinyal</span>
              </div>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr className="border-b border-gray-200 text-gray-500">
                      <th className="text-left px-3 py-2 font-semibold">#</th>
                      <th className="text-right px-3 py-2 font-semibold">Tahmin</th>
                      <th className="text-right px-3 py-2 font-semibold">Odds</th>
                      <th className="text-right px-3 py-2 font-semibold">Stake</th>
                      <th className="text-right px-3 py-2 font-semibold">Sonuc</th>
                      <th className="text-right px-3 py-2 font-semibold">Kar/Zarar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r, i) => {
                      const won = r.actual === 1;
                      const pnl = won ? r.stake * (r.odds - 1) : -r.stake;
                      return (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-3 py-1.5 text-gray-400">{i + 1}</td>
                          <td className="px-3 py-1.5 text-right font-mono">%{(r.predicted * 100).toFixed(1)}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{r.odds.toFixed(2)}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-gray-600">{r.stake.toFixed(2)}</td>
                          <td className="px-3 py-1.5 text-right">
                            {won ? <span className="text-emerald-600 font-bold">✅ KAZANDI</span> : <span className="text-red-600">❌ KAYBETTI</span>}
                          </td>
                          <td className={`px-3 py-1.5 text-right font-mono font-bold ${pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Comment */}
          <div className={`rounded-lg p-4 text-sm ${result.profit > 0 ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
            <strong>🔍 Yorum:</strong>
            <ul className="list-disc ml-5 mt-1 space-y-1">
              {result.profit > 0
                ? <li>✅ {result.totalSignals} sinyalde {result.profit} birim kar (ROI: %{result.roi})</li>
                : <li>❌ {result.totalSignals} sinyalde {Math.abs(result.profit)} birim zarar (ROI: %{result.roi})</li>}
              {result.sharpeRatio > 1 ? <li>✅ Sharpe &gt; 1: risk ayarli getiri iyi</li> : <li>⚠️ Sharpe dusuk: risk ayarli getiri zayif</li>}
              {result.winRate > 0.4 ? <li>✅ Win rate %{(result.winRate * 100).toFixed(1)}: kabul edilebilir</li> : <li>⚠️ Win rate %{(result.winRate * 100).toFixed(1)}: dusuk</li>}
              {useKelly && <li>ℹ️ Kelly Criterion: edge'e gore stake buyuklugu ayarlanir, dusuk olasilikli sinyallere dusuk bahis</li>}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
