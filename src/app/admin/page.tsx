'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';

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

// ── Grafana-style color tokens ──────────────────────────────────
const G = {
  green: '#3cb15c',
  blue: '#5794f2',
  orange: '#f79520',
  red: '#e24d42',
  purple: '#9178d9',
  cyan: '#56a6d9',
  yellow: '#f2c94c',
  gray: '#8e8e8e',
} as const;

function asPct(v: number | null | undefined, decimals = 1): string {
  if (v == null) return '-';
  return `${(v * 100).toFixed(decimals)}%`;
}

function asFixed(v: number | null | undefined, d = 3): string {
  if (v == null) return '-';
  return v.toFixed(d);
}

// ── Login Screen ──────────────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: (token: string, mustChange: boolean) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', username, password }),
      });
      const data = await res.json();
      if (data.ok) {
        sessionStorage.setItem('admin_token', data.token);
        onLogin(data.token, data.mustChange ?? false);
      } else {
        setError(data.reason || 'Giris basarisiz');
      }
    } catch {
      setError('Baglanti hatasi');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#f4f5f5' }}>
      <form onSubmit={handleSubmit} className="bg-white border border-gray-200 p-8 w-full max-w-sm" style={{ borderRadius: 3, boxShadow: '0 0 8px rgba(0,0,0,0.05)' }}>
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">⚽</div>
          <h1 className="text-xl font-semibold text-gray-800 tracking-tight">Gol Radari · Admin</h1>
          <p className="text-xs text-gray-400 mt-1">Lutfen giris yapin</p>
        </div>
        <div className="mb-4">
          <label className="block text-[11px] font-medium text-gray-500 mb-1 uppercase tracking-wide">Kullanici Adi</label>
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin"
            className="w-full px-3 py-2 border border-gray-200 text-sm focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none transition-colors" style={{ borderRadius: 2 }} autoFocus />
        </div>
        <div className="mb-4">
          <label className="block text-[11px] font-medium text-gray-500 mb-1 uppercase tracking-wide">Sifre</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••"
            className="w-full px-3 py-2 border border-gray-200 text-sm focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none transition-colors" style={{ borderRadius: 2 }} />
        </div>
        {error && <p className="text-red-500 text-xs mb-3">{error}</p>}
        <button type="submit" disabled={loading}
          className="w-full py-2.5 text-white text-sm font-medium transition-colors disabled:opacity-50"
          style={{ borderRadius: 2, background: '#5794f2' }}>
          {loading ? 'Giris yapiliyor...' : 'Giris Yap'}
        </button>
      </form>
    </div>
  );
}

// ── Password Change Screen ────────────────────────────────────────
function PasswordChangeScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (newPassword.length < 6) { setError('Yeni sifre en az 6 karakter olmali'); return; }
    if (newPassword !== confirmPassword) { setError('Sifreler eslesmiyor'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'change-password', password: currentPassword, newPassword }),
      });
      const data = await res.json();
      if (data.ok) { onDone(); } else { setError(data.reason || 'Sifre degistirilemedi'); }
    } catch { setError('Baglanti hatasi'); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#f4f5f5' }}>
      <form onSubmit={handleSubmit} className="bg-white border border-gray-200 p-8 w-full max-w-sm" style={{ borderRadius: 3, boxShadow: '0 0 8px rgba(0,0,0,0.05)' }}>
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">🔒</div>
          <h1 className="text-xl font-semibold text-gray-800 tracking-tight">Sifre Degistir</h1>
          <p className="text-xs text-gray-400 mt-1">Ilk giriste sifrenizi degistirmelisiniz</p>
        </div>
        <div className="mb-4">
          <label className="block text-[11px] font-medium text-gray-500 mb-1 uppercase tracking-wide">Mevcut Sifre</label>
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Mevcut sifreniz"
            className="w-full px-3 py-2 border border-gray-200 text-sm focus:border-blue-400 outline-none transition-colors" style={{ borderRadius: 2 }} autoFocus />
        </div>
        <div className="mb-4">
          <label className="block text-[11px] font-medium text-gray-500 mb-1 uppercase tracking-wide">Yeni Sifre</label>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="En az 6 karakter"
            className="w-full px-3 py-2 border border-gray-200 text-sm focus:border-blue-400 outline-none transition-colors" style={{ borderRadius: 2 }} />
        </div>
        <div className="mb-4">
          <label className="block text-[11px] font-medium text-gray-500 mb-1 uppercase tracking-wide">Yeni Sifre (Tekrar)</label>
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Yeni sifreyi tekrar yazin"
            className="w-full px-3 py-2 border border-gray-200 text-sm focus:border-blue-400 outline-none transition-colors" style={{ borderRadius: 2 }} />
        </div>
        {error && <p className="text-red-500 text-xs mb-3">{error}</p>}
        <button type="submit" disabled={loading}
          className="w-full py-2.5 text-white text-sm font-medium transition-colors disabled:opacity-50"
          style={{ borderRadius: 2, background: '#5794f2' }}>
          {loading ? 'Degistiriliyor...' : 'Sifreyi Guncelle'}
        </button>
      </form>
    </div>
  );
}

// ── Grafana Reusable Components ──────────────────────────────────
function Panel({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-gray-200 ${className}`} style={{ borderRadius: 3, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      {title && (
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <div className="w-0.5 h-3 rounded-full" style={{ background: G.blue }} />
          <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{title}</h3>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

function StatPanel({ label, value, unit, color = G.blue, sub }: { label: string; value: string | number; unit?: string; color?: string; sub?: string }) {
  return (
    <div className="text-center">
      <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-2xl font-bold tracking-tight" style={{ color }}>
        {value}{unit && <span className="text-sm font-normal text-gray-400 ml-0.5">{unit}</span>}
      </div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium" style={{ color: ok ? G.green : G.red }}>
      <span className="w-2 h-2 rounded-full" style={{ background: ok ? G.green : G.red }} />
      {label ?? (ok ? 'Aktif' : 'Pasif')}
    </span>
  );
}

function ProgressBar({ pct, color = G.blue, height = 6 }: { pct: number; color?: string; height?: number }) {
  return (
    <div className="w-full rounded-full overflow-hidden" style={{ background: '#e8e8e8', height }}>
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />
    </div>
  );
}

function Spinner() {
  return <div className="inline-block w-4 h-4 border-2 border-gray-200 border-t-blue-400 rounded-full animate-spin" />;
}

// ── Overview Tab ──────────────────────────────────────────────────
import SignalStatsPanel from '@/components/SignalStatsPanel';
import { logError } from '@/lib/devLog';

function OverviewTab({ token }: { token: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mlRes, cacheRes, calRes, signalRes] = await Promise.all([
        authFetch('/api/admin/ml/status'),
        authFetch('/api/admin/fotmob-cache-stats'),
        authFetch('/api/calibration?action=stats'),
        authFetch('/api/goal-signals?action=stats&days=30'),
      ]);
      const ml = mlRes.ok ? await mlRes.json() : null;
      const cache = cacheRes.ok ? await cacheRes.json() : null;
      const cal = calRes.ok ? await calRes.json() : null;
      const signals = signalRes.ok ? await signalRes.json() : null;
      setData({ ml, cache, cal, signals });
    } catch { setData(null); }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (!data) return <div className="text-center py-12 text-gray-400 text-xs">Veri yuklenemedi</div>;

  const { ml, cache, cal, signals } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ── Signal KPI Row ──────────────────────────────── */}
      {signals && signals.totalSignals > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5" style={{ gap: 8 }}>
          <Panel><StatPanel label="Toplam Sinyal" value={signals.totalSignals} color={G.purple} sub="Son 30 gun" /></Panel>
          <Panel><StatPanel label="Dogruluk" value={asPct(signals.accuracyRate)} color={G.green} sub={`${signals.correctPredictions} dogru`} /></Panel>
          <Panel><StatPanel label="Gol Orani" value={asPct(signals.goalAfterSignalRate)} color={G.orange} sub={`${signals.signalsWithGoal} gol`} /></Panel>
          <Panel><StatPanel label="Ort. Gol Suresi" value={signals.avgMinutesAfterSignal || '-'} unit="dk" color={G.cyan} sub="Sinyal sonrasi" /></Panel>
          <Panel><StatPanel label="Brier Skor" value={asFixed(signals.brierScore)} color={G.blue} sub="Kalibrasyon" /></Panel>
        </div>
      )}

      {/* ── System Health Row ──────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: 8 }}>
        <Panel title="ML Trainer">
          <div className="flex items-center gap-3 mb-3">
            <StatusBadge ok={ml?.trainer?.health?.ok} label={`Trainer ${ml?.trainer?.health?.ok ? 'Aktif' : 'Pasif'}`} />
          </div>
          {ml?.champions && Object.keys(ml.champions).length > 0 ? (
            <div className="space-y-1.5">
              {Object.entries(ml.champions).map(([name, c]: [string, any]) => (
                <div key={name} className="flex justify-between text-xs py-1.5 px-2 rounded" style={{ background: '#f7f8fa' }}>
                  <span className="font-medium text-gray-700">{name}</span>
                  <span className="text-gray-400 font-mono">v{c.version}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-[11px] text-gray-400">Henuz champion model yok</p>}
          {ml?.latestMetrics && (
            <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid #f0f0f0' }}>
              <div className="grid grid-cols-2 gap-2">
                <StatPanel label="Brier" value={asFixed(ml.latestMetrics.brierScore, 4)} color={G.blue} />
                <StatPanel label="Shadow Δ" value={asFixed(ml.latestMetrics.shadowBrierDelta, 4)} color={G.purple} />
              </div>
            </div>
          )}
        </Panel>

        <Panel title="FotMob Cache">
          {cache?.cache ? (
            <div className="grid grid-cols-2 gap-3">
              <StatPanel label="Toplam Satir" value={cache.cache.totalRows?.toLocaleString() ?? '-'} color={G.blue} />
              <StatPanel label="Hit Rate" value={cache.cache.cacheHitRatePct != null ? `${cache.cache.cacheHitRatePct}%` : '-'} color={G.green} />
              <StatPanel label="Suresi Dolan" value={cache.cache.expiredRows ?? '-'} color={G.orange} />
              <StatPanel label="Toplam Hit" value={cache.cache.totalHits?.toLocaleString() ?? '-'} color={G.cyan} />
            </div>
          ) : <p className="text-xs text-gray-400">Veri yok</p>}
          {cache?.scheduler && (
            <div className="text-[11px] text-gray-400 mt-3 pt-2 border-t border-gray-50">
              Scheduler: {cache.scheduler.running ? `Aktif (${cache.scheduler.uptimeHuman})` : 'Pasif'}
            </div>
          )}
        </Panel>

        <Panel title="Kalibrasyon">
          {cal ? (
            <div className="grid grid-cols-2 gap-3">
              <StatPanel label="Kayit" value={cal.totalRecords?.toLocaleString() ?? '-'} color={G.blue} />
              <StatPanel label="Brier" value={asFixed(cal.brierScore, 4)} color={G.green} />
              <StatPanel label="Log Loss" value={asFixed(cal.logLoss, 4)} color={G.orange} />
              <StatPanel label="Dogruluk" value={asPct(cal.accuracy)} color={G.purple} />
            </div>
          ) : <p className="text-xs text-gray-400">Veri yok</p>}
        </Panel>
      </div>

      {/* ── Scheduler Row ──────────────────────────────── */}
      {ml?.scheduler && (
        <Panel title="Scheduler">
          <div className="flex flex-wrap items-center gap-6 text-xs">
            <div className="flex items-center gap-2"><span className="text-gray-400">Export:</span><StatusBadge ok={ml.scheduler.exportRunning} label={ml.scheduler.exportRunning ? 'Aktif' : 'Pasif'} /></div>
            <div className="flex items-center gap-2"><span className="text-gray-400">InPlay:</span><StatusBadge ok={ml.scheduler.inplayRunning} label={ml.scheduler.inplayRunning ? 'Aktif' : 'Pasif'} /></div>
            <div className="flex items-center gap-2"><span className="text-gray-400">Son Export:</span><span className="font-mono text-gray-600">{ml.scheduler.lastExportAt ? new Date(ml.scheduler.lastExportAt).toLocaleString('tr-TR') : '-'}</span></div>
            <div className="flex items-center gap-2"><span className="text-gray-400">Son InPlay:</span><span className="font-mono text-gray-600">{ml.scheduler.lastInplayAt ? new Date(ml.scheduler.lastInplayAt).toLocaleString('tr-TR') : '-'}</span></div>
          </div>
        </Panel>
      )}

      {/* ── Signal Detail Row ──────────────────────────────── */}
      {signals && signals.totalSignals > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 8 }}>
          <Panel title="Sinyal Sonuc Dagilimi">
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-[10px] text-gray-400 mb-1.5">
                  <span>Dogru / Yanlis / Gol Yok / Bekleyen</span>
                  <span className="font-mono">{signals.totalSignals} sinyal</span>
                </div>
                <div className="h-3 rounded-full overflow-hidden flex" style={{ background: '#e8e8e8' }}>
                  {signals.correctPredictions > 0 && <div className="h-full transition-all duration-500" style={{ width: `${(signals.correctPredictions / Math.max(1, signals.totalSignals)) * 100}%`, background: G.green }} />}
                  {signals.incorrectPredictions > 0 && <div className="h-full transition-all duration-500" style={{ width: `${(signals.incorrectPredictions / Math.max(1, signals.totalSignals)) * 100}%`, background: G.red }} />}
                  {signals.signalsWithoutGoal > 0 && <div className="h-full transition-all duration-500" style={{ width: `${(signals.signalsWithoutGoal / Math.max(1, signals.totalSignals)) * 100}%`, background: '#d0d0d0' }} />}
                  {signals.signalsPending > 0 && <div className="h-full transition-all duration-500" style={{ width: `${(signals.signalsPending / Math.max(1, signals.totalSignals)) * 100}%`, background: G.yellow }} />}
                </div>
                <div className="flex flex-wrap gap-3 mt-2 text-[10px] text-gray-400">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: G.green }} /> Dogru {signals.correctPredictions}</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: G.red }} /> Yanlis {signals.incorrectPredictions}</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: '#d0d0d0' }} /> Gol yok {signals.signalsWithoutGoal}</span>
                  {signals.signalsPending > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: G.yellow }} /> Bekleyen {signals.signalsPending}</span>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="text-center py-2 rounded" style={{ background: '#fef3e8' }}>
                  <div className="text-sm font-bold" style={{ color: G.orange }}>{asPct(signals.homeSideAccuracy, 0)}</div>
                  <div className="text-[10px] text-gray-400">Ev Sahibi Dogrulugu</div>
                </div>
                <div className="text-center py-2 rounded" style={{ background: '#edf2fb' }}>
                  <div className="text-sm font-bold" style={{ color: G.blue }}>{asPct(signals.awaySideAccuracy, 0)}</div>
                  <div className="text-[10px] text-gray-400">Deplasman Dogrulugu</div>
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Kalibrasyon Sagligi">
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <StatPanel label="Ort. Tahmin" value={asPct(signals.avgPredictedP)} color={G.blue} />
                <StatPanel label="Ort. Gozlem" value={asPct(signals.avgObservedP)} color={G.green} />
                <StatPanel label="Kal. Hata" value={asPct(signals.calibrationError)} color={signals.calibrationError < 0.1 ? G.green : G.orange} />
              </div>
              {signals.buckets?.filter((b: any) => b.total > 0).length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Olasilik Araliklari</div>
                  <div className="space-y-1.5">
                    {signals.buckets.filter((b: any) => b.total > 0).map((b: any) => (
                      <div key={b.range} className="flex items-center gap-2 text-[10px]">
                        <span className="w-16 text-gray-500 font-mono">{b.range}</span>
                        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: '#e8e8e8' }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.min(100, b.goalRate)}%`, background: b.goalRate >= 40 ? G.green : b.goalRate >= 20 ? G.orange : G.red }} />
                        </div>
                        <span className="w-20 text-right text-gray-400">{b.total} sinyal · {b.goalRate}% gol</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Panel>
        </div>
      )}

      {/* ── Signal Level Distribution ──────────────────────── */}
      {signals?.levelDistribution && Object.keys(signals.levelDistribution).length > 0 && (
        <Panel title="Sinyal Seviye Dagilimi">
          <div className="grid grid-cols-4 gap-3">
            {Object.entries(signals.levelDistribution).map(([level, d]: [string, any]) => {
              const colors: Record<string, string> = { low: G.gray, medium: G.orange, high: G.orange, critical: G.red };
              return (
                <div key={level} className="text-center py-3 rounded" style={{ background: '#f7f8fa', borderLeft: `3px solid ${colors[level] || G.gray}` }}>
                  <div className="text-[11px] font-semibold capitalize text-gray-700">{level}</div>
                  <div className="text-xl font-bold text-gray-800">{d.total}</div>
                  <div className="text-[10px] text-gray-400">{d.goals} gol · {d.correct} dogru</div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </div>
  );
}

// ── ML Models Tab ─────────────────────────────────────────────────
function MLModelsTab({ token }: { token: string }) {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [actionResult, setActionResult] = useState('');
  const [backtestDays, setBacktestDays] = useState(14);
  const [backtestResult, setBacktestResult] = useState<any>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    try { const res = await authFetch('/api/admin/ml/status'); if (res.ok) setStatus(await res.json()); } catch (e) { logError('page', e); }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (name: string, url: string, body?: any) => {
    setActionLoading(name); setActionResult('');
    try {
      const res = await authFetch(url, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined });
      const data = await res.json();
      setActionResult(`${name}: ${res.ok ? 'Basarili' : 'Hata'} — ${JSON.stringify(data).slice(0, 300)}`);
      if (res.ok) load();
    } catch (e: any) { setActionResult(`${name}: Hata — ${e.message}`); }
    setActionLoading('');
  };

  const runBacktest = async (nm: string, ver: string) => {
    setBacktestLoading(true); setBacktestResult(null);
    try {
      const res = await authFetch('/api/admin/ml/model-backtest', {
        method: 'POST',
        body: JSON.stringify({ mode: 'artifact', name: nm, version: ver, days: backtestDays }),
      });
      const data = await res.json();
      if (data.ok) setBacktestResult(data.result);
      else setBacktestResult({ error: data.error });
    } catch (e: any) { setBacktestResult({ error: e.message }); }
    setBacktestLoading(false);
  };

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Panel title="Champion Modeller">
        {status?.champions && Object.keys(status.champions).length > 0 ? (
          <div className="space-y-2">
            {Object.entries(status.champions).map(([name, c]: [string, any]) => (
              <div key={name} className="flex items-center justify-between py-2 px-3 rounded" style={{ background: '#f7f8fa' }}>
                <div><span className="font-semibold text-sm text-gray-800">{name}</span><span className="ml-2 text-xs text-gray-400 font-mono">v{c.version}</span></div>
                <button onClick={() => doAction(`compare-${name}`, `/api/admin/ml/compare?name=${name}&version=${c.version}`)} disabled={!!actionLoading}
                  className="px-3 py-1 text-[11px] font-medium rounded transition-colors disabled:opacity-50" style={{ background: '#edf2fb', color: G.blue }}>
                  {actionLoading === `compare-${name}` ? <Spinner /> : 'Karsilastir'}
                </button>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-gray-400">Henuz champion model yok</p>}
      </Panel>

      {/* ── Model Performance Metrics ────────────────────────── */}
      {status?.latestMetrics && (
        <Panel title="Model Performans Metrikleri (Son Gun)">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatPanel label="Champion Brier" value={status.latestMetrics.brierScore?.toFixed(4) ?? '-'} color={G.blue} />
            <StatPanel label="GBDT Brier" value={status.latestMetrics.gbdtBrier?.toFixed(4) ?? '-'} color={G.green} />
            <StatPanel label="XGB Brier" value={status.latestMetrics.xgbBrier?.toFixed(4) ?? '-'} color={G.orange} />
            <StatPanel label="InPlay Brier" value={status.latestMetrics.inPlayBrier?.toFixed(4) ?? '-'} color={G.purple} />
          </div>
          {status.latestMetrics.shadowBrierDelta != null && (
            <div className="flex items-center gap-2 mt-3 pt-2 border-t border-gray-100 text-xs">
              <span className="text-gray-400">Shadow Delta:</span>
              <span className="font-mono font-semibold" style={{ color: status.latestMetrics.shadowBrierDelta < 0 ? G.green : G.red }}>
                {status.latestMetrics.shadowBrierDelta > 0 ? '+' : ''}{status.latestMetrics.shadowBrierDelta?.toFixed(4)}
              </span>
              <span className="text-gray-400">(n={status.latestMetrics.nShadowSamples})</span>
            </div>
          )}
        </Panel>
      )}

      {/* ── Model Artifact List ─────────────────────────────── */}
      {status?.allArtifacts?.length > 0 && (
        <Panel title="Tum Model Surumleri">
          <div className="overflow-x-auto max-h-48 overflow-y-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-gray-400 border-b border-gray-100 sticky top-0 bg-white">
                <th className="py-1.5 pr-3 font-medium">Model</th><th className="py-1.5 pr-3 font-medium">Surum</th><th className="py-1.5 pr-3 font-medium">Egitim Brier</th><th className="py-1.5 pr-3 font-medium">Egitim Acc</th><th className="py-1.5 pr-3 font-medium">Champion</th><th className="py-1.5 font-medium">Islem</th>
              </tr></thead>
              <tbody>
                {status.allArtifacts.map((a: any) => (
                  <tr key={`${a.name}-${a.version}`} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-1.5 pr-3 font-medium text-gray-700">{a.name}</td>
                    <td className="py-1.5 pr-3 font-mono text-gray-500">{a.version}</td>
                    <td className="py-1.5 pr-3 font-mono text-gray-600">{a.metrics?.brier?.toFixed(4) ?? '-'}</td>
                    <td className="py-1.5 pr-3 font-mono text-gray-600">{a.metrics?.accuracy != null ? `${(a.metrics.accuracy * 100).toFixed(1)}%` : '-'}</td>
                    <td className="py-1.5 pr-3">{a.isChampion ? <StatusBadge ok={true} label="Champion" /> : <span className="text-gray-300">-</span>}</td>
                    <td className="py-1.5 flex gap-1">
                      <button onClick={() => runBacktest(a.name, a.version)}
                        disabled={backtestLoading || !a.fileExists}
                        className="text-[10px] font-medium rounded px-2 py-0.5 transition-colors disabled:opacity-50"
                        style={{ background: a.fileExists ? '#edf2fb' : '#f0f0f0', color: a.fileExists ? G.blue : '#bbb' }}>
                        {backtestLoading ? <Spinner /> : (a.fileExists ? 'Backtest' : 'Dosya Yok')}
                      </button>
                      {!a.isChampion && a.fileExists && (
                        <button onClick={async () => {
                          if (!confirm(`${a.name}@${a.version} champion yapilsin mi?`)) return;
                          setActionLoading(`promote-${a.name}-${a.version}`);
                          try {
                            const res = await authFetch('/api/admin/ml/promote', {
                              method: 'POST',
                              body: JSON.stringify({ name: a.name, version: a.version, confirm: true }),
                            });
                            const data = await res.json();
                            setActionResult(`Promote: ${data.ok ? 'Basarili' : 'Hata'} — ${JSON.stringify(data).slice(0, 200)}`);
                            if (data.ok) load();
                          } catch (e: any) { setActionResult(`Promote: Hata — ${e.message}`); }
                          setActionLoading('');
                        }} disabled={!!actionLoading}
                          className="text-[10px] font-medium rounded px-2 py-0.5 transition-colors"
                          style={{ background: '#d1fae5', color: '#059669' }}>
                          {actionLoading === `promote-${a.name}-${a.version}` ? <Spinner /> : 'Champion Yap'}
                        </button>
                      )}
                      {!a.isChampion && (
                        <button onClick={async () => {
                          if (!confirm(`${a.name}@${a.version} silinsin mi?`)) return;
                          setDeleteLoading(`${a.name}-${a.version}`);
                          try {
                            const res = await authFetch('/api/admin/ml/artifact', {
                              method: 'DELETE',
                              body: JSON.stringify({ name: a.name, version: a.version }),
                            });
                            const data = await res.json();
                            if (data.ok) load();
                            else alert('Hata: ' + (data.error || ''));
                          } catch (e: any) { alert('Hata: ' + e.message); }
                          setDeleteLoading('');
                        }} disabled={deleteLoading === `${a.name}-${a.version}`}
                          className="text-[10px] font-medium rounded px-2 py-0.5 transition-colors"
                          style={{ background: '#fee2e2', color: '#dc2626' }}>
                          {deleteLoading === `${a.name}-${a.version}` ? <Spinner /> : 'Sil'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* ── Backtest Result ─────────────────────────────────── */}
      {backtestResult && (
        <Panel title="Backtest Sonucu">
          {backtestResult.error ? (
            <p className="text-xs text-red-500">{backtestResult.error}</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatPanel label="Brier Skor" value={backtestResult.brierScore?.toFixed(4) ?? '-'} color={G.blue} />
                <StatPanel label="Dogruluk" value={backtestResult.accuracy != null ? `${(backtestResult.accuracy * 100).toFixed(1)}%` : '-'} color={G.green} />
                <StatPanel label="Kalibrasyon Hatasi" value={backtestResult.calibrationError?.toFixed(4) ?? '-'} color={G.orange} />
                <StatPanel label="Ornek Sayisi" value={backtestResult.totalPredictions?.toLocaleString() ?? '-'} color={G.purple} />
              </div>
              {backtestResult.sideAccuracy && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="text-center py-2 rounded" style={{ background: '#fef3e8' }}>
                    <div className="text-xs font-bold" style={{ color: G.orange }}>{((backtestResult.sideAccuracy.home ?? 0) * 100).toFixed(0)}%</div>
                    <div className="text-[10px] text-gray-400">Ev Sahibi Dogrulugu</div>
                  </div>
                  <div className="text-center py-2 rounded" style={{ background: '#edf2fb' }}>
                    <div className="text-xs font-bold" style={{ color: G.blue }}>{((backtestResult.sideAccuracy.away ?? 0) * 100).toFixed(0)}%</div>
                    <div className="text-[10px] text-gray-400">Deplasman Dogrulugu</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </Panel>
      )}

      {/* ── Backtest Controls ───────────────────────────────── */}
      <Panel title="Backtest Parametreleri">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Gun:</span>
            <input type="number" value={backtestDays} onChange={(e) => setBacktestDays(Math.min(90, Math.max(1, parseInt(e.target.value) || 14)))}
              className="w-16 px-2 py-1 border border-gray-200 text-xs rounded focus:border-blue-400 outline-none" />
          </div>
          <span className="text-[10px] text-gray-400">Backtest yapmak icin yukaridaki model satirindaki butona tikla</span>
        </div>
      </Panel>

      <Panel title="Model Egit">
        <div className="flex flex-wrap gap-2">
          {['gbdt', 'xgb', 'inplay'].map((name) => (
            <button key={name} onClick={() => doAction(`train-${name}`, '/api/admin/ml/train', { name })} disabled={!!actionLoading}
              className="px-4 py-2 text-sm text-white font-medium rounded transition-colors disabled:opacity-50" style={{ background: G.blue }}>
              {actionLoading === `train-${name}` ? <Spinner /> : `Train ${name}`}
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Training Datasets">
        {status?.recentDatasets?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-gray-400 border-b border-gray-100">
                <th className="py-2 pr-3 font-medium">ID</th><th className="py-2 pr-3 font-medium">Horizon</th><th className="py-2 pr-3 font-medium">Satir</th><th className="py-2 pr-3 font-medium">Brier</th><th className="py-2 pr-3 font-medium">Durum</th><th className="py-2 font-medium">Tarih</th>
              </tr></thead>
              <tbody>
                {status.recentDatasets.map((d: any) => (
                  <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 pr-3 font-mono text-[10px] text-gray-500">{d.id.slice(0, 8)}</td>
                    <td className="py-2 pr-3">{d.horizonMin}dk</td>
                    <td className="py-2 pr-3">{d.rowCount?.toLocaleString()}</td>
                    <td className="py-2 pr-3 font-mono">{d.brier?.toFixed(4) ?? '-'}</td>
                    <td className="py-2 pr-3"><StatusBadge ok={d.status === 'ready'} label={d.status} /></td>
                    <td className="py-2 text-gray-400">{new Date(d.createdAt).toLocaleDateString('tr-TR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-xs text-gray-400">Dataset yok</p>}
      </Panel>

      {/* ── ML Pipeline ────────────────────────────────────────── */}
      <Panel title="Pipeline">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <select id="pipelineModel" className="text-xs px-3 py-1.5 rounded border border-gray-200 bg-white" defaultValue="gbdt">
              <option value="gbdt">GBDT</option>
              <option value="xgb">XGBoost</option>
              <option value="inplay">In-play</option>
            </select>
            <select id="pipelineHorizon" className="text-xs px-3 py-1.5 rounded border border-gray-200 bg-white" defaultValue="5">
              <option value="5">5dk</option>
              <option value="10">10dk</option>
              <option value="15">15dk</option>
            </select>
            <button onClick={() => {
              const model = (document.getElementById('pipelineModel') as HTMLSelectElement)?.value || 'gbdt';
              const horizon = parseInt((document.getElementById('pipelineHorizon') as HTMLSelectElement)?.value || '5');
              doAction('pipeline', '/api/admin/ml/pipeline', { modelName: model, horizonMin: horizon });
            }} disabled={!!actionLoading}
              className="px-4 py-1.5 text-xs font-bold rounded text-white disabled:opacity-50 transition-colors" style={{ background: '#6366f1' }}>
              {actionLoading === 'pipeline' ? <Spinner /> : 'Pipeline Başlat'}
            </button>
          </div>

          {/* Active/recent pipeline runs */}
          <PipelineRunsView token={token} reloadTrigger={actionLoading} />
        </div>
      </Panel>

      {actionResult && <div className="p-3 rounded text-xs text-gray-600 font-mono break-all" style={{ background: '#f7f8fa' }}>{actionResult}</div>}
    </div>
  );
}

function PipelineRunsView({ token, reloadTrigger }: { token: string; reloadTrigger: string }) {
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/admin/ml/pipeline');
      if (res.ok) setRuns(await res.json());
    } catch {}
    setLoading(false);
  }, [token, reloadTrigger]);

  useEffect(() => { load(); }, [load]);

  const active = runs.filter(r => r.status !== 'done' && r.status !== 'failed');

  return (
    <div className="space-y-2 mt-2">
      {active.length > 0 && (
        <div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Aktif Pipeline</div>
          {active.map(r => (
            <PipelineRunCard key={r.id} run={r} />
          ))}
        </div>
      )}
      <div>
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Geçmiş</div>
        {runs.filter(r => r.status === 'done' || r.status === 'failed').slice(0, 5).map(r => (
          <div key={r.id} className="flex items-center justify-between py-1.5 px-2 rounded text-[11px] hover:bg-gray-50" style={r.status === 'failed' ? { borderLeft: '3px solid #e24d42' } : { borderLeft: '3px solid #3cb15c' }}>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-gray-700">{r.modelName}</span>
              {r.newVersion && <span className="text-[10px] text-gray-400">v{r.newVersion}</span>}
            </div>
            <div className="flex items-center gap-2">
              {r.isPromoted && <span className="text-[10px] font-bold text-green-600">🏆 Champion</span>}
              {r.brierDelta != null && (
                <span className="text-[10px] font-mono" style={{ color: r.isBetter ? '#3cb15c' : '#e24d42' }}>
                  Δ{r.brierDelta > 0 ? '+' : ''}{r.brierDelta.toFixed(4)}
                </span>
              )}
              <span className="text-[9px] text-gray-400">{new Date(r.createdAt).toLocaleDateString('tr-TR')}</span>
            </div>
          </div>
        ))}
        {runs.length === 0 && !loading && <p className="text-[11px] text-gray-400 py-2">Henüz pipeline çalıştırılmadı.</p>}
      </div>
    </div>
  );
}

function PipelineRunCard({ run }: { run: any }) {
  const [status, setStatus] = useState(run);

  useEffect(() => {
    if (status.status === 'done' || status.status === 'failed') return;
    const interval = setInterval(async () => {
      try {
        const res = await authFetch(`/api/admin/ml/pipeline?id=${run.id}`);
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
          if (data.status === 'done' || data.status === 'failed') clearInterval(interval);
        } else if (res.status === 401) {
          clearInterval(interval); // stop polling on auth failure
        }
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [run.id, status.status]);

  const pct = status.progressPct || 0;
  const barColor = status.status === 'failed' ? '#e24d42' : status.status === 'done' ? '#3cb15c' : '#6366f1';

  return (
    <div className="p-3 rounded border border-gray-200 bg-white">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-700">{status.modelName}</span>
          {status.newVersion && <span className="text-[10px] text-gray-400 font-mono">v{status.newVersion}</span>}
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
            status.status === 'done' ? 'bg-green-50 text-green-600' :
            status.status === 'failed' ? 'bg-red-50 text-red-500' :
            'bg-indigo-50 text-indigo-600'
          }`}>{status.status}</span>
        </div>
        <span className="text-[10px] text-gray-400 font-mono">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden mb-1">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: barColor }} />
      </div>
      <div className="text-[10px] text-gray-500 truncate">{status.step || 'Başlatılıyor...'}</div>
      {status.errorMsg && <div className="mt-1 text-[9px] text-red-400 truncate">{status.errorMsg}</div>}
      {status.newBrier != null && (
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-gray-100 text-[10px]">
          <span>Brier: <strong>{status.newBrier.toFixed(4)}</strong></span>
          {status.oldChampionBrier != null && (
            <>
              <span>Eski: <strong>{status.oldChampionBrier.toFixed(4)}</strong></span>
              <span style={{ color: status.isBetter ? '#3cb15c' : '#e24d42' }}>
                Δ{status.brierDelta > 0 ? '+' : ''}{status.brierDelta.toFixed(4)}
              </span>
            </>
          )}
          {status.isPromoted && <span className="font-bold text-green-600">🏆 Champion</span>}
        </div>
      )}
    </div>
  );
}
function CalibrationTab({ token }: { token: string }) {
  const [calData, setCalData] = useState<any>(null);
  const [smartData, setSmartData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionResult, setActionResult] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [calRes, smartRes] = await Promise.all([fetch('/api/calibration?action=stats'), fetch('/api/smart-calibration?action=status')]);
      if (calRes.ok) setCalData(await calRes.json());
      if (smartRes.ok) setSmartData(await smartRes.json());
    } catch (e) { logError('page', e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const autocalibrate = async () => {
    try { const res = await fetch('/api/calibration?action=autocalibrate'); const data = await res.json(); setActionResult(data.message || JSON.stringify(data)); load(); } catch (e: any) { setActionResult(`Hata: ${e.message}`); }
  };

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 8 }}>
        <Panel title="Kalibrasyon Istatistikleri">
          {calData ? (
            <div className="grid grid-cols-2 gap-3 mb-3">
              <StatPanel label="Kayit" value={calData.totalRecords?.toLocaleString() ?? '-'} color={G.blue} />
              <StatPanel label="Brier" value={asFixed(calData.brierScore, 4)} color={G.green} />
              <StatPanel label="Log Loss" value={asFixed(calData.logLoss, 4)} color={G.orange} />
              <StatPanel label="Dogruluk" value={asPct(calData.accuracy)} color={G.purple} />
            </div>
          ) : <p className="text-xs text-gray-400 mb-3">Veri yok</p>}
          <button onClick={autocalibrate} className="w-full py-2 text-sm text-white font-medium rounded transition-colors" style={{ background: G.blue }}>Otomatik Kalibrasyon</button>
        </Panel>

        <Panel title="Smart Kalibrasyon (F8)">
          {smartData?.mode && (
            <div className="space-y-2.5">
              <div className="flex justify-between text-xs"><span className="text-gray-400">Mod:</span><StatusBadge ok={smartData.mode.mode === 'auto'} label={smartData.mode.mode} /></div>
              <div className="flex justify-between text-xs"><span className="text-gray-400">Sensitivite:</span><span className="font-medium text-gray-700">{smartData.mode.sensitivity}</span></div>
              <div className="flex justify-between text-xs"><span className="text-gray-400">Min Ornek:</span><span className="font-medium text-gray-700">{smartData.mode.minSampleSize}</span></div>
              <div className="flex justify-between text-xs"><span className="text-gray-400">Odds Compound:</span><StatusBadge ok={smartData.mode.oddsCompoundEnabled} label={smartData.mode.oddsCompoundEnabled ? 'Aktif' : 'Pasif'} /></div>
            </div>
          )}
          {smartData?.f8Calibration && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">F8 Kalibrasyon</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-gray-400">Dampener:</span> <span className="font-mono">{smartData.f8Calibration.calibratedDampener?.toFixed(2)}</span></div>
                <div><span className="text-gray-400">Danger Boost:</span> <span className="font-mono">{smartData.f8Calibration.calibratedDangerBoost?.toFixed(2)}</span></div>
                <div><span className="text-gray-400">Kaynak:</span> <span className="font-mono">{smartData.f8Calibration.source}</span></div>
              </div>
              {smartData.f8Calibration.explanation && <p className="mt-2 text-[11px] text-gray-500">{smartData.f8Calibration.explanation}</p>}
            </div>
          )}
        </Panel>
      </div>

      {smartData?.topLeagues?.length > 0 && (
        <Panel title="Lig Profilleri">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-gray-400 border-b border-gray-100"><th className="py-2 pr-3 font-medium">Lig ID</th><th className="py-2 pr-3 font-medium">Ort. Gol Dakikasi</th><th className="py-2 pr-3 font-medium">Erken Gol %</th><th className="py-2 font-medium">Gec Gol %</th></tr></thead>
              <tbody>
                {smartData.topLeagues.map((p: any) => (
                  <tr key={p.leagueId} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 pr-3 font-medium text-gray-700">{p.leagueId}</td>
                    <td className="py-2 pr-3 font-mono">{p.avgGoalMinute?.toFixed(1)}</td>
                    <td className="py-2 pr-3 font-mono">{(p.earlyGoalRate * 100)?.toFixed(1)}%</td>
                    <td className="py-2 font-mono">{(p.lateGoalRate * 100)?.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {actionResult && <div className="p-3 rounded text-xs text-gray-600 font-mono break-all" style={{ background: '#f7f8fa' }}>{actionResult}</div>}
    </div>
  );
}

// ── Signals Tab ───────────────────────────────────────────────────
function SignalsTab() {
  return <SignalStatsPanel />;
}

// ── Elo Tab ───────────────────────────────────────────────────────
function EloTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { const res = await fetch('/api/elo?action=all'); if (res.ok) setData(await res.json()); } catch (e) { logError('page', e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;

  const entries = data ? Object.entries(data)
    .filter(([name]: [string, any]) => !search || name.toLowerCase().includes(search.toLowerCase()))
    .sort(([, a]: [string, any], [, b]: [string, any]) => (b.rating ?? 1500) - (a.rating ?? 1500))
    .slice(0, 50) : [];

  const top5 = entries.slice(0, 5);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {top5.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5" style={{ gap: 8 }}>
          {top5.map(([name, r]: [string, any], i) => (
            <Panel key={name}>
              <div className="text-center">
                <div className="text-[10px] text-gray-400 mb-1">#{i + 1}</div>
                <div className="text-xs font-semibold text-gray-700 truncate">{name}</div>
                <div className="text-xl font-bold mt-1" style={{ color: i === 0 ? G.green : G.blue }}>{r.rating?.toFixed(0)}</div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Panel title="Elo Siralamasi">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Takim ara..."
          className="w-full px-3 py-2 border border-gray-200 text-sm mb-3 focus:border-blue-400 outline-none transition-colors" style={{ borderRadius: 2 }} />
        <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white"><tr className="text-left text-gray-400 border-b border-gray-100"><th className="py-2 pr-3 font-medium w-10">#</th><th className="py-2 pr-3 font-medium">Takim</th><th className="py-2 pr-3 font-medium">Rating</th><th className="py-2 pr-3 font-medium">Form</th><th className="py-2 font-medium">Mac</th></tr></thead>
            <tbody>
              {entries.map(([name, r]: [string, any], i) => (
                <tr key={name} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 pr-3 text-gray-400 w-10">{i + 1}</td>
                  <td className="py-2 pr-3 font-medium text-gray-800">{name}</td>
                  <td className="py-2 pr-3 font-mono font-semibold text-gray-700">{r.rating?.toFixed(0) ?? '-'}</td>
                  <td className="py-2 pr-3 font-mono text-gray-500">{r.formIndex?.toFixed(2) ?? '-'}</td>
                  <td className="py-2 text-gray-400">{r.matchesPlayed ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ── Elo Import Tab ────────────────────────────────────────────────
function EloImportTab({ token }: { token: string }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<any>(null);
  const [manualEntries, setManualEntries] = useState('');
  const [fetchTeams, setFetchTeams] = useState('');

  useEffect(() => {
    if (!jobId) return;
    const poll = setInterval(async () => {
      try {
        const res = await authFetch('/api/admin/elo-import', { method: 'POST', body: JSON.stringify({ action: 'job-progress', jobId }) });
        const data = await res.json(); setProgress(data);
        if (data.status === 'done' || data.status === 'failed') { clearInterval(poll); setJobId(null); setResult(data); }
      } catch (e) { logError('page', e); }
    }, 1500);
    return () => clearInterval(poll);
  }, [jobId]);

  const doImport = async (action: string, body: any) => {
    setLoading(true); setResult(null);
    try {
      const res = await authFetch('/api/admin/elo-import', { method: 'POST', body: JSON.stringify({ action, ...body }) });
      const data = await res.json();
      if (data.jobId) { setJobId(data.jobId); setProgress({ status: 'running', progressPct: 0, totalTeams: data.total, fetchedTeams: 0, failedTeams: 0 }); }
      else { setResult(data); }
    } catch (e: any) { setResult({ error: e.message }); }
    setLoading(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: 8 }}>
        <Panel title="Super Lig Ice Aktar">
          <p className="text-[11px] text-gray-400 mb-3">Turk takimlarinin Elo rating'lerini coklu kaynaktan ceker.</p>
          <button onClick={() => doImport('fetch-league', { country: 'TUR' })} disabled={loading} className="w-full py-2 text-white text-sm font-medium rounded transition-colors disabled:opacity-50" style={{ background: G.red }}>{loading ? <Spinner /> : 'Super Lig Cek'}</button>
        </Panel>
        <Panel title="Avrupa Kulupleri Ice Aktar">
          <p className="text-[11px] text-gray-400 mb-3">Major Avrupa kuluplerinin Elo rating'leri.</p>
          <button onClick={() => doImport('fetch-league', { country: 'EUR' })} disabled={loading} className="w-full py-2 text-white text-sm font-medium rounded transition-colors disabled:opacity-50" style={{ background: G.blue }}>{loading ? <Spinner /> : 'Avrupa Cek'}</button>
        </Panel>
        <Panel title="Tum Takimlari Cek">
          <p className="text-[11px] text-gray-400 mb-3">TeamMapping'teki TUM takimlarin Elo rating'lerini arkaplanda ceker.</p>
          <button onClick={async () => {
            setLoading(true); setResult(null);
            try {
              const res = await authFetch('/api/admin/elo-import', { method: 'POST', body: JSON.stringify({ action: 'fetch-all-mappings' }) });
              const data = await res.json();
              if (data.jobId) { setJobId(data.jobId); setProgress({ status: 'running', progressPct: 0, totalTeams: data.total, fetchedTeams: 0, failedTeams: 0 }); }
              else { setResult(data); }
            } catch (e: any) { setResult({ error: e.message }); }
            setLoading(false);
          }} disabled={loading || !!jobId} className="w-full py-2 text-white text-sm font-medium rounded transition-colors disabled:opacity-50" style={{ background: G.green }}>{loading ? <Spinner /> : 'Tum Takimlari Cek'}</button>
        </Panel>
      </div>

      {progress && (
        <Panel title="Ilerleme">
          <div className="space-y-3">
            <div className="flex justify-between text-xs text-gray-600">
              <span>{progress.status === 'done' ? 'Tamamlandi' : progress.status === 'failed' ? 'Basarisiz' : 'Calisiyor...'}</span>
              <span className="font-mono">{progress.fetchedTeams ?? 0} / {progress.totalTeams ?? 0} takim</span>
            </div>
            <ProgressBar pct={progress.progressPct ?? 0} color={progress.status === 'done' ? G.green : progress.status === 'failed' ? G.red : G.blue} />
            <div className="flex justify-between text-[10px] text-gray-400"><span>Basarili: {progress.fetchedTeams ?? 0}</span><span>Basarisiz: {progress.failedTeams ?? 0}</span><span className="font-mono">%{progress.progressPct ?? 0}</span></div>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 8 }}>
        <Panel title="Takim Listesi ile Cek">
          <p className="text-[11px] text-gray-400 mb-2">Takim isimlerini virgulle ayirarak girin. ClubElo → FootballDB → Tahmin.</p>
          <textarea value={fetchTeams} onChange={(e) => setFetchTeams(e.target.value)} placeholder="Galatasaray, Fenerbahce, Besiktas, RealMadrid, Barcelona"
            className="w-full px-3 py-2 border border-gray-200 text-xs h-20 resize-none focus:border-blue-400 outline-none transition-colors font-mono" style={{ borderRadius: 2 }} />
          <button onClick={() => { const teams = fetchTeams.split(',').map(t => t.trim()).filter(Boolean); if (teams.length > 0) doImport('fetch', { teams }); }} disabled={loading || !fetchTeams.trim()}
            className="mt-2 w-full py-2 text-white text-sm font-medium rounded transition-colors disabled:opacity-50" style={{ background: G.purple }}>{loading ? <Spinner /> : 'Cek'}</button>
        </Panel>
        <Panel title="Manuel Giris">
          <p className="text-[11px] text-gray-400 mb-2">Her satira: takimadi, rating (or: Galatasaray, 1750)</p>
          <textarea value={manualEntries} onChange={(e) => setManualEntries(e.target.value)} placeholder={"Galatasaray, 1750\nFenerbahce, 1720\nBesiktas, 1680"}
            className="w-full px-3 py-2 border border-gray-200 text-xs h-20 resize-none focus:border-blue-400 outline-none transition-colors font-mono" style={{ borderRadius: 2 }} />
          <button onClick={() => {
            const entries = manualEntries.split('\n').map(line => { const parts = line.split(',').map(s => s.trim()); if (parts.length >= 2) { const rating = parseFloat(parts[1]); if (!isNaN(rating)) return { team: parts[0], rating }; } return null; }).filter(Boolean);
            if (entries.length > 0) doImport('manual', { entries });
          }} disabled={loading || !manualEntries.trim()}
            className="mt-2 w-full py-2 text-white text-sm font-medium rounded transition-colors disabled:opacity-50" style={{ background: G.orange }}>{loading ? <Spinner /> : 'Kaydet'}</button>
        </Panel>
      </div>

      {result && !result.jobId && (
        <Panel title="Sonuc">
          {result.ok && <div className="flex flex-wrap gap-4"><StatPanel label="Ice Aktarilan" value={result.imported ?? 0} color={G.green} />{result.failed?.length > 0 && <StatPanel label="Basarisiz" value={result.failed.length} color={G.red} />}{result.country && <StatPanel label="Lig" value={result.country} color={G.blue} />}</div>}
          {result.results?.length > 0 && <div className="mt-2"><div className="text-[10px] text-gray-400 mb-1 uppercase tracking-wide">Cekilen Rating'ler</div><div className="grid grid-cols-2 md:grid-cols-4 gap-1">{result.results.map((r: any) => <div key={r.team} className="flex justify-between text-xs px-2 py-1 rounded" style={{ background: '#f7f8fa' }}><span className="text-gray-700">{r.team}</span><span className="font-mono font-semibold" style={{ color: G.green }}>{r.rating}</span></div>)}</div></div>}
          {result.failed?.length > 0 && <div className="mt-2"><div className="text-[10px] text-red-400 mb-1 uppercase tracking-wide">Bulunamayan Takimlar</div><div className="flex flex-wrap gap-1">{result.failed.map((t: string) => <span key={t} className="text-[10px] text-red-500 px-2 py-0.5 rounded" style={{ background: '#fde8e8' }}>{t}</span>)}</div></div>}
          {result.error && <div className="text-xs text-red-500 p-2 rounded" style={{ background: '#fde8e8' }}>{result.error}</div>}
        </Panel>
      )}
    </div>
  );
}

// ── Backfill Tab ──────────────────────────────────────────────────
function BackfillTab({ token }: { token: string }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [daysBack, setDaysBack] = useState(30);
  const [maxMatches, setMaxMatches] = useState(300);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<any>(null);

  useEffect(() => {
    if (!jobId) return;
    const poll = setInterval(async () => {
      try {
        const res = await authFetch(`/api/admin/backfill-predictions?jobId=${jobId}`);
        const data = await res.json(); setProgress(data);
        if (data.status === 'done' || data.status === 'failed') { clearInterval(poll); setJobId(null); setResult(data); }
      } catch (e) { logError('page', e); }
    }, 1500);
    return () => clearInterval(poll);
  }, [jobId]);

  const startBackfill = async () => {
    setLoading(true); setResult(null); setProgress(null);
    const newJobId = crypto.randomUUID();
    try {
      const res = await authFetch('/api/admin/backfill-predictions', { method: 'POST', body: JSON.stringify({ daysBack, maxMatches, jobId: newJobId }) });
      const data = await res.json();
      if (data.jobId) { setJobId(data.jobId); setProgress({ status: 'running', progressPct: 0, totalDates: data.totalDates, processedDates: 0, totalMatches: 0, totalPredictions: 0 }); }
      else { setResult(data); }
    } catch (e: any) { setResult({ error: e.message }); }
    setLoading(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Panel title="Gecmis Veri Ice Aktarma (Goaloo)">
        <p className="text-xs text-gray-400 mb-4 leading-relaxed">Goaloo'dan bitmis maclari gercek gol dakikalari ve hucum momentum verisiyle ceker, her mac icin 5 dakikalik araliklarla tahmin hesaplar ve PredictionLog tablosuna yazar. Bu veriler ML model egitimi icin kullanilir.</p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Gun Geriye Git</label>
            <input type="number" value={daysBack} onChange={(e) => setDaysBack(Math.min(90, Math.max(1, parseInt(e.target.value) || 30)))} min={1} max={90}
              className="w-full px-3 py-2 border border-gray-200 text-sm focus:border-blue-400 outline-none transition-colors" style={{ borderRadius: 2 }} />
            <p className="text-[10px] text-gray-400 mt-1">1-90 gun arasi</p>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Max Mac Sayisi</label>
            <input type="number" value={maxMatches} onChange={(e) => setMaxMatches(Math.min(2000, Math.max(10, parseInt(e.target.value) || 300)))} min={10} max={2000}
              className="w-full px-3 py-2 border border-gray-200 text-sm focus:border-blue-400 outline-none transition-colors" style={{ borderRadius: 2 }} />
            <p className="text-[10px] text-gray-400 mt-1">10-2000 mac</p>
          </div>
        </div>
        <button onClick={startBackfill} disabled={loading || !!jobId} className="w-full py-3 text-white text-sm font-semibold rounded transition-colors disabled:opacity-50" style={{ background: G.green }}>
          {loading || !!jobId ? <span className="flex items-center justify-center gap-2"><Spinner /> Veri cekiliyor...</span> : `${daysBack} Gun Geriye Git (${maxMatches} Max Mac)`}
        </button>
      </Panel>

      {progress && (
        <Panel title="Ilerleme">
          <div className="space-y-3">
            <div className="flex justify-between text-xs text-gray-600"><span>{progress.status === 'done' ? 'Tamamlandi' : progress.status === 'failed' ? 'Basarisiz' : 'Calisiyor...'}</span><span className="font-mono">{progress.processedDates ?? 0} / {progress.totalDates ?? 0} gun</span></div>
            <ProgressBar pct={progress.progressPct ?? 0} color={progress.status === 'done' ? G.green : progress.status === 'failed' ? G.red : G.blue} />
            <div className="flex justify-between text-[10px] text-gray-400"><span>Mac: {progress.totalMatches ?? 0}</span><span>Tahmin: {(progress.totalPredictions ?? 0).toLocaleString()}</span><span>Basarisiz Gun: {progress.failedDates ?? 0}</span></div>
            {progress.currentMatch && <div className="text-[10px] text-gray-500 text-center">Su an: {progress.currentMatch}</div>}
          </div>
        </Panel>
      )}

      {result?.status === 'done' && (
        <Panel title="Sonuc">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatPanel label="Islenen Gun" value={result.processedDates ?? 0} color={G.green} />
            <StatPanel label="Islenen Mac" value={result.totalMatches ?? 0} color={G.blue} />
            <StatPanel label="Toplam Tahmin" value={(result.totalPredictions ?? 0).toLocaleString()} color={G.purple} />
            <StatPanel label="Basarisiz Gun" value={result.failedDates ?? 0} color={result.failedDates > 0 ? G.red : G.gray} />
          </div>
        </Panel>
      )}

      {result?.error && <div className="p-3 rounded text-xs" style={{ background: '#fde8e8', color: G.red }}>{result.error}</div>}
    </div>
  );
}

// ── DatabaseTab: Signal temizleme + DB istatistikleri ────────────
function DatabaseTab({ token }: { token: string }) {
  const [dbStats, setDbStats] = useState<{
    total: number; pending: number; resolved: number;
    withGoal: number; oldest: string | null; newest: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmPhase, setConfirmPhase] = useState<'idle' | 'confirm' | 'executing' | 'done' | 'error'>('idle');
  const [confirmInput, setConfirmInput] = useState('');
  const [resultMsg, setResultMsg] = useState('');
  const [clearMode, setClearMode] = useState<'all' | 'before-date'>('all');
  const [targetDate, setTargetDate] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await authFetch('/api/admin/clear-signals');
      if (resp.ok) { const d = await resp.json(); setDbStats(d); }
    } catch { /* ignore */ }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleClear = async () => {
    setConfirmPhase('executing');
    setResultMsg('');
    try {
      const body: Record<string, unknown> = { confirmCode: 'SIGNAL-CLEAR' };
      if (clearMode === 'before-date' && targetDate) body.targetDate = targetDate;
      const resp = await authFetch('/api/admin/clear-signals', {
        method: 'POST', body: JSON.stringify(body),
      });
      if (resp.ok) {
        const data = await resp.json();
        setResultMsg('✅ ' + data.message);
        setConfirmPhase('done');
        load(); // refresh stats
      } else {
        const data = await resp.json();
        setResultMsg('❌ Hata: ' + (data.error || 'bilinmeyen'));
        setConfirmPhase('error');
      }
    } catch {
      setResultMsg('❌ Baglanti hatasi');
      setConfirmPhase('error');
    }
  };

  const handleReset = () => {
    setConfirmPhase('idle'); setConfirmInput(''); setResultMsg('');
  };

  if (loading) return (
    <Panel title="Veritabani">
      <div className="text-center py-8 text-xs text-gray-400">Yükleniyor...</div>
    </Panel>
  );

  return (
    <div className="space-y-4">
      {/* ── DB Stats ── */}
      <Panel title="Sinyal Veritabani">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <StatPanel label="Toplam Sinyal" value={dbStats?.total ?? 0} color={G.blue} />
          <StatPanel label="Bekleyen" value={dbStats?.pending ?? 0} color={G.orange} />
          <StatPanel label="Cozulmus" value={dbStats?.resolved ?? 0} color={G.green} />
          <StatPanel label="Gol Olmus" value={dbStats?.withGoal ?? 0} color={G.purple} />
          <StatPanel label="Basarili %" value={dbStats?.resolved && dbStats.resolved > 0
            ? ((dbStats.withGoal / dbStats.resolved) * 100).toFixed(1) + '%'
            : '-'} color={G.cyan} />
        </div>
        <div className="text-[11px] text-gray-500 space-y-1">
          {dbStats?.oldest && <div>En eski kayit: {new Date(dbStats.oldest).toLocaleString('tr-TR')}</div>}
          {dbStats?.newest && <div>En yeni kayit: {new Date(dbStats.newest).toLocaleString('tr-TR')}</div>}
        </div>
      </Panel>

      {/* ── Clear Signals ── */}
      <Panel title="Sinyal Sifirlama">
        <div className="text-xs text-gray-500 mb-2 bg-orange-50 border border-orange-200 rounded p-2.5">
          <strong>⚠️ Uyari:</strong> Bu islem geri alinamaz. Eski algoritmayla kaydedilmis sinyallerin
          correctPrediction degeri her zaman true oldugu icin istatistikler yanlis.
          Temizledikten sonra yeni algoritma ile dogru kayitlar baslar.
        </div>

        {confirmPhase === 'idle' && (
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-xs">
                <input type="radio" checked={clearMode === 'all'} onChange={() => setClearMode('all')} />
                Tum sinyalleri sil
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <input type="radio" checked={clearMode === 'before-date'} onChange={() => setClearMode('before-date')} />
                Belirli tarihten oncekileri sil
              </label>
            </div>
            {clearMode === 'before-date' && (
              <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}
                className="w-48 text-xs px-3 py-1.5 rounded border border-gray-300 bg-white" />
            )}
            <button onClick={() => setConfirmPhase('confirm')}
              className="px-4 py-2 text-xs font-bold rounded text-white"
              style={{ background: G.red }}>
              {clearMode === 'all' ? 'Tum Sinyalleri Temizle' : 'Sinyalleri Temizle'}
            </button>
          </div>
        )}

        {confirmPhase === 'confirm' && (
          <div className="space-y-3">
            <div className="text-xs text-red-600 font-semibold">
              Onay icin asagidaki kodu yazin: <span className="font-mono bg-red-50 px-2 py-0.5 rounded border border-red-200">SIGNAL-CLEAR</span>
            </div>
            <input type="text" value={confirmInput} onChange={e => setConfirmInput(e.target.value)}
              placeholder="SIGNAL-CLEAR"
              className="w-64 text-xs px-3 py-1.5 rounded border border-gray-300 bg-white font-mono" />
            <div className="flex gap-2">
              <button onClick={handleClear} disabled={confirmInput !== 'SIGNAL-CLEAR'}
                className="px-4 py-2 text-xs font-bold rounded text-white disabled:opacity-40"
                style={{ background: G.red }}>
                {clearMode === 'all' ? 'Evet, Tumunu Sil' : 'Evet, Sil'}
              </button>
              <button onClick={handleReset}
                className="px-4 py-2 text-xs font-bold rounded text-gray-600 bg-gray-100 hover:bg-gray-200">
                Iptal
              </button>
            </div>
          </div>
        )}

        {(confirmPhase === 'executing') && (
          <div className="text-center py-4">
            <div className="animate-spin w-6 h-6 border-2 border-red-400 border-t-transparent rounded-full mx-auto mb-2" />
            <p className="text-xs text-gray-500">Sinyaller siliniyor...</p>
          </div>
        )}

        {(confirmPhase === 'done' || confirmPhase === 'error') && (
          <div className="space-y-2">
            <div className={`p-3 rounded text-xs ${confirmPhase === 'done' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {resultMsg}
            </div>
            <button onClick={handleReset}
              className="px-4 py-2 text-xs font-bold rounded text-gray-600 bg-gray-100 hover:bg-gray-200">
              Geri
            </button>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ── Main Admin Page ───────────────────────────────────────────────
type Tab = 'overview' | 'ml' | 'calibration' | 'signals' | 'elo' | 'elo-import' | 'backfill' | 'database';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Genel Bakis' },
  { key: 'ml', label: 'ML Modelleri' },
  { key: 'calibration', label: 'Kalibrasyon' },
  { key: 'signals', label: 'Sinyaller' },
  { key: 'elo', label: 'Elo' },
  { key: 'elo-import', label: 'Elo Ice Aktar' },
  { key: 'backfill', label: 'Veri Ice Aktar' },
  { key: 'database', label: 'Veritabani' },
];

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [mustChange, setMustChange] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');

  useEffect(() => {
    const saved = sessionStorage.getItem('admin_token');
    if (saved) {
      fetch('/api/admin/auth?action=check', { headers: { Authorization: `Bearer ${saved}` } })
        .then(async (r) => {
          const data = await r.json();
          if (data.ok) { setToken(saved); setMustChange(data.mustChange ?? false); }
          else { sessionStorage.removeItem('admin_token'); }
        }).catch(() => { /* Network error — don't delete token, retry on next render cycle */ });
    }
  }, []);

  const handleLogin = (t: string, mc: boolean) => { setToken(t); setMustChange(mc); };
  const handlePasswordChanged = () => { setMustChange(false); };

  const handleLogout = () => {
    if (token) {
      fetch('/api/admin/auth', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'logout' }) }).catch((e) => { logError('page', e); });
    }
    sessionStorage.removeItem('admin_token'); setToken(null); setMustChange(false);
  };

  if (!token) return <LoginScreen onLogin={handleLogin} />;
  if (mustChange) return <PasswordChangeScreen token={token} onDone={handlePasswordChanged} />;

  return (
    <div style={{ minHeight: '100vh', background: '#f4f5f5' }}>
      {/* ── Grafana-style Top Nav ───────────────────────────── */}
      <div className="flex items-center justify-between px-4" style={{ background: '#1f1f20', height: 44 }}>
        <div className="flex items-center gap-3">
          <span className="text-white text-sm font-semibold tracking-tight">Gol Radari</span>
          <span className="text-gray-500 text-xs hidden sm:inline">Admin</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-gray-400 text-[11px] hidden sm:inline">{new Date().toLocaleDateString('tr-TR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
          <button onClick={handleLogout} className="text-gray-400 hover:text-white text-[11px] transition-colors">Cikis</button>
        </div>
      </div>

      {/* ── Tab Bar ────────────────────────────────────────── */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e0e0e0' }}>
        <div className="max-w-6xl mx-auto flex gap-0 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors relative ${tab === t.key ? 'text-blue-500' : 'text-gray-500 hover:text-gray-700'}`}>
              {t.label}
              {tab === t.key && <span className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: G.blue }} />}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto p-3">
        {tab === 'overview' && <OverviewTab token={token} />}
        {tab === 'ml' && <MLModelsTab token={token} />}
        {tab === 'calibration' && <CalibrationTab token={token} />}
        {tab === 'signals' && <SignalsTab />}
        {tab === 'elo' && <EloTab />}
        {tab === 'elo-import' && <EloImportTab token={token} />}
        {tab === 'backfill' && <BackfillTab token={token} />}
        {tab === 'database' && <DatabaseTab token={token} />}
      </div>
    </div>
  );
}
