'use client';

import { useEffect, useState, useCallback } from 'react';
import { Search, ChevronLeft, ChevronRight, ArrowUpDown, ChevronDown, ChevronUp, BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { authFetch } from '@/lib/adminAuth';

interface TeamRow {
  id: string; teamName: string; teamNameTr: string | null;
  elo: number; attackStrength: number; defenseWeakness: number;
  matchesPlayed: number; wins: number; draws: number; losses: number;
  goalsFor: number; goalsAgainst: number;
  piHa: number; piHd: number; piAa: number; piAd: number; piMatches: number;
}

interface ApiResponse {
  rows: TeamRow[]; total: number; page: number; totalPages: number;
}

interface EloImportJob {
  id: string; status: string; totalTeams: number;
  fetchedTeams: number; failedTeams: number;
  currentTeam: string | null; progressPct: number;
  startedAt: string; finishedAt: string | null;
}

const SORTABLE = ['elo', 'teamName', 'matchesPlayed', 'wins', 'goalsFor', 'attackStrength', 'defenseWeakness', 'piHa', 'piHd'] as const;
type SortCol = typeof SORTABLE[number];

export default function AdminEloPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortCol>('elo');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [jobs, setJobs] = useState<EloImportJob[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50', sortBy, sortDir });
      if (search) params.set('search', search);
      const resp = await fetch(`/api/admin/elo?${params}`);
      const json = await resp.json();
      setData(json);
    } catch { /* */ }
    setLoading(false);
  }, [page, search, sortBy, sortDir]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const loadJobs = useCallback(async () => {
    try {
      const res = await authFetch('/api/admin/elo-import').catch(() => null);
      if (res && res.ok) {
        const j = await res.json();
        setJobs(j.jobs || []);
      }
    } catch { /* */ }
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  // Poll active jobs
  useEffect(() => {
    if (jobs.some(j => j.status === 'running')) {
      const i = setInterval(() => { fetchData(); loadJobs(); }, 5000);
      return () => clearInterval(i);
    }
  }, [jobs, fetchData, loadJobs]);

  const startImport = async (action: string, body: any = {}) => {
    setImporting(true);
    setImportMsg(null);
    try {
      const res = await authFetch('/api/admin/elo-import', {
        method: 'POST',
        body: JSON.stringify({ action, ...body }),
      });
      const d = await res.json();
      if (d.ok || d.jobId) {
        setImportMsg(`✓ Import başlatıldı`);
        setTimeout(() => { fetchData(); loadJobs(); }, 1000);
      } else {
        setImportMsg(`✗ ${d.error || 'Başarısız'}`);
      }
    } catch { setImportMsg('✗ Bağlantı hatası'); }
    setImporting(false);
  };

  const toggleSort = (col: SortCol) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  const chartData = [...(data?.rows ?? [])]
    .sort((a, b) => b.elo - a.elo)
    .slice(0, 20)
    .map(r => ({ name: (r.teamNameTr ?? r.teamName ?? '').slice(0, 14), elo: r.elo }))
    .reverse();

  const cols: { key: SortCol; label: string }[] = [
    { key: 'teamName', label: 'Takım' },
    { key: 'elo', label: 'Elo' },
    { key: 'attackStrength', label: 'Atak' },
    { key: 'defenseWeakness', label: 'Defans' },
    { key: 'piHa', label: 'π Ha' },
    { key: 'piHd', label: 'π Hd' },
    { key: 'matchesPlayed', label: 'Maç' },
    { key: 'wins', label: 'G' },
    { key: 'goalsFor', label: 'AG' },
  ];

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black text-gray-800">⚡ Elo Ratings</h1>
        <button
          onClick={() => setImportOpen(!importOpen)}
          className="text-xs flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"
        >
          {importOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          Import
        </button>
      </div>

      {/* ── Collapsible Import Section ── */}
      {importOpen && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-3">
          <h2 className="text-sm font-bold text-gray-800">📥 Import ClubElo</h2>
          {importMsg && (
            <div className={`text-xs font-medium px-3 py-1.5 rounded-lg ${
              importMsg.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
            }`}>{importMsg}</div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <button onClick={() => startImport('fetch-league', { country: 'TUR' })} disabled={importing}
              className="p-3 rounded-lg border-2 border-orange-200 bg-orange-50/40 hover:bg-orange-50 transition-all disabled:opacity-50 text-left">
              <div className="text-xl mb-0.5">🇹🇷</div>
              <div className="text-sm font-bold text-gray-800">Süper Lig</div>
              <div className="text-[10px] text-gray-500">ClubElo API</div>
            </button>
            <button onClick={() => startImport('fetch-league', { country: 'ENG' })} disabled={importing}
              className="p-3 rounded-lg border-2 border-blue-200 bg-blue-50/40 hover:bg-blue-50 transition-all disabled:opacity-50 text-left">
              <div className="text-xl mb-0.5">🏴󠁧󠁢󠁥󠁮󠁧󠁿</div>
              <div className="text-sm font-bold text-gray-800">Premier Lig</div>
              <div className="text-[10px] text-gray-500">ClubElo API</div>
            </button>
            <button onClick={() => startImport('fetch-league', { country: 'ESP' })} disabled={importing}
              className="p-3 rounded-lg border-2 border-red-200 bg-red-50/40 hover:bg-red-50 transition-all disabled:opacity-50 text-left">
              <div className="text-xl mb-0.5">🇪🇸</div>
              <div className="text-sm font-bold text-gray-800">La Liga</div>
              <div className="text-[10px] text-gray-500">ClubElo API</div>
            </button>
          </div>
          <button onClick={() => startImport('fetch-all')} disabled={importing}
            className="w-full py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white text-sm font-bold rounded-lg hover:from-orange-600 hover:to-red-600 transition-all disabled:opacity-50">
            {importing ? '⏳ Çalışıyor...' : '🌍 Tüm Aktif Ligleri Çek'}
          </button>

          {/* Active import jobs */}
          {jobs.filter(j => j.status === 'running').length > 0 && (
            <div className="bg-amber-50/40 rounded-lg p-3 border border-amber-100">
              {jobs.filter(j => j.status === 'running').map(j => (
                <div key={j.id}>
                  <div className="flex items-center justify-between text-[11px] font-mono text-gray-700 mb-1">
                    <span>{j.fetchedTeams}/{j.totalTeams} takım · {j.failedTeams} hata{j.currentTeam && <span className="ml-2 text-amber-700">→ {j.currentTeam}</span>}</span>
                    <span className="text-[10px] font-bold text-amber-700">{j.progressPct}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500" style={{ width: `${j.progressPct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Bar Chart ── */}
      {data && data.rows.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-gray-600">
            <BarChart3 className="size-3.5" /> Top 20
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 100, right: 10 }}>
                <XAxis type="number" domain={[1000, 2000]} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={90} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} formatter={(v: unknown) => [typeof v === 'number' ? v.toFixed(0) : '-', 'Elo']} />
                <Bar dataKey="elo" fill="#6366f1" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Search ── */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
        <input
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400"
          placeholder="Takım ara..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {/* ── DataTable ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {cols.map(c => (
                  <th key={c.key} className="text-left px-3 py-2 font-semibold text-gray-500 cursor-pointer hover:text-gray-700 select-none" onClick={() => toggleSort(c.key)}>
                    <span className="flex items-center gap-1">{c.label}<ArrowUpDown className="size-3" /></span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={cols.length} className="text-center py-8 text-gray-400">Yükleniyor...</td></tr>
              )}
              {!loading && data?.rows.length === 0 && (
                <tr><td colSpan={cols.length} className="text-center py-8 text-gray-400">Henüz rating verisi yok. Import başlatın.</td></tr>
              )}
              {data?.rows.map(r => (
                <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-medium text-gray-800">{r.teamNameTr ?? r.teamName}</td>
                  <td className={`px-3 py-2 font-mono font-bold ${
                    r.elo >= 1700 ? 'text-emerald-600' : r.elo >= 1500 ? 'text-amber-600' : 'text-gray-500'
                  }`}>{r.elo}</td>
                  <td className="px-3 py-2 font-mono text-gray-600">{r.attackStrength.toFixed(2)}</td>
                  <td className="px-3 py-2 font-mono text-gray-600">{r.defenseWeakness.toFixed(2)}</td>
                  <td className="px-3 py-2 font-mono text-gray-600">{r.piHa.toFixed(4)}</td>
                  <td className="px-3 py-2 font-mono text-gray-600">{r.piHd.toFixed(4)}</td>
                  <td className="px-3 py-2 text-gray-600">{r.matchesPlayed}</td>
                  <td className="px-3 py-2">
                    <span className="text-emerald-600 font-mono">{r.wins}</span>
                    <span className="text-gray-300 mx-0.5">/</span>
                    <span className="text-amber-600 font-mono">{r.draws}</span>
                    <span className="text-gray-300 mx-0.5">/</span>
                    <span className="text-red-600 font-mono">{r.losses}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-gray-600">{r.goalsFor}/{r.goalsAgainst}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Pagination ── */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>Toplam {data.total} takım</span>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30">
              <ChevronLeft className="size-4" />
            </button>
            <span>Sayfa {page} / {data.totalPages}</span>
            <button disabled={page >= data.totalPages} onClick={() => setPage(p => p + 1)} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30">
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
