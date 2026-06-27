'use client';

import { useState } from 'react';
import { KPICard } from '@/lib/adminAuth';

interface SystemResult {
  totalSignals: number;
  correctSignals: number;
  incorrectSignals: number;
  falsePositives: number;
  truePositives: number;
  precision: number;
  recall: number;
  f1Score: number;
  avgMinutesToGoal: number;
  signalsByTier: Record<string, number>;
}

interface ABTestResult {
  ok: boolean;
  config: { daysBack: number; minScore: number };
  totalMatches: number;
  oldSystem: SystemResult;
  newSystem: SystemResult;
  improvement: {
    precisionDelta: number;
    recallDelta: number;
    f1Delta: number;
    falsePositiveDelta: number;
    signalCountDelta: number;
  };
}

function MetricRow({ label, oldVal, newVal, delta, format }: {
  label: string;
  oldVal: number;
  newVal: number;
  delta: number;
  format?: (v: number) => string;
}) {
  const fmt = format ?? ((v: number) => v.toFixed(1));
  const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
  const color = delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-500' : 'text-gray-400';
  return (
    <tr className="border-b border-gray-100">
      <td className="py-2 px-3 font-medium text-sm">{label}</td>
      <td className="py-2 px-3 text-right text-sm">{fmt(oldVal)}</td>
      <td className="py-2 px-3 text-right text-sm">{fmt(newVal)}</td>
      <td className={`py-2 px-3 text-right text-sm font-bold ${color}`}>
        {arrow} {delta >= 0 ? '+' : ''}{fmt(delta)}
      </td>
    </tr>
  );
}

export default function ABTestPage() {
  const [days, setDays] = useState(30);
  const [minScore, setMinScore] = useState(60);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ABTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runTest() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/ab-test?days=${days}&minScore=${minScore}`);
      const data = await res.json();
      if (!data.ok) { setError(data.error ?? 'Test failed'); return; }
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">A/B Test: Eski vs Yeni Sinyal Sistemi</h1>
      <p className="text-sm text-gray-500">
        AI Berkshire yöntemleriyle iyileştirilmiş sinyal sistemini eski sistemle karşılaştırır.
        Yeni sistem: funnel (kaynak kalitesi) + verdict (model uyumu) + thesis (tez takibi).
      </p>

      {/* Controls */}
      <div className="flex flex-wrap gap-4 items-end bg-white p-4 rounded-lg border">
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
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Min Score</label>
          <select value={minScore} onChange={e => setMinScore(Number(e.target.value))}
            className="border rounded px-3 py-1.5 text-sm">
            <option value={50}>50</option>
            <option value={55}>55</option>
            <option value={60}>60</option>
            <option value={65}>65</option>
            <option value={70}>70</option>
          </select>
        </div>
        <button onClick={runTest} disabled={loading}
          className="bg-blue-600 text-white px-5 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Çalışıyor...' : 'Testi Çalıştır'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded text-sm">{error}</div>
      )}

      {result && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPICard title="Toplam Maç" value={result.totalMatches} />
            <KPICard title="ESKİ Sinyal" value={result.oldSystem.totalSignals}
              subtitle={result.oldSystem.correctSignals + ' doğru'} />
            <KPICard title="YENİ Sinyal" value={result.newSystem.totalSignals}
              subtitle={result.newSystem.correctSignals + ' doğru'} />
            <KPICard title="Fark" value={(result.improvement.signalCountDelta >= 0 ? '+' : '') + result.improvement.signalCountDelta}
              color={result.improvement.signalCountDelta <= 0 ? 'green' : 'yellow'} />
          </div>

          {/* Comparison Table */}
          <div className="bg-white rounded-lg border overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b font-semibold text-sm">Metrik Karşılaştırması</div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="py-2 px-3 text-left">Metrik</th>
                  <th className="py-2 px-3 text-right">Eski Sistem</th>
                  <th className="py-2 px-3 text-right">Yeni Sistem</th>
                  <th className="py-2 px-3 text-right">Değişim</th>
                </tr>
              </thead>
              <tbody>
                <MetricRow label="Precision (Kesinlik)" oldVal={result.oldSystem.precision * 100} newVal={result.newSystem.precision * 100} delta={result.improvement.precisionDelta} />
                <MetricRow label="Recall (Duyarlılık)" oldVal={result.oldSystem.recall * 100} newVal={result.newSystem.recall * 100} delta={result.improvement.recallDelta} />
                <MetricRow label="F1 Score" oldVal={result.oldSystem.f1Score * 100} newVal={result.newSystem.f1Score * 100} delta={result.improvement.f1Delta} />
                <MetricRow label="False Positive (Yanlış Alarm)" oldVal={result.oldSystem.falsePositives} newVal={result.newSystem.falsePositives} delta={-result.improvement.falsePositiveDelta} />
                <MetricRow label="Ort. Gol Süresi (dk)" oldVal={result.oldSystem.avgMinutesToGoal} newVal={result.newSystem.avgMinutesToGoal} delta={-(result.oldSystem.avgMinutesToGoal - result.newSystem.avgMinutesToGoal)} />
                <MetricRow label="Doğru Sinyal" oldVal={result.oldSystem.correctSignals} newVal={result.newSystem.correctSignals} delta={result.newSystem.correctSignals - result.oldSystem.correctSignals} />
                <MetricRow label="Yanlış Sinyal" oldVal={result.oldSystem.incorrectSignals} newVal={result.newSystem.incorrectSignals} delta={-(result.oldSystem.incorrectSignals - result.newSystem.incorrectSignals)} />
              </tbody>
            </table>
          </div>

          {/* Tier Distribution */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-lg border overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b font-semibold text-sm">ESKİ — Sinyal Seviye Dağılımı</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr><th className="py-2 px-3 text-left">Seviye</th><th className="py-2 px-3 text-right">Adet</th></tr>
                </thead>
                <tbody>
                  {Object.entries(result.oldSystem.signalsByTier).map(([tier, count]) => (
                    <tr key={tier} className="border-b border-gray-50">
                      <td className="py-2 px-3 text-sm">{tier}</td>
                      <td className="py-2 px-3 text-right text-sm">{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bg-white rounded-lg border overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b font-semibold text-sm">YENİ — Verdict Dağılımı</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr><th className="py-2 px-3 text-left">Tier</th><th className="py-2 px-3 text-right">Adet</th></tr>
                </thead>
                <tbody>
                  {Object.entries(result.newSystem.signalsByTier).map(([tier, count]) => (
                    <tr key={tier} className="border-b border-gray-50">
                      <td className="py-2 px-3 text-sm">{tier}</td>
                      <td className="py-2 px-3 text-right text-sm">{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Interpretation */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
            <strong>🔍 Yorum:</strong>
            <ul className="list-disc ml-5 mt-1 space-y-1">
              {result.improvement.precisionDelta > 0
                ? <li>✅ Precision arttı: daha az yanlış alarm — funnel + verdict çalışıyor</li>
                : <li>❌ Precision düştü: nedenini araştır</li>}
              {result.improvement.f1Delta > 0
                ? <li>✅ F1 arttı: genel performans iyileşti</li>
                : <li>❌ F1 düştü: sistem denge kaybetmiş olabilir</li>}
              {result.improvement.signalCountDelta <= 0
                ? <li>✅ Sinyal sayısı azaldı veya aynı: daha seçici sistem</li>
                : <li>⚠️ Sinyal sayısı arttı: daha fazla sinyal, daha fazla gürültü riski</li>}
              {result.oldSystem.avgMinutesToGoal > result.newSystem.avgMinutesToGoal
                ? <li>✅ Golden sinyale süre kısaldı: daha erken uyarı</li>
                : <li>ℹ️ Golden sinyale süre uzadı: daha geç uyarı</li>}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
