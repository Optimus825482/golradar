'use client';

import { useEffect, useState, useCallback } from 'react';
import { authFetch } from '@/lib/adminAuth';

interface Artifact {
  name: string;
  version: string;
  isChampion: boolean;
  metrics: Record<string, number>;
  trainedAt: string;
  sha256: string;
}

interface LevelDistribution { total: number; goals: number; correct: number }
interface SideAccuracy { home: number; away: number }

interface RawBacktestResult {
  selector: string; selectorKind: 'champion' | 'artifact';
  totalPredictions: number; resolvedPredictions: number;
  brierScore: number; logLoss: number; accuracy: number;
  auc?: number; calibrationError: number;
  precision: number; recall: number; f1Score: number; falsePositiveRate: number;
  sideAccuracy: SideAccuracy;
  levelDistribution: Record<'low' | 'medium' | 'high' | 'critical', LevelDistribution>;
  byDay: Array<{ date: string; total: number; goals: number; brier: number }>;
  computedAt: string; notes: string[]; side?: 'both' | 'home' | 'away';
}

const CHAMPION_MODELS = ['xgb', 'gbdt', 'inplay', 'lightgbm', 'gap', 'pi', 'glicko2'];

const fmt = (v: number | null | undefined, d = 4): string => v == null || !Number.isFinite(v) ? '—' : v.toFixed(d);
const fmtPct = (v: number | null | undefined, d = 2): string => v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(d)}%`;

const brierColor = (b: number | null | undefined): string => {
  if (b == null) return '#6b7280';
  if (b < 0.12) return '#059669'; if (b < 0.18) return '#10b981';
  if (b < 0.25) return '#22c55e'; if (b < 0.32) return '#f59e0b';
  if (b < 0.40) return '#f97316'; return '#ef4444';
};

const aucColor = (a: number | null | undefined): string => {
  if (a == null) return '#6b7280';
  if (a >= 0.90) return '#059669'; if (a >= 0.80) return '#10b981';
  if (a >= 0.70) return '#22c55e'; if (a >= 0.60) return '#f59e0b';
  return '#ef4444';
};

const accColor = (a: number | null | undefined): string => {
  if (a == null) return '#6b7280';
  if (a >= 0.85) return '#059669'; if (a >= 0.75) return '#10b981';
  if (a >= 0.65) return '#22c55e'; if (a >= 0.50) return '#f59e0b';
  return '#ef4444';
};

function MetricCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 bg-gradient-to-br from-gray-50 to-white">
      <div className="text-[10px] font-semibold text-gray-500 uppercase mb-1">{label}</div>
      <div className="text-xl font-black" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function AdminMLBacktestPage() {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [mode, setMode] = useState<'champion' | 'artifact'>('champion');
  const [selectedName, setSelectedName] = useState('gbdt');
  const [selectedVersion, setSelectedVersion] = useState('');
  const [days, setDays] = useState(14);
  const [side, setSide] = useState<'both' | 'home' | 'away'>('both');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Map<string, RawBacktestResult>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/admin/ml/model-backtest');
      if (res.ok) {
        const data = await res.json();
        setArtifacts((data.artifacts || []).map((a: any) => ({
          ...a, metrics: typeof a.metrics === 'string' ? JSON.parse(a.metrics) : (a.metrics || {}),
        })));
      }
    } catch { /* keep existing */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runAllBacktests = async () => {
    setRunning(true); setError(null); setResults(new Map());
    try {
      const newResults = new Map<string, RawBacktestResult>();
      await Promise.all(CHAMPION_MODELS.map(async (name) => {
        const res = await authFetch('/api/admin/ml/model-backtest', { method: 'POST', body: JSON.stringify({ mode: 'artifact', name, version: 'local-87feat-v1', days, side }) });
        const data = await res.json();
        if (data.ok && data.result) newResults.set(name, data.result as RawBacktestResult);
      }));
      setResults(newResults);
    } catch { setError('Backtest başarısız'); }
    setRunning(false);
  };

  const runSingleBacktest = async () => {
    setRunning(true); setError(null);
    try {
      const body: Record<string, unknown> = { mode, days, side };
      if (mode === 'artifact') { body.name = selectedName; body.version = selectedVersion || undefined; }
      const res = await authFetch('/api/admin/ml/model-backtest', { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      if (data.ok && data.result) { const m = new Map(); m.set('single', data.result); setResults(m); }
      else setError(data.error || 'Backtest başarısız');
    } catch { setError('Bağlantı hatası'); }
    setRunning(false);
  };

  const versionOptions = artifacts.filter(a => a.name === selectedName);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-gray-800">🔬 Model Backtest &amp; Karşılaştırma</h1>
        <p className="text-xs text-gray-500 mt-0.5">Tüm champion modelleri geçmiş veri üzerinde test et</p>
      </div>

      {error && <div className="rounded-lg px-4 py-2.5 bg-red-50 text-red-700 border border-red-200 text-sm">{error}</div>}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h2 className="text-sm font-bold text-gray-800 mb-4">⚙️ Backtest Konfigürasyonu</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold text-gray-600 mb-2 uppercase">Mod</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setMode('champion')} className={`p-3 rounded-lg border-2 text-left ${mode === 'champion' ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200'}`}>
                <div className="text-base mb-1">🏆</div>
                <div className="text-[12px] font-bold">Tüm Champions</div>
                <div className="text-[10px] text-gray-500">4 modeli paralel test et</div>
              </button>
              <button onClick={() => setMode('artifact')} className={`p-3 rounded-lg border-2 text-left ${mode === 'artifact' ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200'}`}>
                <div className="text-base mb-1">🔍</div>
                <div className="text-[12px] font-bold">Tek Artifact</div>
                <div className="text-[10px] text-gray-500">Belirli sürümü test et</div>
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {mode === 'artifact' && (
              <>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1 uppercase">Model</label>
                  <select value={selectedName} onChange={e => { setSelectedName(e.target.value); setSelectedVersion(''); }} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                    {CHAMPION_MODELS.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1 uppercase">Sürüm</label>
                  <select value={selectedVersion} onChange={e => setSelectedVersion(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                    <option value="">— Seçin —</option>
                    {versionOptions.map(a => (<option key={a.version} value={a.version}>v{a.version}{a.isChampion ? '⭐' : ''} AUC:{fmt(a.metrics?.auc, 3)}</option>))}
                  </select>
                </div>
              </>
            )}
            <div className="flex gap-2">
              <button onClick={() => setDays(7)} className={`px-3 py-2 text-sm font-bold rounded-lg border-2 ${days === 7 ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200'}`}>7g</button>
              <button onClick={() => setDays(14)} className={`px-3 py-2 text-sm font-bold rounded-lg border-2 ${days === 14 ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200'}`}>14g</button>
              <button onClick={() => setDays(30)} className={`px-3 py-2 text-sm font-bold rounded-lg border-2 ${days === 30 ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200'}`}>30g</button>
              <button onClick={() => setDays(90)} className={`px-3 py-2 text-sm font-bold rounded-lg border-2 ${days === 90 ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200'}`}>90g</button>
            </div>
            <div className="flex gap-2">
              {(['both', 'home', 'away'] as const).map(s => (<button key={s} onClick={() => setSide(s)} className={`px-3 py-2 text-sm font-bold rounded-lg border-2 ${side === s ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200'}`}>{s === 'both' ? 'Tümü' : s === 'home' ? 'Ev' : 'Dep'}</button>))}
            </div>
          </div>
        </div>
        <div className="mt-5 pt-4 border-t border-gray-100">
          {mode === 'champion' ? (
            <button onClick={runAllBacktests} disabled={running} className="px-5 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-bold rounded-lg hover:from-indigo-600 hover:to-purple-700 disabled:opacity-50">
              {running ? '⏳ Test ediliyor (4 model)...' : '🚀 Tüm Champions Test Et'}
            </button>
          ) : (
            <button onClick={runSingleBacktest} disabled={running} className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              {running ? '⏳' : '🔬 Backtest Başlat'}
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      {mode === 'champion' && results.size > 0 && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-sm font-bold text-gray-800 mb-4">🏆 Champion Karşılaştırması</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead><tr className="text-gray-500 border-b border-gray-200">
                  <th className="text-left py-2 font-semibold">Model</th>
                  <th className="text-right py-2 font-semibold">AUC</th>
                  <th className="text-right py-2 font-semibold">Brier</th>
                  <th className="text-right py-2 font-semibold">Doğruluk</th>
                  <th className="text-right py-2 font-semibold">Precision</th>
                  <th className="text-right py-2 font-semibold">Recall</th>
                  <th className="text-right py-2 font-semibold">F1</th>
                  <th className="text-right py-2 font-semibold">Örneklem</th>
                </tr></thead>
                <tbody>
                  {CHAMPION_MODELS.map(name => {
                    const r = results.get(name);
                    if (!r) return <tr key={name}><td colSpan={8} className="py-2 text-center text-gray-400 text-[11px]">⏳ {name} yükleniyor...</td></tr>;
                    return (<tr key={name} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 font-bold">{name}</td>
                      <td className="text-right font-bold" style={{ color: aucColor(r.auc ?? 0) }}>{fmt(r.auc ?? 0, 3)}</td>
                      <td className="text-right font-bold" style={{ color: brierColor(r.brierScore) }}>{fmt(r.brierScore)}</td>
                      <td className="text-right" style={{ color: accColor(r.accuracy) }}>{fmtPct(r.accuracy, 1)}</td>
                      <td className="text-right">{fmtPct(r.precision)}</td>
                      <td className="text-right" style={{ color: r.recall > 0.01 ? '#10b981' : '#ef4444' }}>{fmtPct(r.recall)}</td>
                      <td className="text-right">{fmt(r.f1Score)}</td>
                      <td className="text-right text-gray-500">{r.resolvedPredictions.toLocaleString('tr-TR')}</td>
                    </tr>);
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-sm font-bold text-gray-800 mb-4">🎯 AUC Roket Grafiği</h2>
            <div className="space-y-2">
              {CHAMPION_MODELS.map(name => {
                const r = results.get(name);
                if (!r || r.auc == null) return null;
                const auc = r.auc * 100;
                return (
                  <div key={name} className="flex items-center gap-3">
                    <span className="w-20 text-[12px] font-bold text-gray-700">{name}</span>
                    <div className="flex-1 bg-gray-100 rounded h-6 overflow-hidden relative">
                      <div className="h-full bg-gradient-to-r from-emerald-400 to-indigo-500 rounded" style={{ width: `${auc}%` }} />
                      <span className="absolute inset-0 flex items-center justify-end pr-2 text-[10px] font-bold text-white">{fmt(auc / 100, 3)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from(results.entries()).map(([name, r]) => (
              <div key={name} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-bold text-gray-800">{name.toUpperCase()}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold">local-87feat-v1</span>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <MetricCard label="AUC" value={fmt(r.auc ?? 0, 3)} color={aucColor(r.auc ?? 0)} />
                  <MetricCard label="Brier" value={fmt(r.brierScore)} color={brierColor(r.brierScore)} />
                  <MetricCard label="Doğruluk" value={fmtPct(r.accuracy, 1)} color={accColor(r.accuracy)} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px] mb-2">
                  <div><span className="text-gray-500">Precision:</span> <span className="font-bold ml-1">{fmtPct(r.precision)}</span></div>
                  <div><span className="text-gray-500">Recall:</span> <span className="font-bold ml-1" style={{ color: r.recall > 0.01 ? '#10b981' : '#ef4444' }}>{fmtPct(r.recall)}</span></div>
                  <div><span className="text-gray-500">F1:</span> <span className="font-bold ml-1">{fmt(r.f1Score)}</span></div>
                </div>
                <details className="text-[10px]">
                  <summary className="font-semibold text-gray-500 cursor-pointer">Sinyal Dağılımı</summary>
                  <div className="grid grid-cols-4 gap-1 mt-1">
                    {(['low', 'medium', 'high', 'critical'] as const).map(level => {
                      const d = r.levelDistribution?.[level];
                      if (!d || d.total === 0) return null;
                      return (<div key={level} className="rounded border border-gray-100 p-1.5 text-center">
                        <div className="font-bold">{level === 'critical' ? '🔴' : level === 'high' ? '🟠' : level === 'medium' ? '🟡' : '⚪'} {d.total}</div>
                        <div className="text-[9px] font-bold" style={{ color: accColor(d.correct / d.total) }}>{fmtPct(d.correct / d.total)}</div>
                      </div>);
                    })}
                  </div>
                </details>
                {r.notes?.length > 0 && (
                  <details className="mt-2 text-[10px]">
                    <summary className="font-semibold text-gray-500 cursor-pointer">Detaylar</summary>
                    <div className="text-[9px] font-mono text-gray-600 mt-1 space-y-0.5">{r.notes.map((n, i) => <div key={i}>{n}</div>)}</div>
                  </details>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {results.has('single') && (() => {
        const r = results.get('single')!;
        return (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-gray-800">📊 Backtest: {r.selector.replace(/^artifact:/, '')}</h2>
              <div className="text-[10px] text-gray-500">{r.byDay.length}g · {r.totalPredictions.toLocaleString('tr-TR')} örneklem</div>
            </div>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-4">
              <MetricCard label="Brier" value={fmt(r.brierScore)} color={brierColor(r.brierScore)} sub={r.brierScore < 0.18 ? '✓ iyi' : '⚠ yüksek'} />
              <MetricCard label="AUC" value={fmt(r.auc, 3)} color={aucColor(r.auc ?? 0)} sub={r.auc != null && r.auc > 0.6 ? '✓ iyi' : '⚠ zayıf'} />
              <MetricCard label="Doğruluk" value={fmtPct(r.accuracy)} color={accColor(r.accuracy)} />
              <MetricCard label="CalErr" value={fmt(r.calibrationError)} color="#8b5cf6" />
              <MetricCard label="Precision" value={fmtPct(r.precision)} color="#f79520" />
              <MetricCard label="Recall" value={fmtPct(r.recall)} color={r.recall > 0.01 ? '#10b981' : '#ec4899'} />
            </div>
          </div>
        );
      })()}
    </div>
  );
}