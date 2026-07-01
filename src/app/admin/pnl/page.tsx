'use client';

// ── Admin P&L Dashboard ────────────────────────────────────────────
// Faz D Task D1 — per-signal P&L tracking with Kelly staking.
// Renders aggregate stats from the SignalPnL table:
//   - Total signals resolved, win rate, ROI %
//   - P&L grouped by signalTier (elite / confirmed / watch / radar)
//   - Recent 50 signals with calibratedP, odds, outcome, pnl
//
// Data source: GET /api/admin/pnl (or similar) — fetch on mount.
// All money values are in "units" (the Kelly stake base). Multiples
// of stake are converted to units by multiplying by the stake.

import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Activity, Target } from 'lucide-react';
import { authFetch } from '@/lib/adminAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { fmtDate } from '@/lib/safeFormat';

interface PnlRecord {
  id: string;
  signalId: string;
  calibratedP: number;
  closingOdds: number | null;
  outcome: 0 | 1;
  pnl: number | null;
  kellyStake: number | null;
  signalTier: string | null;
  createdAt: string;
}

interface PnlResponse {
  total: number;
  records: PnlRecord[];
  aggregates: {
    byTier: Record<string, { count: number; wins: number; pnl: number; roi: number }>;
    overall: { count: number; wins: number; pnl: number; roi: number; winRate: number };
  };
}

function asUnits(v: number | null | undefined, d = 2): string {
  if (v == null) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(d)}u`;
}

function asPct(v: number | null | undefined, d = 1): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(d)}%`;
}

function tierColor(tier: string | null): string {
  switch (tier) {
    case 'elite': return 'bg-purple-500/20 text-purple-300 border-purple-500/40';
    case 'confirmed': return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    case 'watch': return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    case 'radar': return 'bg-slate-500/20 text-slate-300 border-slate-500/40';
    default: return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
  }
}

export default function PnlDashboardPage() {
  const [data, setData] = useState<PnlResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch('/api/admin/pnl?limit=50');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as PnlResponse;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'unknown error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const overall = data?.aggregates.overall;
  const tierRows = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.aggregates.byTier).sort(([, a], [, b]) => b.pnl - a.pnl);
  }, [data]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <DollarSign className="w-6 h-6 text-emerald-400" />
          Signal P&L Dashboard
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Per-signal P&L tracking with quarter-Kelly staking. Data refreshed on each page load.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          Failed to load P&L data: {error}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Resolved signals"
          value={overall?.count.toString() ?? '—'}
          icon={<Activity className="w-4 h-4 text-slate-400" />}
          loading={loading}
        />
        <KpiCard
          label="Win rate"
          value={asPct(overall?.winRate)}
          icon={<Target className="w-4 h-4 text-slate-400" />}
          loading={loading}
        />
        <KpiCard
          label="Total P&L"
          value={asUnits(overall?.pnl)}
          icon={
            overall && overall.pnl >= 0
              ? <TrendingUp className="w-4 h-4 text-emerald-400" />
              : <TrendingDown className="w-4 h-4 text-red-400" />
          }
          tone={overall && overall.pnl >= 0 ? 'emerald' : 'red'}
          loading={loading}
        />
        <KpiCard
          label="ROI"
          value={asPct(overall?.roi)}
          icon={
            overall && overall.roi >= 0
              ? <TrendingUp className="w-4 h-4 text-emerald-400" />
              : <TrendingDown className="w-4 h-4 text-red-400" />
          }
          tone={overall && overall.roi >= 0 ? 'emerald' : 'red'}
          loading={loading}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">P&L by signal tier</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : tierRows.length === 0 ? (
            <p className="text-sm text-slate-400">No resolved signals yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700">
                  <th className="text-left py-2">Tier</th>
                  <th className="text-right py-2">Signals</th>
                  <th className="text-right py-2">Wins</th>
                  <th className="text-right py-2">Win rate</th>
                  <th className="text-right py-2">P&L (units)</th>
                  <th className="text-right py-2">ROI</th>
                </tr>
              </thead>
              <tbody>
                {tierRows.map(([tier, agg]) => (
                  <tr key={tier} className="border-b border-slate-800/60">
                    <td className="py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${tierColor(tier)}`}>
                        {tier}
                      </span>
                    </td>
                    <td className="text-right tabular-nums">{agg.count}</td>
                    <td className="text-right tabular-nums">{agg.wins}</td>
                    <td className="text-right tabular-nums">
                      {asPct(agg.count > 0 ? agg.wins / agg.count : null)}
                    </td>
                    <td className={`text-right tabular-nums ${agg.pnl >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {asUnits(agg.pnl)}
                    </td>
                    <td className={`text-right tabular-nums ${agg.roi >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {asPct(agg.roi)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent resolved signals</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : !data || data.records.length === 0 ? (
            <p className="text-sm text-slate-400">No records yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700">
                    <th className="text-left py-2">Date</th>
                    <th className="text-left py-2">Tier</th>
                    <th className="text-right py-2">P (cal)</th>
                    <th className="text-right py-2">Odds</th>
                    <th className="text-right py-2">Stake</th>
                    <th className="text-right py-2">Outcome</th>
                    <th className="text-right py-2">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {data.records.map(r => (
                    <tr key={r.id} className="border-b border-slate-800/60">
                      <td className="py-1.5 text-slate-300">{fmtDate(r.createdAt)}</td>
                      <td>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs border ${tierColor(r.signalTier)}`}>
                          {r.signalTier ?? '—'}
                        </span>
                      </td>
                      <td className="text-right tabular-nums">{r.calibratedP.toFixed(3)}</td>
                      <td className="text-right tabular-nums">
                        {r.closingOdds != null ? r.closingOdds.toFixed(2) : '—'}
                      </td>
                      <td className="text-right tabular-nums">
                        {r.kellyStake != null ? r.kellyStake.toFixed(3) : '—'}
                      </td>
                      <td>
                        <Badge variant={r.outcome === 1 ? 'default' : 'secondary'}>
                          {r.outcome === 1 ? 'Goal' : 'No goal'}
                        </Badge>
                      </td>
                      <td className={`text-right tabular-nums ${(r.pnl ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                        {asUnits(r.pnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  label, value, icon, tone, loading,
}: {
  label: string; value: string; icon: React.ReactNode; tone?: 'emerald' | 'red'; loading: boolean;
}) {
  const valueColor = tone === 'emerald'
    ? 'text-emerald-300'
    : tone === 'red'
      ? 'text-red-300'
      : 'text-slate-100';
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-slate-400 uppercase tracking-wide">{label}</span>
          {icon}
        </div>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div className={`text-2xl font-bold tabular-nums ${valueColor}`}>{value}</div>
        )}
      </CardContent>
    </Card>
  );
}
