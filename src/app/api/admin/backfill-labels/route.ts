// ── Admin: Backfill PredictionLog Labels ──────────────────────────
// One-shot repair: scan MatchEvent for goal events, then label every
// PredictionLog row with goalScored/minutesToGoal/goalTimestamp.
//
// HORIZON-AWARE SEMANTICS (post 2026-07-01 fix): a row at minute T
// is labelled positive iff at least one goal happens within
// HORIZON_FOR_LABEL minutes AFTER T. This matches what the trainer
// learns from (exportTrainingData → labelForLog).
//
// REGRESSION NOTE: the previous formula was
//   goalHappened = rMin <= firstGoalMinute
// which marked every prediction up to the first goal minute as
// positive — producing ~80% positive rate and trainer collapse
// (AUC=0.500). The horizon-aware fix brings the positive rate
// down to ~10-15% (real-world goal rate).
//
// Usage:
//   POST /api/admin/backfill-labels (with force=true)
//   GET  /api/admin/backfill-labels?action=status

import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/adminRoute";
import { db } from "@/lib/db";
import { logInfo } from "@/lib/devLog";

export const dynamic = "force-dynamic";

const HORIZON_FOR_LABEL = 15;

interface MatchLabelSummary {
  matchCode: number;
  firstGoalMinute: number | null;
  goalMinutes: number[];
  unlabeledRows: number;
  labeledRows: number;
  positives: number;
}

// ── In-process progress tracker (singleton) ──────────────────────
// GET endpoint'i buradaki son durumu okuyup progress gösterebilir.
interface BackfillProgress {
  startedAt: number;
  totalMatches: number;
  completedMatches: number;
  totalLabeled: number;
  totalPositives: number;
  positiveRate: number;
  running: boolean;
}

let progress: BackfillProgress = {
  startedAt: 0,
  totalMatches: 0,
  completedMatches: 0,
  totalLabeled: 0,
  totalPositives: 0,
  positiveRate: 0,
  running: false,
};

// ── GET: Progress status ──────────────────────────────────────────
export const GET = adminRoute(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("action") === "status") {
    return NextResponse.json({ success: true, data: progress });
  }
  return NextResponse.json(
    { ok: false, error: "unknown_action" },
    { status: 400 },
  );
});

// ── POST: Run backfill (chunk'li) ─────────────────────────────────
export const POST = adminRoute(async (request: Request) => {
  let force = false;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      force?: boolean;
    };
    force = body.force === true;
  } catch {
    /* no body — fine */
  }

  // 1. Collect matchCodes that have rows needing (re-)label.
  const where = force ? {} : { goalScored: null };
  const unlabeled = await db.predictionLog.findMany({
    where,
    select: { matchCode: true },
    distinct: ["matchCode"],
  });
  const matchCodes = unlabeled.map((r) => r.matchCode).sort((a, b) => a - b);
  if (matchCodes.length === 0) {
    return NextResponse.json({
      success: true,
      data: {
        matchesScanned: 0,
        totalLabeled: 0,
        positiveRate: 0,
        message: force
          ? "No rows to relabel"
          : "No unlabeled rows found",
      },
    });
  }

  // Reset progress
  progress = {
    startedAt: Date.now(),
    totalMatches: matchCodes.length,
    completedMatches: 0,
    totalLabeled: 0,
    totalPositives: 0,
    positiveRate: 0,
    running: true,
  };

  const summaries: MatchLabelSummary[] = [];
  let totalLabeled = 0;
  let totalPositives = 0;

  for (let i = 0; i < matchCodes.length; i++) {
    const matchCode = matchCodes[i];

    // Resolve ALL goal minutes for the match, sorted ascending.
    const goalEvents = await db.matchEvent.findMany({
      where: { matchCode, eventType: "goal" },
      orderBy: { minute: "asc" },
      select: { minute: true },
    });
    const goalMinutes = goalEvents
      .map((e) => e.minute)
      .filter((m): m is number => Number.isFinite(m));
    const firstGoalMinute = goalMinutes[0] ?? null;

    // If force=true, also clear the existing labels so they get rewritten.
    if (force) {
      await db.predictionLog.updateMany({
        where: { matchCode },
        data: { goalScored: null, minutesToGoal: null, goalTimestamp: null },
      });
    }

    const rows = await db.predictionLog.findMany({
      where: { matchCode },
      select: { id: true, minute: true },
    });
    if (rows.length === 0) {
      progress.completedMatches = i + 1;
      continue;
    }

    let labeled = 0;
    let positives = 0;
    for (const row of rows) {
      const rMin = row.minute ?? 0;
      const firstEligible = goalMinutes.find(
        (gm) => gm > rMin && gm - rMin <= HORIZON_FOR_LABEL,
      );
      if (firstEligible === undefined) {
        await db.predictionLog.update({
          where: { id: row.id },
          data: { goalScored: false, minutesToGoal: null, goalTimestamp: null },
        });
      } else {
        const delta = firstEligible - rMin;
        await db.predictionLog.update({
          where: { id: row.id },
          data: {
            goalScored: true,
            minutesToGoal: delta,
            goalTimestamp: new Date(Date.now() - delta * 60_000),
          },
        });
        positives++;
      }
      labeled++;
    }
    totalLabeled += labeled;
    totalPositives += positives;
    summaries.push({
      matchCode,
      firstGoalMinute,
      goalMinutes,
      unlabeledRows: rows.length,
      labeledRows: labeled,
      positives,
    });

    // Update progress after every 20 matches (reduce DB write load)
    if (i % 20 === 0 || i === matchCodes.length - 1) {
      progress.completedMatches = i + 1;
      progress.totalLabeled = totalLabeled;
      progress.totalPositives = totalPositives;
      progress.positiveRate =
        totalLabeled > 0
          ? Math.round((totalPositives / totalLabeled) * 10000) / 100
          : 0;
    }
  }

  progress.running = false;
  progress.totalLabeled = totalLabeled;
  progress.totalPositives = totalPositives;
  progress.positiveRate =
    totalLabeled > 0
      ? Math.round((totalPositives / totalLabeled) * 10000) / 100
      : 0;

  logInfo(
    "backfill-labels",
    `Repaired ${totalLabeled} rows (${totalPositives} positive) across ${matchCodes.length} matches (force=${force})`,
  );

  return NextResponse.json({
    success: true,
    data: {
      matchesScanned: matchCodes.length,
      totalLabeled,
      totalPositives,
      positiveRate: progress.positiveRate,
      durationMs: Date.now() - progress.startedAt,
      summaries,
    },
  });
});