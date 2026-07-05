'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { authFetch } from '@/lib/adminAuth';
import { fmtNum } from '@/lib/safeFormat';

interface MatchRow {
  id: string;
  matchCode: number;
  minute: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  rawScore: number;
  calibratedP: number;
  side: string;
  goalScored: boolean | null;
  minutesToGoal: number | null;
  modelVariant: string;
  createdAt: string;
}

interface APIResponse {
  ok: boolean;
  total: number;
  totalLabeled: number;
  page: number;
  totalPages: number;
  leagues: { league: string; count: number }[];
  rows: MatchRow[];
  error?: string;
}

interface DatasetRun {
  runId: string;
  status: string;
  progressPct: number;
  step: string;
  errorMsg?: string;
  newTrainRows?: number;
}

export default function AdminLabelingPage() {
  const [rows, setRows] = useState<MatchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalLabeled, setTotalLabeled] = useState(0);
  const [page, setPage] = useState(1);
  const [leagues, setLeagues] = useState<{ league: string; count: number }[]>([]);
  const [labelFilter, setLabelFilter] = useState('all');
  const [leagueFilter, setLeagueFilter] = useState('');
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Dataset generation state
  const [horizon, setHorizon] = useState(15);
  const [days, setDays] = useState(90);
  const [genLoading, setGenLoading] = useState(false);
  const [datasetRun, setDatasetRun] = useState<DatasetRun | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Labeling state
  const [labelLoading, setLabelLoading] = useState(false);
  const [selectedMatchCodes, setSelectedMatchCodes] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (labelFilter !== 'all') params.set('label', labelFilter);
      if (leagueFilter) params.set('league', leagueFilter);
      const res = await authFetch(`/api/admin/ml/label-matches?${params}`);
      const data: APIResponse = await res.json();
      if (data.ok) {
        setRows(data.rows);
        setTotal(data.total);
        setTotalLabeled(data.totalLabeled);
        setLeagues(data.leagues);
      } else {
        setError(data.error || 'Veri alınamadı');
      }
    } catch { setError('Bağlantı hatası'); }
    setLoading(false);
  }, [page, limit, labelFilter, leagueFilter]);

  useEffect(() => { load(); }, [load]);

  // Toggle match selection
  const toggleMatch = (code: number) => {
    const next = new Set(selectedMatchCodes);
    next.has(code) ? next.delete(code) : next.add(code);
    setSelectedMatchCodes(next);
  };

  // Bulk label selected matches
  const labelSelected = async () => {
    if (selectedMatchCodes.size === 0) return;
    setLabelLoading(true);
    setError(null);
    try {
      const matchCodes = [...selectedMatchCodes];
      const res = await authFetch('/api/admin/ml/label-matches', {
        method: 'POST',
        body: JSON.stringify({ action: 'label-match', matchCodes, horizonMin: horizon }),
      });
      const data = await res.json();
      if (data.ok) {
        setSuccess(`✓ ${data.labeled} satır label'landı`);
        setSelectedMatchCodes(new Set());
        load();
      } else {
        setError(data.error || 'Label başarısız');
      }
    } catch { setError('Bağlantı hatası'); }
    setLabelLoading(false);
  };

  // Label ALL unlabeled
  const labelAll = async () => {
    setLabelLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/admin/ml/label-matches', {
        method: 'POST',
        body: JSON.stringify({ action: 'label-all', horizonMin: horizon, dryRun: false }),
      });
      const data = await res.json();
      if (data.ok) {
        setSuccess(`✓ ${data.labeled} satır label'landı (${data.matchCount} maç)`);
        load();
      } else {
        setError(data.error || 'Label başarısız');
      }
    } catch { setError('Bağlantı hatası'); }
    setLabelLoading(false);
  };

  // Generate dataset
  const startGenerate = async () => {
    setGenLoading(true);
    setError(null);
    setDatasetRun(null);
    try {
      const res = await authFetch('/api/admin/ml/generate-dataset', {
        method: 'POST',
        body: JSON.stringify({ horizon, days, maxRows: 50000, labelFirst: true }),
      });
      const data = await res.json();
      if (data.ok) {
        // Start polling
        pollDatasetProgress(data.runId);
      } else {
        setError(data.error || 'Dataset oluşturma başarısız');
        setGenLoading(false);
      }
    } catch { setError('Bağlantı hatası'); setGenLoading(false); }
  };

  const pollDatasetProgress = (runId: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await authFetch(`/api/admin/ml/generate-dataset?runId=${runId}`);
        const data = await res.json();
        if (data.ok) {
          setDatasetRun(data);
          if (data.status === 'done' || data.status === 'failed') {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            setGenLoading(false);
            if (data.status === 'done') {
              setSuccess(`✅ Dataset oluşturuldu: ${data.newTrainRows ? fmtNum(data.newTrainRows) + ' satır' : ''}`);
              load();
            } else {
              setError(data.errorMsg || 'Dataset oluşturma başarısız');
            }
          }
        }
      } catch { /* polling retry */ }
    }, 1000);
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black text-gray-800">🏷️ Label'leme & Dataset Üretimi</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Maç verilerini etiketle, dataset oluştur, analiz et
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="px-2 py-1 rounded bg-emerald-100 text-emerald-700 font-bold">{fmtNum(totalLabeled)} etiketli</span>
          <span className="px-2 py-1 rounded bg-amber-100 text-amber-700 font-bold">{fmtNum(total - totalLabeled)} etiketsiz</span>
        </div>
      </div>

      {error && <div className="rounded-lg px-4 py-2.5 bg-red-50 text-red-700 border border-red-200 text-sm font-medium">{error}</div>}
      {success && <div className="rounded-lg px-4 py-2.5 bg-emerald-50 text-emerald-700 border border-emerald-200 text-sm font-medium">{success}</div>}

      {/* Dataset Üretimi */}
      <div className="bg-white rounded-xl border border-indigo-200 shadow-sm p-5">
        <h2 className="text-sm font-bold text-gray-800 mb-3">📦 Dataset Üret</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-[11px] font-semibold text-gray-600 mb-1 uppercase">Horizon (dk)</label>
            <select value={horizon} onChange={e => setHorizon(Number(e.target.value))}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
              <option value={5}>5dk</option>
              <option value={10}>10dk</option>
              <option value={15}>15dk</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-600 mb-1 uppercase">Gün Geriye</label>
            <input type="number" value={days} onChange={e => setDays(Number(e.target.value))}
              className="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono" min={1} max={365} />
          </div>
          <button onClick={startGenerate} disabled={genLoading}
            className="px-5 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-bold rounded-lg hover:from-indigo-600 hover:to-purple-700 disabled:opacity-50 transition-all">
            {genLoading ? '⏳ Üretiliyor...' : '🚀 Dataset Üret'}
          </button>
        </div>

        {/* Progress bar */}
        {datasetRun && (
          <div className="mt-4 p-4 rounded-lg bg-gray-50 border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-700">{datasetRun.step}</span>
              <span className="text-[11px] font-mono text-gray-500">{datasetRun.progressPct}%</span>
            </div>
            <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-500 ${
                datasetRun.status === 'failed' ? 'bg-red-500' :
                datasetRun.status === 'done' ? 'bg-emerald-500' : 'bg-indigo-500'
              }`} style={{ width: `${datasetRun.progressPct}%` }} />
            </div>
            {datasetRun.status === 'done' && (
              <div className="mt-2 text-[11px] text-emerald-700 font-bold">
                ✅ {datasetRun.step}
              </div>
            )}
            {datasetRun.status === 'failed' && (
              <div className="mt-2 text-[11px] text-red-700">
                ❌ {datasetRun.errorMsg || 'Başarısız'}
              </div>
            )}
            {/* Dynamic log */}
            {datasetRun.status !== 'done' && datasetRun.status !== 'failed' && (
              <div className="mt-2 text-[11px] text-gray-600 font-mono animate-pulse">
                ▸ {datasetRun.step}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Labeling actions */}
      <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-bold text-gray-800">🏷️ Label'leme</h2>
          <div className="flex-1" />
          <button onClick={labelSelected} disabled={selectedMatchCodes.size === 0 || labelLoading}
            className="px-3 py-1.5 bg-amber-500 text-white text-xs font-bold rounded-lg hover:bg-amber-600 disabled:opacity-50">
            Seçilenleri Label'la ({selectedMatchCodes.size})
          </button>
          <button onClick={labelAll} disabled={labelLoading}
            className="px-3 py-1.5 bg-orange-500 text-white text-xs font-bold rounded-lg hover:bg-orange-600 disabled:opacity-50">
            ⚡ Tümünü Label'la
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <select value={labelFilter} onChange={e => { setLabelFilter(e.target.value); setPage(1); }}
          className="px-3 py-1.5 border border-gray-200 rounded text-[11px] font-bold bg-white">
          <option value="all">Tümü</option>
          <option value="labeled">Etiketli</option>
          <option value="unlabeled">Etiketsiz</option>
        </select>
        <select value={leagueFilter} onChange={e => { setLeagueFilter(e.target.value); setPage(1); }}
          className="px-3 py-1.5 border border-gray-200 rounded text-[11px] font-bold bg-white max-w-[200px]">
          <option value="">Tüm Ligler</option>
          {leagues.slice(0, 30).map(l => (
            <option key={l.league} value={l.league}>{l.league} ({l.count})</option>
          ))}
        </select>
        <select value={limit} onChange={e => { setLimit(Number(e.target.value)); setPage(1); }}
          className="px-3 py-1.5 border border-gray-200 rounded text-[11px] font-bold bg-white">
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={200}>200</option>
        </select>
        <span className="text-[11px] text-gray-400 ml-auto">
          Sayfa {page}/{Math.ceil(total / limit)} · {fmtNum(total)} toplam
        </span>
      </div>

      {/* Data table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Yükleniyor...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500 bg-gray-50">
                  <th className="text-left py-2 px-2 font-semibold w-8">
                    <input type="checkbox" onChange={e => {
                      if (e.target.checked) setSelectedMatchCodes(new Set(rows.map(r => r.matchCode)));
                      else setSelectedMatchCodes(new Set());
                    }} checked={selectedMatchCodes.size > 0 && rows.every(r => selectedMatchCodes.has(r.matchCode))} />
                  </th>
                  <th className="text-left py-2 px-2 font-semibold">Maç</th>
                  <th className="text-center py-2 px-2 font-semibold">Dk</th>
                  <th className="text-center py-2 px-2 font-semibold">Skor</th>
                  <th className="text-center py-2 px-2 font-semibold">Cal.P</th>
                  <th className="text-center py-2 px-2 font-semibold">Side</th>
                  <th className="text-center py-2 px-2 font-semibold">Lig</th>
                  <th className="text-center py-2 px-2 font-semibold">Label</th>
                  <th className="text-center py-2 px-2 font-semibold">Dk→Gol</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id || i} className={`border-b border-gray-50 hover:bg-gray-50 ${selectedMatchCodes.has(r.matchCode) ? 'bg-amber-50' : ''}`}>
                    <td className="py-1.5 px-2">
                      <input type="checkbox" checked={selectedMatchCodes.has(r.matchCode)}
                        onChange={() => toggleMatch(r.matchCode)} />
                    </td>
                    <td className="py-1.5 px-2 font-bold text-gray-800 max-w-[250px] truncate">
                      {r.homeTeam} vs {r.awayTeam}
                      <div className="text-[9px] text-gray-400 font-normal">#{r.matchCode}</div>
                    </td>
                    <td className="py-1.5 px-2 text-center font-mono">{r.minute}&apos;</td>
                    <td className="py-1.5 px-2 text-center font-mono font-bold">{r.rawScore}</td>
                    <td className="py-1.5 px-2 text-center font-mono">{r.calibratedP?.toFixed(3)}</td>
                    <td className="py-1.5 px-2 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        r.side === 'home' ? 'bg-blue-100 text-blue-700' :
                        r.side === 'away' ? 'bg-red-100 text-red-700' :
                        r.side === 'both' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'
                      }`}>{r.side}</span>
                    </td>
                    <td className="py-1.5 px-2 text-center text-gray-500 max-w-[120px] truncate">{r.league}</td>
                    <td className="py-1.5 px-2 text-center">
                      {r.goalScored === null ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold">?</span>
                      ) : r.goalScored ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold">✓ Gol</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-bold">✗ Yok</span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-center font-mono text-gray-500">
                      {r.minutesToGoal != null ? `${r.minutesToGoal}'` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 bg-gray-50">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="text-[11px] px-3 py-1 rounded bg-white border border-gray-200 hover:bg-gray-100 font-bold disabled:opacity-40">
            ← Önceki
          </button>
          <span className="text-[11px] text-gray-500">
            Sayfa {page} / {Math.max(1, Math.ceil(total / limit))}
          </span>
          <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / limit)}
            className="text-[11px] px-3 py-1 rounded bg-white border border-gray-200 hover:bg-gray-100 font-bold disabled:opacity-40">
            Sonraki →
          </button>
        </div>
      </div>
    </div>
  );
}
