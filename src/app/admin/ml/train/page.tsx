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

interface TrainingDataset {
  id: string;
  createdAt: string;
  horizonMin: number;
  rowCount: number;
  brier: number | null;
  path: string;
  status: string;
}

interface PipelineRun {
  id: string;
  createdAt: string;
  completedAt: string | null;
  modelName: string;
  horizonMin: number;
  status: string;
  progressPct: number;
  step: string;
  newBrier: number | null;
  newAccuracy: number | null;
  isBetter: boolean | null;
  isPromoted: boolean | null;
  brierDelta: number | null;
  oldChampionBrier: number | null;
}

const MODEL_OPTIONS = [
  { value: 'gbdt', label: 'GBDT (Champion)', color: '#10b981', desc: 'Gradient Boosted Decision Trees' },
  { value: 'xgb', label: 'XGBoost', color: '#3b82f6', desc: 'Yüksek doğruluk potansiyeli' },
  { value: 'inplay', label: 'InPlay 5dk', color: '#8b5cf6', desc: 'Canlı maç 5dk gol modeli' },
];

export default function AdminMLTrainPage() {
  const [datasets, setDatasets] = useState<TrainingDataset[]>([]);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [modelName, setModelName] = useState('gbdt');
  const [horizonMin, setHorizonMin] = useState(5);
  const [datasetId, setDatasetId] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [loading, setLoading] = useState(false);
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [dsRes, runsRes] = await Promise.all([
        authFetch('/api/admin/ml/export').then(r => r.ok ? r.json() : null),
        authFetch('/api/admin/ml/pipeline').then(r => r.ok ? r.json() : null),
      ]);
      if (dsRes?.datasets) setDatasets(dsRes.datasets);
      if (runsRes?.runs) setRuns(runsRes.runs);
    } catch (e) {
      // Silent
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll active runs every 5s
  useEffect(() => {
    const interval = setInterval(() => {
      if (runs.some(r => ['pending', 'extracting', 'training', 'comparing'].includes(r.status))) {
        load();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [runs, load]);

  const startTraining = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const ds = datasets.find(d => d.id === datasetId);
      const body: any = {
        name: modelName,
        version,
        horizon_min: horizonMin,
      };
      if (ds) {
        body.dataset_id = ds.id;
        body.dataset_path = ds.path;
      }
      const res = await authFetch('/api/admin/ml/train', { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      if (data.ok) {
        setSuccess(`✓ Eğitim başlatıldı. Job ID: ${data.jobId || '—'}`);
        load();
      } else {
        setError(data.error || 'Eğitim başlatılamadı');
      }
    } catch (e) {
      setError('Bağlantı hatası');
    }
    setLoading(false);
  };

  const startPipeline = async () => {
    setPipelineLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await authFetch('/api/admin/ml/pipeline', {
        method: 'POST',
        body: JSON.stringify({ modelName, horizonMin }),
      });
      const data = await res.json();
      if (data.ok) {
        setSuccess(`✓ Pipeline başlatıldı. Run ID: ${data.runId}`);
        load();
      } else {
        setError(data.error || 'Pipeline başlatılamadı');
      }
    } catch (e) {
      setError('Bağlantı hatası');
    }
    setPipelineLoading(false);
  };

  const activeRuns = runs.filter(r => ['pending', 'extracting', 'training', 'comparing'].includes(r.status));
  const completedRuns = runs.filter(r => r.status === 'done' || r.status === 'failed').slice(0, 10);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-gray-800">🚀 ML Model Eğitimi</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Manuel eğitim tetikleme, pipeline izleme ve dataset seçimi
        </p>
      </div>

      {(error || success) && (
        <div className={`rounded-lg px-4 py-2.5 text-sm font-medium ${error ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
          {error || success}
        </div>
      )}

      {/* Eğitim formu */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h2 className="text-sm font-bold text-gray-800 mb-4">📦 Yeni Eğitim Başlat</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Model</label>
            <div className="space-y-2">
              {MODEL_OPTIONS.map(m => (
                <button key={m.value} type="button" onClick={() => setModelName(m.value)}
                  className={`w-full text-left p-2.5 rounded-lg border-2 transition-all ${
                    modelName === m.value ? 'border-indigo-400 bg-indigo-50/50' : 'border-gray-200 hover:border-gray-300'
                  }`}>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: m.color }} />
                    <span className="text-sm font-bold text-gray-800">{m.label}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Horizon (dk)</label>
              <div className="flex gap-1">
                {[5, 10, 15].map(h => (
                  <button key={h} type="button" onClick={() => setHorizonMin(h)}
                    className={`flex-1 py-2 text-sm font-bold rounded-lg border-2 transition-all ${
                      horizonMin === h ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}>
                    {h}dk
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Sürüm</label>
              <input type="text" value={version} onChange={e => setVersion(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none" />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Dataset</label>
              <select value={datasetId} onChange={e => setDatasetId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none">
                <option value="">En yeni dataset'i kullan</option>
                {datasets.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.horizonMin}dk · {d.rowCount.toLocaleString()} satır · {new Date(d.createdAt).toLocaleDateString('tr-TR')}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-gray-100 flex gap-2">
          <button onClick={startTraining} disabled={loading || pipelineLoading}
            className="flex-1 px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-bold rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? '⏳ Eğitim başlatılıyor...' : '🚀 Sadece Train Başlat'}
          </button>
          <button onClick={startPipeline} disabled={loading || pipelineLoading}
            className="flex-1 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-green-600 text-white text-sm font-bold rounded-lg hover:from-emerald-600 hover:to-green-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            {pipelineLoading ? '⏳ Pipeline çalışıyor...' : '🔄 Full Pipeline (Train + Compare + Promote)'}
          </button>
        </div>
      </div>

      {/* Aktif run'lar */}
      {activeRuns.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <h2 className="text-sm font-bold text-gray-800">Aktif Pipeline Run'ları ({activeRuns.length})</h2>
          </div>
          <div className="space-y-2">
            {activeRuns.map(r => (
              <div key={r.id} className="bg-amber-50/40 rounded-lg p-3 border border-amber-100">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-gray-700">{r.modelName}</span>
                    <span className="text-[10px] text-gray-500">·</span>
                    <span className="text-[10px] text-gray-500">{r.horizonMin}dk horizon</span>
                    <span className="text-[10px] text-gray-500">·</span>
                    <span className="text-[10px] text-gray-400 font-mono">{r.id.slice(-8)}</span>
                  </div>
                  <span className="text-[10px] font-bold text-amber-700">{r.progressPct}%</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-1.5">
                  <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-500" style={{ width: `${r.progressPct}%` }} />
                </div>
                <div className="text-[10px] text-gray-500">{r.step}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tamamlanan run'lar */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <h2 className="text-sm font-bold text-gray-800 mb-3">📋 Son Pipeline Run'ları</h2>
        {completedRuns.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">Henüz run yok</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th className="text-left py-2 px-2 font-semibold">Model</th>
                  <th className="text-center py-2 px-2 font-semibold">Horizon</th>
                  <th className="text-center py-2 px-2 font-semibold">Durum</th>
                  <th className="text-right py-2 px-2 font-semibold">Brier Δ</th>
                  <th className="text-right py-2 px-2 font-semibold">Accuracy</th>
                  <th className="text-center py-2 px-2 font-semibold">Promote</th>
                  <th className="text-right py-2 px-2 font-semibold">Tarih</th>
                </tr>
              </thead>
              <tbody>
                {completedRuns.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 px-2 font-mono font-bold text-gray-700">{r.modelName}</td>
                    <td className="py-2 px-2 text-center text-gray-600">{r.horizonMin}dk</td>
                    <td className="py-2 px-2 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        r.status === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {r.status === 'done' ? '✓ Done' : '✗ Failed'}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right font-mono">
                      {r.brierDelta != null ? (
                        <span className={r.brierDelta < 0 ? 'text-emerald-600 font-bold' : 'text-amber-600'}>
                          {r.brierDelta > 0 ? '+' : ''}{r.brierDelta.toFixed(4)}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-gray-700">
                      {r.newAccuracy != null ? `${(r.newAccuracy * 100).toFixed(1)}%` : '-'}
                    </td>
                    <td className="py-2 px-2 text-center">
                      {r.isPromoted ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold">⭐ Champion</span>
                      ) : r.isBetter === false ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">Shadow</span>
                      ) : '-'}
                    </td>
                    <td className="py-2 px-2 text-right text-gray-500 text-[10px]">
                      {new Date(r.createdAt).toLocaleString('tr-TR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
