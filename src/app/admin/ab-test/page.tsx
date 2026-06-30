'use client';

import { useEffect, useState } from 'react';
import { KPICard } from '@/lib/adminAuth';
import { RefreshCw } from 'lucide-react';

interface SystemResult {
  totalSignals: number; correctSignals: number; incorrectSignals: number;
  falsePositives: number; truePositives: number;
  precision: number; recall: number; f1Score: number;
  avgMinutesToGoal: number; signalsByTier: Record<string, number>;
}

interface ABTestResult {
  ok: boolean; config: { daysBack: number; minScore: number };
  totalMatches: number; oldSystem: SystemResult; newSystem: SystemResult;
  improvement: {
    precisionDelta: number; recallDelta: number; f1Delta: number;
    falsePositiveDelta: number; signalCountDelta: number;
  };
}

interface FlagState { key: string; label: string; effectiveValue: string; type: string; default: string; overridden: boolean; group: string; }

function MetricRow({ label, oldVal, newVal, delta, format: fmt }: { label: string; oldVal: number; newVal: number; delta: number; format?: (v: number) => string }) {
  const f = fmt ?? ((v: any) => v != null ? Number(v).toFixed(1) : '—');
  const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
  const color = delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-500' : 'text-gray-400';
  return (
    <tr className="border-b border-gray-100">
      <td className="py-2 px-3 font-medium text-sm">{label}</td>
      <td className="py-2 px-3 text-right text-sm">{f(oldVal)}</td>
      <td className="py-2 px-3 text-right text-sm">{f(newVal)}</td>
      <td className={`py-2 px-3 text-right text-sm font-bold ${color}`}>{arrow} {delta >= 0 ? '+' : ''}{f(delta)}</td>
    </tr>
  );
}

const TOGGLE_FLAGS = ['PI_RATING', 'GLICKO2', 'GAP_RATING', 'ZISM_CORRECTOR', 'ENABLE_ONLINE_ADJUSTMENTS', 'BACKTEST_PERSIST_JSON'];
const NUM_FLAGS = ['STACKING_BLEND_ALPHA', 'SKOR_KAPPA', 'ZISM_BETA'];

export default function ABTestPage() {
  const [days, setDays] = useState(30);
  const [minScore, setMinScore] = useState(60);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ABTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flags, setFlags] = useState<FlagState[]>([]);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/settings').then(r => r.json()).then(d => {
      if (d.flags) setFlags(d.flags.filter((f: FlagState) => [...TOGGLE_FLAGS, ...NUM_FLAGS].includes(f.key)));
    }).catch(() => {});
  }, []);

  const toggle = async (key: string, val: string) => {
    setSaving(key);
    await fetch('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value: val }) });
    const r = await fetch('/api/admin/settings'); const d = await r.json();
    if (d.flags) setFlags(d.flags.filter((f: FlagState) => [...TOGGLE_FLAGS, ...NUM_FLAGS].includes(f.key)));
    setSaving(null);
  };

  async function runTest() {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch(`/api/admin/ab-test?days=${days}&minScore=${minScore}`);
      const data = await res.json();
      if (!data.ok) { setError(data.error ?? 'Test failed'); return; }
      setResult(data);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  // Determine which toggle flags are ACIK
  const activeFlags = flags.filter(f => f.type === 'toggle' && f.effectiveValue === 'true').map(f => f.key);
  const stackingVal = flags.find(f => f.key === 'STACKING_BLEND_ALPHA')?.effectiveValue ?? '0.5';

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">A/B Test: Feature Flag Karsilastirmasi</h1>
      <p className="text-sm text-gray-500">
        Feature flag'leri degistirerek sinyal sistemi uzerindeki etkilerini karsilastirin.
        "Eski Sistem" = threshold-only. "Yeni Sistem" = aktif flag'ler ile.
      </p>

      {/* ── Feature Flag Config ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-800">🧪 Test Edilecek Ozellikler</h2>
          <button onClick={() => fetch('/api/admin/settings').then(r => r.json()).then(d => {
            if (d.flags) setFlags(d.flags.filter((f: FlagState) => [...TOGGLE_FLAGS, ...NUM_FLAGS].includes(f.key)));
          })} className="p-1 rounded hover:bg-gray-100 text-gray-400"><RefreshCw className="size-3.5" /></button>
        </div>
        <div className="flex flex-wrap gap-2">
          {flags.filter(f => f.type === 'toggle').map(f => (
            <div key={f.key} className="flex items-center gap-1.5 bg-gray-50 rounded-lg px-2.5 py-1.5 border border-gray-200 text-xs">
              <span className="text-gray-500 font-mono text-[10px]">{f.key}</span>
              <button
                disabled={saving === f.key}
                onClick={() => toggle(f.key, f.effectiveValue === 'true' ? 'false' : 'true')}
                className={`relative w-8 h-4 rounded-full transition-colors ${f.effectiveValue === 'true' ? 'bg-indigo-500' : 'bg-gray-300'} ${saving === f.key ? 'opacity-50' : ''}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${f.effectiveValue === 'true' ? 'translate-x-4' : ''}`} />
              </button>
              <span className={`text-[10px] font-medium ${f.effectiveValue === 'true' ? 'text-emerald-600' : 'text-gray-400'}`}>
                {f.effectiveValue === 'true' ? 'ACIK' : 'KAPALI'}
              </span>
            </div>
          ))}
          {flags.filter(f => f.type === 'number').map(f => (
            <div key={f.key} className="flex items-center gap-1 bg-gray-50 rounded-lg px-2.5 py-1.5 border border-gray-200 text-xs">
              <span className="text-gray-500 font-mono text-[10px]">{f.key}</span>
              <span className="font-mono font-bold text-indigo-600">{f.effectiveValue}</span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 mt-2">Toggle'lari degistirerek ozellikleri ac/kapat. A/B testi aktif flag konfigurasyonu ile calisir.</p>
      </div>

      {/* ── Controls ── */}
      <div className="flex flex-wrap gap-4 items-end bg-white p-4 rounded-lg border">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Gun araligi</label>
          <select value={days} onChange={e => setDays(Number(e.target.value))} className="border rounded px-3 py-1.5 text-sm">
            <option value={7}>7 gun</option><option value={30}>30 gun</option><option value={60}>60 gun</option><option value={90}>90 gun</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Min Score</label>
          <select value={minScore} onChange={e => setMinScore(Number(e.target.value))} className="border rounded px-3 py-1.5 text-sm">
            <option value={50}>50</option><option value={55}>55</option><option value={60}>60</option><option value={65}>65</option><option value={70}>70</option>
          </select>
        </div>
        <button onClick={runTest} disabled={loading}
          className="bg-indigo-600 text-white px-5 py-1.5 rounded text-sm hover:bg-indigo-700 disabled:opacity-50">
          {loading ? 'Calisiyor...' : '🚀 Testi Calistir'}
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded text-sm">{error}</div>}

      {result && (
        <>
          {/* Active config summary */}
          <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-4 py-2 border">
            Test konfigurasyonu: <strong>{activeFlags.length}</strong> ozellik aktif · Stacking α={stackingVal} · Threshold={minScore}
            {activeFlags.length > 0 && <span> · {activeFlags.join(', ')}</span>}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPICard label="Toplam Mac" value={String(result.totalMatches)} color="#6366f1" />
            <KPICard label="ESKI Sinyal" value={String(result.oldSystem.totalSignals)} sub={result.oldSystem.correctSignals + ' dogru'} color="#f79520" />
            <KPICard label="YENI Sinyal" value={String(result.newSystem.totalSignals)} sub={result.newSystem.correctSignals + ' dogru'} color="#10b981" />
            <KPICard label="Fark" value={(result.improvement.signalCountDelta >= 0 ? '+' : '') + result.improvement.signalCountDelta} color={result.improvement.signalCountDelta <= 0 ? '#10b981' : '#f79520'} />
          </div>

          <div className="bg-white rounded-lg border overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b font-semibold text-sm">Metrik Karsilastirmasi</div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr><th className="py-2 px-3 text-left">Metrik</th><th className="py-2 px-3 text-right">Threshold Only</th><th className="py-2 px-3 text-right">Aktif Flagler</th><th className="py-2 px-3 text-right">Degisim</th></tr>
              </thead>
              <tbody>
                <MetricRow label="Precision" oldVal={result.oldSystem.precision * 100} newVal={result.newSystem.precision * 100} delta={result.improvement.precisionDelta} />
                <MetricRow label="Recall" oldVal={result.oldSystem.recall * 100} newVal={result.newSystem.recall * 100} delta={result.improvement.recallDelta} />
                <MetricRow label="F1 Score" oldVal={result.oldSystem.f1Score * 100} newVal={result.newSystem.f1Score * 100} delta={result.improvement.f1Delta} />
                <MetricRow label="False Positive" oldVal={result.oldSystem.falsePositives} newVal={result.newSystem.falsePositives} delta={-result.improvement.falsePositiveDelta} />
                <MetricRow label="Dogru Sinyal" oldVal={result.oldSystem.correctSignals} newVal={result.newSystem.correctSignals} delta={result.newSystem.correctSignals - result.oldSystem.correctSignals} />
                <MetricRow label="Yanlis Sinyal" oldVal={result.oldSystem.incorrectSignals} newVal={result.newSystem.incorrectSignals} delta={-(result.oldSystem.incorrectSignals - result.newSystem.incorrectSignals)} />
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-lg border overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b font-semibold text-sm">Threshold Only — Seviye Dagitimi</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500"><tr><th className="py-2 px-3 text-left">Seviye</th><th className="py-2 px-3 text-right">Adet</th></tr></thead>
                <tbody>{Object.entries(result.oldSystem.signalsByTier).map(([tier, count]) => (
                  <tr key={tier} className="border-b border-gray-50"><td className="py-2 px-3 text-sm">{tier}</td><td className="py-2 px-3 text-right text-sm">{count}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div className="bg-white rounded-lg border overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b font-semibold text-sm">Aktif Flagler — Seviye Dagitimi</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500"><tr><th className="py-2 px-3 text-left">Seviye</th><th className="py-2 px-3 text-right">Adet</th></tr></thead>
                <tbody>{Object.entries(result.newSystem.signalsByTier).map(([tier, count]) => (
                  <tr key={tier} className="border-b border-gray-50"><td className="py-2 px-3 text-sm">{tier}</td><td className="py-2 px-3 text-right text-sm">{count}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>

          {/* Active features list */}
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 text-sm text-indigo-800 space-y-1">
            <strong>🔬 Bu Testte Aktif Ozellikler:</strong>
            {activeFlags.length === 0 ? <p>Threshold-only mod (hicbir ozellik aktif degil)</p> : (
              <ul className="list-disc ml-5 text-xs space-y-0.5">
                {activeFlags.includes('PI_RATING') && <li>✅ Pi-Rating — Constantinou 4-rating sistemi</li>}
                {activeFlags.includes('GLICKO2') && <li>✅ Glicko-2 — RD+σ volatility rating</li>}
                {activeFlags.includes('GAP_RATING') && <li>✅ Lite GAP — Generalized Attacking Performance (singleton state)</li>}
                {activeFlags.includes('ZISM_CORRECTOR') && <li>✅ ZISM Corrector — Frank's Copula κ={flags.find(f=>f.key==='SKOR_KAPPA')?.effectiveValue ?? '-0.30'} (BTTS duzeltmesi)</li>}
                {activeFlags.includes('ENABLE_ONLINE_ADJUSTMENTS') && <li>✅ Online Weight Drift — rolling 500-window rebalance</li>}
                {stackingVal !== '0' && <li>✅ Stacking α-Blend — α={stackingVal} (Brier -%23.6)</li>}
              </ul>
            )}
          </div>

          {/* Interpretation */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
            <strong>🔍 Yorum:</strong>
            <ul className="list-disc ml-5 mt-1 space-y-1">
              {result.improvement.precisionDelta > 0 ? <li>✅ Precision artti: aktif flag'ler daha az yanlis alarm uretiyor</li> : <li>❌ Precision dustu: flag'ler yanlis alarmi artiriyor</li>}
              {result.improvement.f1Delta > 0 ? <li>✅ F1 artti: genel performans iyilesti</li> : <li>❌ F1 dustu: denge kaybi var</li>}
              {result.improvement.signalCountDelta <= 0 ? <li>✅ Sinyal sayisi azaldi veya ayni: daha secici</li> : <li>⚠️ Sinyal sayisi artti: daha fazla gurultu riski</li>}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
