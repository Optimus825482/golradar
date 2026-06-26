'use client';

import { useEffect, useState, useCallback } from 'react';
import { fmtNum } from '@/lib/safeFormat';
import { authFetch } from '@/lib/adminAuth';

interface TrainingDataset {
  id: string;
  horizon: number;
  date: string;
  path: string;
  sizeBytes: number;
  rowCount: number;
  status: string;
  createdAt: string;
  errorMsg: string | null;
}

interface ArtifactInfo {
  name: string;
  version: string;
  isChampion: boolean;
  metrics: Record<string, number>;
  createdAt: string;
  bytes: number | null;
}

const MODEL_OPTIONS = [
  { value: 'gbdt', label: 'GBDT (Champion)', color: '#10b981', desc: 'Gradient Boosted Decision Trees' },
  { value: 'xgb', label: 'XGBoost', color: '#3b82f6', desc: 'Yüksek doğruluk potansiyeli' },
  { value: 'inplay', label: 'InPlay 5dk', color: '#8b5cf6', desc: 'Canlı maç 5dk gol modeli' },
];

function nextVersion(artifacts: ArtifactInfo[]): string {
  const versions = artifacts
    .map(a => a.version.replace(/^v/, '').split('.').map(Number))
    .filter(v => v.length === 3 && v.every(n => !isNaN(n)))
    .sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2]);
  if (versions.length === 0) return '1.0.0';
  const [major, minor, patch] = versions[0];
  return `${major}.${minor}.${patch + 1}`;
}

export default function AdminMLTrainPage() {
  const [datasets, setDatasets] = useState<TrainingDataset[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactInfo[]>([]);
  const [modelName, setModelName] = useState('gbdt');
  const [horizonMin, setHorizonMin] = useState(5);
  const [datasetId, setDatasetId] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [loading, setLoading] = useState(false);
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [cleanupMsg, setCleanupMsg] = useState<string | null>(null);

  // ── Takım Gücü (Kalman) state ──
  const [tsStartDate, setTsStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 365);
    return d.toISOString().slice(0, 10);
  });
  const [tsEndDate, setTsEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [tsMinMatches, setTsMinMatches] = useState(3);
  const [tsPromote, setTsPromote] = useState(true);
  const [tsLoading, setTsLoading] = useState(false);
  const [tsCheck, setTsCheck] = useState<{
    ready: boolean;
    totalMatches: number;
    perSource: Record<string, number>;
    teamsWithMinMatches: number;
    teamsTotal: number;
    minMatches: number;
  } | null>(null);
  const [tsChecking, setTsChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      const [dsRes, artRes, runRes] = await Promise.all([
        authFetch('/api/admin/ml/export').then(r => r.ok ? r.json() : null),
        authFetch('/api/admin/ml/artifact').then(r => r.ok ? r.json() : null),
        authFetch('/api/admin/ml/pipeline').then(r => r.ok ? r.json() : null),
      ]);
      if (dsRes?.datasets) setDatasets(dsRes.datasets);
      if (artRes?.artifacts) {
        setArtifacts(artRes.artifacts);
        // Auto version: selected model için son version'ı bul
        const modelArts = artRes.artifacts.filter((a: ArtifactInfo) => a.name === modelName);
        setVersion(nextVersion(modelArts));
      }
    } catch { /* connection error */ }
  }, [modelName]);

  useEffect(() => { load(); }, [load]);

  // Version'u model değişince güncelle
  useEffect(() => {
    const modelArts = artifacts.filter(a => a.name === modelName);
    setVersion(nextVersion(modelArts));
  }, [modelName, artifacts]);

  const startTraining = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const ds = datasets.find(d => d.id === datasetId);
      const body: Record<string, unknown> = {
        name: modelName,
        version,
        horizon_min: horizonMin,
      };
      if (ds) body.dataset_path = ds.path;
      const res = await authFetch('/api/admin/ml/train', { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      if (data.ok) {
        setSuccess(`✓ Eğitim başlatıldı: ${modelName}@${version}`);
        load();
      } else {
        setError(data.error || 'Eğitim başlatılamadı');
      }
    } catch { setError('Bağlantı hatası'); }
    setLoading(false);
  };

  const startPipeline = async () => {
    setPipelineLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await authFetch('/api/admin/ml/pipeline', {
        method: 'POST',
        body: JSON.stringify({ modelName, horizonMin, version }),
      });
      const data = await res.json();
      if (data.ok) {
        setSuccess(`✓ Pipeline başlatıldı. Run ID: ${data.runId}`);
        load();
      } else {
        setError(data.error || 'Pipeline başlatılamadı');
      }
    } catch { setError('Bağlantı hatası'); }
    setPipelineLoading(false);
  };

  const cleanupDatasets = async () => {
    setCleanupMsg(null);
    try {
      const res = await authFetch('/api/admin/ml/dataset-cleanup', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setCleanupMsg(`✓ ${data.deleted} eski/bozuk dataset temizlendi`);
        load();
      } else {
        setCleanupMsg(`✗ ${data.error || 'Temizlik başarısız'}`);
      }
    } catch { setCleanupMsg('✗ Bağlantı hatası'); }
  };

  // ── Takım Gücü (Kalman) functions ──
  const startTeamStrengthFit = async () => {
    setTsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await authFetch('/api/admin/ml/team-strength-fit', {
        method: 'POST',
        body: JSON.stringify({
          startDate: tsStartDate,
          endDate: tsEndDate,
          minMatches: tsMinMatches,
          promote: tsPromote,
          skipBackfill: true,
          notes: `manual from /admin/ml/train @ ${new Date().toISOString()}`,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        const teams = data.fit.teamsInModel;
        const matches = data.fit.nMatchesFitted;
        if (matches === 0) {
          setError("Scoremer'den hiç maç bulunamadı. Tarih aralığını kontrol edin.");
        } else {
          setSuccess(`✓ ${teams} takım, ${matches} maç ile Kalman fit tamamlandı${data.promoted ? ' → ⭐ Champion' : ''}`);
          load();
        }
      } else {
        setError(data.error || data.message || 'Fit başarısız');
      }
    } catch { setError('Bağlantı hatası'); }
    setTsLoading(false);
  };

  const checkTeamStrengthData = async () => {
    setTsChecking(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await authFetch(`/api/admin/ml/team-strength-check?minMatches=${tsMinMatches}`);
      const data = await res.json();
      if (data.ok) {
        setTsCheck(data);
      } else {
        setError(data.message || 'Kontrol başarısız');
        setTsCheck(null);
      }
    } catch { setError('Bağlantı hatası'); setTsCheck(null); }
    setTsChecking(false);
  };

  // Sağlıklı / sorunlu dataset sayıları
  const healthyDatasets = datasets.filter(d => d.status === 'ready' || (!d.errorMsg));
  const staleDatasets = datasets.filter(d =>
    d.errorMsg ||
    d.status === 'failed' ||
    (d.createdAt && Date.now() - new Date(d.createdAt).getTime() > 30 * 24 * 60 * 60 * 1000)
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black text-gray-800">🚀 ML Model Eğitimi</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Manuel eğitim tetikleme, dataset yönetimi, versiyon kontrolü
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="px-2 py-1 rounded bg-emerald-100 text-emerald-700 font-bold">{healthyDatasets.length} sağlıklı dataset</span>
          {staleDatasets.length > 0 && (
            <span className="px-2 py-1 rounded bg-red-100 text-red-700 font-bold">{staleDatasets.length} sorunlu</span>
          )}
        </div>
      </div>

      {error && <div className="rounded-lg px-4 py-2.5 bg-red-50 text-red-700 border border-red-200 text-sm font-medium">{error}</div>}
      {success && <div className="rounded-lg px-4 py-2.5 bg-emerald-50 text-emerald-700 border border-emerald-200 text-sm font-medium">{success}</div>}
      {cleanupMsg && (
        <div className={`rounded-lg px-4 py-2.5 border text-sm font-medium ${cleanupMsg.startsWith('✓') ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
          {cleanupMsg}
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
              <label className="block text-[11px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                Sürüm <span className="text-gray-400 font-normal">(otomatik)</span>
              </label>
              <input type="text" value={version} onChange={e => setVersion(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none" />
              <div className="flex gap-1 mt-1">
                {['major', 'minor', 'patch'].map(t => (
                  <button key={t} type="button" onClick={() => {
                    const parts = version.split('.').map(Number);
                    if (t === 'major') setVersion(`${parts[0] + 1}.0.0`);
                    else if (t === 'minor') setVersion(`${parts[0]}.${parts[1] + 1}.0`);
                    else {
                      const modelArts = artifacts.filter(a => a.name === modelName);
                      setVersion(nextVersion(modelArts));
                    }
                  }}
                  className="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 font-semibold">
                    +{t === 'patch' ? 'otomatik' : t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Dataset</label>
              <select value={datasetId} onChange={e => setDatasetId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none">
                <option value="">En yeni dataset'i kullan (otomatik)</option>
                {datasets.filter(d => !d.errorMsg).map(d => (
                  <option key={d.id} value={d.id}>
                    {d.horizon}dk · {d.rowCount ? fmtNum(d.rowCount) + ' row' : '?'} · {(d.sizeBytes / 1024 / 1024).toFixed(1)} MB · {d.date || d.createdAt?.slice(0, 10) || '—'}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-gray-100 flex gap-2">
          <button onClick={startTraining} disabled={loading || pipelineLoading}
            className="flex-1 px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-bold rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? '⏳ Eğitim başlatılıyor...' : `🚀 Train ${modelName}@${version}`}
          </button>
          <button onClick={startPipeline} disabled={loading || pipelineLoading}
            className="flex-1 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-green-600 text-white text-sm font-bold rounded-lg hover:from-emerald-600 hover:to-green-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            {pipelineLoading ? '⏳ Pipeline çalışıyor...' : '🔄 Full Pipeline (Export + Train + Compare + Promote)'}
          </button>
        </div>
	      </div>

	      {/* Takım Gücü (Kalman Filter) */}
	      <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-5">
	        <div className="flex items-center gap-3 mb-3">
	          <div className="w-1.5 h-7 rounded-full bg-gradient-to-b from-amber-400 to-orange-500" />
	          <div>
	            <div className="text-sm font-bold text-gray-800">🏋️ Takım Gücü (Kalman Filter)</div>
	            <div className="text-[11px] text-gray-500">Scoremer/Goaloo'dan maç geçmişi → Kalman fit → artifact olarak kaydet</div>
	          </div>
	        </div>

	        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
	          <div>
	            <label className="block text-[11px] font-semibold text-gray-600 mb-1 uppercase">Başlangıç</label>
	            <input type="date" value={tsStartDate} onChange={e => setTsStartDate(e.target.value)}
	              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm font-mono focus:border-amber-400 focus:ring-2 focus:ring-amber-100 outline-none" />
	          </div>
	          <div>
	            <label className="block text-[11px] font-semibold text-gray-600 mb-1 uppercase">Bitiş</label>
	            <input type="date" value={tsEndDate} onChange={e => setTsEndDate(e.target.value)}
	              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm font-mono focus:border-amber-400 focus:ring-2 focus:ring-amber-100 outline-none" />
	          </div>
	          <div>
	            <label className="block text-[11px] font-semibold text-gray-600 mb-1 uppercase">Min Maç</label>
	            <input type="number" min={1} max={50} value={tsMinMatches} onChange={e => setTsMinMatches(Number(e.target.value))}
	              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm font-mono focus:border-amber-400 focus:ring-2 focus:ring-amber-100 outline-none" />
	          </div>
	          <div className="flex items-end pb-1">
	            <label className="flex items-center gap-2 cursor-pointer">
	              <input type="checkbox" checked={tsPromote} onChange={e => setTsPromote(e.target.checked)}
	                className="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-300" />
	              <span className="text-[11px] font-semibold text-gray-700">Otomatik Champion</span>
	            </label>
	          </div>
	        </div>

	        <button onClick={checkTeamStrengthData} disabled={tsChecking}
	          className="w-full mb-2 px-4 py-2 bg-white border border-amber-300 text-amber-700 text-sm font-bold rounded-lg hover:bg-amber-50 transition-all disabled:opacity-50">
	          {tsChecking ? '🔄 Kontrol ediliyor…' : '🔍 Veri Kontrolü'}
	        </button>

	        {tsCheck && (
	          tsCheck.ready ? (
	            <div className="mb-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-800">
	              ✓ <b>{fmtNum(tsCheck.totalMatches)}</b> maç, <b>{fmtNum(tsCheck.teamsWithMinMatches)}</b> takım hazır (min {tsCheck.minMatches} maç).
	              {' '}<span className="text-emerald-600">{Object.entries(tsCheck.perSource).map(([k, v]) => `${k}: ${v}`).join(' · ')}</span>
	            </div>
	          ) : (
	            <div className="mb-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[11px] text-red-800">
	              ✗ Yetersiz veri: <b>{fmtNum(tsCheck.totalMatches)}</b> maç, <b>{fmtNum(tsCheck.teamsWithMinMatches)}</b> takım (min {tsCheck.minMatches} maç gerekli).
	              <br /><a href="/admin/ml/data-import" className="font-bold underline">📥 Veri İçe Aktar</a> sayfasından maç geçmişi çekin.
	            </div>
	          )
	        )}

	        <button onClick={startTeamStrengthFit} disabled={tsLoading}
	          className="w-full px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-600 text-white text-sm font-bold rounded-lg hover:from-amber-600 hover:to-orange-700 transition-all disabled:opacity-50">
	          {tsLoading ? '⏳ Kalman fit çalışıyor…' : '🏋️ Fit + Promote'}
	        </button>
	      </div>

	      {/* Dataset Sağlığı */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-5 rounded-full bg-gradient-to-b from-cyan-400 to-blue-500" />
            <h3 className="text-sm font-bold text-gray-800">🗄️ Dataset Yönetimi</h3>
            <span className="text-[10px] text-gray-400">{datasets.length} dataset</span>
          </div>
          <button onClick={cleanupDatasets} disabled={staleDatasets.length === 0}
            className="text-[11px] px-3 py-1.5 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 font-bold disabled:opacity-50 disabled:cursor-not-allowed border border-red-200">
            🗑️ {staleDatasets.length} Sorunlu/Eski Dataset'i Temizle
          </button>
        </div>
        {datasets.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">Henüz dataset yok</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th className="text-left py-2 px-2 font-semibold">Horizon</th>
                  <th className="text-right py-2 px-2 font-semibold">Rows</th>
                  <th className="text-right py-2 px-2 font-semibold">Size</th>
                  <th className="text-center py-2 px-2 font-semibold">Durum</th>
                  <th className="text-center py-2 px-2 font-semibold">Tarih</th>
                  <th className="text-right py-2 px-2 font-semibold">Yaş</th>
                </tr>
              </thead>
              <tbody>
                {[...datasets].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(d => {
                  const ageDays = d.createdAt ? Math.floor((Date.now() - new Date(d.createdAt).getTime()) / 86400000) : 0;
                  const isStale = ageDays > 30 || d.errorMsg || d.status === 'failed';
                  return (
                    <tr key={d.id} className={`border-b border-gray-50 hover:bg-gray-50 ${isStale ? 'opacity-60' : ''}`}>
                      <td className="py-2 px-2 font-mono font-bold text-gray-700">{d.horizon}dk</td>
                      <td className="py-2 px-2 text-right font-mono text-gray-600">{d.rowCount ? fmtNum(d.rowCount) : '—'}</td>
                      <td className="py-2 px-2 text-right font-mono text-gray-600">{(d.sizeBytes / 1024 / 1024).toFixed(1)} MB</td>
                      <td className="py-2 px-2 text-center">
                        {d.errorMsg ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-bold" title={d.errorMsg}>✗ Hata</span>
                        ) : d.status === 'failed' ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-bold">Başarısız</span>
                        ) : ageDays > 30 ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold">Eski</span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold">✓ Hazır</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-center text-gray-500">{d.createdAt?.slice(0, 10) || '—'}</td>
                      <td className="py-2 px-2 text-right font-mono text-gray-400">{ageDays > 0 ? `${ageDays}g` : 'yeni'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
