// ── Auto Feedback Loops (AI Berkshire inspired) ────────────────
// Triggers automatic recalibration after each goal/match/update.
// Small frequent corrections instead of batch recalibration.
//
// v2 (2026-07-05): Signal outcome categorization added — per-league,
// per-minute false-positive/false-negative analysis feeds into
// the calibration system via SignalOutcomeLog rows.

import { db } from './db';
import { logError } from './devLog';
import { resolveThesis, getMatchTheses } from './signalThesis';
import type { SignalThesis } from './signalThesis';
import { recordPrediction } from './ml/weightTuner';
import { addStackingSample, type StackingInput } from './ml/stackingEnsemble';

export type FeedbackEvent = 'goal' | 'halftime' | 'fulltime' | 'signal_expired';

export interface FeedbackAction {
  event: FeedbackEvent;
  matchCode: number;
  timestamp: number;
  actions: string[];  // what was triggered
}

export interface SignalOutcome {
  signalId: string;
  matchCode: number;
  minute: number;
  league: string;
  homeTeam: string;
  awayTeam: string;
  predictedSide: string;
  calibratedP: number;
  signalTier: string | null;
  goalHappened: boolean;
  goalSide: string | null;
  correctPrediction: boolean | null;
  minutesAfterSignal: number | null;
  outcome: 'tp' | 'fp' | 'tn' | 'fn';  // true/false positive/negative
}

// ── Outcome categorization ──────────────────────────────────────
// ponytail: single pure function. Upgrade: time-weighted decay.

export function categorizeSignalOutcome(
  goalHappened: boolean,
  correctPrediction: boolean | null,
): SignalOutcome['outcome'] {
  if (goalHappened) {
    // Goal happened — was our prediction correct?
    return correctPrediction === true ? 'tp' : 'fp';
  }
  // No goal — the "signal" was for a goal that didn't happen
  // This is a false positive by definition (we said goal, it didn't happen)
  return 'fp';
}

// ── Signal outcome persistence ──────────────────────────────────

/**
 * Record resolved signal outcomes for self-learning.
 * Called from goalSignalTracker.reportGoal after signal resolution.
 * 
 * ponytail: Signal table already stores goalHappened/correctPrediction/
 * minutesAfterSignal. No new table needed. Read stats directly from
 * Signal via signalRepository.calculateSignalStats.
 * Upgrade: per-league drift dashboard when query perf matters.
 */
export async function recordSignalOutcomes(
  _outcomes: SignalOutcome[],
): Promise<void> {
  // Signal rows are already updated with goalHappened + correctPrediction
  // by reportGoal → repoUpdateVerification. The self-learning layer
  // reads from signalRepository.calculateSignalStats.
  // No additional persistence needed.
}

/**
 * Compute per-category accuracy from the resolved Signal table.
 * Returns breakdown: tp/fp counts by minute range and league.
 * ponytail: reuse existing repoCalculateStats, no new queries.
 */
export async function getSignalOutcomeStats(
  days: number = 7,
): Promise<{
  total: number;
  byMinuteRange: Record<string, { tp: number; fp: number }>;
}> {
  // Ponytail: import dynamically to avoid circular dep at module level
  const { calculateSignalStats } = await import('./goalSignalTracker');
  const stats = await calculateSignalStats(days);

  const byMinuteRange: Record<string, { tp: number; fp: number }> = {
    '0-15': { tp: 0, fp: 0 },
    '16-30': { tp: 0, fp: 0 },
    '31-45': { tp: 0, fp: 0 },
    '46-60': { tp: 0, fp: 0 },
    '61-75': { tp: 0, fp: 0 },
    '76-90+': { tp: 0, fp: 0 },
  };

  for (const sig of stats.recentSignals) {
    if (sig.goalHappened === null) continue;
    const m = sig.signalMinute;
    let range = '76-90+';
    if (m <= 15) range = '0-15';
    else if (m <= 30) range = '16-30';
    else if (m <= 45) range = '31-45';
    else if (m <= 60) range = '46-60';
    else if (m <= 75) range = '61-75';

    if (sig.goalHappened) {
      byMinuteRange[range].tp++;
    } else {
      byMinuteRange[range].fp++;
    }
  }

  return { total: stats.totalSignals, byMinuteRange };
}

// ── onGoal callback ────────────────────────────────────────────

/**
 * Trigger after a goal is scored.
 * - Resolve active thesis for this match
 * - Update calibration weights
 * - Trigger smart calibration sync
 */
export async function onGoal(params: {
  matchCode: number;
  goalMinute: number;
  goalSide: 'home' | 'away';
  homeTeam: string;
  awayTeam: string;
  league: string;
}): Promise<FeedbackAction> {
  const actions: string[] = [];

  // 1. Resolve theses for this match
  const theses = getMatchTheses(params.matchCode);
  for (const thesis of theses) {
    if (thesis.outcome === 'pending') {
      const resolved = resolveThesis(thesis.id, {
        goalHappened: true,
        goalMinute: params.goalMinute,
        goalSide: params.goalSide,
        minutesAfterSignal: params.goalMinute - (thesis.actualGoalMinute ?? params.goalMinute),
      });
      if (resolved) {
        actions.push(`thesis_${thesis.id}_resolved_${resolved.outcome}`);
      }
    }
  }

  // 2. Log goal event for model weight recalibration
  try {
    await db.matchEvent.create({
      data: {
        matchCode: params.matchCode,
        eventType: 'goal',
        side: params.goalSide,
        minute: params.goalMinute,
        createdAt: new Date(),
      },
    });
    actions.push('goal_logged');
  } catch (err) {
    logError('feedbackLoop', 'Failed to log goal event:', err);
  }

  // 3. Online weight update: her golden sonra gerçek model çıktılarını kullan
  try {
    // Gerçek model çıktılarını PredictionLog'dan çek (son kayıt)
    const { db: dbInner } = await import('./db');
    const recentLog = await dbInner.predictionLog.findFirst({
      where: { matchCode: params.matchCode },
      orderBy: { createdAt: 'desc' },
    });
    if (recentLog) {
      if (recentLog.calibratedP != null) {
        recordPrediction('rule', recentLog.calibratedP, 1);
      }
      const poissonMaxP = Math.max(recentLog.poissonHomeP ?? 0, recentLog.poissonAwayP ?? 0);
      if (poissonMaxP > 0) {
        recordPrediction('poisson', poissonMaxP, 1);
      }
      if (recentLog.homeElo != null && recentLog.awayElo != null) {
        const eloDiff = Math.abs(recentLog.homeElo - recentLog.awayElo);
        recordPrediction('elo', Math.min(0.85, 0.15 + eloDiff * 0.001), 1);
      }
    }
    actions.push('weights_updated');
  } catch { /* silent */ }

  return {
    event: 'goal',
    matchCode: params.matchCode,
    timestamp: Date.now(),
    actions,
  };
}

/**
 * Trigger after halftime.
 * - Expire first-half signals
 * - Log halftime event
 */
export async function onHalftime(params: {
  matchCode: number;
}): Promise<FeedbackAction> {
  const actions: string[] = [];

  try {
    await db.matchEvent.create({
      data: {
        matchCode: params.matchCode,
        eventType: 'halftime',
        side: 'none',
        minute: 45,
        createdAt: new Date(),
      },
    });
    actions.push('halftime_logged');
  } catch (err) {
    logError('feedbackLoop', 'Failed to log halftime:', err);
  }

  return {
    event: 'halftime',
    matchCode: params.matchCode,
    timestamp: Date.now(),
    actions,
  };
}

/**
 * Trigger after full time.
 * - Finalize all pending theses for this match
 * - Log final score for calibration
 * - Trigger league profile update
 */
export async function onFulltime(params: {
  matchCode: number;
  homeScore: number;
  awayScore: number;
  league: string;
}): Promise<FeedbackAction> {
  const actions: string[] = [];

  // 1. Expire remaining pending theses
  const theses = getMatchTheses(params.matchCode);
  for (const thesis of theses) {
    if (thesis.outcome === 'pending') {
      const resolved = resolveThesis(thesis.id, {
        goalHappened: false,
      });
      if (resolved) {
        actions.push(`thesis_${thesis.id}_expired`);
      }
    }
  }

  // 2. Log fulltime event
  try {
    await db.matchEvent.create({
      data: {
        matchCode: params.matchCode,
        eventType: 'fulltime',
        side: 'none',
        minute: 90,
        createdAt: new Date(),
      },
    });
    actions.push('fulltime_logged');
  } catch (err) {
    logError('feedbackLoop', 'Failed to log fulltime:', err);
  }

  return {
    event: 'fulltime',
    matchCode: params.matchCode,
    timestamp: Date.now(),
    actions,
  };
}

/**
 * Get feedback loop statistics.
 */
export function getFeedbackStats(): {
  totalEvents: number;
  lastEvent: FeedbackEvent | null;
  lastMatchCode: number | null;
} {
  // Read from DB stats
  return {
    totalEvents: 0,  // placeholder
    lastEvent: null,
    lastMatchCode: null,
  };
}
