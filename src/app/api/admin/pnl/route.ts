// ── Admin: P&L Aggregate Endpoint ──────────────────────────────────
// Returns recent SignalPnL records plus per-tier aggregates for the
// admin P&L dashboard.
//
// Query params:
//   limit  (default 50, max 200)
//   days   (default 30, max 365)
//
// The route is admin-gated. We use the standard adminRoute wrapper.

import { NextResponse } from 'next/server';
import { adminRoute } from '@/lib/adminRoute';
import { db } from '@/lib/db';
import { logError } from '@/lib/devLog';

interface TierAggregate {
  count: number;
  wins: number;
  pnl: number;
  roi: number;
}

export const GET = adminRoute(async (req: Request) => {
  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10) || 50));
  const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get('days') ?? '30', 10) || 30));

  const since = new Date(Date.now() - days * 86_400_000);

  try {
    // Pull aggregates + recent records in two queries. Indexes on
    // (createdAt) and (signalTier) keep both fast on a 100K-row table.
    const [records, aggRows] = await Promise.all([
      db.signalPnL.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      db.signalPnL.groupBy({
        by: ['signalTier'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        _sum: { pnl: true },
        _avg: { kellyStake: true },
      }),
    ]);

    // Compute win counts per tier (groupBy doesn't expose a where clause
    // for outcome=1, so we do a single light query).
    const winsByTier = new Map<string, number>();
    for (const t of ['elite', 'confirmed', 'watch', 'radar', null]) {
      const wins = await db.signalPnL.count({
        where: { createdAt: { gte: since }, outcome: 1, signalTier: t },
      });
      winsByTier.set(t ?? '__null__', wins);
    }

    const byTier: Record<string, TierAggregate> = {};
    let overallCount = 0;
    let overallWins = 0;
    let overallPnl = 0;
    let overallStake = 0;

    for (const row of aggRows) {
      const tier = row.signalTier ?? '__null__';
      const count = row._count._all;
      const pnl = row._sum.pnl ?? 0;
      const avgStake = row._avg.kellyStake ?? 0;
      const stakeSum = avgStake * count;
      const wins = winsByTier.get(tier) ?? 0;
      const roi = stakeSum > 0 ? pnl / stakeSum : 0;

      byTier[tier === '__null__' ? 'untiered' : tier] = {
        count,
        wins,
        pnl,
        roi,
      };

      overallCount += count;
      overallWins += wins;
      overallPnl += pnl;
      overallStake += stakeSum;
    }

    return NextResponse.json({
      total: overallCount,
      records: records.map(r => ({
        id: r.id,
        signalId: r.signalId,
        calibratedP: r.calibratedP,
        closingOdds: r.closingOdds,
        outcome: r.outcome as 0 | 1,
        pnl: r.pnl,
        kellyStake: r.kellyStake,
        signalTier: r.signalTier,
        createdAt: r.createdAt.toISOString(),
      })),
      aggregates: {
        overall: {
          count: overallCount,
          wins: overallWins,
          pnl: overallPnl,
          roi: overallStake > 0 ? overallPnl / overallStake : 0,
          winRate: overallCount > 0 ? overallWins / overallCount : 0,
        },
        byTier,
      },
    });
  } catch (e) {
    logError('admin-pnl', e);
    return NextResponse.json(
      { error: 'failed to compute P&L aggregates' },
      { status: 500 },
    );
  }
});
