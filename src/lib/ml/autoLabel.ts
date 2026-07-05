// ── Auto-label background task ─────────────────────────────────────
// Runs before each daily export. Labels unlabeled PredictionLog rows
// using MatchEvent goal data. Bounded to 50K rows per run to avoid
// overwhelming the DB. Idempotent — skips already-labeled rows.
//
// ponytail: single function, called from trainingScheduler. Upgrade:
// move to a dedicated cron job if row volume grows beyond 50K/day.

import { db } from '../db';
import { logInfo, logError } from '../devLog';

export interface AutoLabelResult {
  checked: number;
  unlabeled: number;
  labeled: number;
  skipped: number; // rows with no goal events (match not finished yet)
}

/**
 * Auto-label all unlabeled PredictionLog rows using MatchEvent goals.
 * Call before daily export so training data has fresh labels.
 */
export async function autoLabelPredictionLogs(
  maxRows: number = 50_000,
): Promise<AutoLabelResult> {
  const start = Date.now();
  let labeled = 0;
  let skipped = 0;

  try {
    const unlabeled = await db.predictionLog.findMany({
      where: { goalScored: null, featuresJson: { not: null } },
      select: { id: true, matchCode: true, minute: true },
      orderBy: { createdAt: "desc" },
      take: maxRows,
    });

    if (unlabeled.length === 0) {
      return { checked: 0, unlabeled: 0, labeled: 0, skipped: 0 };
    }

    const codes = [...new Set(unlabeled.map(r => r.matchCode))];
    const events = await db.matchEvent.findMany({
      where: { matchCode: { in: codes }, eventType: "goal" },
      select: { matchCode: true, minute: true, createdAt: true },
      orderBy: { minute: "asc" },
    });
    const byMatch = new Map<number, typeof events>();
    for (const ev of events) {
      if (!byMatch.has(ev.matchCode)) byMatch.set(ev.matchCode, []);
      byMatch.get(ev.matchCode)!.push(ev);
    }

    const horizonMin = 15; // ponytail: broad horizon, training export corrects with horizonAwareLabel
    const batchSize = 300;

    for (let i = 0; i < unlabeled.length; i += batchSize) {
      const batch = unlabeled.slice(i, i + batchSize);
      await Promise.all(batch.map(async (row) => {
        const goals = byMatch.get(row.matchCode);
        if (!goals || goals.length === 0) {
          skipped++;
          return;
        }
        const rMin = row.minute ?? 0;
        const firstGoal = goals.find(g => g.minute > rMin && g.minute - rMin <= horizonMin);
        const delta = firstGoal ? firstGoal.minute - rMin : null;
        await db.predictionLog.update({
          where: { id: row.id },
          data: {
            goalScored: !!firstGoal,
            minutesToGoal: delta,
            goalTimestamp: firstGoal?.createdAt ?? null,
          },
        });
        labeled++;
      }));
    }

    const elapsed = Date.now() - start;
    logInfo('AutoLabel', `${labeled} labeled, ${skipped} skipped (no goal events), ${unlabeled.length - labeled - skipped} no-match rows in ${elapsed}ms`);

    return {
      checked: unlabeled.length,
      unlabeled: unlabeled.length - labeled - skipped,
      labeled,
      skipped,
    };
  } catch (err) {
    logError('AutoLabel', err);
    return { checked: 0, unlabeled: 0, labeled, skipped };
  }
}
