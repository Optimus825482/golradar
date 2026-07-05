'use client';

import { useEffect, useState, useCallback } from 'react';
import { fmtNum } from '@/lib/safeFormat';
import { authFetch } from '@/lib/adminAuth';

interface DatasetMeta {
  id: string;
  horizon: number;
  rowCount: number;
  sizeBytes: number;
  status: string;
  createdAt: string;
  path: string;
  errorMsg: string | null;
  brier: number | null;
  logLoss: number | null;
}

interface LabelDist {
  positives: number;
  negatives: number;
  posPct: number;
  byMinuteRange: Record<string, { total: number; goals: number }>;
}

export default function AdminDatasetsPage() {
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [labelDist, setLabelDist] = useState<LabelDist | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cleanupMsg, setCleanupMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/admin/ml/export');
      const data = await res.json();
      if (data?.datasets) setDatasets(data.datasets);
    } catch { /* connection */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const analyzeDataset = async (id: string) => {
    setAnalyzing(true);
    setError(null);
    setSelected(id);
    try {
      const res = await authFetch(`/api/admin/ml/dataset-analyze?id=${id}`);
      const data = await res.json();
      if (data.ok) {
        setLabelDist(data.labelDist);
      } else {
        setError(data.error || 'Analiz başarısız');
        setLabelDist(null);
      }
    } catch { setError('Bağlantı hatası'); setLabelDist(null); }
    setAnalyzing(false);
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

  const healthy = datasets.filter(d => d.status === 'ready' || (!d.errorMsg));
  const stale = datasets.filter(d =>
    d.errorMsg || d.status === 'failed' ||
    (d.createdAt && Date.now() - new Date(d.createdAt).getTime() > 30 * 86400000)
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black text-gray-800">📊 Dataset Analizi & Yönetimi</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Label dağılımı, içerik analizi, dataset temizleme
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="px-2 py-1 rounded bg-emerald-100 text-emerald-700 font-bold">{healthy.length} sağlıklı</span>
          {stale.length > 0 && (
            <button onClick={cleanupDatasets}
              className="px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 font-bold">
              🗑️ {stale.length} sorunlu temizle
            </button>
          )}
        </div>
      </div>

      {error && <div className="rounded-lg px-4 py-2.5 bg-red-50 text-red-700 border border-red-200 text-sm font-medium">{error}</div>}
      {cleanupMsg && (
        <div className={`rounded-lg px-4 py-2.5 border text-sm font-medium ${cleanupMsg.startsWith('✓') ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
          {cleanupMsg}
        </div>
      )}

      {/* Dataset listesi */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <h2 className="text-sm font-bold text-gray-800 mb-3">🗄️ Tüm Datasetler ({datasets.length})</h2>
        {datasets.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">Henüz dataset yok. ML scheduler export bekleniyor.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th className="text-left py-2 px-2 font-semibold">Horizon</th>
                  <th className="text-right py-2 px-2 font-semibold">Rows</th>
                  <th className="text-right py-2 px-2 font-semibold">Size</th>
                  <th className="text-right py-2 px-2 font-semibold">Brier</th>
                  <th className="text-center py-2 px-2 font-semibold">Durum</th>
                  <th className="text-center py-2 px-2 font-semibold">Tarih</th>
                  <th className="text-center py-2 px-2 font-semibold">Analiz</th>
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
                      <td className="py-2 px-2 text-right font-mono text-gray-600">{d.sizeBytes ? (d.sizeBytes / (1024*1024)).toFixed(1) + ' MB' : '—'}</td>
                      <td className="py-2 px-2 text-right font-mono text-gray-600">
                        {d.brier != null ? (
                          <span className={d.brier < 0.1 ? 'text-emerald-600 font-bold' : d.brier < 0.2 ? 'text-amber-600' : 'text-red-600'}>
                            {d.brier.toFixed(4)}
                          </span>
                        ) : '—'}
                      </td>
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
                      <td className="py-2 px-2 text-center">
                        <button onClick={() => analyzeDataset(d.id)}
                          disabled={analyzing}
                          className={`text-[10px] px-2 py-1 rounded font-bold transition-all ${
                            selected === d.id
                              ? 'bg-indigo-100 text-indigo-700'
                              : 'bg-gray-100 text-gray-600 hover:bg-indigo-50 hover:text-indigo-600'
                          }`}>
                          {analyzing && selected === d.id ? '⏳' : '🔍 Analiz'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Label dağılımı analizi */}
      {labelDist && (
        <div className="bg-white rounded-xl border border-indigo-200 shadow-sm p-5">
          <h2 className="text-sm font-bold text-gray-800 mb-3">📈 Label Dağılımı</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
              <div className="text-[10px] text-emerald-600 uppercase font-semibold">Pozitif (Gol)</div>
              <div className="text-lg font-black text-emerald-700">{fmtNum(labelDist.positives)}</div>
              <div className="text-[10px] text-emerald-500">{labelDist.posPct.toFixed(1)}%</div>
            </div>
            <div className="p-3 rounded-lg bg-red-50 border border-red-200">
              <div className="text-[10px] text-red-600 uppercase font-semibold">Negatif (Gol Yok)</div>
              <div className="text-lg font-black text-red-700">{fmtNum(labelDist.negatives)}</div>
              <div className="text-[10px] text-red-500">{(100 - labelDist.posPct).toFixed(1)}%</div>
            </div>
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
              <div className="text-[10px] text-blue-600 uppercase font-semibold">Toplam</div>
              <div className="text-lg font-black text-blue-700">{fmtNum(labelDist.positives + labelDist.negatives)}</div>
              <div className="text-[10px] text-blue-500">rows</div>
            </div>
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
              <div className="text-[10px] text-amber-600 uppercase font-semibold">Balans</div>
              <div className="text-lg font-black text-amber-700">1:{Math.round(labelDist.negatives / Math.max(1, labelDist.positives))}</div>
              <div className="text-[10px] text-amber-500">neg:pos</div>
            </div>
          </div>

          {/* Dakika bazlı dağılım */}
          {Object.keys(labelDist.byMinuteRange).length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-gray-600 mb-2">Dakika Bazlı Gol Dağılımı</h3>
              <div className="space-y-1.5">
                {Object.entries(labelDist.byMinuteRange).map(([range, { total, goals }]) => {
                  const pct = total > 0 ? (goals / total * 100) : 0;
                  return (
                    <div key={range} className="flex items-center gap-2">
                      <span className="text-[11px] font-mono text-gray-600 w-16">{range}</span>
                      <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${Math.max(1, pct)}%` }} />
                      </div>
                      <span className="text-[11px] font-mono text-gray-500 w-16 text-right">{goals}/{total}</span>
                      <span className="text-[10px] font-mono text-gray-400 w-12 text-right">{pct.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
