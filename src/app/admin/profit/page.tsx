'use client';

import { useState } from 'react';
import { authFetch, KPICard } from '@/lib/adminAuth';
import { simulateProfit, signalsToBetRecords, type SimulationResult } from '@/lib/simulationMetrics';

export default function ProfitSimulationPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  async function runSimulation() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await authFetch(`/api/goal-signals?action=stats&days=${days}`);
      const stats = await res.json();
      const signals = stats?.recentSignals ?? [];

      if (signals.length === 0) { setError('No signals found'); return; }

      const records = signalsToBetRecords(signals, 1);
      const simResult = simulateProfit(records);
      setResult(simResult);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-black text-gray-800">📈 Kâr Simülasyonu</h1>
      <p className="text-xs text-gray-500">
        Geçmiş sinyallere hypothetical bahis koyar: doğruysa kazanır, yanlışsa kaybedersin.
        Her sinyal için 1 birim bahis, odds = 1/calibratedP.
      </p>

      <div className="flex flex-wrap gap-3 items-end bg-white p-4 rounded-lg border">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Gün aralığı</label>
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="border rounded px-3 py-1.5 text-sm">
            <option value={7}>7 gün</option>
            <option value={30}>30 gün</option>
            <option value={60}>60 gün</option>
            <option value={90}>90 gün</option>
          </select>
        </div>
        <button onClick={runSimulation} disabled={loading}
          className="bg-indigo-600 text-white px-5 py-1.5 rounded text-sm hover:bg-indigo-700 disabled:opacity-50">
          {loading ? 'Hesaplanıyor...' : '🚀 Simülasyonu Çalıştır'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded text-sm">{error}</div>
      )}

      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPICard label="Toplam Sinyal" value={String(result.totalSignals)} color="#6366f1" />
            <KPICard label="Kazanan" value={String(result.wonBets)} color="#10b981"
              sub={`%${(result.winRate * 100).toFixed(1)} kazanma`} />
            <KPICard label="Kaybeden" value={String(result.lostBets)} color="#ef4444" />
            <KPICard label="Ort. Odds" value={String(result.avgOdds)} color="#8b5cf6" />
          </div>

          <div className="bg-white rounded-lg border overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b font-semibold text-sm">💰 Kâr/Zarar</div>
            <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-gray-500">Yatırılan</div>
                <div className="text-lg font-bold">{result.totalStaked} birim</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Geri Dönen</div>
                <div className="text-lg font-bold">{result.totalReturned} birim</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Kâr</div>
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

          <div className="bg-white rounded-lg border overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b font-semibold text-sm">📊 Risk Metrikleri</div>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-gray-100">
                  <td className="py-2 px-3 font-medium">Sharpe Ratio</td>
                  <td className="py-2 px-3">{result.sharpeRatio > 1 ? '✅' : result.sharpeRatio > 0 ? '⚠️' : '❌'} {result.sharpeRatio}</td>
                  <td className="py-2 px-3 text-xs text-gray-500">&gt;1 iyi, &gt;2 çok iyi</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 px-3 font-medium">Max Drawdown</td>
                  <td className="py-2 px-3 text-red-600">{result.maxDrawdown} birim</td>
                  <td className="py-2 px-3 text-xs text-gray-500">En büyük tepeden-tabağa düşüş</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-medium">Win Rate</td>
                  <td className="py-2 px-3">%{(result.winRate * 100).toFixed(1)}</td>
                  <td className="py-2 px-3 text-xs text-gray-500">Kazanan bahis oranı</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className={`rounded-lg p-4 text-sm ${result.profit > 0 ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
            <strong>🔍 Yorum:</strong>
            <ul className="list-disc ml-5 mt-1 space-y-1">
              {result.profit > 0
                ? <li>✅ {result.totalSignals} sinyalde {result.profit} birim kâr (ROI: %{result.roi})</li>
                : <li>❌ {result.totalSignals} sinyalde {Math.abs(result.profit)} birim zarar (ROI: %{result.roi})</li>}
              {result.sharpeRatio > 1
                ? <li>✅ Sharpe &gt; 1: risk ayarlı getiri iyi</li>
                : <li>⚠️ Sharpe düşük: risk ayarlı getiri zayıf</li>}
              {result.winRate > 0.4
                ? <li>✅ Win rate %{(result.winRate * 100).toFixed(1)}: kabul edilebilir</li>
                : <li>⚠️ Win rate %{(result.winRate * 100).toFixed(1)}: düşük</li>}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
