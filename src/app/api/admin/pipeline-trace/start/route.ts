// ── Pipeline Debug Trace API ───────────────────────────────────
// POST /api/admin/pipeline-trace/start?matchCode=2184558
// Bir maç için pipeline'ı debug modunda çalıştırır, her adımı
// kaydeder, sonucu döndürür.

import { NextRequest, NextResponse } from 'next/server';
import { ACTIVE_STATUSES, FINISHED_STATUSES, LIVESCORE_API, HEADERS } from '@/lib/nesine';
import { calculatePressure } from '@/lib/nesineTypes';
import { calculateGoalProbability } from '@/lib/nesine';
import { checkAndRecordSignal } from '@/lib/goalSignalTracker';
import { PipelineTracer } from '@/lib/pipelineTracer';
import { RADAR_THRESHOLD } from '@/config';
import { logError } from '@/lib/devLog';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const matchCode = parseInt(searchParams.get('matchCode') || '0', 10);
  if (!matchCode) {
    return NextResponse.json({ ok: false, error: 'missing matchCode' }, { status: 400 });
  }

  const tracer = new PipelineTracer(matchCode);

  try {
    // ── Step 1: Fetch raw match data from Nesine API ──────────
    tracer.stepBegin();
    let resp: Response;
    try {
      resp = await fetch(`${LIVESCORE_API}?sportType=1&v=0`, {
        headers: HEADERS,
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) {
      tracer.stepEnd('fetch_raw_data', { matchCode }, {}, (e as Error).message);
      await tracer.save('error', (e as Error).message);
      return NextResponse.json({ ok: false, error: 'fetch failed', traceId: '' });
    }
    const data = await resp.json();
    const match = (data?.d ?? []).find((m: any) => m.C === matchCode);
    if (!match) {
      tracer.stepEnd('fetch_raw_data', { matchCode, found: false }, {});
      await tracer.save('error', 'match not found');
      return NextResponse.json({ ok: false, error: 'match not found in live data' });
    }
    tracer.stepEnd('fetch_raw_data', { matchCode, found: true }, {
      status: match.S, minute: match.M, home: match.HT, away: match.AT,
      homeGoals: match.ES?.[0]?.H, awayGoals: match.ES?.[0]?.A,
    });

    // Extract match info
    const home = String(match.HT || '');
    const away = String(match.AT || '');
    const league = String(match.L || '');
    const minute = String(match.M || '0');
    const homeGoals = (match.ES?.[0]?.H as number) || 0;
    const awayGoals = (match.ES?.[0]?.A as number) || 0;
    const status = (match.S as number) || 0;
    const isLive = ACTIVE_STATUSES.has(status);
    const isFinished = FINISHED_STATUSES.has(status);

    // Update tracer metadata
    tracer.homeTeam = home;
    tracer.awayTeam = away;
    tracer.league = league;

    // ── Step 2: Parse stats from SE array ─────────────────────
    tracer.stepBegin();
    const se = match.SE as any[] | undefined;
    let stats: any = {};
    const parseInput: Record<string, unknown> = { hasSE: Array.isArray(se) && (se?.length ?? 0) > 0 };

    if (Array.isArray(se) && se.length > 0) {
      const { parseStats } = await import('@/lib/nesine');
      stats = parseStats(se);
      // Override with shorthand fields if present
      if (match.DAH != null) stats.dangerous_attacks = { home: match.DAH, away: match.DAA ?? 0 };
      if (match.SH != null) stats.shots_total = { home: match.SH, away: match.SA ?? 0 };
      if (match.CH != null) stats.corners = { home: match.CH, away: match.CA ?? 0 };
      parseInput.seFields = se.map((e: any) => ({ ET: e.ET, H: e.H, A: e.A }));
    } else {
      // Legacy fallback
      stats = {
        possession: { home: 50, away: 50 },
        dangerous_attacks: { home: (match.DAH as number) || 0, away: (match.DAA as number) || 0 },
        shots_total: { home: (match.SH as number) || 0, away: (match.SA as number) || 0 },
        corners: { home: (match.CH as number) || 0, away: (match.CA as number) || 0 },
      };
    }
    tracer.stepEnd('parse_stats', parseInput, stats);

    // ── Step 3: Calculate pressure ────────────────────────────
    tracer.stepBegin();
    const pressure = calculatePressure(stats);
    tracer.stepEnd('calculate_pressure', stats, pressure);

    // ── Step 4: Check if live + drawable ──────────────────────
    tracer.stepBegin();
    const shouldProcess = !!home && !!away && isLive && !isFinished;
    tracer.stepEnd('pre_checks', {
      home: !!home, away: !!away, isLive, isFinished, shouldProcess,
    }, { shouldProcess });

    if (!shouldProcess) {
      await tracer.save('completed');
      return NextResponse.json({ ok: true, traceId: '', skipped: true });
    }

    // ── Step 5: Calculate goal probability ────────────────────
    tracer.stepBegin();
    const prob = calculateGoalProbability(stats, minute, true, undefined, homeGoals, awayGoals, home, away);
    tracer.stepEnd('calculate_goal_probability', {
      minute, homeGoals, awayGoals,
      dangerous_attacks: stats.dangerous_attacks,
      shots_total: stats.shots_total,
      corners: stats.corners,
    }, {
      score: prob.score,
      homeScore: prob.homeScore,
      awayScore: prob.awayScore,
      side: prob.side,
      level: prob.level,
      calibratedP: prob.calibratedP,
      poissonP: prob.poissonP,
      goalProbability5min: prob.goalProbability5min,
      factors: prob.factors,
    });

    // ── Step 6: Signal decision ───────────────────────────────
    const sigMin = parseInt(minute.replace(/[^0-9]/g, ''), 10) || 0;
    const inExcludedZone = sigMin <= 2;

    const gatePassed = prob && prob.score >= RADAR_THRESHOLD && prob.side && !inExcludedZone;

    tracer.step('signal_decision', {
      score: prob.score,
      threshold: RADAR_THRESHOLD,
      side: prob.side,
      sigMin,
      inExcludedZone,
      gatePassed,
    }, { decision: gatePassed ? 'will_attempt_signal' : 'skipped' });

    // ── Step 7: Attempt signal creation ───────────────────────
    if (gatePassed) {
      tracer.stepBegin();
      try {
        const result = await checkAndRecordSignal(
          matchCode, home, away, league,
          String(match.T || ''), minute,
          {
            score: prob.score,
            homeScore: prob.homeScore,
            awayScore: prob.awayScore,
            side: prob.side,
            level: prob.level,
            factors: prob.factors,
            calibratedP: prob.calibratedP,
            poissonP: prob.poissonP,
          },
          homeGoals, awayGoals,
        );
        tracer.stepEnd('check_and_record_signal', {}, {
          signalCreated: !!result,
          signalTier: result?.signalTier ?? null,
          signalSide: result?.signalSide ?? null,
          signalScore: result?.signalScore ?? null,
          escalated: result?.escalated ?? false,
        });
      } catch (e) {
        tracer.stepEnd('check_and_record_signal', {}, {}, (e as Error).message);
      }
    }

    // ── Save trace ────────────────────────────────────────────
    const traceId = await tracer.save('completed');
    return NextResponse.json({ ok: true, traceId, steps: tracer.getSteps() });
  } catch (e) {
    await tracer.save('error', (e as Error).message);
    logError('PipelineTrace', 'debug failed:', e);
    return NextResponse.json({ ok: false, error: (e as Error).message, traceId: '' });
  }
}
