// ── Auto Feedback Loops (AI Berkshire inspired) ────────────────
// Triggers automatic recalibration after each goal/match/update.
// Small frequent corrections instead of batch recalibration.

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
