'use client';

import { useEffect, useState, useCallback } from 'react';

function authFetch(path: string, init?: RequestInit) {
  const token = sessionStorage.getItem('admin_token');
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
}

interface Artifact {
  name: string;
  version: string;
  isChampion: boolean;
  metrics: Record<string, number>;
  trainedAt: string;
  sha256: string;
}

interface BacktestResult {
  name: string;
  version: string;
  isChampion: boolean;
  metrics: Record<string, number>;
  sampleCount: number;
  windowDays: number;
}

export default function AdminMLBacktestPage() {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [mode, setMode] = useState<'champion' | 'artifact'>('champion');
  const [selectedName, setSelectedName] = useState('gbdt');
  const [selectedVersion, setSelectedVersion] = useState('');
  const [days, setDays] = useState(14);
  const [side, setSide] = useState<'both' | 'home' | 'away'>('both');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compareResult, setCompareResult] = useState<any>(null);

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
    } catch (e) { /* silent */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runBacktest = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const body: any = { mode, days };
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
        setResult({
          ...data.result,
          metrics: typeof data.result.metrics === 'string' ? JSON.parse(data.result.metrics) : (data.result.metrics || {}),
        });
      } else {
        setError(data.error || 'Backtest başarısız');
      }
    } catch (e) {
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
      if (data.ok) {
        setCompareResult(data);
      } else {
        setError(data.error || 'Compare başarısız');
      }
    } catch (e) {
      setError('Bağlantı hatası');
    }
    setRunning(false);
  };

  const versionOptions = artifacts.filter(a => a.name === selectedName);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-gray-800">🔬 Model Backtest & Karşılaştırma</h1>
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

      {/* Backtest Result */}
      {result && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-800">
              📊 Backtest Sonucu · {result.name} v{result.version}
              {result.isChampion && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold">⭐ Champion</span>}
            </h2>
            <span className="text-[10px] text-gray-500">
              {result.windowDays} gün · {result.sampleCount} örneklem
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard label="Brier Score" value={(result.metrics.brier ?? 0).toFixed(4)}
              color={result.metrics.brier < 0.2 ? '#10b981' : result.metrics.brier < 0.3 ? '#f59e0b' : '#ef4444'} />
            <MetricCard label="LogLoss" value={(result.metrics.logLoss ?? result.metrics.log_loss ?? 0).toFixed(4)} color="#3b82f6" />
            <MetricCard label="Accuracy" value={`${((result.metrics.accuracy ?? 0) * 100).toFixed(2)}%`} color="#8b5cf6" />
            <MetricCard label="Precision" value={`${((result.metrics.precision ?? 0) * 100).toFixed(2)}%`} color="#f79520" />
          </div>

          {Object.keys(result.metrics).length > 4 && (
            <details className="mt-4">
              <summary className="text-[11px] font-semibold text-gray-600 cursor-pointer">Tüm metrikleri göster</summary>
              <div className="mt-2 bg-gray-50 rounded p-3 text-[10px] font-mono">
                {Object.entries(result.metrics).map(([k, v]) => (
                  <div key={k} className="flex justify-between py-0.5">
                    <span className="text-gray-600">{k}</span>
                    <span className="text-gray-800">{typeof v === 'number' ? v.toFixed(4) : String(v)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Compare Result */}
      {compareResult && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-sm font-bold text-gray-800 mb-3">🆚 Karşılaştırma Sonucu</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <CompareCard title="⭐ Champion" metrics={compareResult.champion?.metrics || {}} />
            <CompareCard title="🔍 Candidate" metrics={compareResult.candidate?.metrics || {}} />
            <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-lg border-2 border-indigo-300 p-4">
              <div className="text-[10px] font-semibold text-indigo-600 uppercase tracking-wide mb-2">Delta (Candidate − Champion)</div>
              <div className="text-[11px] font-mono space-y-1">
                {compareResult.delta && Object.entries(compareResult.delta).map(([k, v]: [string, any]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-gray-600">{k}</span>
                    <span className={typeof v === 'number' && v < 0 ? 'text-emerald-600 font-bold' : 'text-amber-600 font-bold'}>
                      {typeof v === 'number' ? (v > 0 ? '+' : '') + v.toFixed(4) : String(v)}
                    </span>
                  </div>
                ))}
              </div>
              {compareResult.verdict && (
                <div className={`mt-3 px-3 py-2 rounded text-[11px] font-bold text-center ${
                  compareResult.verdict === 'better' || compareResult.verdict === 'promote'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-100 text-amber-700'
                }`}>
                  {compareResult.verdict === 'better' || compareResult.verdict === 'promote' ? '✓ Candidate daha iyi — promote edilebilir' : '⏳ Candidate yeterli değil'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 bg-gradient-to-br from-gray-50 to-white">
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-lg font-black" style={{ color }}>{value}</div>
    </div>
  );
}

function CompareCard({ title, metrics }: { title: string; metrics: Record<string, any> }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4 bg-white">
      <div className="text-[11px] font-semibold text-gray-700 mb-2">{title}</div>
      <div className="text-[11px] font-mono space-y-1">
        {Object.entries(metrics).filter(([k]) => ['brier', 'logLoss', 'log_loss', 'accuracy', 'precision'].includes(k)).map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <span className="text-gray-500">{k}</span>
            <span className="text-gray-800 font-bold">{typeof v === 'number' ? v.toFixed(4) : String(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
