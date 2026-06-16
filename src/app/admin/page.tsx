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
        setError(data.reason || 'Giriş başarısız');
      }
    } catch {
      setError('Bağlantı hatası');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-lg p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">⚽</div>
          <h1 className="text-xl font-bold text-gray-800">Admin Panel</h1>
          <p className="text-sm text-gray-500">Gol Radarı Yönetim</p>
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Kullanıcı Adı</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
            autoFocus
          />
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Şifre</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
          />
        </div>
        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
        >
          {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
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
    e.preventDefault();
    setError('');

    if (newPassword.length < 6) { setError('Yeni şifre en az 6 karakter olmalı'); return; }
    if (newPassword !== confirmPassword) { setError('Şifreler eşleşmiyor'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'change-password', password: currentPassword, newPassword }),
      });
      const data = await res.json();
      if (data.ok) {
        onDone();
      } else {
        setError(data.reason || 'Şifre değiştirilemedi');
      }
    } catch {
      setError('Bağlantı hatası');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-lg p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">🔒</div>
          <h1 className="text-xl font-bold text-gray-800">Şifre Değiştir</h1>
          <p className="text-sm text-gray-500">İlk girişte şifrenizi değiştirmelisiniz</p>
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Mevcut Şifre</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Mevcut şifreniz"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
            autoFocus
          />
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Yeni Şifre</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="En az 6 karakter"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
          />
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Yeni Şifre (Tekrar)</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Yeni şifreyi tekrar yazın"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
          />
        </div>
        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
        >
          {loading ? 'Değiştiriliyor...' : 'Şifreyi Güncelle'}
        </button>
      </form>
    </div>
  );
}

// ── Reusable Components ───────────────────────────────────────────
function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 p-4 ${className}`}>
      {title && <h3 className="text-sm font-bold text-gray-700 mb-3">{title}</h3>}
      {children}
    </div>
  );
}

function Badge({ children, color = 'gray' }: { children: ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    yellow: 'bg-amber-50 text-amber-700 border-amber-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    gray: 'bg-gray-50 text-gray-600 border-gray-200',
  };
  return (
    <span className={`inline-block px-2 py-0.5 text-[11px] font-medium rounded border ${colors[color] || colors.gray}`}>
      {children}
    </span>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div>
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="text-lg font-bold text-gray-800">{value}</div>
      {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
    </div>
  );
}

function Spinner() {
  return <div className="inline-block w-4 h-4 border-2 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />;
}

// ── Overview Tab ──────────────────────────────────────────────────
function OverviewTab({ token }: { token: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mlRes, cacheRes, calRes] = await Promise.all([
        authFetch('/api/admin/ml/status'),
        authFetch('/api/admin/fotmob-cache-stats'),
        fetch('/api/calibration?action=stats'),
      ]);
      const ml = mlRes.ok ? await mlRes.json() : null;
      const cache = cacheRes.ok ? await cacheRes.json() : null;
      const cal = calRes.ok ? await calRes.json() : null;
      setData({ ml, cache, cal });
    } catch { setData(null); }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (!data) return <div className="text-center py-12 text-gray-500">Veri yüklenemedi</div>;

  const { ml, cache, cal } = data;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <Card title="ML Durumu">
        <div className="flex items-center gap-2 mb-3">
          <Badge color={ml?.trainer?.health?.ok ? 'green' : 'red'}>
            Trainer {ml?.trainer?.health?.ok ? 'Aktif' : 'Pasif'}
          </Badge>
          <Badge color={ml?.trainer?.enabled ? 'blue' : 'gray'}>
            {ml?.trainer?.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
        {ml?.champions && Object.entries(ml.champions).map(([name, c]: [string, any]) => (
          <div key={name} className="flex justify-between text-xs py-1 border-t border-gray-50">
            <span className="font-medium text-gray-700">{name}</span>
            <span className="text-gray-500">v{c.version}</span>
          </div>
        ))}
        {ml?.latestMetrics && (
          <div className="mt-3 pt-2 border-t border-gray-100">
            <div className="text-[11px] text-gray-500 mb-1">Son Metrikler</div>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Brier" value={ml.latestMetrics.brierScore?.toFixed(4) ?? '-'} />
              <Stat label="Shadow Δ" value={ml.latestMetrics.shadowBrierDelta?.toFixed(4) ?? '-'} />
            </div>
          </div>
        )}
      </Card>

      <Card title="FotMob Cache">
        {cache?.cache ? (
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Toplam Satır" value={cache.cache.totalRows} />
            <Stat label="Hit Rate" value={cache.cache.cacheHitRatePct !== null ? `${cache.cache.cacheHitRatePct}%` : '-'} />
            <Stat label="Süresi Dolan" value={cache.cache.expiredRows} />
            <Stat label="Toplam Hit" value={cache.cache.totalHits} />
          </div>
        ) : <p className="text-gray-400 text-sm">Veri yok</p>}
        {cache?.scheduler && (
          <div className="mt-3 pt-2 border-t border-gray-100 text-xs text-gray-500">
            Scheduler: {cache.scheduler.running ? `Aktif (${cache.scheduler.uptimeHuman})` : 'Pasif'}
          </div>
        )}
      </Card>

      <Card title="Kalibrasyon">
        {cal ? (
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Kayıt Sayısı" value={cal.totalRecords ?? '-'} />
            <Stat label="Brier Score" value={cal.brierScore?.toFixed(4) ?? '-'} />
            <Stat label="Log Loss" value={cal.logLoss?.toFixed(4) ?? '-'} />
            <Stat label="Doğruluk" value={cal.accuracy != null ? `${(cal.accuracy * 100).toFixed(1)}%` : '-'} />
          </div>
        ) : <p className="text-gray-400 text-sm">Veri yok</p>}
      </Card>

      <Card title="Scheduler" className="md:col-span-2 lg:col-span-3">
        {ml?.scheduler ? (
          <div className="flex flex-wrap gap-4 text-xs">
            <div><span className="text-gray-500">Export:</span> <Badge color={ml.scheduler.exportRunning ? 'green' : 'gray'}>{ml.scheduler.exportRunning ? 'Aktif' : 'Pasif'}</Badge></div>
            <div><span className="text-gray-500">InPlay:</span> <Badge color={ml.scheduler.inplayRunning ? 'green' : 'gray'}>{ml.scheduler.inplayRunning ? 'Aktif' : 'Pasif'}</Badge></div>
            <div><span className="text-gray-500">Son Export:</span> {ml.scheduler.lastExportAt ? new Date(ml.scheduler.lastExportAt).toLocaleString('tr-TR') : '-'}</div>
            <div><span className="text-gray-500">Son InPlay:</span> {ml.scheduler.lastInplayAt ? new Date(ml.scheduler.lastInplayAt).toLocaleString('tr-TR') : '-'}</div>
          </div>
        ) : <p className="text-gray-400 text-sm">Veri yok</p>}
      </Card>
    </div>
  );
}

// ── ML Models Tab ─────────────────────────────────────────────────
function MLModelsTab({ token }: { token: string }) {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [actionResult, setActionResult] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/admin/ml/status');
      if (res.ok) setStatus(await res.json());
    } catch {}
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (name: string, url: string, body?: any) => {
    setActionLoading(name);
    setActionResult('');
    try {
      const res = await authFetch(url, {
        method: body ? 'POST' : 'GET',
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      setActionResult(`${name}: ${res.ok ? 'Başarılı' : 'Hata'} — ${JSON.stringify(data).slice(0, 200)}`);
      if (res.ok) load();
    } catch (e: any) {
      setActionResult(`${name}: Hata — ${e.message}`);
    }
    setActionLoading('');
  };

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;

  return (
    <div className="space-y-4">
      <Card title="Champion Modeller">
        {status?.champions && Object.keys(status.champions).length > 0 ? (
          <div className="space-y-2">
            {Object.entries(status.champions).map(([name, c]: [string, any]) => (
              <div key={name} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                <div>
                  <span className="font-bold text-sm text-gray-800">{name}</span>
                  <span className="ml-2 text-xs text-gray-500">v{c.version}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => doAction(`compare-${name}`, `/api/admin/ml/compare?name=${name}&version=${c.version}`)}
                    disabled={!!actionLoading}
                    className="px-3 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100 disabled:opacity-50"
                  >
                    {actionLoading === `compare-${name}` ? <Spinner /> : 'Karşılaştır'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="text-gray-400 text-sm">Henüz champion model yok</p>}
      </Card>

      <Card title="Model Eğit">
        <div className="flex flex-wrap gap-2">
          {['gbdt', 'xgb', 'inplay'].map((name) => (
            <button
              key={name}
              onClick={() => {
                const version = prompt(`${name} model versiyonu (ör: 1.0.0):`);
                if (version) doAction(`train-${name}`, '/api/admin/ml/train', { name, version });
              }}
              disabled={!!actionLoading}
              className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
            >
              {actionLoading === `train-${name}` ? <Spinner /> : `Train ${name}`}
            </button>
          ))}
        </div>
      </Card>

      <Card title="Training Datasets">
        {status?.recentDatasets?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="py-1.5 pr-3">ID</th>
                  <th className="py-1.5 pr-3">Horizon</th>
                  <th className="py-1.5 pr-3">Satır</th>
                  <th className="py-1.5 pr-3">Brier</th>
                  <th className="py-1.5 pr-3">Durum</th>
                  <th className="py-1.5">Tarih</th>
                </tr>
              </thead>
              <tbody>
                {status.recentDatasets.map((d: any) => (
                  <tr key={d.id} className="border-b border-gray-50">
                    <td className="py-1.5 pr-3 font-mono text-[10px]">{d.id.slice(0, 8)}</td>
                    <td className="py-1.5 pr-3">{d.horizonMin}dk</td>
                    <td className="py-1.5 pr-3">{d.rowCount?.toLocaleString()}</td>
                    <td className="py-1.5 pr-3">{d.brier?.toFixed(4) ?? '-'}</td>
                    <td className="py-1.5 pr-3"><Badge color={d.status === 'ready' ? 'green' : d.status === 'error' ? 'red' : 'yellow'}>{d.status}</Badge></td>
                    <td className="py-1.5 text-gray-400">{new Date(d.createdAt).toLocaleDateString('tr-TR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-gray-400 text-sm">Dataset yok</p>}
      </Card>

      {actionResult && (
        <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-600 font-mono break-all">{actionResult}</div>
      )}
    </div>
  );
}

// ── Calibration Tab ───────────────────────────────────────────────
function CalibrationTab({ token }: { token: string }) {
  const [calData, setCalData] = useState<any>(null);
  const [smartData, setSmartData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionResult, setActionResult] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [calRes, smartRes] = await Promise.all([
        fetch('/api/calibration?action=stats'),
        fetch('/api/smart-calibration?action=status'),
      ]);
      if (calRes.ok) setCalData(await calRes.json());
      if (smartRes.ok) setSmartData(await smartRes.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const autocalibrate = async () => {
    try {
      const res = await fetch('/api/calibration?action=autocalibrate');
      const data = await res.json();
      setActionResult(data.message || JSON.stringify(data));
      load();
    } catch (e: any) { setActionResult(`Hata: ${e.message}`); }
  };

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Kalibrasyon İstatistikleri">
          {calData ? (
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Kayıt" value={calData.totalRecords ?? '-'} />
              <Stat label="Brier" value={calData.brierScore?.toFixed(4) ?? '-'} />
              <Stat label="Log Loss" value={calData.logLoss?.toFixed(4) ?? '-'} />
              <Stat label="Doğruluk" value={calData.accuracy != null ? `${(calData.accuracy * 100).toFixed(1)}%` : '-'} />
            </div>
          ) : <p className="text-gray-400 text-sm">Veri yok</p>}
          <button
            onClick={autocalibrate}
            className="mt-3 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            Otomatik Kalibrasyon
          </button>
        </Card>

        <Card title="Smart Kalibrasyon (F8)">
          {smartData?.mode && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Mod:</span>
                <Badge color={smartData.mode.mode === 'auto' ? 'green' : smartData.mode.mode === 'manual' ? 'blue' : 'gray'}>
                  {smartData.mode.mode}
                </Badge>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Sensitivite:</span>
                <span className="font-medium">{smartData.mode.sensitivity}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Min Örnek:</span>
                <span className="font-medium">{smartData.mode.minSampleSize}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Odds Compound:</span>
                <Badge color={smartData.mode.oddsCompoundEnabled ? 'green' : 'gray'}>
                  {smartData.mode.oddsCompoundEnabled ? 'Aktif' : 'Pasif'}
                </Badge>
              </div>
            </div>
          )}
          {smartData?.f8Calibration && (
            <div className="mt-3 pt-2 border-t border-gray-100">
              <div className="text-[11px] text-gray-500 mb-2">F8 Kalibrasyon</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-gray-400">Dampener:</span> {smartData.f8Calibration.calibratedDampener?.toFixed(2)}</div>
                <div><span className="text-gray-400">Danger Boost:</span> {smartData.f8Calibration.calibratedDangerBoost?.toFixed(2)}</div>
                <div><span className="text-gray-400">Kaynak:</span> {smartData.f8Calibration.source}</div>
              </div>
              {smartData.f8Calibration.explanation && (
                <p className="mt-2 text-[11px] text-gray-500">{smartData.f8Calibration.explanation}</p>
              )}
            </div>
          )}
        </Card>
      </div>

      {smartData?.topLeagues?.length > 0 && (
        <Card title="Lig Profilleri">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="py-1.5 pr-3">Lig ID</th>
                  <th className="py-1.5 pr-3">Ort. Gol Dakikası</th>
                  <th className="py-1.5 pr-3">Erken Gol %</th>
                  <th className="py-1.5 pr-3">Geç Gol %</th>
                </tr>
              </thead>
              <tbody>
                {smartData.topLeagues.map((p: any) => (
                  <tr key={p.leagueId} className="border-b border-gray-50">
                    <td className="py-1.5 pr-3">{p.leagueId}</td>
                    <td className="py-1.5 pr-3">{p.avgGoalMinute?.toFixed(1)}</td>
                    <td className="py-1.5 pr-3">{(p.earlyGoalRate * 100)?.toFixed(1)}%</td>
                    <td className="py-1.5 pr-3">{(p.lateGoalRate * 100)?.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {actionResult && (
        <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-600 font-mono break-all">{actionResult}</div>
      )}
    </div>
  );
}

// ── Signals Tab ───────────────────────────────────────────────────
function SignalsTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/goal-signals?action=stats');
      if (res.ok) setData(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;

  return (
    <div className="space-y-4">
      <Card title="Sinyal İstatistikleri">
        {data ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Toplam Sinyal" value={data.totalSignals ?? '-'} />
            <Stat label="Doğrulanan" value={data.verifiedSignals ?? '-'} />
            <Stat label="Doğruluk" value={data.accuracy != null ? `${(data.accuracy * 100).toFixed(1)}%` : '-'} />
            <Stat label="Ort. Brier" value={data.avgBrier?.toFixed(4) ?? '-'} />
          </div>
        ) : <p className="text-gray-400 text-sm">Veri yok</p>}
      </Card>
    </div>
  );
}

// ── Elo Tab ───────────────────────────────────────────────────────
function EloTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/elo?action=all');
      if (res.ok) setData(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;

  const entries = data ? Object.entries(data)
    .filter(([name]: [string, any]) => !search || name.toLowerCase().includes(search.toLowerCase()))
    .sort(([, a]: [string, any], [, b]: [string, any]) => (b.rating ?? 1500) - (a.rating ?? 1500))
    .slice(0, 50) : [];

  return (
    <div className="space-y-4">
      <Card title="Elo Sıralaması">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Takım ara..."
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mb-3 focus:ring-2 focus:ring-emerald-500 outline-none"
        />
        <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="py-1.5 pr-3">#</th>
                <th className="py-1.5 pr-3">Takım</th>
                <th className="py-1.5 pr-3">Rating</th>
                <th className="py-1.5 pr-3">Form</th>
                <th className="py-1.5">Maç</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([name, r]: [string, any], i) => (
                <tr key={name} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-1.5 pr-3 text-gray-400">{i + 1}</td>
                  <td className="py-1.5 pr-3 font-medium text-gray-800">{name}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.rating?.toFixed(0) ?? '-'}</td>
                  <td className="py-1.5 pr-3">{r.formIndex?.toFixed(2) ?? '-'}</td>
                  <td className="py-1.5">{r.matchesPlayed ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── Elo Import Tab ────────────────────────────────────────────────
function EloImportTab({ token }: { token: string }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [manualEntries, setManualEntries] = useState('');
  const [fetchTeams, setFetchTeams] = useState('');

  const doImport = async (action: string, body: any) => {
    setLoading(true);
    setResult(null);
    try {
      const res = await authFetch('/api/admin/elo-import', {
        method: 'POST',
        body: JSON.stringify({ action, ...body }),
      });
      setResult(await res.json());
    } catch (e: any) {
      setResult({ error: e.message });
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Süper Lig İçe Aktar">
          <p className="text-xs text-gray-500 mb-3">ClubElo.com'dan Türk takımlarının Elo rating'lerini çeker.</p>
          <button
            onClick={() => doImport('fetch-league', { country: 'TUR' })}
            disabled={loading}
            className="w-full py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? <Spinner /> : '🇹🇷 Süper Lig Çek'}
          </button>
        </Card>

        <Card title="Avrupa Kulüpleri İçe Aktar">
          <p className="text-xs text-gray-500 mb-3">Major Avrupa kulüplerinin Elo rating'leri.</p>
          <button
            onClick={() => doImport('fetch-league', { country: 'EUR' })}
            disabled={loading}
            className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? <Spinner /> : '🇪🇺 Avrupa Çek'}
          </button>
        </Card>

        <Card title="Hepsini Çek">
          <p className="text-xs text-gray-500 mb-3">Süper Lig + Avrupa kulüpleri toplu import.</p>
          <button
            onClick={() => doImport('fetch-league', { country: 'ALL' })}
            disabled={loading}
            className="w-full py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? <Spinner /> : '⚽ Tümünü Çek'}
          </button>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Takım Listesi ile Çek (ClubElo)">
          <p className="text-xs text-gray-500 mb-2">ClubElo takım isimlerini virgülle ayırarak girin.</p>
          <textarea
            value={fetchTeams}
            onChange={(e) => setFetchTeams(e.target.value)}
            placeholder="Galatasaray, Fenerbahce, Besiktas, RealMadrid, Barcelona"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs h-20 resize-none focus:ring-2 focus:ring-emerald-500 outline-none"
          />
          <button
            onClick={() => {
              const teams = fetchTeams.split(',').map(t => t.trim()).filter(Boolean);
              if (teams.length > 0) doImport('fetch', { teams });
            }}
            disabled={loading || !fetchTeams.trim()}
            className="mt-2 w-full py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? <Spinner /> : 'Çek'}
          </button>
        </Card>

        <Card title="Manuel Giriş">
          <p className="text-xs text-gray-500 mb-2">Her satıra: takımadı, rating (ör: Galatasaray, 1750)</p>
          <textarea
            value={manualEntries}
            onChange={(e) => setManualEntries(e.target.value)}
            placeholder={"Galatasaray, 1750\nFenerbahce, 1720\nBesiktas, 1680"}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs h-20 resize-none focus:ring-2 focus:ring-emerald-500 outline-none font-mono"
          />
          <button
            onClick={() => {
              const entries = manualEntries.split('\n').map(line => {
                const parts = line.split(',').map(s => s.trim());
                if (parts.length >= 2) {
                  const rating = parseFloat(parts[1]);
                  if (!isNaN(rating)) return { team: parts[0], rating };
                }
                return null;
              }).filter(Boolean);
              if (entries.length > 0) doImport('manual', { entries });
            }}
            disabled={loading || !manualEntries.trim()}
            className="mt-2 w-full py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
          >
            {loading ? <Spinner /> : 'Kaydet'}
          </button>
        </Card>
      </div>

      {result && (
        <Card title="Sonuç">
          <div className="space-y-2">
            {result.ok && (
              <div className="flex flex-wrap gap-3">
                <Stat label="İçe Aktarılan" value={result.imported ?? 0} />
                {result.failed?.length > 0 && <Stat label="Başarısız" value={result.failed.length} />}
                {result.country && <Stat label="Lig" value={result.country} />}
              </div>
            )}
            {result.results?.length > 0 && (
              <div className="mt-2">
                <div className="text-[11px] text-gray-500 mb-1">Çekilen Rating'ler:</div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1">
                  {result.results.map((r: any) => (
                    <div key={r.team} className="flex justify-between text-xs bg-gray-50 px-2 py-1 rounded">
                      <span className="text-gray-700">{r.team}</span>
                      <span className="font-mono font-bold text-emerald-700">{r.rating}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {result.failed?.length > 0 && (
              <div className="mt-2">
                <div className="text-[11px] text-red-500 mb-1">Bulunamayan Takımlar:</div>
                <div className="flex flex-wrap gap-1">
                  {result.failed.map((t: string) => (
                    <span key={t} className="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded">{t}</span>
                  ))}
                </div>
              </div>
            )}
            {result.error && (
              <div className="text-xs text-red-600 bg-red-50 p-2 rounded">{result.error}</div>
            )}
          </div>
        </Card>
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

  const startBackfill = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await authFetch('/api/admin/backfill-predictions', {
        method: 'POST',
        body: JSON.stringify({ daysBack, maxMatches }),
      });
      setResult(await res.json());
    } catch (e: any) {
      setResult({ error: e.message });
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <Card title="Geçmiş Veri İçe Aktarma">
        <p className="text-xs text-gray-500 mb-4">
          Nesine API'den bitmiş maçları çeker, her maç için 5 dakikalık aralıklarla tahmin hesaplar
          ve PredictionLog tablosuna yazar. Bu veriler ML model eğitimi için kullanılır.
          Ayrıca gol olayları MatchEvent tablosuna yazılır (labeling için).
        </p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-[11px] font-medium text-gray-600 mb-1">Gün Geriye Git</label>
            <input
              type="number"
              value={daysBack}
              onChange={(e) => setDaysBack(Math.min(90, Math.max(1, parseInt(e.target.value) || 30)))}
              min={1}
              max={90}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            />
            <p className="text-[10px] text-gray-400 mt-1">1-90 gün arası</p>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-600 mb-1">Max Maç Sayısı</label>
            <input
              type="number"
              value={maxMatches}
              onChange={(e) => setMaxMatches(Math.min(2000, Math.max(10, parseInt(e.target.value) || 300)))}
              min={10}
              max={2000}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            />
            <p className="text-[10px] text-gray-400 mt-1">10-2000 maç</p>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-700">
          ⚠️ Bu işlem uzun sürebilir (30 gün ≈ 5-10 dakika). Her maç için 17 snapshot hesabı yapılır.
          İşlem sırasında sayfayı kapatmayın.
        </div>

        <button
          onClick={startBackfill}
          disabled={loading}
          className="w-full py-3 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2"><Spinner /> Veri çekiliyor...</span>
          ) : (
            `📊 ${daysBack} Gün Geriye Git (${maxMatches} Max Maç)`
          )}
        </button>
      </Card>

      {result?.summary && (
        <Card title="Sonuç">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Stat label="İşlenen Gün" value={result.summary.datesProcessed} />
            <Stat label="Toplam Maç" value={result.summary.totalMatches} />
            <Stat label="Toplam Tahmin" value={result.summary.totalPredictions?.toLocaleString()} />
            <Stat label="Başarısız Gün" value={result.summary.failedDates} />
            <Stat label="Elo Çekilen Takım" value={result.summary.teamsEloFetched} />
          </div>
          <div className="mt-3 p-2 bg-emerald-50 rounded-lg text-xs text-emerald-700">
            ✅ {result.summary.totalPredictions} tahmin kaydedildi. 
            ML trainer otomatik olarak training data export edecek (her gün 03:00).
            Veya admin panelinden "ML Modelleri" → "Export" ile manuel tetikleyebilirsin.
          </div>
        </Card>
      )}

      {result?.error && (
        <div className="p-3 bg-red-50 rounded-lg text-xs text-red-600">{result.error}</div>
      )}
    </div>
  );
}

// ── Main Admin Page ───────────────────────────────────────────────
type Tab = 'overview' | 'ml' | 'calibration' | 'signals' | 'elo' | 'elo-import' | 'backfill';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Genel Bakış' },
  { key: 'ml', label: 'ML Modelleri' },
  { key: 'calibration', label: 'Kalibrasyon' },
  { key: 'signals', label: 'Sinyaller' },
  { key: 'elo', label: 'Elo' },
  { key: 'elo-import', label: 'Elo İçe Aktar' },
  { key: 'backfill', label: 'Veri İçe Aktar' },
];

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [mustChange, setMustChange] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');

  useEffect(() => {
    const saved = sessionStorage.getItem('admin_token');
    if (saved) {
      // Check if password change is still required
      fetch('/api/admin/auth?action=check', {
        headers: { Authorization: `Bearer ${saved}` },
      }).then(async (r) => {
        const data = await r.json();
        if (data.ok) {
          setToken(saved);
          setMustChange(data.mustChange ?? false);
        } else {
          sessionStorage.removeItem('admin_token');
        }
      }).catch(() => {
        sessionStorage.removeItem('admin_token');
      });
    }
  }, []);

  const handleLogin = (t: string, mc: boolean) => {
    setToken(t);
    setMustChange(mc);
  };

  const handlePasswordChanged = () => {
    setMustChange(false);
  };

  const handleLogout = () => {
    if (token) {
      fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'logout' }),
      }).catch(() => { });
    }
    sessionStorage.removeItem('admin_token');
    setToken(null);
    setMustChange(false);
  };

  if (!token) return <LoginScreen onLogin={handleLogin} />;
  if (mustChange) return <PasswordChangeScreen token={token} onDone={handlePasswordChanged} />;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">⚽</span>
            <h1 className="text-lg font-bold text-gray-800">Admin Panel</h1>
          </div>
          <button
            onClick={handleLogout}
            className="text-xs text-gray-500 hover:text-red-600"
          >
            Çıkış
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-100 px-4">
        <div className="max-w-6xl mx-auto flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto p-4">
        {tab === 'overview' && <OverviewTab token={token} />}
        {tab === 'ml' && <MLModelsTab token={token} />}
        {tab === 'calibration' && <CalibrationTab token={token} />}
        {tab === 'signals' && <SignalsTab />}
        {tab === 'elo' && <EloTab />}
        {tab === 'elo-import' && <EloImportTab token={token} />}
        {tab === 'backfill' && <BackfillTab token={token} />}
      </div>
    </div>
  );
}
