'use client';

import { useEffect, useState, useCallback } from 'react';
import { Search, ChevronLeft, ChevronRight, ArrowUpDown } from 'lucide-react';

interface TeamRow {
  id: string; teamName: string; teamNameTr: string | null;
  elo: number; attackStrength: number; defenseWeakness: number;
  matchesPlayed: number; wins: number; draws: number; losses: number;
  goalsFor: number; goalsAgainst: number; xgFor: number; xgAgainst: number;
  piHa: number; piHd: number; piAa: number; piAd: number; piMatches: number;
}

interface ApiResponse {
  rows: TeamRow[]; total: number; page: number; totalPages: number;
}

const SORTABLE = ['elo', 'piHa', 'piHd', 'matchesPlayed', 'wins', 'goalsFor', 'teamName'] as const;
type SortCol = typeof SORTABLE[number];

export default function TeamRatingsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortCol>('elo');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50', sortBy, sortDir });
      if (search) params.set('search', search);
      const resp = await fetch(`/api/admin/team-ratings?${params}`);
      const json = await resp.json();
      setData(json);
    } catch { /* */ }
    setLoading(false);
  }, [page, search, sortBy, sortDir]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleSort = (col: SortCol) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  const cols = [
    { key: 'teamName' as SortCol, label: 'Takım' },
    { key: 'elo' as SortCol, label: 'Elo' },
    { key: 'piHa' as SortCol, label: 'π Ha' },
    { key: 'piHd' as SortCol, label: 'π Hd' },
    { key: 'matchesPlayed' as SortCol, label: 'Maç' },
    { key: 'wins' as SortCol, label: 'G' },
    { key: 'goalsFor' as SortCol, label: 'AG' },
  ];

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Takım Değerlendirmeleri</h1>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
        <input
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400"
          placeholder="Takım ara..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {/* Table */}
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
                <tr><td colSpan={cols.length} className="text-center py-8 text-gray-400">Sonuç bulunamadı</td></tr>
              )}
              {data?.rows.map(r => (
                <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-medium text-gray-800">{r.teamNameTr ?? r.teamName}</td>
                  <td className="px-3 py-2 font-mono text-indigo-600">{r.elo}</td>
                  <td className="px-3 py-2 font-mono text-gray-600">{r.piHa.toFixed(4)}</td>
                  <td className="px-3 py-2 font-mono text-gray-600">{r.piHd.toFixed(4)}</td>
                  <td className="px-3 py-2 text-gray-600">{r.matchesPlayed}</td>
                  <td className="px-3 py-2 text-gray-600">{r.wins}</td>
                  <td className="px-3 py-2 text-gray-600">{r.goalsFor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>Toplam {data.total} takım</span>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"><ChevronLeft className="size-4" /></button>
            <span>Sayfa {page} / {data.totalPages}</span>
            <button disabled={page >= data.totalPages} onClick={() => setPage(p => p + 1)} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"><ChevronRight className="size-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
