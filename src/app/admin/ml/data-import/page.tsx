// ── Admin: Data Import (Team History) ───────────────────────────────
// Lets an admin pull historical finished matches from Fotmob,
// Sofascore, Scoremer, or Goaloo into `TeamHistoryMatch`. After
// the import, run the team-strength fit from /admin/ml/train to
// actually train the Kalman model on the new rows.
//
// Two-step UX:
//   1. "Önizle" → POST { dryRun: true } → confirms source+range
//   2. "Çek ve Yazdır" → POST { dryRun: false } → backfill runs

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { fmtNum } from '@/lib/safeFormat';
import { authFetch } from '@/lib/adminAuth';

interface BulkEnrichResult {
  ok: boolean;
  season: string;
  leagueCount: number;
  leaguesWithData: number;
  matchesProcessed: number;
  predictionLogsCreated: number;
  errors: number;
  perLeague: Array<{
    leagueId: number;
    shortName: string;
    fullName: string;
    seasonMatches: number;
    finished: number;
    enriched: number;
    errors: number;
  }>;
  elapsed: string;
}

interface EnrichProgress {
  running: boolean;
  total: number;
  processed: number;
  errors: number;
  percent: number;
  elapsed: number;
  currentMatch: string | null;
  currentLeague: string | null;
  recentMatches: string[];
}

interface BulkEnrichResult {
  ok: boolean;
  season: string;
  leagueCount: number;
  leaguesWithData: number;
  matchesProcessed: number;
  predictionLogsCreated: number;
  errors: number;
  perLeague: Array<{
    leagueId: number;
    shortName: string;
    fullName: string;
    seasonMatches: number;
    finished: number;
    enriched: number;
    errors: number;
  }>;
  elapsed: string;
}

interface ImportResult {
  ok: boolean;
  dryRun?: boolean;
  source?: string;
  dateRange?: { startDate: string; endDate: string; days: number };
  scraped?: number;
  inserted?: number;
  skippedDuplicate?: number;
  error?: string;
  message?: string;
  valid?: string[];
  days?: number;
  max?: number;
}

const SOURCES = [
  {
    id: 'fotmob',
    label: 'Fotmob',
    desc: 'Halka açık API, hızlı, xG + form verisi. Çoğu lig için 30 günlük geriye gider.',
    color: '#3cb15c',
  },
  {
    id: 'sofascore',
    label: 'Sofascore',
    desc: 'Python bridge üzerinden. 5 paralel gün. Yavaş ama kapsamlı (150+ lig).',
    color: '#5794f2',
  },
  {
    id: 'scoremer',
    label: 'Scoremer',
    desc: 'Mevcut varsayılan kaynak. Türk ligleri güçlü, tarih parse en iyi burada.',
    color: '#f79520',
  },
  {
    id: 'goaloo',
    label: 'Goaloo',
    desc: '166 lig, 365 gün. Scraping tabanlı, hızlı parallel fetch. Maç sonuçları + detaylı ML verisi.',
    color: '#9178d9',
  },
  {
    id: 'nesine',
    label: 'Nesine (Geçmiş)',
    desc: '✨ YENİ! Gerçek stats (possession, shots, xG) ile geçmiş maç backfill. Cloudflare yok, hızlı.',
    color: '#10b981',
  },
] as const;

type SourceId = (typeof SOURCES)[number]['id'];

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (d: number) =>
  new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);

export default function AdminDataImportPage() {
  const [source, setSource] = useState<SourceId>('fotmob');
  const [startDate, setStartDate] = useState(() => daysAgoISO(30));
  const [endDate, setEndDate] = useState(todayISO);
  const [dryRun, setDryRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enrichResult, setEnrichResult] = useState<BulkEnrichResult | null>(null);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState<EnrichProgress | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const days = Math.max(
    1,
    Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000),
  );

  const submit = useCallback(
    async (asDryRun: boolean) => {
      setLoading(true);
      setError(null);
      setResult(null);
      try {
        const res = await authFetch('/api/admin/ml/data-import', {
          method: 'POST',
          body: JSON.stringify({
            source,
            startDate,
            endDate,
            dryRun: asDryRun,
          }),
        });
        const data: ImportResult = await res.json();
        if (!res.ok || data.error) {
          setError(data.message || data.error || `HTTP ${res.status}`);
          setResult(data);
        } else {
          setResult(data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [source, startDate, endDate],
  );

  const startEnrich = useCallback(async () => {
    setEnrichLoading(true);
    setEnrichResult(null);
    setEnrichProgress({ running: true, total: 25000, processed: 0, errors: 0, percent: 0, elapsed: 0, currentMatch: null, currentLeague: null, recentMatches: [] });
    setError(null);

    // Progress polling başlat
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/admin/ml/bulk-enrich/progress');
        const data: EnrichProgress = await res.json();
        setEnrichProgress(data);
        if (!data.running && data.processed > 0) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {}
    }, 2000);

    try {
      const res = await authFetch('/api/admin/ml/bulk-enrich', {
        method: 'POST',
        body: JSON.stringify({ maxMatches: 25000 }),
      });
      const data: BulkEnrichResult = await res.json();
      if (!res.ok || !data.ok) {
        setError('Enrichment failed');
      } else {
        setEnrichResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnrichLoading(false);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-gray-800">📥 Veri İçe Aktar</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Geçmiş maçları seçilen kaynaktan çek ve <code>TeamHistoryMatch</code>{' '}
          tablosuna yaz. Sonra <code>/admin/ml/train → Takım Gücü (Kalman)</code>{' '}
          adımıyla modeli eğit.
        </p>
      </div>

      {/* Source picker */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Kaynak
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {SOURCES.map((s) => {
            const active = source === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setSource(s.id)}
                type="button"
                className={`text-left rounded-lg p-3 border-2 transition-all ${
                  active
                    ? 'border-indigo-400 bg-indigo-50/50'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ background: s.color }}
                  />
                  <span className="text-sm font-bold text-gray-800">{s.label}</span>
                </div>
                <div className="text-[10px] text-gray-500 leading-snug">{s.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Date range */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Tarih Aralığı
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] text-gray-500 mb-1">Başlangıç</label>
            <input
              type="date"
              value={startDate}
              max={endDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 mb-1">Bitiş</label>
            <input
              type="date"
              value={endDate}
              min={startDate}
              max={todayISO()}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"
            />
          </div>
          <div className="text-xs text-gray-500 pb-1">
            <b className="text-gray-800">{fmtNum(days)} gün</b>
            {days > 365 && (
              <span className="text-red-600 ml-2">⚠️ 365 gün sınırı aşıldı</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {[
            { label: 'Son 7 gün', d: 7 },
            { label: 'Son 30 gün', d: 30 },
            { label: 'Son 90 gün', d: 90 },
            { label: 'Son 365 gün', d: 365 },
          ].map((p) => (
            <button
              key={p.d}
              type="button"
              onClick={() => {
                setStartDate(daysAgoISO(p.d));
                setEndDate(todayISO());
              }}
              className="text-[10px] px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => submit(true)}
          disabled={loading || days > 365}
          className="px-4 py-2 rounded-lg bg-white border border-gray-300 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading && dryRun ? '… Önizleniyor' : '👁 Önizle'}
        </button>
        <button
          onClick={() => submit(false)}
          disabled={loading || days > 365}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading && !dryRun ? '⏳ Çekiliyor…' : '⬇ Çek ve Yazdır'}
        </button>
        <label className="flex items-center gap-2 text-[11px] text-gray-600 px-2">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            className="rounded"
          />
          Önizleme modu (DB'ye yazmaz)
        </label>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
          <b>Hata:</b> {error}
        </div>
      )}

      {result?.ok && result.dateRange && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-3">
            {result.dryRun ? 'Önizleme Sonucu' : 'İçe Aktarma Sonucu'}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat
              label="Kaynak"
              value={result.source || '—'}
              color="#5794f2"
            />
            <Stat
              label="Başlangıç"
              value={result.dateRange.startDate}
              color="#10b981"
            />
            <Stat
              label="Bitiş"
              value={result.dateRange.endDate}
              color="#10b981"
            />
            <Stat
              label="Gün"
              value={String(result.dateRange.days ?? '—')}
              color="#9178d9"
            />
            {!result.dryRun && (
              <>
                <Stat
                  label="Çekilen"
                  value={fmtNum(result.scraped)}
                  color="#5794f2"
                />
                <Stat
                  label="Eklenen"
                  value={fmtNum(result.inserted)}
                  color="#3cb15c"
                />
                <Stat
                  label="Atlanan (tekrar)"
                  value={fmtNum(result.skippedDuplicate)}
                  color="#f79520"
                />
              </>
            )}
          </div>
          {!result.dryRun && (
            <div className="mt-4 text-[11px] text-gray-500">
              Şimdi <a href="/admin/ml/train" className="text-indigo-600 hover:underline font-semibold">/admin/ml/train → Takım Gücü (Kalman)</a> ile modeli eğit.
            </div>
          )}
        </div>
      )}

      {/* Bulk enrich trigger — only for Goaloo after successful import */}
      {result?.ok && !result.dryRun && source === 'goaloo' && (
        <div className="bg-white rounded-xl border border-violet-200 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[11px] font-semibold text-violet-600 uppercase tracking-wide">
                🧠 Detaylı ML Verisi (Phase 2)
              </div>
              <p className="text-[10px] text-gray-500 mt-0.5">
                Her maç için momentum + events + prediction log çeker. 50 worker paralel. 25000 maç ≈ 10 dk.
              </p>
            </div>
          </div>

          <button
            onClick={startEnrich}
            disabled={enrichLoading}
            className="w-full px-4 py-2.5 rounded-lg bg-gradient-to-r from-violet-500 to-purple-600 text-white text-sm font-bold hover:from-violet-600 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {enrichLoading
              ? '⏳ Detaylı veriler çekiliyor...'
              : enrichResult
                ? '🔄 Tekrar Detaylı Çek'
                : '⚡ Detaylı ML Verilerini Çek'}
          </button>

          {/* ── Dynamic Progress Bar ── */}
          {enrichProgress && enrichProgress.running && (
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-xs text-gray-600">
                <span>{enrichProgress.processed} / {enrichProgress.total} maç</span>
                <span>%{enrichProgress.percent}</span>
                <span>{enrichProgress.elapsed}s</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${Math.min(100, enrichProgress.percent)}%`,
                    background: 'linear-gradient(90deg, #8b5cf6, #a78bfa)',
                  }}
                />
              </div>
              {enrichProgress.currentMatch && (
                <div className="text-[10px] text-violet-600 font-medium animate-pulse">
                  🔄 {enrichProgress.currentLeague}: {enrichProgress.currentMatch}
                </div>
              )}
              {enrichProgress.errors > 0 && (
                <div className="text-[10px] text-red-500">
                  ⚠️ {enrichProgress.errors} hata
                </div>
              )}
            </div>
          )}

          {/* ── Live Last 50 Matches ── */}
          {enrichProgress && enrichProgress.recentMatches.length > 0 && (
            <div className="mt-3 border border-gray-100 rounded-lg max-h-48 overflow-y-auto">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide px-3 py-2 bg-gray-50 border-b border-gray-100 sticky top-0">
                Son {Math.min(enrichProgress.recentMatches.length, 50)} İşlenen Maç
              </div>
              <div className="divide-y divide-gray-50">
                {enrichProgress.recentMatches.map((match, i) => (
                  <div
                    key={`${match}-${i}`}
                    className="px-3 py-1.5 text-[11px] text-gray-700 font-mono"
                  >
                    {match}
                  </div>
                ))}
              </div>
            </div>
          )}

          {enrichResult && (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="İşlenen Maç" value={fmtNum(enrichResult.matchesProcessed)} color="#8b5cf6" />
              <Stat label="Prediction Log" value={fmtNum(enrichResult.predictionLogsCreated)} color="#10b981" />
              <Stat label="Lig (verili)" value={fmtNum(enrichResult.leaguesWithData)} color="#3b82f6" />
              <Stat label="Süre" value={enrichResult.elapsed} color="#f59e0b" />
              {enrichResult.errors > 0 && (
                <Stat label="Hata" value={fmtNum(enrichResult.errors)} color="#ef4444" />
              )}
            </div>
          )}
        </div>
      )}

      {/* bulk enrich result end */}

    </div>
  );
}

function Stat({
  label,
  value,
  color = '#5794f2',
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="text-center bg-gray-50 rounded-lg p-2.5">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
        {label}
      </div>
      <div className="text-lg font-black" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
