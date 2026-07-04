// ── piRatingGlue.ts — Pi-Rating Model Artifact Glue ─────────────────
// bridge layer: piRating.ts in-memory cache ↔ ModelArtifact DB.
// modelRouter.ts calls loadPiRating() to resolve the Pi champion.

import { db } from '../db';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import {
  exportPiState,
  bulkImportPiRatings,
  predictPiFromRating,
  type PiTeamRating,
  type PiPrediction,
} from '../piRating';

// ── Types ──────────────────────────────────────────────────────────

export type PiRatingModel = PiPrediction;

// ── Champion loader (modelRouter.ts API) ───────────────────────────

/**
 * Load the Pi-Rating champion from ModelArtifact DB.
 * Returns null when no champion exists — ensemble skips Pi.
 */
export async function loadPiRating(): Promise<{
  predict: (home: string, away: string) => PiPrediction;
  version: string;
  metrics: Record<string, number>;
} | null> {
  const artifact = await db.modelArtifact.findFirst({
    where: { name: 'pi', isChampion: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!artifact) return null;

  try {
    const fullPath = resolveArtifactPath(artifact.artifactPath);
    const raw = await readFile(fullPath, 'utf-8');
    const snapshot = JSON.parse(raw) as Record<string, PiTeamRating>;
    bulkImportPiRatings(Object.entries(snapshot));
    const metrics = JSON.parse(artifact.metricsJson) as Record<string, number>;
    return { predict: predictPiFromRating, version: artifact.version, metrics };
  } catch {
    return null;
  }
}

// ── Champion persistence ───────────────────────────────────────────

/**
 * Serialize current Pi-Rating cache and persist as ModelArtifact.
 */
export async function dumpPiState(opts?: {
  version?: string;
  metrics?: Record<string, number>;
  notes?: string;
}): Promise<{ path: string; version: string }> {
  const snapshot = exportPiState();
  const version = opts?.version ?? `pi-${Date.now()}`;
  const dir = process.env.ML_DATA_DIR || join(process.cwd(), 'data');
  const modelsDir = join(dir, 'ml-models');
  await mkdir(modelsDir, { recursive: true });

  const filePath = join(modelsDir, `${version}.json`);
  await writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');

  const { registerArtifact } = await import('./modelRouter');
  await registerArtifact({
    name: 'pi',
    version,
    artifactPath: filePath,
    metrics: opts?.metrics ?? {},
    sha256: 'pi-cache',
    notes: opts?.notes ?? 'Pi-Rating cache snapshot',
  });

  return { path: filePath, version };
}

function resolveArtifactPath(storedPath: string): string {
  const dir = process.env.ML_DATA_DIR || join(process.cwd(), 'data');
  if (storedPath.startsWith('/data/')) {
    return join(dir, storedPath.slice(6));
  }
  return storedPath;
}
