// ── glicko2Glue.ts — Glicko-2 Model Artifact Glue ──────────────────
// bridge layer: glicko2.ts in-memory cache ↔ ModelArtifact DB.
// modelRouter.ts calls loadGlicko2() to resolve the Glicko-2 champion.

import { db } from '../db';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import {
  exportGlicko2State,
  predictGlicko2,
  type Glicko2Rating,
  type Glicko2Prediction,
} from '../glicko2';

// ── Types ──────────────────────────────────────────────────────────

export type Glicko2Model = Glicko2Prediction;

// ── Champion loader (modelRouter.ts API) ───────────────────────────

/**
 * Load the Glicko-2 champion from ModelArtifact DB.
 * Returns null when no champion exists — ensemble skips Glicko-2.
 */
export async function loadGlicko2(): Promise<{
  predict: (home: string, away: string) => Glicko2Prediction;
  version: string;
  metrics: Record<string, number>;
} | null> {
  const artifact = await db.modelArtifact.findFirst({
    where: { name: 'glicko2', isChampion: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!artifact) return null;

  try {
    // Glicko-2 uses its own DB table (teamGlicko2Rating), not file-based artifacts.
    // The loadGlicko2CacheFromDB() in glicko2.ts already handles DB hydration.
    // This glue just validates that a champion artifact exists and returns the predict function.
    const metrics = JSON.parse(artifact.metricsJson) as Record<string, number>;
    return { predict: predictGlicko2, version: artifact.version, metrics };
  } catch {
    return null;
  }
}

// ── Champion persistence ───────────────────────────────────────────

/**
 * Serialize current Glicko-2 cache and persist as ModelArtifact.
 */
export async function dumpGlicko2State(opts?: {
  version?: string;
  metrics?: Record<string, number>;
  notes?: string;
}): Promise<{ path: string; version: string }> {
  const snapshot = exportGlicko2State();
  const version = opts?.version ?? `glicko2-${Date.now()}`;
  const dir = process.env.ML_DATA_DIR || join(process.cwd(), 'data');
  const modelsDir = join(dir, 'ml-models');
  await mkdir(modelsDir, { recursive: true });

  const filePath = join(modelsDir, `${version}.json`);
  await writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');

  const { registerArtifact } = await import('./modelRouter');
  await registerArtifact({
    name: 'glicko2',
    version,
    artifactPath: filePath,
    metrics: opts?.metrics ?? {},
    sha256: 'glicko2-cache',
    notes: opts?.notes ?? 'Glicko-2 cache snapshot',
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
