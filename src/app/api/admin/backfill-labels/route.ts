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

// ── Goal minute resolution: MatchEvent + MatchSnapshot ────────────
async function resolveGoalMinutes(matchCode: number): Promise<number[]> {
  const goalSet = new Set<number>();

  // Primary: MatchEvent
  const goalEvents = await db.matchEvent.findMany({
    where: { matchCode, eventType: "goal" },
    orderBy: { minute: "asc" },
    select: { minute: true },
  });
  for (const ev of goalEvents) {
    if (Number.isFinite(ev.minute)) goalSet.add(ev.minute);
  }

  // Secondary: MatchSnapshot — detect homeGoals/awayGoals increases
  // between consecutive snapshots. Each increase = a goal at that minute.
  const snapshots = await db.matchSnapshot.findMany({
    where: { matchCode },
    orderBy: [{ minute: "asc" }, { createdAt: "asc" }],
    select: { minute: true, homeGoals: true, awayGoals: true },
  });
  if (snapshots.length > 0) {
    let prevHome = 0, prevAway = 0;
    for (const snap of snapshots) {
      if (snap.minute === null || !Number.isFinite(snap.minute)) continue;
      const home = snap.homeGoals ?? 0;
      const away = snap.awayGoals ?? 0;
      if (home > prevHome) goalSet.add(snap.minute);
      if (away > prevAway) goalSet.add(snap.minute);
      prevHome = home;
      prevAway = away;
    }
  }

  return [...goalSet].sort((a, b) => a - b);
}

// ── In-process progress tracker (singleton) ──────────────────────
// GET endpoint'i buradaki son durumu okuyup progress gösterebilir.
interface BackfillProgress {
  startedAt: number;
  totalMatches: number;
  completedMatches: number;
  matchesWithGoals: number;    // Kaç matchCode'da goal bulundu
  matchesWithOnlyMev: number; // Kaç matchCode'da sadece MatchEvent'te goal var
  matchesWithOnlySnap: number;// Kaç matchCode'da sadece MatchSnapshot'ta goal var
  totalLabeled: number;
  totalPositives: number;
  positiveRate: number;
  running: boolean;
}

let progress: BackfillProgress = {
  startedAt: 0,
  totalMatches: 0,
  completedMatches: 0,
  matchesWithGoals: 0,
  matchesWithOnlyMev: 0,
  matchesWithOnlySnap: 0,
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

// ── POST: Run backfill (paralel worker'li) ───────────────────────
export const POST = adminRoute(async (request: Request) => {
  let force = false;
  let workers = 1;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      force?: boolean;
      workers?: number;
    };
    force = body.force === true;
    workers = Math.max(1, Math.min(12, body.workers ?? 1));
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
  // DESC sort: en yeni matchCode'lar önce işlensin. Eskilerde MatchSnapshot
  // verisi olmayabilir (Snapshot sadece yakın zamandaki maçlar için var).
  const matchCodes = unlabeled.map((r) => r.matchCode).sort((a, b) => b - a);
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
    matchesWithGoals: 0,
    matchesWithOnlyMev: 0,
    matchesWithOnlySnap: 0,
    totalLabeled: 0,
    totalPositives: 0,
    positiveRate: 0,
    running: true,
  };

  const summaries: MatchLabelSummary[] = [];
  let totalLabeled = 0;
  let totalPositives = 0;
  let completedLock = 0;

  // ── Single match processor ─────────────────────────────────────
  async function processOne(matchCode: number): Promise<{
    matchCode: number;
    labeled: number;
    positives: number;
    goalMinutes: number[];
    unlabeledRows: number;
  }> {
    const goalMinutes = await resolveGoalMinutes(matchCode);

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
      return { matchCode, labeled: 0, positives: 0, goalMinutes, unlabeledRows: 0 };
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
    return { matchCode, labeled, positives, goalMinutes, unlabeledRows: rows.length };
  }

  // ── Worker pool ────────────────────────────────────────────────
  // Her worker sıradaki matchCode'u alır, işler, progress günceller.
  // workers=N aynı anda N tane işlem koşturur.
  async function worker(): Promise<void> {
    while (true) {
      const idx = completedLock; // atomic index al
      // eslint-disable-next-line require-atomic-updates
      if (idx >= matchCodes.length) break;
      completedLock = idx + 1;
      const matchCode = matchCodes[idx];

      const result = await processOne(matchCode);
      summaries.push({
        matchCode,
        firstGoalMinute: result.goalMinutes[0] ?? null,
        goalMinutes: result.goalMinutes,
        unlabeledRows: result.unlabeledRows,
        labeledRows: result.labeled,
        positives: result.positives,
      });
      totalLabeled += result.labeled;
      totalPositives += result.positives;
      if (result.goalMinutes.length > 0) progress.matchesWithGoals++;

      // Debug sample: ilk 20 matchCode'un goalMinutes durumu
      if (idx < 20 && result.goalMinutes.length === 0) {
        (progress as any)._debugSample = (progress as any)._debugSample || [];
        if ((progress as any)._debugSample.length < 10) {
          (progress as any)._debugSample.push({
            matchCode,
            goalCount: result.goalMinutes.length,
            snapshotCount: "?",
            mevCount: "?",
          });
        }
      }

      if (idx % Math.max(1, Math.floor(matchCodes.length / 100)) === 0 || idx === matchCodes.length - 1) {
        progress.completedMatches = idx + 1;
        progress.totalLabeled = totalLabeled;
        progress.totalPositives = totalPositives;
        progress.positiveRate =
          totalLabeled > 0
            ? Math.round((totalPositives / totalLabeled) * 10000) / 100
            : 0;
      }
    }
  }

  // Start N workers, wait for all to finish
  await Promise.all(Array.from({ length: workers }, () => worker()));

  progress.running = false;
  progress.completedMatches = matchCodes.length;
  progress.totalLabeled = totalLabeled;
  progress.totalPositives = totalPositives;
  progress.positiveRate =
    totalLabeled > 0
      ? Math.round((totalPositives / totalLabeled) * 10000) / 100
      : 0;

  logInfo(
    "backfill-labels",
    `Repaired ${totalLabeled} rows (${totalPositives} positive) across ${matchCodes.length} matches (force=${force}, workers=${workers})`,
  );

  return NextResponse.json({
    success: true,
    data: {
      matchesScanned: matchCodes.length,
      totalLabeled,
      totalPositives,
      positiveRate: progress.positiveRate,
      durationMs: Date.now() - progress.startedAt,
      workers,
      summaries,
    },
  });
});