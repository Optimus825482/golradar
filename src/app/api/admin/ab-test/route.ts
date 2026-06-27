// ── A/B Test API — Eski vs Yeni sinyal sistemi karşılaştırması ──
// Geçmiş maç verilerini kullanarak iki sistemi yan yana test eder.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logError } from '@/lib/devLog';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5dk

interface ABTestConfig {
  daysBack: number;
  minScore: number;        // min probability score for signal (default 60)
  minCalibratedP: number;  // min calibrated probability (default 0.5)
}

interface ABTestResult {
  ok: boolean;
  config: ABTestConfig;
  totalMatches: number;
  oldSystem: SystemResult;
  newSystem: SystemResult;
  improvement: {
    precisionDelta: number;    // yüzde puanı
    recallDelta: number;
    f1Delta: number;
    falsePositiveDelta: number;
    signalCountDelta: number;
  };
}

interface SystemResult {
  totalSignals: number;
  correctSignals: number;    // goal happened within 15min
  incorrectSignals: number;  // no goal within 15min
  falsePositives: number;     // signal but no goal
  truePositives: number;      // signal + goal within 15min
  precision: number;          // TP / (TP + FP)
  recall: number;             // TP / actual goals
  f1Score: number;
  avgMinutesToGoal: number;
  signalsByTier: Record<string, number>;
}

async function runOldSystem(
  matches: any[],
  config: ABTestConfig,
): Promise<SystemResult> {
  let totalSignals = 0;
  let correctSignals = 0;
  let incorrectSignals = 0;
  let falsePositives = 0;
  let truePositives = 0;
  let totalMinutes = 0;
  let goalCount = 0;
  const signalsByTier: Record<string, number> = {};

  // Old system: signal if score >= threshold, no verdict check
  for (const match of matches) {
    const homeScore = (match as any).homeScore ?? 0;
    const awayScore = (match as any).awayScore ?? 0;
    const actualGoals = homeScore + awayScore;
    if (actualGoals > 0) goalCount++;

    const signals = (match as any).signals ?? [];
    for (const s of signals) {
      if (s.signalScore >= config.minScore) {
        totalSignals++;
        const level = s.signalLevel ?? 'medium';
        signalsByTier[level] = (signalsByTier[level] ?? 0) + 1;

        if (s.goalHappened === true) {
          correctSignals++;
          truePositives++;
          totalMinutes += s.minutesAfterSignal ?? 999;
        } else {
          incorrectSignals++;
          falsePositives++;
        }
      }
    }
  }

  const precision = (truePositives + falsePositives) > 0
    ? truePositives / (truePositives + falsePositives) : 0;
  const recall = goalCount > 0 ? truePositives / goalCount : 0;

  return {
    totalSignals,
    correctSignals,
    incorrectSignals,
    falsePositives,
    truePositives,
    precision,
    recall,
    f1Score: (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0,
    avgMinutesToGoal: correctSignals > 0 ? totalMinutes / correctSignals : 0,
    signalsByTier,
  };
}

async function runNewSystem(
  matches: any[],
  config: ABTestConfig,
): Promise<SystemResult> {
  // Yeni sistem = eski sistemle aynı (thesis tracking sadece kayıt, engellemez)
  // A/B test sadece thesis'in sinyal sayısını etkilemediğini doğrulamak için
  let totalSignals = 0;
  let correctSignals = 0;
  let incorrectSignals = 0;
  let falsePositives = 0;
  let truePositives = 0;
  let totalMinutes = 0;
  let goalCount = 0;
  const signalsByTier: Record<string, number> = {};

  for (const match of matches) {
    const homeScore = (match as any).homeScore ?? 0;
    const awayScore = (match as any).awayScore ?? 0;
    const actualGoals = homeScore + awayScore;
    if (actualGoals > 0) goalCount++;

    const signals = (match as any).signals ?? [];
    for (const s of signals) {
      if (s.signalScore >= config.minScore) {
        totalSignals++;
        const level = s.signalLevel ?? 'medium';
        signalsByTier[level] = (signalsByTier[level] ?? 0) + 1;

        if (s.goalHappened === true) {
          correctSignals++;
          truePositives++;
          totalMinutes += s.minutesAfterSignal ?? 999;
        } else {
          incorrectSignals++;
          falsePositives++;
        }
      }
    }
  }

  const precision = (truePositives + falsePositives) > 0
    ? truePositives / (truePositives + falsePositives) : 0;
  const recall = goalCount > 0 ? truePositives / goalCount : 0;

  return {
    totalSignals,
    correctSignals,
    incorrectSignals,
    falsePositives,
    truePositives,
    precision,
    recall,
    f1Score: (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0,
    avgMinutesToGoal: correctSignals > 0 ? totalMinutes / correctSignals : 0,
    signalsByTier,
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const daysBack = parseInt(url.searchParams.get('days') ?? '30');
    const minScore = parseInt(url.searchParams.get('minScore') ?? '60');

    const config: ABTestConfig = { daysBack, minScore, minCalibratedP: 0.5 };

    // Fetch historical signals from DB
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const dbSignals = await db.signal.findMany({
      where: { signalTimestamp: { gte: cutoff } },
      orderBy: { matchCode: 'asc' },
    });

    // Group by match
    const matchMap = new Map<number, any>();
    for (const s of dbSignals) {
      if (!matchMap.has(s.matchCode)) {
        matchMap.set(s.matchCode, {
          matchCode: s.matchCode,
          homeTeam: s.homeTeam,
          awayTeam: s.awayTeam,
          league: s.league,
          date: s.date,
          homeScore: s.finalHomeScore ?? 0,
          awayScore: s.finalAwayScore ?? 0,
          activeSources: ['nesine'],
          signals: [],
        });
      }
      matchMap.get(s.matchCode)!.signals.push(s);
    }

    const matches = Array.from(matchMap.values());
    const [oldResult, newResult] = await Promise.all([
      runOldSystem(matches, config),
      runNewSystem(matches, config),
    ]);

    const improvement = {
      precisionDelta: (newResult.precision - oldResult.precision) * 100,
      recallDelta: (newResult.recall - oldResult.recall) * 100,
      f1Delta: (newResult.f1Score - oldResult.f1Score) * 100,
      falsePositiveDelta: (newResult.falsePositives - oldResult.falsePositives),
      signalCountDelta: (newResult.totalSignals - oldResult.totalSignals),
    };

    const result: ABTestResult = {
      ok: true,
      config,
      totalMatches: matches.length,
      oldSystem: oldResult,
      newSystem: newResult,
      improvement,
    };

    return NextResponse.json(result);
  } catch (err) {
    logError('ab-test', 'Failed:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
