'use client';

import { useEffect, useState, useCallback } from 'react';
import { Search, ChevronLeft, ChevronRight, ArrowUpDown, RefreshCw } from 'lucide-react';

interface NationalTeam {
  id: string; countryCode: string; countryName: string;
  elo: number; rank: number; lastUpdated: string;
}

export default function NationalEloPage() {
  const [data, setData] = useState<{ rows: NationalTeam[]; total: number; page: number; totalPages: number } | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (search) params.set('search', search);
      const resp = await fetch(`/api/admin/national-elo?${params}`);
      const json = await resp.json();
      setData(json);
    } catch { /* */ }
    setLoading(false);
  }, [page, search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const runImport = async () => {
    setImporting(true);
    try {
      const { execSync } = await import('child_process');
      execSync('bun scripts/import-national-elo.ts', { cwd: process.cwd(), stdio: 'pipe' });
      fetchData();
    } catch { /* */ }
    setImporting(false);
  };

  const eloColor = (elo: number) => {
    if (elo >= 2000) return 'text-emerald-600';
    if (elo >= 1800) return 'text-indigo-600';
    if (elo >= 1600) return 'text-amber-600';
    return 'text-gray-500';
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">🌍 Milli Takim Elo Ratingleri</h1>
          <p className="text-xs text-gray-500 mt-0.5">Kaynak: eloratings.net — {data?.total ?? 0} takim</p>
        </div>
        <button onClick={runImport} disabled={importing}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200 font-medium disabled:opacity-50">
          <RefreshCw className={`size-3.5 ${importing ? 'animate-spin' : ''}`} />
          {importing ? 'Guncelleniyor...' : 'Eloratings.net\'ten Cek'}
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
        <input className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400"
          placeholder="Ulke ara..."
          value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-3 py-2 font-semibold text-gray-500 w-12">#</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-500">Ulke</th>
                <th className="text-right px-3 py-2 font-semibold text-gray-500">Kod</th>
                <th className="text-right px-3 py-2 font-semibold text-gray-500">Elo</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={4} className="text-center py-8 text-gray-400">Yukleniyor...</td></tr>}
              {!loading && data?.rows.length === 0 && <tr><td colSpan={4} className="text-center py-8 text-gray-400">Sonuc bulunamadi</td></tr>}
              {data?.rows.map(r => (
                <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-mono text-gray-400">{r.rank}</td>
                  <td className="px-3 py-2 font-medium text-gray-800">{r.countryName}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-500 uppercase">{r.countryCode}</td>
                  <td className={`px-3 py-2 text-right font-mono font-bold ${eloColor(r.elo)}`}>{r.elo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>Toplam {data.total} takim</span>
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
