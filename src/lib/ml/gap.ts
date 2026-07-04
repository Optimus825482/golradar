// ── gap.ts — GAP Rating Model Artifact Glue ────────────────────────
// bridge layer: gapRating.ts singleton state ↔ ModelArtifact DB.
// modelRouter.ts calls loadGapRating() to resolve the GAP champion.
//
// GAP model = GapRatingState singleton (gapRating.ts).
// Champion persistence: serialize → dump to disk → register as artifact.
// Champion restore: load artifact from disk → deserialize → seed singleton.
//
// When no champion exists: fallback to in-memory singleton (populated
// by initializeGapState via MatchSnapshot data at first predictEnsemble).

import { db } from '../db';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import {
  getGapState,
  initializeGapState,
  serializeGapState,
  predictGapMatch,
  type GapRatingState,
  type GapPrediction,
  type TeamGapRating,
} from './gapRating';

// ── Types ──────────────────────────────────────────────────────────

export type GapRatingModel = GapRatingState;

export interface GapModelEntry {
  state: GapRatingState;
  version: string;
  metrics: Record<string, number>;
}

// ── Champion loader (modelRouter.ts API) ───────────────────────────

/**
 * Load the GAP champion from ModelArtifact DB.
 * Returns the singleton state (seeded from champion snapshot if available).
 * If no champion exists, returns the in-memory singleton (cold-start).
 */
export async function loadGapRating(): Promise<GapModelEntry | null> {
  const artifact = await db.modelArtifact.findFirst({
    where: { name: 'gap', isChampion: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!artifact) {
    // No champion — return in-memory singleton
    const state = getGapState();
    return {
      state,
      version: 'gap-coldstart',
      metrics: {},
    };
  }

  try {
    const fullPath = resolveArtifactPath(artifact.artifactPath);
    const raw = await readFile(fullPath, 'utf-8');
    const snapshot = JSON.parse(raw) as ReturnType<typeof serializeGapState>;

    // Seed singleton from champion snapshot
    const state = getGapState();
    for (const [teamKey, rating] of Object.entries(snapshot.teams)) {
      state.teams.set(teamKey, rating as TeamGapRating);
    }
    state.totalUpdates = snapshot.totalUpdates;
    state.version = snapshot.version;

    const metrics = JSON.parse(artifact.metricsJson) as Record<string, number>;
    return { state, version: artifact.version, metrics };
  } catch {
    // Disk read failed — fallback to in-memory singleton
    const state = getGapState();
    return { state, version: 'gap-fallback', metrics: {} };
  }
}

// ── Champion persistence ───────────────────────────────────────────

/**
 * Serialize current singleton state and persist as a ModelArtifact.
 * Does NOT auto-promote to champion (call promoteArtifact separately).
 */
export async function dumpGapState(opts?: {
  version?: string;
  metrics?: Record<string, number>;
  notes?: string;
}): Promise<{ path: string; version: string }> {
  const state = getGapState();
  const serialized = serializeGapState(state);

  const version = opts?.version ?? `gap-${Date.now()}`;
  const dir = process.env.ML_DATA_DIR || join(process.cwd(), 'data');
  const modelsDir = join(dir, 'ml-models');
  await mkdir(modelsDir, { recursive: true });

  const filename = `${version}.json`;
  const filePath = join(modelsDir, filename);
  await writeFile(filePath, JSON.stringify(serialized, null, 2), 'utf-8');

  const { registerArtifact } = await import('./modelRouter');
  await registerArtifact({
    name: 'gap',
    version,
    artifactPath: filePath,
    metrics: opts?.metrics ?? {},
    sha256: 'gap-singleton', // singleton state — content hash not meaningful
    notes: opts?.notes ?? 'GAP singleton state snapshot',
  });

  return { path: filePath, version };
}

// ── Helpers ────────────────────────────────────────────────────────

function resolveArtifactPath(storedPath: string): string {
  const dir = process.env.ML_DATA_DIR || join(process.cwd(), 'data');
  if (storedPath.startsWith('/data/')) {
    return join(dir, storedPath.slice(6));
  }
  return storedPath;
}

// Re-export predictGapMatch for convenience (modelRouter.ts can also
// import directly from gapRating.ts)
export { predictGapMatch, getGapState, initializeGapState };
export type { GapPrediction, GapRatingState, TeamGapRating };
