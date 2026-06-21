'use client';

import { useState, useEffect, type ReactNode } from 'react';
import Link from 'next/link';

// ── Auth API Helper ──────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────
function asPct(v: number | null | undefined, decimals = 1): string {
  return v == null ? '-' : `${(v * 100).toFixed(decimals)}%`;
}
function asFixed(v: number | null | undefined, d = 3): string {
  return v == null ? '-' : v.toFixed(d);
}

// ── Reusable UI ───────────────────────────────────────────────────
function Card({ title, children, accent = 'gray' }: { title?: string; children: ReactNode; accent?: 'gray' | 'green' | 'red' | 'blue' | 'purple' }) {
  const accentColors: Record<string, string> = {
    gray: 'border-gray-200',
    green: 'border-emerald-200',
    red: 'border-red-200',
    blue: 'border-blue-200',
    purple: 'border-purple-200',
  };
  return (
    <div className={`bg-white rounded-xl border ${accentColors[accent]} shadow-sm overflow-hidden`}>
      {title && (
        <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
          <div className="w-1 h-3.5 rounded-full bg-gradient-to-b from-indigo-400 to-purple-500" />
          <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{title}</h3>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

function StatTile({ label, value, unit, color = '#5794f2', sub }: { label: string; value: string | number; unit?: string; color?: string; sub?: string }) {
  return (
    <div className="text-center">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-xl font-black tracking-tight" style={{ color }}>
        {value}{unit && <span className="text-xs font-normal text-gray-400 ml-0.5">{unit}</span>}
      </div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function StatusDot({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: ok ? '#10b981' : '#ef4444' }}>
      <span className="w-2 h-2 rounded-full" style={{ background: ok ? '#10b981' : '#ef4444' }} />
      {label ?? (ok ? 'Aktif' : 'Pasif')}
    </span>
  );
}

function Spinner() {
  return <div className="inline-block w-5 h-5 border-2 border-gray-200 border-t-indigo-500 rounded-full animate-spin" />;
}

// ── Main Admin Page (with sidebar from layout) ────────────────────
// Auth now lives at /admin/login (server-guarded by middleware). This page
// assumes a valid session is present; if the token is missing the API calls
// will 401 and render empty state.
export default function AdminPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const [mlRes, signalRes, dailyRes] = await Promise.all([
        authFetch('/api/admin/ml/status'),
        authFetch('/api/goal-signals?action=stats&days=30'),
        authFetch('/api/daily-metrics'),
      ]);
      const ml = mlRes.ok ? await mlRes.json() : null;
      const signals = signalRes.ok ? await signalRes.json() : null;
      const daily = dailyRes.ok ? await dailyRes.json() : null;
      setData({ ml, signals, daily });
    } catch { /* skip */ }
  };

  useEffect(() => {
    (async () => { await loadData(); setLoading(false); })();
  }, []);

  // Auto-revalidate every 30s (lightweight, doesn't block UI)
  useEffect(() => {
    const i = setInterval(loadData, 30000);
    return () => clearInterval(i);
  }, []);

  if (loading && !data) return (
    <div className="flex flex-col items-center justify-center py-20">
      <Spinner />
      <p className="text-xs text-gray-500 mt-3">Yönetim paneli yükleniyor...</p>
    </div>
  );

  const { ml, signals, daily } = data || {};

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-gray-200">
        <div>
          <h1 className="text-xl font-black text-gray-800">📊 Genel Bakış</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Son güncelleme: {data ? new Date().toLocaleString('tr-TR') : '-'}
          </p>
        </div>
        <button onClick={async () => { setLoading(true); await loadData(); setLoading(false); }} disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold transition-colors disabled:opacity-50">
          {loading ? 'Yenileniyor...' : '🔄 Yenile'}
        </button>
      </div>

      {/* Today's KPI */}
      {daily && (
        <Card title="📊 Bugünün Performansı" accent="blue">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatTile label="Bugün Başarı" value={asPct(daily.today.successRate, 0)}
              color={daily.today.successRate >= 0.6 ? '#10b981' : daily.today.successRate >= 0.4 ? '#f59e0b' : '#ef4444'}
              sub={`${daily.today.goalsHit}/${daily.today.resolved} gol`} />
            <StatTile label="Verilen Sinyal" value={daily.today.signalsTotal}
              color="#f79520" sub={`${daily.today.pending} bekliyor`} />
            <StatTile label="Oynanacak Maç" value={daily.upcoming.total}
              color="#9178d9" sub={`🟢 ${daily.upcoming.liveNow} canlı`} />
            <StatTile label="Genel (90g)" value={asPct(daily.allTime.successRate, 0)}
              color={daily.allTime.successRate >= 0.6 ? '#10b981' : '#f59e0b'}
              sub={`${daily.allTime.totalSignals} sinyal`} />
          </div>
        </Card>
      )}

      {/* ML Trainer Status */}
      {ml && (
        <Card title="🤖 ML Trainer" accent="purple">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Health</div>
              <StatusDot ok={!!ml.trainer?.health?.ok} label={ml.trainer?.health?.ok ? 'Trainer Aktif' : 'Pasif'} />
            </div>
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Champions</div>
              <div className="space-y-1">
                {ml.champions && Object.keys(ml.champions).length > 0 ? (
                  Object.entries(ml.champions).map(([name, c]: [string, any]) => (
                    <div key={name} className="text-xs flex justify-between bg-gray-50 rounded px-2 py-1">
                      <span className="font-semibold text-gray-700">{name}</span>
                      <span className="text-gray-500 font-mono">v{c.version}</span>
                    </div>
                  ))
                ) : <p className="text-[11px] text-gray-400">Henüz champion yok</p>}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Son Metrics</div>
              {ml.latestMetrics ? (
                <div className="grid grid-cols-2 gap-2">
                  <StatTile label="Brier" value={asFixed(ml.latestMetrics.brierScore, 4)} color="#5794f2" />
                  <StatTile label="Shadow Δ" value={asFixed(ml.latestMetrics.shadowBrierDelta, 4)} color="#9178d9" />
                </div>
              ) : <p className="text-[11px] text-gray-400">Veri yok</p>}
            </div>
          </div>
          {ml.scheduler && (
            <div className="mt-4 pt-3 border-t border-gray-100 grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
              <div className="flex items-center gap-1.5"><span className="text-gray-400">Export:</span><StatusDot ok={!!ml.scheduler.exportRunning} /></div>
              <div className="flex items-center gap-1.5"><span className="text-gray-400">InPlay:</span><StatusDot ok={!!ml.scheduler.inplayRunning} /></div>
              <div className="flex items-center gap-1.5"><span className="text-gray-400">Son Export:</span>
                <span className="font-mono text-gray-600">{ml.scheduler.lastExportAt ? new Date(ml.scheduler.lastExportAt).toLocaleString('tr-TR') : '-'}</span>
              </div>
              <div className="flex items-center gap-1.5"><span className="text-gray-400">Cron:</span>
                <span className="font-mono text-gray-600">{ml.scheduler.lastCronAt ? new Date(ml.scheduler.lastCronAt).toLocaleString('tr-TR') : '-'}</span>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Signal Performance */}
      {signals && signals.totalSignals > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card title="🎯 Sinyal Performansı (30g)" accent="green">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <StatTile label="Toplam" value={signals.totalSignals} color="#9178d9" sub="sinyal" />
              <StatTile label="Doğruluk" value={asPct(signals.accuracyRate)} color="#10b981" sub={`${signals.correctPredictions} doğru`} />
              <StatTile label="Gol %" value={asPct(signals.goalAfterSignalRate)} color="#f79520" sub={`${signals.signalsWithGoal} gol`} />
              <StatTile label="Brier" value={asFixed(signals.brierScore)} color="#5794f2" sub="kalibrasyon" />
            </div>
            <Link href="/admin/calibration" className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold">
              Detaylı kalibrasyon analizi →
            </Link>
          </Card>

          <Card title="🧮 Kalibrasyon Sağlığı" accent="blue">
            <div className="grid grid-cols-3 gap-3 mb-3">
              <StatTile label="Ort. Tahmin" value={asPct(signals.avgPredictedP)} color="#5794f2" />
              <StatTile label="Ort. Gözlem" value={asPct(signals.avgObservedP)} color="#10b981" />
              <StatTile label="Kal. Hata" value={asPct(signals.calibrationError)}
                color={signals.calibrationError < 0.1 ? '#10b981' : '#f59e0b'} />
            </div>
            <Link href="/admin/algorithm" className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold">
              Sinyal algoritmasını görüntüle →
            </Link>
          </Card>
        </div>
      )}

      {/* Quick Links */}
      <Card title="⚡ Hızlı Erişim">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Link href="/admin/ml" className="text-center py-3 rounded-lg bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition-colors">
            <div className="text-xl mb-0.5">🤖</div>
            <div className="text-[11px] font-bold text-indigo-700">ML & Modeller</div>
          </Link>
          <Link href="/admin/calibration" className="text-center py-3 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors">
            <div className="text-xl mb-0.5">🎯</div>
            <div className="text-[11px] font-bold text-emerald-700">Kalibrasyon</div>
          </Link>
          <Link href="/admin/algorithm" className="text-center py-3 rounded-lg bg-purple-50 hover:bg-purple-100 border border-purple-200 transition-colors">
            <div className="text-xl mb-0.5">🧠</div>
            <div className="text-[11px] font-bold text-purple-700">Algoritma Akışı</div>
          </Link>
          <a href="/" className="text-center py-3 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors">
            <div className="text-xl mb-0.5">⚽</div>
            <div className="text-[11px] font-bold text-blue-700">Ana Sayfa</div>
          </a>
        </div>
      </Card>
    </div>
  );
}
