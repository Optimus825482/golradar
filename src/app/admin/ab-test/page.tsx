'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';

interface SystemResult {
  label: string; totalSignals: number; correctSignals: number; incorrectSignals: number;
  falsePositives: number; truePositives: number;
  precision: number; recall: number; f1Score: number;
  avgMinutesToGoal: number; signalsByTier: Record<string, number>;
  config: { threshold: number; flags: Record<string, string> };
}

interface ABTestResult {
  ok: boolean; days: number; totalMatches: number;
  baseline: SystemResult; test: SystemResult;
  improvement: {
    precisionDelta: number; recallDelta: number; f1Delta: number;
    falsePositiveDelta: number; signalCountDelta: number;
  };
}

interface FlagState { key: string; effectiveValue: string; type: string; default: string; }

const FLAG_KEYS = ['PI_RATING', 'GLICKO2', 'GAP_RATING', 'ZISM_CORRECTOR'];
const FLAG_LABELS: Record<string, string> = {
  PI_RATING: 'Pi-Rating', GLICKO2: 'Glicko-2', GAP_RATING: 'Lite GAP', ZISM_CORRECTOR: 'ZISM Corrector',
};

function MetricRow({ label, baseline, test, delta, format: fmt }: {
  label: string; baseline: number; test: number; delta: number; format?: (v: number) => string;
}) {
  const f = fmt ?? ((v: number) => v != null ? Number(v).toFixed(1) : '—');
  const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
  const color = delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-500' : 'text-gray-400';
  return (
    <tr className="border-b border-gray-50">
      <td className="py-2 px-3 text-sm font-medium">{label}</td>
      <td className="py-2 px-3 text-right text-sm">{f(baseline)}</td>
      <td className="py-2 px-3 text-right text-sm">{f(test)}</td>
      <td className={`py-2 px-3 text-right text-sm font-bold ${color}`}>{arrow} {delta >= 0 ? '+' : ''}{f(Math.abs(delta))}</td>
    </tr>
  );
}

export default function ABTestPage() {
  const [flags, setFlags] = useState<FlagState[]>([]);
  const [days, setDays] = useState(30);
  const [baselineThreshold, setBaselineThreshold] = useState(60);
  const [testThreshold, setTestThreshold] = useState(65);
  const [baselineFlagOverrides, setBaselineFlagOverrides] = useState<Record<string, string>>({});
  const [testFlagOverrides, setTestFlagOverrides] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ABTestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load live flag states
  useEffect(() => {
    fetch('/api/admin/settings').then(r => r.json()).then(d => {
      if (d.flags) setFlags(d.flags.filter((f: FlagState) => FLAG_KEYS.includes(f.key)));
    }).catch(() => {});
  }, []);

  // Sync live flags → test config
  useEffect(() => {
    const overrides: Record<string, string> = {};
    for (const f of flags) {
      overrides[f.key] = f.effectiveValue;
    }
    setTestFlagOverrides(overrides);
  }, [flags]);

  const runTest = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const params = new URLSearchParams({
        days: String(days),
        baselineThreshold: String(baselineThreshold),
        testThreshold: String(testThreshold),
      });
      // Encode flag overrides
      const blFlags = Object.entries(baselineFlagOverrides).map(([k, v]) => `${k}=${v}`).join(',');
      const teFlags = Object.entries(testFlagOverrides).map(([k, v]) => `${k}=${v}`).join(',');
      if (blFlags) params.set('baselineFlags', blFlags);
      if (teFlags) params.set('testFlags', teFlags);

      const res = await fetch(`/api/admin/ab-test?${params}`);
      const data = await res.json();
      if (!data.ok) { setError(data.error ?? 'Test basarisiz'); return; }
      setResult(data);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const activeLiveFlags = flags.filter(f => f.effectiveValue === 'true').map(f => f.key);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-900">A/B Test: Flag Konfigurasyon Karsilastirmasi</h1>
      <p className="text-sm text-gray-500">
        Iki farkli feature flag konfigurasyonunu gecmis sinyaller uzerinde karsilastirir.
        BASELINE = referans, TEST = karsilastirilacak konfigurasyon.
      </p>

      {/* ── Live Flag Status ── */}
      <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-200 p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-bold text-indigo-700 uppercase tracking-wide">Anlik Canli Konfigurasyon</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {FLAG_KEYS.map(key => {
            const f = flags.find(ff => ff.key === key);
            if (!f) return null;
            const isActive = f.effectiveValue === 'true';
            return (
              <div key={key} className={`text-[11px] px-2.5 py-1 rounded-lg border font-medium ${
                isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-500 border-gray-200'
              }`}>
                {FLAG_LABELS[key]}: {isActive ? 'ACIK' : 'KAPALI'}
              </div>
            );
          })}
          <button onClick={() => fetch('/api/admin/settings').then(r => r.json()).then(d => {
            if (d.flags) setFlags(d.flags.filter((f: FlagState) => FLAG_KEYS.includes(f.key)));
          })} className="p-1 rounded hover:bg-white/50 text-gray-400">
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      {/* ── Config Panels ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* BASELINE */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <h2 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-gray-400" />
            BASELINE (Referans)
          </h2>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Threshold</label>
              <select value={baselineThreshold} onChange={e => setBaselineThreshold(Number(e.target.value))}
                className="w-full mt-1 border rounded px-2 py-1.5 text-sm">
                {[50, 55, 60, 65, 70].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Flag Override</div>
              <div className="space-y-1.5">
                {FLAG_KEYS.map(key => {
                  const val = baselineFlagOverrides[key];
                  return (
                    <div key={key} className="flex items-center justify-between text-xs">
                      <span className="text-gray-600">{FLAG_LABELS[key]}</span>
                      <select value={val ?? ''} onChange={e => {
                        const v = e.target.value;
                        setBaselineFlagOverrides(prev => {
                          const copy = { ...prev };
                          if (v === '' || v === 'default') delete copy[key];
                          else copy[key] = v;
                          return copy;
                        });
                      }}
                        className="border rounded px-1.5 py-0.5 text-[11px]">
                        <option value="">Varsayilan</option>
                        <option value="true">ACIK</option>
                        <option value="false">KAPALI</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* TEST */}
        <div className="bg-white rounded-xl border border-indigo-200 shadow-sm p-4 ring-1 ring-indigo-100">
          <h2 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
            TEST (Karsilastirma)
          </h2>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Threshold</label>
              <select value={testThreshold} onChange={e => setTestThreshold(Number(e.target.value))}
                className="w-full mt-1 border rounded px-2 py-1.5 text-sm">
                {[50, 55, 60, 65, 70].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Flag Override</div>
              <div className="space-y-1.5">
                {FLAG_KEYS.map(key => {
                  const val = testFlagOverrides[key];
                  const isLive = flags.find(f => f.key === key)?.effectiveValue;
                  return (
                    <div key={key} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1">
                        <span className="text-gray-600">{FLAG_LABELS[key]}</span>
                        {val === isLive ? null : val !== undefined && (
                          <span className="text-[9px] text-amber-500 font-medium">(override)</span>
                        )}
                      </div>
                      <select value={val ?? ''} onChange={e => {
                        const v = e.target.value;
                        setTestFlagOverrides(prev => {
                          const copy = { ...prev };
                          if (v === '' || v === 'default') delete copy[key];
                          else copy[key] = v;
                          return copy;
                        });
                      }}
                        className="border rounded px-1.5 py-0.5 text-[11px]">
                        <option value="">Anlik ({isLive === 'true' ? 'ACIK' : 'KAPALI'})</option>
                        <option value="true">ACIK</option>
                        <option value="false">KAPALI</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-gray-500">Periyot:</label>
          <div className="flex gap-1 bg-gray-100 p-0.5 rounded-lg">
            {[7, 30, 60, 90].map(d => (
              <button key={d} onClick={() => setDays(d)}
                className={`text-[11px] px-3 py-1.5 rounded-md font-semibold transition-all ${
                  days === d ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>{d}g</button>
            ))}
          </div>
        </div>
        <button onClick={runTest} disabled={loading}
          className="px-5 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-bold rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all disabled:opacity-50">
          {loading ? '⏳ Calisiyor...' : '🚀 Karsilastir'}
        </button>
      </div>

      {error && <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm"><AlertCircle className="size-4" /> {error}</div>}

      {result && (
        <>
          {/* Config summary */}
          <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-4 py-2.5 border flex items-center justify-between">
            <span>
              Baseline: threshold={result.baseline.config.threshold}
              {Object.keys(result.baseline.config.flags).length > 0 && ` · flag override: ${Object.entries(result.baseline.config.flags).map(([k, v]) => `${FLAG_LABELS[k]}=${v}`).join(', ')}`}
            </span>
            <span className="text-gray-300 mx-2">→</span>
            <span>
              Test: threshold={result.test.config.threshold}
              {Object.keys(result.test.config.flags).length > 0 && ` · ${Object.entries(result.test.config.flags).map(([k, v]) => `${FLAG_LABELS[k]}=${v}`).join(', ')}`}
            </span>
          </div>

          {/* KPI */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="text-xs text-gray-500 font-medium">Toplam Sinyal (DB)</div>
              <div className="text-2xl font-black text-gray-800">{result.totalMatches}</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="text-xs text-gray-500 font-medium">Baseline Sinyal</div>
              <div className="text-2xl font-black text-gray-800">{result.baseline.totalSignals}</div>
              <div className="text-[10px] text-gray-400">{result.baseline.correctSignals} dogru</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="text-xs text-gray-500 font-medium">Test Sinyal</div>
              <div className="text-2xl font-black text-indigo-600">{result.test.totalSignals}</div>
              <div className="text-[10px] text-gray-400">{result.test.correctSignals} dogru</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="text-xs text-gray-500 font-medium">Fark</div>
              <div className={`text-2xl font-black ${result.improvement.signalCountDelta <= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                {result.improvement.signalCountDelta >= 0 ? '+' : ''}{result.improvement.signalCountDelta}
              </div>
            </div>
          </div>

          {/* Comparison Table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b font-semibold text-sm">📊 Metrik Karsilastirmasi</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500 border-b">
                  <tr><th className="py-2 px-3 text-left">Metrik</th><th className="py-2 px-3 text-right">Baseline</th><th className="py-2 px-3 text-right">Test</th><th className="py-2 px-3 text-right">Degisim</th></tr>
                </thead>
                <tbody>
                  <MetricRow label="Precision" baseline={result.baseline.precision * 100} test={result.test.precision * 100} delta={result.improvement.precisionDelta} />
                  <MetricRow label="Recall" baseline={result.baseline.recall * 100} test={result.test.recall * 100} delta={result.improvement.recallDelta} />
                  <MetricRow label="F1 Score" baseline={result.baseline.f1Score * 100} test={result.test.f1Score * 100} delta={result.improvement.f1Delta} />
                  <MetricRow label="False Positive" baseline={result.baseline.falsePositives} test={result.test.falsePositives} delta={-result.improvement.falsePositiveDelta} />
                  <MetricRow label="Dogru Sinyal" baseline={result.baseline.correctSignals} test={result.test.correctSignals} delta={result.test.correctSignals - result.baseline.correctSignals} />
                  <MetricRow label="Sinyal Sayisi" baseline={result.baseline.totalSignals} test={result.test.totalSignals} delta={result.improvement.signalCountDelta} />
                  <MetricRow label="Ort. Gol Suresi (dk)" baseline={result.baseline.avgMinutesToGoal} test={result.test.avgMinutesToGoal} delta={-(result.baseline.avgMinutesToGoal - result.test.avgMinutesToGoal)} />
                </tbody>
              </table>
            </div>
          </div>

          {/* Tier distribution */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b font-semibold text-sm">Baseline — Seviye Dagitimi</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500"><tr><th className="py-2 px-3 text-left">Seviye</th><th className="py-2 px-3 text-right">Adet</th></tr></thead>
                <tbody>{Object.entries(result.baseline.signalsByTier).map(([tier, count]) => (
                  <tr key={tier} className="border-b border-gray-50"><td className="py-2 px-3 text-sm">{tier}</td><td className="py-2 px-3 text-right text-sm">{count}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b font-semibold text-sm">Test — Seviye Dagitimi</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500"><tr><th className="py-2 px-3 text-left">Seviye</th><th className="py-2 px-3 text-right">Adet</th></tr></thead>
                <tbody>{Object.entries(result.test.signalsByTier).map(([tier, count]) => (
                  <tr key={tier} className="border-b border-gray-50"><td className="py-2 px-3 text-sm">{tier}</td><td className="py-2 px-3 text-right text-sm">{count}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>

          {/* Interpretation */}
          <div className={`rounded-lg p-4 text-sm border ${
            result.improvement.f1Delta > 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}>
            <div className="flex items-center gap-2 mb-2">
              {result.improvement.f1Delta > 0 ? <CheckCircle2 className="size-5 text-emerald-500" /> : <AlertCircle className="size-5 text-amber-500" />}
              <strong>🔍 Karsilastirma Sonucu</strong>
            </div>
            <ul className="list-disc ml-5 space-y-1 text-sm">
              {result.improvement.f1Delta > 0
                ? <li>✅ Test konfigurasyonu <strong>F1 {result.improvement.f1Delta > 0 ? '+' : ''}{(result.improvement.f1Delta).toFixed(1)}%</strong> ile daha iyi</li>
                : <li>❌ Baseline daha iyi (F1 {Math.abs(result.improvement.f1Delta).toFixed(1)}% farkla)</li>}
              {result.improvement.precisionDelta > 0
                ? <li>✅ Precision {result.improvement.precisionDelta > 0 ? '+' : ''}{(result.improvement.precisionDelta).toFixed(1)}%: daha az yanlis alarm</li>
                : <li>❌ Precision {(result.improvement.precisionDelta).toFixed(1)}%: test daha fazla yanlis alarm uretiyor</li>}
              {result.improvement.signalCountDelta <= 0
                ? <li>✅ Sinyal sayisi {Math.abs(result.improvement.signalCountDelta)} azaldi: daha secici</li>
                : <li>⚠️ Sinyal sayisi +{result.improvement.signalCountDelta} artti: daha fazla gurultu riski</li>}
            </ul>
          </div>

          {/* Flag impact summary */}
          <div className="bg-gray-50 rounded-lg p-4 border text-xs text-gray-600 space-y-1">
            <strong>🔬 Bu Karsilastirmada Test Edilen:</strong>
            <div className="grid grid-cols-2 gap-1 mt-1">
              {FLAG_KEYS.map(key => {
                const bl = result.baseline.config.flags[key];
                const te = result.test.config.flags[key];
                const same = bl === te;
                return (
                  <div key={key} className={`px-2 py-1 rounded ${same ? 'text-gray-400' : 'text-indigo-600 font-medium'}`}>
                    {FLAG_LABELS[key]}: {bl ?? 'default'} → {te ?? 'default'}
                    {!same && <span className="text-[10px] text-amber-500 ml-1">(farkli)</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
