import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/securityHelpers";
import { logError, logInfo } from '@/lib/devLog';
import { exportTrainingData, type TrainingHorizon } from "@/lib/ml/exportTrainingData";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { createHash } from "crypto";

export const dynamic = "force-dynamic";

const DATA_DIR = process.env.ML_DATA_DIR
  ? join(process.env.ML_DATA_DIR, 'ml-training')
  : join(process.cwd(), 'data', 'ml-training');

/** GET: poll pipeline progress by runId */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });

  try {
    const run = await db.pipelineRun.findUnique({ where: { id: runId } });
    if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

    return NextResponse.json({
      ok: true,
      runId: run.id,
      status: run.status,
      progressPct: run.progressPct,
      step: run.step,
      errorMsg: run.errorMsg,
      modelName: run.modelName,
      horizonMin: run.horizonMin,
      newTrainRows: run.newTrainRows,
      completedAt: run.completedAt?.toISOString() ?? null,
    });
  } catch (err) {
    logError('dataset-generate', err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/** POST: kick off dataset generation */
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const { horizon = 15, days = 90, maxRows = 50000, labelFirst = true } = body as {
      horizon?: number;
      days?: number;
      maxRows?: number;
      labelFirst?: boolean;
    };

    // Create pipeline run for progress tracking
    const run = await db.pipelineRun.create({
      data: {
        modelName: "gbdt", // ponytail: reusing existing modelName enum, just for tracking
        horizonMin: horizon,
        status: "pending",
        progressPct: 0,
        step: "Başlatılıyor...",
      },
    });

    // Fire background generation
    generateInBackground(run.id, {
      horizon: horizon as TrainingHorizon,
      days,
      maxRows,
      labelFirst,
    }).catch((err) => {
      logError('dataset-generate', `Run ${run.id} failed:`, err);
      db.pipelineRun.update({
        where: { id: run.id },
        data: { status: "failed", errorMsg: String(err.message || err) },
      }).catch(() => {});
    });

    return NextResponse.json({ ok: true, runId: run.id });
  } catch (err) {
    logError('dataset-generate', err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

async function generateInBackground(
  runId: string,
  opts: { horizon: TrainingHorizon; days: number; maxRows: number; labelFirst: boolean },
) {
  const { horizon, days, maxRows, labelFirst } = opts;

  // Step 1: Label all unlabeled rows first
  if (labelFirst) {
    await updateRun(runId, "extracting", 5, "Maç etiketleri kontrol ediliyor...");
    const unlabeled = await db.predictionLog.count({ where: { goalScored: null } });
    if (unlabeled > 0) {
      await updateRun(runId, "extracting", 10, `${unlabeled} etiketsiz satır bulundu, label'lanıyor...`);
      // Quick label pass: use MatchEvent to label rows
      const rows = await db.predictionLog.findMany({
        where: { goalScored: null },
        select: { id: true, matchCode: true, minute: true },
        take: 50000,
        orderBy: { matchCode: "asc" },
      });
      const codes = [...new Set(rows.map(r => r.matchCode))];
      const events = await db.matchEvent.findMany({
        where: { matchCode: { in: codes }, eventType: "goal" },
        select: { matchCode: true, minute: true, createdAt: true },
      });
      const byMatch = new Map<number, typeof events>();
      for (const ev of events) {
        if (!byMatch.has(ev.matchCode)) byMatch.set(ev.matchCode, []);
        byMatch.get(ev.matchCode)!.push(ev);
      }

      let labeled = 0;
      const batchSize = 200;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        await Promise.all(batch.map(async (row) => {
          const goals = byMatch.get(row.matchCode) ?? [];
          const rMin = row.minute ?? 0;
          const firstGoal = goals.find(g => g.minute > rMin && g.minute - rMin <= horizon);
          const delta = firstGoal ? firstGoal.minute - rMin : null;
          await db.predictionLog.update({
            where: { id: row.id },
            data: { goalScored: !!firstGoal, minutesToGoal: delta, goalTimestamp: firstGoal?.createdAt ?? null },
          });
          labeled++;
        }));
        const pct = 10 + Math.round((i + batchSize) / rows.length * 10);
        await updateRun(runId, "extracting", pct, `Label'landı: ${Math.min(i + batchSize, rows.length)}/${rows.length} (${labeled} güncellendi)`);
      }
    }
  }

  // Step 2: Export training data
  await updateRun(runId, "extracting", 25, `${horizon}dk horizon için veri çekiliyor...`);
  const result = await exportTrainingData({ days, horizon, maxRows });

  if (!result) {
    await updateRun(runId, "failed", 0, "Export başarısız — veri yok");
    return;
  }

  await updateRun(runId, "done", 100, `✅ ${result.rowCount} satırlık dataset oluşturuldu (${(result.bytes / 1024 / 1024).toFixed(1)} MB)`);

  // Save row count
  await db.pipelineRun.update({
    where: { id: runId },
    data: { newTrainRows: result.rowCount, completedAt: new Date() },
  });

  logInfo('dataset-generate', `Run ${runId}: ${result.rowCount} rows, ${horizon}min horizon`);
}

async function updateRun(
  runId: string,
  status: string,
  progressPct: number,
  step: string,
) {
  await db.pipelineRun.update({
    where: { id: runId },
    data: { status: status as any, progressPct, step },
  }).catch(() => {});
}
