// ── ML Pipeline Runner ─────────────────────────────────────────
// Orchestrates the full ML pipeline:
//   1. Feature extraction from DB → FeatureSet
//   2. Train model via Python sidecar → ModelArtifact
//   3. Compare new model vs current champion
//   4. Auto-promote if better
//
// Progress is tracked in PipelineRun table (real-time % in admin UI).

import { db } from '../db';
import { extractFeatures, featuresToArray } from '../featureEngineering';
import { writeFile, mkdir } from 'fs/promises';
import { createHash } from 'crypto';
import { join } from 'path';
import { startTraining, pollJob } from './mlClient';
import { registerArtifact, listArtifacts } from './modelRouter';
import { logError, logInfo } from '../devLog';

// Use the Docker volume mount path (/app/data/ml-training) so the file is
// visible to the ml-trainer sidecar which mounts the same volume at /data.
// Falls back to cwd-relative path for local development.
const FEATURE_DIR = process.env.NODE_ENV === 'production'
  ? '/app/data/ml-training'
  : join(process.cwd(), 'data', 'ml-training');

export type PipelineModel = 'gbdt' | 'xgb' | 'inplay';
export type PipelineStatus = 'pending' | 'extracting' | 'training' | 'comparing' | 'done' | 'failed';

interface PipelineConfig {
  modelName: PipelineModel;
  horizonMin: 5 | 10 | 15;
  days?: number;
  maxRows?: number;
}

export async function updatePipelineProgress(
  runId: string,
  status: string,
  progressPct: number,
  step: string,
): Promise<void> {
  await db.pipelineRun.update({
    where: { id: runId },
    data: { status, progressPct, step },
  });
}

export async function runPipeline(config: PipelineConfig): Promise<string> {
  const modelName = config.modelName;
  const horizonMin = config.horizonMin;
  const days = config.days ?? 90;
  const maxRows = config.maxRows ?? 50000;

  // Create pipeline run
  const run = await db.pipelineRun.create({
    data: {
      modelName,
      horizonMin,
      status: 'extracting',
      progressPct: 0,
      step: 'Başlatılıyor...',
    },
  });
  const runId = run.id;

  // Run asynchronously — don't await
  executePipeline(runId, config).catch((err) => {
    logError('Pipeline', `Run ${runId} failed:`, err);
    db.pipelineRun.update({
      where: { id: runId },
      data: { status: 'failed', errorMsg: String(err.message || err), progressPct: 0 },
    }).catch(() => {});
  });

  return runId;
}

async function executePipeline(runId: string, config: PipelineConfig): Promise<void> {
  const modelName = config.modelName;
  const horizonMin = config.horizonMin;
  const days = config.days ?? 90;
  const maxRows = config.maxRows ?? 50000;
  const startTime = Date.now();

  try {
    // ══════════════════════════════════════════════════════════════
    // STEP 1: Feature Extraction (35%)
    // ══════════════════════════════════════════════════════════════
    await updatePipelineProgress(runId, 'extracting', 5, 'Veritabanından veriler okunuyor...');

    const logs = await db.predictionLog.findMany({
      where: {
        createdAt: { gte: new Date(Date.now() - days * 86400000) },
      },
      orderBy: { createdAt: 'asc' },
      take: maxRows,
    });

    // Filter to rows that have a resolved label (goalScored is set after match ends)
    const labeledLogs = logs.filter(l => l.goalScored !== null);
    if (labeledLogs.length === 0) {
      throw new Error('No labeled data available — goalScored is null for all rows. Run pipeline after matches finalize.');
    }

    await updatePipelineProgress(runId, 'extracting', 15, `${labeledLogs.length}/${logs.length} etiketli kayıt bulundu, feature\'lar çıkarılıyor...`);

    // Extract features + labels in batches
    // Each row: { features: number[], label: 0|1 }
    const allRows: { features: number[]; label: number }[] = [];
    const batchSize = 500;
    for (let i = 0; i < labeledLogs.length; i += batchSize) {
      const batch = labeledLogs.slice(i, i + batchSize);
      for (const log of batch) {
        try {
          // Use persisted featuresJson when available (avoids re-extraction drift)
          if (log.featuresJson) {
            const parsed = JSON.parse(log.featuresJson) as number[];
            allRows.push({ features: parsed, label: log.goalScored! ? 1 : 0 });
            continue;
          }
          // Fall back to on-the-fly extraction
          const input = {
            stats: {
              possession: { home: 50, away: 50 },
              dangerous_attacks: { home: log.homeScore || 0, away: log.awayScore || 0 },
            },
            homeTeam: log.homeTeam,
            awayTeam: log.awayTeam,
            minute: String(log.minute),
            isLive: true,
          };
          const features = await extractFeatures(input as any);
          allRows.push({ features: featuresToArray(features), label: log.goalScored! ? 1 : 0 });
        } catch {
          // Skip rows that can't be parsed
        }
      }
      const pct = 15 + Math.round(((i + batchSize) / labeledLogs.length) * 20);
      await updatePipelineProgress(runId, 'extracting', Math.min(pct, 35), `${Math.min(i + batchSize, labeledLogs.length)}/${labeledLogs.length} feature çıkarıldı...`);
    }

    if (allRows.length === 0) {
      throw new Error('Feature extraction produced zero valid rows.');
    }

    const featureCount = allRows[0].features.length;
    const positives = allRows.filter(r => r.label === 1).length;
    const negatives = allRows.length - positives;

    // Serialize to JSONL — each line is {"features": [...], "label": 0|1}
    // as expected by the Python trainer sidecar
    await mkdir(FEATURE_DIR, { recursive: true });
    const featureFile = join(FEATURE_DIR, `features-${modelName}-${horizonMin}min-${Date.now()}.jsonl`);
    const lines = allRows.map(r => JSON.stringify(r)).join('\n');
    await writeFile(featureFile, lines, 'utf-8');
    const sha256 = createHash('sha256').update(lines).digest('hex');

    // Save FeatureSet record
    const fsRow = await db.featureSet.create({
      data: {
        horizonMin,
        rowCount: allRows.length,
        featureCount,
        sha256,
        path: featureFile,
        status: 'ready',
        dataStart: logs[0]?.createdAt || new Date(),
        dataEnd: logs[logs.length - 1]?.createdAt || new Date(),
        durationMs: Date.now() - startTime,
      },
    });

    await db.pipelineRun.update({
      where: { id: runId },
      data: { featureSetId: fsRow.id, featureSetRowCount: allRows.length },
    });

    await updatePipelineProgress(runId, 'extracting', 35, `${allRows.length} feature hazır (${featureCount} özellik, ${positives} pozitif, ${negatives} negatif)`);

    // ══════════════════════════════════════════════════════════════
    // STEP 2: Training (35-75%)
    // ══════════════════════════════════════════════════════════════
    await updatePipelineProgress(runId, 'training', 40, 'Eğitim başlatılıyor...');

    // Find old champion for comparison
    const oldChampion = await db.modelArtifact.findFirst({
      where: { name: modelName, isChampion: true },
      orderBy: { createdAt: 'desc' },
    });

    if (oldChampion) {
      const oldMetrics = JSON.parse(oldChampion.metricsJson || '{}');
      await db.pipelineRun.update({
        where: { id: runId },
        data: {
          oldChampionVersion: oldChampion.version,
          oldChampionBrier: oldMetrics.brier ?? null,
          oldChampionAcc: oldMetrics.accuracy ?? null,
        },
      });
    }

    // Auto-version
    let newVersion = '1.0.0';
    if (oldChampion) {
      const parts = oldChampion.version.split('.').map(Number);
      parts[2] = (parts[2] ?? 0) + 1;
      newVersion = parts.join('.');
    }

    await updatePipelineProgress(runId, 'training', 50, `Sürüm ${newVersion} eğitiliyor (horizon=${horizonMin}dk)...`);

    // Send to trainer
    const job = await startTraining({
      name: modelName,
      version: newVersion,
      horizon_min: horizonMin,
      dataset_path: featureFile,
    });

    if (!job) {
      throw new Error('Trainer sidecar not reachable');
    }

    await updatePipelineProgress(runId, 'training', 60, 'Eğitim devam ediyor...');

    const completed = await pollJob(job.jobId, { timeoutMs: 300000, pollMs: 3000 });
    if (!completed || completed.status !== 'success' || !completed.artifactPath) {
      throw new Error(completed?.error || 'Training failed or timed out');
    }

    await updatePipelineProgress(runId, 'training', 75, 'Eğitim tamamlandı.');

    // Register as shadow (champion=false initially)
    await registerArtifact({
      name: modelName,
      version: newVersion,
      artifactPath: completed.artifactPath,
      metrics: completed.metrics,
      sha256: String(completed.metrics?.sha256 ?? ''),
      bytes: completed.metrics?.artifactBytes ?? null,
      notes: `Pipeline run ${runId} (horizon=${horizonMin}min, rows=${allRows.length})`,
    });

    await updatePipelineProgress(runId, 'comparing', 80, 'Model kaydedildi, karşılaştırılıyor...');

    // ══════════════════════════════════════════════════════════════
    // STEP 3: Compare & Decide (75-100%)
    // ══════════════════════════════════════════════════════════════
    const newBrier = completed.metrics?.brier ?? 0;
    const newAccuracy = completed.metrics?.accuracy ?? 0;
    const newLogLoss = completed.metrics?.log_loss ?? completed.metrics?.logLoss ?? 0;
    const newCalErr = completed.metrics?.calibrationError ?? 0;
    const oldBrier = oldChampion ? (JSON.parse(oldChampion.metricsJson || '{}').brier ?? 0) : null;
    const brierDelta = oldBrier !== null ? newBrier - oldBrier : null;
    const isBetter = brierDelta !== null ? brierDelta < 0 : true; // lower Brier = better

    await updatePipelineProgress(runId, 'comparing', 90, isBetter
      ? '✅ Yeni model daha iyi! Champion yapılıyor...'
      : '⚠️ Yeni model eski kadar iyi değil. Shadow olarak kalıyor.');

    // Auto-promote if better
    if (isBetter && oldChampion) {
      // Demote old champion
      await db.modelArtifact.update({
        where: { name_version: { name: modelName, version: oldChampion.version } },
        data: { isChampion: false, supersededBy: newVersion },
      });
      // Promote new
      await db.modelArtifact.updateMany({
        where: { name: modelName, version: newVersion },
        data: { isChampion: true, promotedAt: new Date() },
      });
    } else if (isBetter && !oldChampion) {
      // First model ever — make it champion
      await db.modelArtifact.updateMany({
        where: { name: modelName, version: newVersion },
        data: { isChampion: true, promotedAt: new Date() },
      });
    }

    const totalTime = Math.round((Date.now() - startTime) / 1000);
    await db.pipelineRun.update({
      where: { id: runId },
      data: {
        completedAt: new Date(),
        status: 'done',
        progressPct: 100,
        step: isBetter
          ? `✅ ${newVersion} champion oldu! (Brier: ${newBrier.toFixed(4)}, acc: ${(newAccuracy * 100).toFixed(1)}%, süre: ${totalTime}s)`
          : `⚠️ ${newVersion} shadow olarak kaldı (Brier: ${newBrier.toFixed(4)}, eski: ${oldBrier?.toFixed(4) ?? 'N/A'})`,
        newVersion,
        newBrier,
        newLogLoss,
        newAccuracy,
        newCalibrationError: newCalErr,
        newTrainRows: allRows.length,
        brierDelta,
        isBetter,
        isPromoted: isBetter,
      },
    });

    logInfo('Pipeline', `Run ${runId} complete: ${modelName}@${newVersion} Brier=${newBrier.toFixed(4)} (delta=${brierDelta?.toFixed(4) ?? 'N/A'})`);
  } catch (err: any) {
    const msg = err.message || String(err);
    logError('Pipeline', `Run ${runId} error:`, msg);
    await db.pipelineRun.update({
      where: { id: runId },
      data: { status: 'failed', errorMsg: msg, progressPct: 0 },
    }).catch(() => {});
  }
}
