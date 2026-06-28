'use client';

import { useState, useEffect } from 'react';
import { fmtDate } from '@/lib/safeFormat';
import Link from 'next/link';
import { authFetch } from '@/lib/adminAuth';
import {
  Brain, Activity, Target, BarChart3, Zap, Shield,
  RefreshCw, ChevronRight, Bot, GitCompare,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// ── Helpers ───────────────────────────────────────────────────────
function asPct(v: number | null | undefined, d = 1): string {
  return v == null ? '-' : `${(v * 100).toFixed(d)}%`;
}
function asFixed(v: number | null | undefined, d = 3): string {
  return v == null ? '-' : v.toFixed(d);
}

function KpiBox({ label, value, color, sub, loading }: {
  label: string; value: string; color?: string; sub?: string; loading?: boolean;
}) {
  if (loading) return (
    <div className="text-center"><Skeleton className="h-8 w-16 mx-auto mb-1" /><Skeleton className="h-3 w-20 mx-auto" /></div>
  );
  return (
    <div className="text-center transition-all duration-200">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-xl font-black tracking-tight" style={{ color: color ?? '#6366f1' }}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function StatusDot({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: ok ? '#16a34a' : '#dc2626' }}>
      <span className="size-2 rounded-full" style={{ background: ok ? '#16a34a' : '#dc2626' }} />
      {label ?? (ok ? 'Aktif' : 'Pasif')}
    </span>
  );
}

// ── Main ──────────────────────────────────────────────────────────
export default function AdminPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const [mlRes, signalRes, dailyRes, monRes] = await Promise.all([
        authFetch('/api/admin/ml/status'),
        authFetch('/api/goal-signals?action=stats&days=30'),
        authFetch('/api/daily-metrics'),
        authFetch('/api/admin/ml/monitoring?days=7'),
      ]);
      const ml = mlRes.ok ? await mlRes.json() : null;
      const signals = signalRes.ok ? await signalRes.json() : null;
      const daily = dailyRes.ok ? await dailyRes.json() : null;
      const mon = monRes.ok ? await monRes.json() : null;
      setData({ ml, signals, daily, mon });
    } catch { /* connection error */ }
  };

  useEffect(() => {
    (async () => { await loadData(); setLoading(false); })();
  }, []);

  // Auto-revalidate 30s
  useEffect(() => {
    const i = setInterval(loadData, 30000);
    return () => clearInterval(i);
  }, []);

  const { ml, signals, daily } = data || {};

  return (
    <div className="space-y-4 animate-in fade-in duration-300 ease-out">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Genel Bakış</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Son güncelleme: {data ? fmtDate(new Date().toISOString()) : '—'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
          <RefreshCw className={`size-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Yenileniyor...' : 'Yenile'}
        </Button>
      </div>

      {/* Today's KPI */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="size-4 text-blue-500" />
            Bugünün Performansı
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!data && loading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => <KpiBox key={i} label="—" value="—" loading />)}
            </div>
          ) : !daily ? (
            <p className="text-sm text-gray-400">Henüz veri yok</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiBox label="Bugün Başarı" value={asPct(daily.today?.successRate, 0)}
                color={(daily.today?.successRate ?? 0) >= 0.6 ? '#16a34a' : (daily.today?.successRate ?? 0) >= 0.4 ? '#d97706' : '#dc2626'}
                sub={`${daily.today?.goalsHit ?? 0}/${daily.today?.resolved ?? 0} gol`} />
              <KpiBox label="Verilen Sinyal" value={String(daily.today?.signalsTotal ?? 0)}
                color="#d97706" sub={`${daily.today?.pending ?? 0} bekliyor`} />
              <KpiBox label="Oynanacak Maç" value={String(daily.upcoming?.total ?? 0)}
                color="#7c3aed" sub={`${daily.upcoming?.liveNow ?? 0} canlı`} />
              <KpiBox label="Genel (90g)" value={asPct(daily.allTime?.successRate, 0)}
                color={(daily.allTime?.successRate ?? 0) >= 0.6 ? '#16a34a' : '#d97706'}
                sub={`${daily.allTime?.totalSignals ?? 0} sinyal`} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Brier Trend Mini Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="size-4 text-indigo-500" />
            Brier Trend (7g)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!data && loading ? (
            <Skeleton className="h-32 w-full rounded-lg" />
          ) : !data?.mon?.series?.length ? (
            <p className="text-sm text-gray-400">Henüz Brier verisi yok</p>
          ) : (
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.mon.series.filter((s: any) => s.brierScore != null)}>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v?.slice(5) ?? ''} stroke="#9ca3af" />
                  <YAxis domain={[0, 1]} tick={{ fontSize: 10 }} tickFormatter={(v: number) => v.toFixed(1)} stroke="#9ca3af" width={30} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} formatter={(v: unknown) => [typeof v === 'number' ? v.toFixed(4) : '—', 'Brier']} />
                  <Line type="monotone" dataKey="brierScore" stroke="#6366f1" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ML Trainer Status */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="size-4 text-purple-500" />
            ML Trainer
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!data && loading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
            </div>
          ) : !ml ? (
            <p className="text-sm text-gray-400">ML verisi alınamadı</p>
          ) : (
            <>
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
                          <span className="font-semibold text-gray-700 capitalize">{name}</span>
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
                      <KpiBox label="Brier" value={asFixed(ml.latestMetrics.brierScore, 4)} color="#6366f1" />
                      <KpiBox label="Shadow Δ" value={asFixed(ml.latestMetrics.shadowBrierDelta, 4)} color="#7c3aed" />
                    </div>
                  ) : <p className="text-[11px] text-gray-400">Veri yok</p>}
                </div>
              </div>
              {ml.scheduler && (
                <div className="mt-4 pt-3 border-t border-gray-100 grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
                  <div className="flex items-center gap-1.5"><span className="text-gray-400">Export:</span><StatusDot ok={!!ml.scheduler.exportRunning} /></div>
                  <div className="flex items-center gap-1.5"><span className="text-gray-400">InPlay:</span><StatusDot ok={!!ml.scheduler.inplayRunning} /></div>
                  <div className="flex items-center gap-1.5"><span className="text-gray-400">Son Export:</span>
                    <span className="font-mono text-gray-600">{ml.scheduler.lastExportAt ? fmtDate(ml.scheduler.lastExportAt) : '—'}</span>
                  </div>
                  <div className="flex items-center gap-1.5"><span className="text-gray-400">Cron:</span>
                    <span className="font-mono text-gray-600">{ml.scheduler.lastCronAt ? fmtDate(ml.scheduler.lastCronAt) : '—'}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Signal Performance + Calibration Health */}
      {signals && signals.totalSignals > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Target className="size-4 text-green-500" />
                Sinyal Performansı (30g)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <KpiBox label="Toplam" value={String(signals.totalSignals)} color="#7c3aed" sub="sinyal" />
                <KpiBox label="Doğruluk" value={asPct(signals.accuracyRate)} color="#16a34a" sub={`${signals.correctPredictions} doğru`} />
                <KpiBox label="Gol %" value={asPct(signals.goalAfterSignalRate)} color="#d97706" sub={`${signals.signalsWithGoal} gol`} />
                <KpiBox label="Brier" value={asFixed(signals.brierScore)} color="#6366f1" sub="kalibrasyon" />
              </div>
              <Link href="/admin/calibration" className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold inline-flex items-center gap-1">
                Detaylı kalibrasyon <ChevronRight className="size-3" />
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="size-4 text-blue-500" />
                Kalibrasyon Sağlığı
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <KpiBox label="Ort. Tahmin" value={asPct(signals.avgPredictedP)} color="#6366f1" />
                <KpiBox label="Ort. Gözlem" value={asPct(signals.avgObservedP)} color="#16a34a" />
                <KpiBox label="Kal. Hata" value={asPct(signals.calibrationError)}
                  color={signals.calibrationError < 0.1 ? '#16a34a' : '#d97706'} />
              </div>
              <Link href="/admin/algorithm" className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold inline-flex items-center gap-1">
                Sinyal algoritması <ChevronRight className="size-3" />
              </Link>
            </CardContent>
          </Card>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card><CardContent className="p-6"><Skeleton className="h-32 w-full" /></CardContent></Card>
          <Card><CardContent className="p-6"><Skeleton className="h-32 w-full" /></CardContent></Card>
        </div>
      ) : null}

      {/* Quick Links */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="size-4 text-amber-500" />
            Hızlı Erişim
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Link href="/admin/ml" className="text-center py-3 rounded-lg bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition-all duration-150 ease-out hover:scale-[1.02] active:scale-[0.98]">
              <Bot className="size-5 mx-auto text-indigo-600 mb-0.5" />
              <div className="text-[11px] font-bold text-indigo-700">ML & Modeller</div>
            </Link>
            <Link href="/admin/calibration" className="text-center py-3 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-all duration-150 ease-out hover:scale-[1.02] active:scale-[0.98]">
              <Target className="size-5 mx-auto text-emerald-600 mb-0.5" />
              <div className="text-[11px] font-bold text-emerald-700">Kalibrasyon</div>
            </Link>
            <Link href="/admin/algorithm" className="text-center py-3 rounded-lg bg-purple-50 hover:bg-purple-100 border border-purple-200 transition-all duration-150 ease-out hover:scale-[1.02] active:scale-[0.98]">
              <GitCompare className="size-5 mx-auto text-purple-600 mb-0.5" />
              <div className="text-[11px] font-bold text-purple-700">Algoritma Akışı</div>
            </Link>
            <a href="/" className="text-center py-3 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-all duration-150 ease-out hover:scale-[1.02] active:scale-[0.98]">
              <BarChart3 className="size-5 mx-auto text-blue-600 mb-0.5" />
              <div className="text-[11px] font-bold text-blue-700">Ana Sayfa</div>
            </a>
          </div>
        </CardContent>
      </Card>

      {/* System Health */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="size-4 text-gray-500" />
            Sistem Sağlığı
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-[11px]">
            <StatTile title="Faktör" value="21" color="#6366f1" sub="toplam (F1-F21)" />
            <StatTile title="Veri Kaynağı" value="4" color="#0891b2" sub="Nesine+Goaloo+FotMob+Netscores" />
            <StatTile title="Ensemble" value="6" color="#7c3aed" sub="model Brier-weight blend" />
            <StatTile title="Kalibrasyon" value="2" color="#16a34a" sub="PAVA + Sigmoid (train/val)" />
            <StatTile title="Canlı Zengin." value="3" color="#d97706" sub="odds+momentum+shot-xG" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatTile({ title, value, color, sub }: { title: string; value: string; color: string; sub: string }) {
  return (
    <div className="text-center p-2 rounded-lg bg-gray-50 border border-gray-100">
      <div className="text-[10px] font-semibold text-gray-400 uppercase mb-1">{title}</div>
      <div className="text-lg font-black" style={{ color }}>{value}</div>
      <div className="text-gray-400 truncate">{sub}</div>
    </div>
  );
}
