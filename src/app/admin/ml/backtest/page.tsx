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

interface ByDayEntry {
  date: string;
  total: number;
  goals: number;
  brier: number;
}

interface LevelDistribution {
  total: number;
  goals: number;
  correct: number;
}

interface SideAccuracy {
  home: number;
  away: number;
}

// Raw response from /api/admin/ml/model-backtest POST.
// Mirrors ModelBacktestResult in src/lib/ml/modelBacktest.ts.
interface RawBacktestResult {
  selector: string;
  selectorKind: 'champion' | 'artifact';
  totalPredictions: number;
  resolvedPredictions: number;
  brierScore: number;
  logLoss: number;
  accuracy: number;
  calibrationError: number;
  precision: number;
  recall: number;
  f1Score: number;
  falsePositiveRate: number;
  sideAccuracy: SideAccuracy;
  levelDistribution: Record<'low' | 'medium' | 'high' | 'critical', LevelDistribution>;
  byDay: ByDayEntry[];
  computedAt: string;
  notes: string[];
  // Optional: when artifact mode includes side filter
  side?: 'both' | 'home' | 'away';
}

interface RawCompareResult {
  champion: RawBacktestResult;
  candidate: RawBacktestResult;
  delta: {
    brier: number;
    logLoss: number;
    accuracy: number;
    sampleCount: number;
    winner: 'champion' | 'candidate' | 'tie';
  };
  computedAt: string;
}

const fmt = (v: number | null | undefined, digits = 4): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
};

const fmtPct = (v: number | null | undefined, digits = 2): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
};

const fmtSigned = (v: number | null | undefined, digits = 4): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}`;
};

const fmtSignedPct = (v: number | null | undefined, digits = 2): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${(v * 100).toFixed(digits)}%`;
};

const brierColor = (b: number | null | undefined): string => {
  if (b == null) return '#6b7280';
  if (b < 0.18) return '#10b981';
  if (b < 0.25) return '#22c55e';
  if (b < 0.32) return '#f59e0b';
  if (b < 0.40) return '#f97316';
  return '#ef4444';
};

const accuracyColor = (a: number | null | undefined): string => {
  if (a == null) return '#6b7280';
  if (a >= 0.80) return '#10b981';
  if (a >= 0.65) return '#22c55e';
  if (a >= 0.50) return '#f59e0b';
  return '#ef4444';
};

const winnerBadge = (w: 'champion' | 'candidate' | 'tie' | undefined): { label: string; cls: string } => {
  if (w === 'candidate') return { label: '✓ Candidate daha iyi — promote edilebilir', cls: 'bg-emerald-100 text-emerald-700' };
  if (w === 'champion') return { label: '⏳ Champion daha iyi', cls: 'bg-amber-100 text-amber-700' };
  return { label: '≈ Tie (anlamlı fark yok)', cls: 'bg-gray-100 text-gray-600' };
};

export default function AdminMLBacktestPage() {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [mode, setMode] = useState<'champion' | 'artifact'>('champion');
  const [selectedName, setSelectedName] = useState('gbdt');
  const [selectedVersion, setSelectedVersion] = useState('');
  const [days, setDays] = useState(14);
  const [side, setSide] = useState<'both' | 'home' | 'away'>('both');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RawBacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compareResult, setCompareResult] = useState<RawCompareResult | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/admin/ml/model-backtest');
      if (res.ok) {
        const data = await res.json();
        setArtifacts((data.artifacts || []).map((a: any) => ({
          ...a,
          metrics: typeof a.metrics === 'string' ? JSON.parse(a.metrics) : (a.metrics || {}),
        })));
      }
    } catch { /* keep existing data */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runBacktest = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    setCompareResult(null);
    try {
      const body: Record<string, unknown> = { mode, days, side };
      if (mode === 'artifact') {
        body.name = selectedName;
        body.version = selectedVersion || undefined;
      }
      const res = await authFetch('/api/admin/ml/model-backtest', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok && data.result) {
        setResult(data.result as RawBacktestResult);
      } else {
        setError(data.error || 'Backtest başarısız');
      }
    } catch {
      setError('Bağlantı hatası');
    }
    setRunning(false);
  };

  const runCompare = async () => {
    if (mode !== 'artifact' || !selectedVersion) {
      setError('Compare için artifact modunda ve sürüm seçili olmalı');
      return;
    }
    setRunning(true);
    setError(null);
    setCompareResult(null);
    try {
      const params = new URLSearchParams({
        name: selectedName,
        version: selectedVersion,
        days: String(days),
        side,
      });
      const res = await authFetch(`/api/admin/ml/compare?${params.toString()}`);
      const data = await res.json();
      if (data.ok && data.champion && data.candidate) {
        setCompareResult(data as RawCompareResult);
      } else {
        setError(data.error || 'Compare başarısız');
      }
    } catch {
      setError('Bağlantı hatası');
    }
    setRunning(false);
  };

  const versionOptions = artifacts.filter(a => a.name === selectedName);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-gray-800">🔬 Model Backtest &amp; Karşılaştırma</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Champion / Shadow modelleri geçmiş veri üzerinde test et, Brier delta hesapla
        </p>
      </div>

      {error && (
        <div className="rounded-lg px-4 py-2.5 bg-red-50 text-red-700 border border-red-200 text-sm">
          {error}
        </div>
      )}

      {/* Konfigürasyon */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h2 className="text-sm font-bold text-gray-800 mb-4">⚙️ Backtest Konfigürasyonu</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold text-gray-600 mb-2 uppercase tracking-wide">Mod</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMode('champion')}
                className={`p-3 rounded-lg border-2 text-left transition-all ${
                  mode === 'champion' ? 'border-indigo-400 bg-indigo-50/50' : 'border-gray-200 hover:border-gray-300'
                }`}>
                <div className="text-base mb-1">⭐</div>
                <div className="text-[12px] font-bold text-gray-800">Champion</div>
                <div className="text-[10px] text-gray-500">Aktif üretim modelini test et</div>
              </button>
              <button type="button" onClick={() => setMode('artifact')}
                className={`p-3 rounded-lg border-2 text-left transition-all ${
                  mode === 'artifact' ? 'border-indigo-400 bg-indigo-50/50' : 'border-gray-200 hover:border-gray-300'
                }`}>
                <div className="text-base mb-1">🔍</div>
                <div className="text-[12px] font-bold text-gray-800">Artifact</div>
                <div className="text-[10px] text-gray-500">Belirli bir sürümü test et</div>
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {mode === 'artifact' && (
              <>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Model</label>
                  <select value={selectedName} onChange={e => { setSelectedName(e.target.value); setSelectedVersion(''); }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                    {['gbdt', 'xgb', 'inplay'].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Sürüm</label>
                  <select value={selectedVersion} onChange={e => setSelectedVersion(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                    <option value="">— Seçin —</option>
                    {versionOptions.map(a => (
                      <option key={a.version} value={a.version}>
                        v{a.version} {a.isChampion ? '⭐ Champion' : '(Shadow)'}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Periyot (gün)</label>
              <div className="flex gap-1">
                {[7, 14, 30, 90].map(d => (
                  <button key={d} type="button" onClick={() => setDays(d)}
                    className={`flex-1 py-2 text-sm font-bold rounded-lg border-2 transition-all ${
                      days === d ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'
                    }`}>
                    {d}g
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Taraf</label>
              <div className="flex gap-1">
                {(['both', 'home', 'away'] as const).map(s => (
                  <button key={s} type="button" onClick={() => setSide(s)}
                    className={`flex-1 py-2 text-sm font-bold rounded-lg border-2 transition-all ${
                      side === s ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'
                    }`}>
                    {s === 'both' ? 'Tümü' : s === 'home' ? 'Ev' : 'Dep'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-gray-100 flex gap-2 flex-wrap">
          <button onClick={runBacktest} disabled={running}
            className="px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-bold rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all disabled:opacity-50">
            {running ? '⏳ Çalışıyor...' : '🔬 Backtest Başlat'}
          </button>
          {mode === 'artifact' && selectedVersion && (
            <button onClick={runCompare} disabled={running}
              className="px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-green-600 text-white text-sm font-bold rounded-lg hover:from-emerald-600 hover:to-green-700 transition-all disabled:opacity-50">
              {running ? '⏳' : '🆚 Champion ile Karşılaştır'}
            </button>
          )}
        </div>
      </div>

      {result && <BacktestResultCard result={result} />}
      {compareResult && <CompareResultCard compare={compareResult} />}
    </div>
  );
}

function MetricCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 bg-gradient-to-br from-gray-50 to-white">
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-xl font-black" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function BacktestResultCard({ result }: { result: RawBacktestResult }) {
  const isChampion = result.selectorKind === 'champion';
  const selectorLabel = isChampion
    ? 'Champion (tüm üretim modelleri)'
    : result.selector.replace(/^artifact:/, '');
  const sideLabel = result.side === 'both' || !result.side ? 'Tümü' : result.side === 'home' ? 'Ev' : 'Dep';

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-gray-800">
          📊 Backtest Sonucu · <span className="font-mono">{selectorLabel}</span>
          {isChampion && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold">⭐ Champion</span>}
        </h2>
        <div className="text-[10px] text-gray-500 text-right">
          <div>{result.byDay.length} gün · {result.totalPredictions.toLocaleString('tr-TR')} örneklem</div>
          <div>Taraf: {sideLabel}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4">
        <MetricCard label="Brier Score" value={fmt(result.brierScore)} color={brierColor(result.brierScore)}
          sub={brierColor(result.brierScore) === '#ef4444' ? '⚠ yüksek' : '✓ iyi'} />
        <MetricCard label="LogLoss" value={fmt(result.logLoss)} color="#3b82f6" />
        <MetricCard label="Accuracy" value={fmtPct(result.accuracy)} color={accuracyColor(result.accuracy)} />
        <MetricCard label="Calibration Err" value={fmt(result.calibrationError)} color="#8b5cf6" />
        <MetricCard label="Precision" value={fmtPct(result.precision)} color="#f79520" />
        <MetricCard label="Recall" value={fmtPct(result.recall)} color="#ec4899" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg border border-gray-200 p-3 bg-white">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Side Accuracy</div>
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <div>
              <div className="text-gray-500">Ev</div>
              <div className="font-bold text-gray-800">{fmtPct(result.sideAccuracy?.home, 1)}</div>
            </div>
            <div>
              <div className="text-gray-500">Dep</div>
              <div className="font-bold text-gray-800">{fmtPct(result.sideAccuracy?.away, 1)}</div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 p-3 bg-white">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Sınıflandırma</div>
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <div>
              <div className="text-gray-500">F1 Score</div>
              <div className="font-bold text-gray-800">{fmt(result.f1Score)}</div>
            </div>
            <div>
              <div className="text-gray-500">FP Rate</div>
              <div className="font-bold text-gray-800">{fmtPct(result.falsePositiveRate)}</div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 p-3 bg-white">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Çözülme</div>
          <div className="text-[12px] space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-500">Toplam</span>
              <span className="font-bold">{result.totalPredictions.toLocaleString('tr-TR')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Çözülmüş</span>
              <span className="font-bold">{result.resolvedPredictions.toLocaleString('tr-TR')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Çözülme %</span>
              <span className="font-bold">{fmtPct(result.totalPredictions > 0 ? result.resolvedPredictions / result.totalPredictions : 0)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Level distribution */}
      <div className="rounded-lg border border-gray-200 p-3 bg-white mb-4">
        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Signal Level Dağılımı</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-gray-500 border-b border-gray-100">
                <th className="text-left py-1.5 font-semibold">Seviye</th>
                <th className="text-right py-1.5 font-semibold">Toplam</th>
                <th className="text-right py-1.5 font-semibold">Gol</th>
                <th className="text-right py-1.5 font-semibold">Doğru</th>
                <th className="text-right py-1.5 font-semibold">Gol Oranı</th>
                <th className="text-right py-1.5 font-semibold">Doğruluk</th>
              </tr>
            </thead>
            <tbody>
              {(['low', 'medium', 'high', 'critical'] as const).map(level => {
                const d = result.levelDistribution?.[level];
                if (!d) return null;
                const goalRate = d.total > 0 ? d.goals / d.total : 0;
                const correctRate = d.total > 0 ? d.correct / d.total : 0;
                return (
                  <tr key={level} className="border-b border-gray-50">
                    <td className="py-1.5 capitalize">{level}</td>
                    <td className="text-right">{d.total.toLocaleString('tr-TR')}</td>
                    <td className="text-right">{d.goals.toLocaleString('tr-TR')}</td>
                    <td className="text-right">{d.correct.toLocaleString('tr-TR')}</td>
                    <td className="text-right">{fmtPct(goalRate)}</td>
                    <td className="text-right font-bold" style={{ color: accuracyColor(correctRate) }}>{fmtPct(correctRate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* By day */}
      {result.byDay.length > 0 && (
        <div className="rounded-lg border border-gray-200 p-3 bg-white mb-4">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Gün Bazında Brier</div>
          <div className="space-y-1">
            {result.byDay.map(d => (
              <div key={d.date} className="flex items-center gap-2 text-[11px]">
                <span className="w-24 text-gray-600 font-mono">{d.date}</span>
                <div className="flex-1 bg-gray-100 rounded h-3 overflow-hidden">
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${Math.min(100, (d.brier / 0.5) * 100)}%`,
                      backgroundColor: brierColor(d.brier),
                    }}
                  />
                </div>
                <span className="w-16 text-right font-mono font-bold" style={{ color: brierColor(d.brier) }}>
                  {fmt(d.brier)}
                </span>
                <span className="w-20 text-right text-gray-500">{d.total} / {d.goals}g</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.notes && result.notes.length > 0 && (
        <details className="mt-3">
          <summary className="text-[11px] font-semibold text-gray-600 cursor-pointer">Notlar &amp; ham veri</summary>
          <div className="mt-2 bg-gray-50 rounded p-3 text-[10px] font-mono space-y-1">
            {result.notes.map((n, i) => <div key={i} className="text-gray-700">{n}</div>)}
            <div className="text-gray-500 pt-1 border-t border-gray-200">computedAt: {result.computedAt}</div>
          </div>
        </details>
      )}
    </div>
  );
}

function CompareResultCard({ compare }: { compare: RawCompareResult }) {
  const { champion, candidate, delta } = compare;
  const verdict = winnerBadge(delta.winner);
  // Brier düşük = iyi olduğu için delta'da ters renk
  const brierBetter = delta.brier < 0; // candidate < champion
  const accBetter = delta.accuracy > 0; // candidate > champion
  const logBetter = delta.logLoss < 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-gray-800">🆚 Karşılaştırma Sonucu</h2>
        <span className="text-[10px] text-gray-500">{delta.sampleCount.toLocaleString('tr-TR')} örneklem</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <CompareSide title="⭐ Champion" sub={champion.selector} result={champion} highlight="left" />
        <CompareSide title="🔍 Candidate" sub={candidate.selector} result={candidate} highlight="right" />

        <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-lg border-2 border-indigo-300 p-4">
          <div className="text-[10px] font-semibold text-indigo-600 uppercase tracking-wide mb-3">Delta (Candidate − Champion)</div>
          <div className="text-[12px] font-mono space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">brier</span>
              <span className={`font-bold text-base ${brierBetter ? 'text-emerald-600' : delta.brier > 0 ? 'text-red-500' : 'text-gray-600'}`}>
                {fmtSigned(delta.brier)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">logLoss</span>
              <span className={`font-bold ${logBetter ? 'text-emerald-600' : delta.logLoss > 0 ? 'text-red-500' : 'text-gray-600'}`}>
                {fmtSigned(delta.logLoss)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">accuracy</span>
              <span className={`font-bold ${accBetter ? 'text-emerald-600' : delta.accuracy < 0 ? 'text-red-500' : 'text-gray-600'}`}>
                {fmtSignedPct(delta.accuracy)}
              </span>
            </div>
          </div>
          <div className={`mt-3 px-3 py-2 rounded text-[11px] font-bold text-center ${verdict.cls}`}>
            {verdict.label}
          </div>
          <div className="mt-2 text-[10px] text-gray-500 italic">
            Brier/LogLoss düşük = iyi. Accuracy yüksek = iyi.
          </div>
        </div>
      </div>
    </div>
  );
}

function CompareSide({ title, sub, result }: { title: string; sub: string; result: RawBacktestResult; highlight: 'left' | 'right' }) {
  return (
    <div className="rounded-lg border-2 border-gray-200 p-4 bg-white">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[11px] font-semibold text-gray-700">{title}</div>
        <div className="text-[10px] text-gray-400 font-mono">{sub.replace(/^artifact:/, '')}</div>
      </div>
      <div className="space-y-1.5 text-[12px]">
        <CompareRow label="Brier" value={fmt(result.brierScore)} color={brierColor(result.brierScore)} />
        <CompareRow label="LogLoss" value={fmt(result.logLoss)} color="#3b82f6" />
        <CompareRow label="Accuracy" value={fmtPct(result.accuracy, 1)} color={accuracyColor(result.accuracy)} />
        <CompareRow label="Cal Err" value={fmt(result.calibrationError)} color="#8b5cf6" />
        <CompareRow label="Precision" value={fmtPct(result.precision)} color="#f79520" />
        <CompareRow label="Recall" value={fmtPct(result.recall)} color="#ec4899" />
        <CompareRow label="Örneklem" value={result.totalPredictions.toLocaleString('tr-TR')} color="#6b7280" />
      </div>
    </div>
  );
}

function CompareRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-500">{label}</span>
      <span className="font-bold text-sm font-mono" style={{ color }}>{value}</span>
    </div>
  );
}