'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// ── Types ──────────────────────────────────────────────────────
interface PipelineEvent {
  id: string;
  level: 'info' | 'warn' | 'error';
  source: string;
  matchCode: number | null;
  message: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

const LEVEL_COLORS: Record<string, string> = {
  info: 'bg-blue-100 text-blue-800',
  warn: 'bg-yellow-100 text-yellow-800',
  error: 'bg-red-100 text-red-800',
};

const SOURCE_BADGES: Record<string, string> = {
  cron: 'bg-gray-100 text-gray-600',
  'pipeline-ws': 'bg-purple-100 text-purple-700',
  signal: 'bg-green-100 text-green-700',
  reportGoal: 'bg-orange-100 text-orange-700',
  expiry: 'bg-slate-100 text-slate-600',
  ml: 'bg-indigo-100 text-indigo-700',
};

export default function PipelineMonitorPage() {
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [filterLevel, setFilterLevel] = useState<string>('');
  const [filterSource, setFilterSource] = useState<string>('');
  const [count24h, setCount24h] = useState({ error: 0, warn: 0, info: 0 });
  const [autoRefresh, setAutoRefresh] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const fetchEvents = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const params = new URLSearchParams();
      if (filterLevel) params.set('level', filterLevel);
      if (filterSource) params.set('source', filterSource);
      params.set('limit', '100');
      const res = await fetch(`/api/admin/pipeline-events?${params}`);
      const data = await res.json();
      if (data.ok) setEvents(data.events);

      // 24h sayacı
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const countRes = await fetch(`/api/admin/pipeline-events?limit=500&since=${since}`);
      const countData = await countRes.json();
      if (countData.ok) {
        setCount24h({
          error: countData.events.filter((e: PipelineEvent) => e.level === 'error').length,
          warn: countData.events.filter((e: PipelineEvent) => e.level === 'warn').length,
          info: countData.events.filter((e: PipelineEvent) => e.level === 'info').length,
        });
      }
    } catch { /* silent */ }
  }, [filterLevel, filterSource]);

  // Auto-refresh 10sn
  useEffect(() => {
    fetchEvents();
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchEvents();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchEvents, autoRefresh]);

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Pipeline Monitoring</h1>

      {/* Sayaçlar */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-red-600">{count24h.error}</div>
          <div className="text-sm text-red-500">Hata (24h)</div>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-yellow-600">{count24h.warn}</div>
          <div className="text-sm text-yellow-500">Uyarı (24h)</div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-blue-600">{count24h.info}</div>
          <div className="text-sm text-blue-500">Bilgi (24h)</div>
        </div>
      </div>

      {/* Filtreler */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <button
          onClick={() => { setFilterLevel(''); setFilterSource(''); }}
          className="px-3 py-1.5 text-xs font-medium rounded bg-gray-200 hover:bg-gray-300"
        >
          Temizle
        </button>

        <span className="text-xs font-medium text-gray-500">Seviye:</span>
        {['', 'error', 'warn', 'info'].map(l => (
          <button
            key={l}
            onClick={() => setFilterLevel(l === filterLevel ? '' : l)}
            className={`px-3 py-1.5 text-xs font-medium rounded ${
              filterLevel === l
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {l || 'Tümü'}
          </button>
        ))}

        <span className="text-xs font-medium text-gray-500 ml-2">Kaynak:</span>
        {['', 'cron', 'pipeline-ws', 'signal', 'reportGoal', 'expiry'].map(s => (
          <button
            key={s}
            onClick={() => setFilterSource(s === filterSource ? '' : s)}
            className={`px-3 py-1.5 text-xs font-medium rounded ${
              filterSource === s
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s || 'Tümü'}
          </button>
        ))}

        <label className="ml-auto flex items-center gap-2 text-sm text-gray-500">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="rounded"
          />
          Auto-refresh (10sn)
        </label>
      </div>

      {/* Olay listesi */}
      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="max-h-[70vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 w-20">Seviye</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 w-24">Zaman</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 w-28">Kaynak</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 w-20">Maç</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Mesaj</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 w-40">Detay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {events.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    Henüz olay kaydı yok
                  </td>
                </tr>
              )}
              {events.map((ev) => (
                <tr key={ev.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full ${LEVEL_COLORS[ev.level] || ''}`}>
                      {ev.level}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500 font-mono">
                    {new Date(ev.createdAt).toLocaleTimeString('tr-TR')}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`inline-block px-2 py-0.5 text-xs rounded ${SOURCE_BADGES[ev.source] || 'bg-gray-100'}`}>
                      {ev.source}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {ev.matchCode ? (
                      <a href={`/?matchCode=${ev.matchCode}`} className="text-blue-600 hover:underline">
                        {ev.matchCode}
                      </a>
                    ) : '-'}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-700 max-w-md truncate" title={ev.message}>
                    {ev.message}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-400 font-mono max-w-[160px] truncate">
                    {ev.details ? JSON.stringify(ev.details).slice(0, 50) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-2">
        Son 100 olay gösteriliyor. Kaynak: {events.length > 0 ? 'ring buffer + DB' : '-'}
      </p>
    </div>
  );
}
