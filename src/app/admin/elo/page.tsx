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

interface EloRating {
  id?: string;
  teamName: string;
  teamNameTr?: string;
  elo: number;
  attackStrength: number;
  defenseWeakness: number;
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  lastUpdated: string;
}

interface EloImportJob {
  id: string;
  status: string;
  totalTeams: number;
  fetchedTeams: number;
  failedTeams: number;
  currentTeam: string | null;
  progressPct: number;
  startedAt: string;
  finishedAt: string | null;
}

export default function AdminEloPage() {
  const [ratings, setRatings] = useState<EloRating[]>([]);
  const [jobs, setJobs] = useState<EloImportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const load = useCallback(async () => {
    try {
      const [ratingsRes, jobsRes] = await Promise.all([
        authFetch('/api/admin/ml/team-strength-fit'),
        authFetch('/api/admin/elo-import').catch(() => null),
      ]);
      if (ratingsRes.ok) {
        const data = await ratingsRes.json();
        setRatings((data.teams || data.ratings || []).slice(0, 100));
      }
      if (jobsRes && jobsRes.ok) {
        const data = await jobsRes.json();
        setJobs(data.jobs || []);
      }
    } catch (e) { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll active jobs
  useEffect(() => {
    if (jobs.some(j => j.status === 'running')) {
      const i = setInterval(load, 5000);
      return () => clearInterval(i);
    }
  }, [jobs, load]);

  const startImport = async (action: string, body: any = {}) => {
    setImporting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await authFetch('/api/admin/elo-import', {
        method: 'POST',
        body: JSON.stringify({ action, ...body }),
      });
      const data = await res.json();
      if (data.ok || data.jobId) {
        setSuccess(`✓ Import başlatıldı (${action})`);
        load();
      } else {
        setError(data.error || 'Import başarısız');
      }
    } catch (e) {
      setError('Bağlantı hatası');
    }
    setImporting(false);
  };

  const filtered = ratings.filter(r =>
    r.teamName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (r.teamNameTr || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-gray-800">⚡ Elo Ratings</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Takım gücü ratingleri, import job'ları ve fit history
        </p>
      </div>

      {(error || success) && (
        <div className={`rounded-lg px-4 py-2.5 text-sm font-medium ${
          error ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
        }`}>
          {error || success}
        </div>
      )}

      {/* Import Butonları */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h2 className="text-sm font-bold text-gray-800 mb-3">📥 Import İşlemleri</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button onClick={() => startImport('fetch-league', { country: 'TUR' })} disabled={importing}
            className="p-4 rounded-lg border-2 border-orange-200 bg-orange-50/40 hover:bg-orange-50 transition-all disabled:opacity-50">
            <div className="text-2xl mb-1">🇹🇷</div>
            <div className="text-sm font-bold text-gray-800">Türkiye Süper Lig</div>
            <div className="text-[10px] text-gray-500 mt-1">ClubElo API'den çek</div>
          </button>
          <button onClick={() => startImport('fetch-league', { country: 'ENG' })} disabled={importing}
            className="p-4 rounded-lg border-2 border-blue-200 bg-blue-50/40 hover:bg-blue-50 transition-all disabled:opacity-50">
            <div className="text-2xl mb-1">🏴󠁧󠁢󠁥󠁮󠁧󠁿</div>
            <div className="text-sm font-bold text-gray-800">İngiltere Premier Lig</div>
            <div className="text-[10px] text-gray-500 mt-1">ClubElo API'den çek</div>
          </button>
          <button onClick={() => startImport('fetch-league', { country: 'ESP' })} disabled={importing}
            className="p-4 rounded-lg border-2 border-red-200 bg-red-50/40 hover:bg-red-50 transition-all disabled:opacity-50">
            <div className="text-2xl mb-1">🇪🇸</div>
            <div className="text-sm font-bold text-gray-800">İspanya La Liga</div>
            <div className="text-[10px] text-gray-500 mt-1">ClubElo API'den çek</div>
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={() => startImport('fetch-all')} disabled={importing}
            className="flex-1 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white text-sm font-bold rounded-lg hover:from-orange-600 hover:to-red-600 transition-all disabled:opacity-50">
            {importing ? '⏳ Çalışıyor...' : '🌍 Tüm Aktif Ligleri Çek'}
          </button>
        </div>
      </div>

      {/* Aktif Import Jobs */}
      {jobs.filter(j => j.status === 'running').length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <h2 className="text-sm font-bold text-gray-800">Aktif Import İşlemleri</h2>
          </div>
          {jobs.filter(j => j.status === 'running').map(j => (
            <div key={j.id} className="bg-amber-50/40 rounded-lg p-3 border border-amber-100">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] font-mono text-gray-700">
                  {j.fetchedTeams}/{j.totalTeams} takım · {j.failedTeams} hata
                  {j.currentTeam && <span className="ml-2 text-amber-700">→ {j.currentTeam}</span>}
                </div>
                <span className="text-[10px] font-bold text-amber-700">{j.progressPct}%</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500" style={{ width: `${j.progressPct}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Arama */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-sm font-bold text-gray-800">📊 Takım Ratingleri</h2>
          <input type="text" placeholder="Takım ara..." value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none w-48" />
        </div>

        {filtered.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6">
            Henüz rating verisi yok. Yukarıdaki butonlardan import başlatın.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th className="text-left py-2 px-2 font-semibold">Takım</th>
                  <th className="text-right py-2 px-2 font-semibold">Elo</th>
                  <th className="text-right py-2 px-2 font-semibold">Atak</th>
                  <th className="text-right py-2 px-2 font-semibold">Defans</th>
                  <th className="text-right py-2 px-2 font-semibold">Maç</th>
                  <th className="text-right py-2 px-2 font-semibold">G/B/M</th>
                  <th className="text-right py-2 px-2 font-semibold">AG/YG</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 50).map(r => (
                  <tr key={r.teamName} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 px-2 font-bold text-gray-800">
                      {r.teamNameTr || r.teamName}
                      {r.teamNameTr && r.teamName !== r.teamNameTr && (
                        <span className="ml-1 text-[10px] font-normal text-gray-400">({r.teamName})</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right font-mono font-bold" style={{ color: r.elo >= 1700 ? '#10b981' : r.elo >= 1500 ? '#f59e0b' : '#6b7280' }}>
                      {r.elo}
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-gray-600">{r.attackStrength.toFixed(2)}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-600">{r.defenseWeakness.toFixed(2)}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-500">{r.matchesPlayed}</td>
                    <td className="py-2 px-2 text-right font-mono">
                      <span className="text-emerald-600">{r.wins}</span>/
                      <span className="text-amber-600">{r.draws}</span>/
                      <span className="text-red-600">{r.losses}</span>
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-gray-600">{r.goalsFor}/{r.goalsAgainst}</td>
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
