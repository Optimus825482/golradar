// ── Admin: Backfill PredictionLog Labels ──────────────────────────
// One-shot repair: scan MatchEvent for goal events, then label every
// PredictionLog row with goalScored/minutesToGoal/goalTimestamp based
// on the first goal minute per match. Skips already-labeled rows.
//
// Used after schema fixes or whenever finalizeMatchSignals was bypassed
// (e.g. matches finalized via older code paths that didn't label logs).

import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/adminRoute";
import { db } from "@/lib/db";
import { logInfo } from "@/lib/devLog";

export const dynamic = "force-dynamic";

interface MatchLabelSummary {
  matchCode: number;
  firstGoalMinute: number | null;
  unlabeledRows: number;
  labeledRows: number;
}

export const POST = adminRoute(async (_request: Request) => {
  // 1. Collect matchCodes that have unlabeled rows
  const unlabeled = await db.predictionLog.findMany({
    where: { goalScored: null },
    select: { matchCode: true },
    distinct: ["matchCode"],
  });
  const matchCodes = unlabeled.map((r) => r.matchCode);
  if (matchCodes.length === 0) {
    return NextResponse.json({
      success: true,
      data: {
        matchesScanned: 0,
        totalLabeled: 0,
        summaries: [] as MatchLabelSummary[],
        message: "No unlabeled rows found",
      },
    });
  }

  const summaries: MatchLabelSummary[] = [];
  let totalLabeled = 0;

  for (const matchCode of matchCodes) {
    // First goal minute from MatchEvent
    const firstGoal = await db.matchEvent.findFirst({
      where: { matchCode, eventType: "goal" },
      orderBy: { minute: "asc" },
      select: { minute: true },
    });
    const firstGoalMinute = firstGoal?.minute ?? null;

    const rows = await db.predictionLog.findMany({
      where: { matchCode, goalScored: null },
      select: { id: true, minute: true },
    });
    if (rows.length === 0) continue;

    let labeled = 0;
    for (const row of rows) {
      const rMin = row.minute ?? 0;
      if (firstGoalMinute == null) {
        await db.predictionLog.update({
          where: { id: row.id },
          data: { goalScored: false, minutesToGoal: null, goalTimestamp: null },
        });
      } else {
        const goalHappened = rMin <= firstGoalMinute;
        const delta = firstGoalMinute - rMin;
        await db.predictionLog.update({
          where: { id: row.id },
          data: {
            goalScored: goalHappened,
            minutesToGoal: goalHappened ? Math.max(0, delta) : null,
            goalTimestamp: goalHappened ? new Date(Date.now() - delta * 60_000) : null,
          },
        });
      }
      labeled++;
    }
    totalLabeled += labeled;
    summaries.push({
      matchCode,
      firstGoalMinute,
      unlabeledRows: rows.length,
      labeledRows: labeled,
    });
  }

  logInfo("backfill-labels",
    `Repaired ${totalLabeled} rows across ${matchCodes.length} matches`);

  return NextResponse.json({
    success: true,
    data: {
      matchesScanned: matchCodes.length,
      totalLabeled,
      summaries,
    },
  });
});