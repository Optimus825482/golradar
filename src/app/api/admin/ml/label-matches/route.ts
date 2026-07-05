import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/securityHelpers";
import { logError, logInfo } from '@/lib/devLog';

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(200, Math.max(10, parseInt(searchParams.get("limit") ?? "50", 10) || 50));
  const league = searchParams.get("league") || undefined;
  const labelStatus = searchParams.get("label") || "all"; // all | labeled | unlabeled
  const dateFrom = searchParams.get("from") || undefined;
  const dateTo = searchParams.get("to") || undefined;

  try {
    const where: Record<string, unknown> = {};
    if (league) where.league = league;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) (where.createdAt as Record<string, unknown>).gte = new Date(dateFrom);
      if (dateTo) (where.createdAt as Record<string, unknown>).lte = new Date(`${dateTo}T23:59:59`);
    }
    if (labelStatus === "labeled") where.goalScored = { not: null };
    else if (labelStatus === "unlabeled") where.goalScored = null;

    const [total, logs] = await Promise.all([
      db.predictionLog.count({ where: where as any }),
      db.predictionLog.findMany({
        where: where as any,
        select: {
          id: true, matchCode: true, minute: true, homeTeam: true, awayTeam: true,
          league: true, rawScore: true, calibratedP: true, side: true, goalScored: true,
          minutesToGoal: true, modelVariant: true, createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    // Aggregate stats
    const [totalLabeled, leagues] = await Promise.all([
      db.predictionLog.count({ where: { goalScored: { not: null } } }),
      db.predictionLog.groupBy({ by: ["league"], _count: true, orderBy: { _count: { league: "desc" } } }),
    ]);

    return NextResponse.json({
      ok: true,
      page, limit,
      total, totalLabeled,
      totalPages: Math.ceil(total / limit),
      leagues: leagues.map(l => ({ league: l.league, count: l._count })),
      rows: logs.map(l => ({
        ...l,
        createdAt: l.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    logError('label-matches', err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/** Label specific rows manually or in batch */
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const { action, matchCodes, horizonMin = 15, dryRun } = body as {
      action: string;
      matchCodes?: number[];
      horizonMin?: number;
      dryRun?: boolean;
    };

    if (action === "label-match") {
      // Label All PredictionLog rows for specific matches
      const codes = matchCodes?.length ? matchCodes : [];
      if (codes.length === 0) return NextResponse.json({ error: "matchCodes required" }, { status: 400 });

      let labeled = 0;
      for (const code of codes) {
        // Find all goal events for this match
        const goalEvents = await db.matchEvent.findMany({
          where: { matchCode: code, eventType: "goal" },
          select: { minute: true, createdAt: true },
          orderBy: { minute: "asc" },
        });

        const unlabeled = await db.predictionLog.findMany({
          where: { matchCode: code, goalScored: null },
          select: { id: true, minute: true, createdAt: true },
        });

        if (dryRun) {
          labeled += unlabeled.length;
          continue;
        }

        for (const row of unlabeled) {
          const rMin = row.minute ?? 0;
          const firstGoal = goalEvents.find(g => g.minute > rMin && g.minute - rMin <= horizonMin);
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
        }
      }
      return NextResponse.json({ ok: true, labeled, dryRun: dryRun ?? false });
    }

    if (action === "label-all") {
      // Start background labeling via PipelineRun + return runId for polling
      const run = await db.pipelineRun.create({
        data: {
          modelName: "gbdt",
          horizonMin: horizonMin,
          status: "extracting",
          progressPct: 0,
          step: "Başlatılıyor...",
        },
      });

      // Fire background
      labelAllInBackground(run.id, horizonMin, dryRun ?? false).catch((err) => {
        logError('label-matches', `Background label ${run.id} failed:`, err);
        db.pipelineRun.update({
          where: { id: run.id },
          data: { status: "failed", errorMsg: String(err.message || err) },
        }).catch(() => {});
      });

      return NextResponse.json({ ok: true, runId: run.id, status: "queued" });
    }

    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  } catch (err) {
    logError('label-matches', err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

// ── Background label-all worker ──────────────────────────────────

async function labelAllInBackground(
  runId: string,
  horizonMin: number,
  dryRun: boolean,
) {
  const update = async (pct: number, step: string, extra?: Record<string, unknown>) => {
    await db.pipelineRun.update({
      where: { id: runId },
      data: { progressPct: pct, step, ...(extra ?? {}) },
    }).catch(() => {});
  };

  await update(2, "Etiketsiz satırlar taranıyor...");

  const unlabeled = await db.predictionLog.findMany({
    where: { goalScored: null },
    select: { id: true, matchCode: true, minute: true, createdAt: true },
    orderBy: { matchCode: "asc" },
    take: 50000,
  });

  if (dryRun) {
    await update(100, `✅ ${unlabeled.length} etiketsiz satır (dry-run)`, { newTrainRows: unlabeled.length });
    return;
  }

  await update(5, `${unlabeled.length} etiketsiz satır bulundu, gol event'leri çekiliyor...`);

  const codes = [...new Set(unlabeled.map(r => r.matchCode))];
  const allGoals = await db.matchEvent.findMany({
    where: { matchCode: { in: codes }, eventType: "goal" },
    select: { matchCode: true, minute: true, createdAt: true },
    orderBy: { minute: "asc" },
  });
  const goalsByMatch = new Map<number, typeof allGoals>();
  for (const g of allGoals) {
    if (!goalsByMatch.has(g.matchCode)) goalsByMatch.set(g.matchCode, []);
    goalsByMatch.get(g.matchCode)!.push(g);
  }

  await update(10, `${codes.length} maç, ${allGoals.length} gol event'i bulundu. Label'lanıyor...`);

  let labeled = 0;
  const total = unlabeled.length;
  const batchSize = 300;

  // Track which match we're currently labeling for live display
  let currentMatch: string | null = null;

  for (let i = 0; i < total; i += batchSize) {
    const batch = unlabeled.slice(i, i + batchSize);
    const firstRow = batch[0];
    currentMatch = `#${firstRow.matchCode}`;

    await Promise.all(batch.map(async (row) => {
      const goals = goalsByMatch.get(row.matchCode) ?? [];
      const rMin = row.minute ?? 0;
      const firstGoal = goals.find(g => g.minute > rMin && g.minute - rMin <= horizonMin);
      const delta = firstGoal ? firstGoal.minute - rMin : null;
      await db.predictionLog.update({
        where: { id: row.id },
        data: { goalScored: !!firstGoal, minutesToGoal: delta, goalTimestamp: firstGoal?.createdAt ?? null },
      });
      labeled++;
    }));

    const pct = 10 + Math.round((i + batchSize) / total * 85);
    const done = Math.min(i + batchSize, total);
    await update(pct, `Label'lanıyor: ${done}/${total} (${labeled} güncellendi) · şu an: ${currentMatch}`);
  }

  await update(100, `✅ Tamamlandı: ${labeled} satır label'landı (${codes.length} maç)`);
  await db.pipelineRun.update({
    where: { id: runId },
    data: { status: "done", progressPct: 100, newTrainRows: labeled, completedAt: new Date() },
  }).catch(() => {});
  logInfo('label-matches', `Background label-all done: ${labeled} rows`);
}
