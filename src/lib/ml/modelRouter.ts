// ── Model Router ───────────────────────────────────────────────────
// Loads the champion model for a given name (`gbdt`, `xgb`,
// `inplay`, `team-strength`, `xt-grid`) from `ModelArtifact` and
// keeps an in-memory cache keyed by (name, sha256). Reads through
// `ModelArtifact` so DB-side isChampion promotion is reflected
// within `CACHE_TTL_MS`.
//
// Champion is determined by `isChampion=true`. The router always
// returns the active champion unless `loadArtifact(name, version)`
// is called explicitly for shadow mode use.

import { db } from '../db';
import { join } from 'path';
import {
  getXgbModelCached,
  invalidateXgbModelCache,
  type XgbModel,
} from "./xgbLoader";
import { loadTeamStrength, type TeamStrengthModel } from './teamStrengthKalman';
import { loadXtGrid, type XtGrid } from './xtGrid';

export type ModelName = 'gbdt' | 'xgb' | 'inplay' | 'team-strength' | 'xt-grid' | 'lightgbm';

export interface ModelEntry {
  name: ModelName;
  version: string;
  path: string;
  metrics: Record<string, number>;
  loadedAt: number;
  sha256: string;
}

const CACHE_TTL_MS = 60 * 1000; // 1 min — re-read DB frequently to honor promotion
const CACHE_MAX = 8;

interface CacheSlot {
  entry: ModelEntry | null;
  loadedAt: number;
}

const modelCache = new Map<ModelName, CacheSlot>();

async function loadArtifactRecord(name: ModelName) {
  return db.modelArtifact.findFirst({
    where: { name, isChampion: true },
    orderBy: { createdAt: 'desc' },
  });
}

function evictIfFull(): void {
  if (modelCache.size <= CACHE_MAX) return;
  // Simple: clear half when full
  const keys = Array.from(modelCache.keys());
  for (let i = 0; i < Math.ceil(keys.length / 2); i++) {
    modelCache.delete(keys[i]);
  }
}

/**
 * Read the Brier score from the current champion artifact. Returns
 * null if no champion exists or the metrics JSON is malformed. The
 * caller is responsible for falling back to a default Brier when
 * null is returned.
 */
export async function getChampionBrier(
  name: ModelName,
): Promise<number | null> {
  const meta = await getChampionPath(name);
  if (!meta) return null;
  const brier = meta.metrics.brier;
  if (typeof brier !== 'number' || !Number.isFinite(brier)) return null;
  return brier;
}

/**
 * Resolve the champion path for a given model name from the DB.
 * Returns null if no champion has been promoted yet.
 */
async function getChampionPath(name: ModelName): Promise<{
  path: string;
  version: string;
  metrics: Record<string, number>;
  sha256: string;
} | null> {
  const cache = modelCache.get(name);
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.entry
      ? {
          path: cache.entry.path,
          version: cache.entry.version,
          metrics: cache.entry.metrics,
          sha256: cache.entry.sha256,
        }
      : null;
  }

  const artifact = await loadArtifactRecord(name);
  if (!artifact) {
    modelCache.set(name, { entry: null, loadedAt: Date.now() });
    return null;
  }
  const metrics = JSON.parse(artifact.metricsJson) as Record<string, number>;
  const entry: ModelEntry = {
    name,
    version: artifact.version,
    path: resolveArtifactPath(artifact.artifactPath),
    metrics,
    loadedAt: Date.now(),
    sha256: artifact.sha256,
  };
  modelCache.set(name, { entry, loadedAt: Date.now() });
  evictIfFull();
  return { path: entry.path, version: entry.version, metrics, sha256: entry.sha256 };
}

// ── Per-model loaders ──────────────────────────────────────────────

/**
 * Load the XGBoost model for the given name. Returns null when
 * no champion has been promoted. The caller is responsible for
 * falling back to the legacy `goalPredictor.ts` GBDT.
 */
export async function loadXgbChampion(
  name: "xgb" | "inplay" | "gbdt",
): Promise<{
  model: XgbModel;
  version: string;
  metrics: Record<string, number>;
} | null> {
  const meta = await getChampionPath(name);
  if (!meta) return null;
  const model = await getXgbModelCached(meta.path);
  return { model, version: meta.version, metrics: meta.metrics };
}

/**
 * Load the team-strength Kalman model. Falls back to a built-in
 * default if no artifact has been promoted.
 */
export async function loadTeamStrengthChampion(): Promise<{
  model: TeamStrengthModel;
  version: string;
} | null> {
  const meta = await getChampionPath('team-strength');
  const model = loadTeamStrength();
  if (!meta) {
    return { model, version: model.version };
  }
  return { model, version: meta.version };
}

/**
 * Load the xT grid. Same fallback-to-built-in pattern.
 */
export async function loadXtGridChampion(): Promise<{
  grid: XtGrid;
  version: string;
} | null> {
  const meta = await getChampionPath('xt-grid');
  if (!meta) {
    const grid = loadXtGrid();
    return { grid, version: grid.version };
  }
  return { grid: loadXtGrid(), version: meta.version };
}

// ── List artifacts (for admin UI / backtest compare) ───────────────

export interface ArtifactListItem {
  id: string;
  name: ModelName;
  version: string;
  isChampion: boolean;
  metrics: Record<string, number>;
  artifactPath: string;
  createdAt: Date;
  sha256: string;
  bytes: number | null;
}

export async function listArtifacts(name?: ModelName): Promise<ArtifactListItem[]> {
  const rows = await db.modelArtifact.findMany({
    where: name ? { name } : undefined,
    orderBy: [{ name: 'asc' }, { createdAt: 'desc' }],
    take: 50,
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name as ModelName,
    version: r.version,
    isChampion: r.isChampion,
    metrics: JSON.parse(r.metricsJson) as Record<string, number>,
    artifactPath: r.artifactPath,
    createdAt: r.createdAt,
    sha256: r.sha256,
    bytes: r.bytes,
  }));
}

/**
 * Promote an artifact to champion. Atomic: in a single
 * transaction, demote the current champion (if any) and set
 * isChampion=true on the new one. Records `supersededBy` and
 * `promotedAt` for audit.
 */
export async function promoteArtifact(
  name: ModelName,
  version: string,
  notes?: string,
): Promise<{ ok: boolean; reason?: string }> {
  const artifact = await db.modelArtifact.findUnique({
    where: { name_version: { name, version } },
  });
  if (!artifact) {
    return { ok: false, reason: `artifact not found: ${name}@${version}` };
  }

  await db.$transaction(async (tx) => {
    // Demote current champion (if any)
    const current = await tx.modelArtifact.findFirst({
      where: { name, isChampion: true },
    });
    if (current) {
      await tx.modelArtifact.update({
        where: { id: current.id },
        data: {
          isChampion: false,
          supersededBy: `${name}@${version}`,
        },
      });
    }
    // Promote new one
    await tx.modelArtifact.update({
      where: { id: artifact.id },
      data: {
        isChampion: true,
        notes: notes ?? 'Promoted via admin endpoint',
      },
    });
  });

  // Invalidate cache so next read picks up the new champion
  modelCache.delete(name);
  return { ok: true };
}

/**
 * Register a new artifact (e.g. after a trainer run completes).
 * Idempotent on (name, version) — re-registering with new metrics
 * just overwrites the previous record.
 */
export async function registerArtifact(opts: {
  name: ModelName;
  version: string;
  artifactPath: string;
  metrics: Record<string, number>;
  sha256: string;
  bytes?: number;
  notes?: string;
}): Promise<void> {
  await db.modelArtifact.upsert({
    where: { name_version: { name: opts.name, version: opts.version } },
    create: {
      name: opts.name,
      version: opts.version,
      artifactPath: opts.artifactPath,
      metricsJson: JSON.stringify(opts.metrics),
      sha256: opts.sha256,
      bytes: opts.bytes ?? null,
      notes: opts.notes ?? null,
      isChampion: false,
    },
    update: {
      artifactPath: opts.artifactPath,
      metricsJson: JSON.stringify(opts.metrics),
      sha256: opts.sha256,
      bytes: opts.bytes ?? null,
      notes: opts.notes ?? null,
    },
  });
}

export function invalidateModelRouterCache(name?: ModelName): void {
  if (name) {
    modelCache.delete(name);
  } else {
    modelCache.clear();
  }
}

/**
 * Delete an artifact from DB and optionally from disk.
 * Returns { deleted: true } on success.
 * Throws if the artifact is the current champion (promote first).
 */
export async function deleteArtifact(
  name: ModelName,
  version: string,
  deleteFile = true,
): Promise<{ deleted: boolean }> {
  const artifact = await db.modelArtifact.findUnique({
    where: { name_version: { name, version } },
  });
  if (!artifact) throw new Error(`Artifact ${name}@${version} bulunamadi`);
  if (artifact.isChampion) {
    throw new Error(
      `${name}@${version} champion olarak isaretli. Once baska bir modeli champion yap, sonra sil.`,
    );
  }

  // Delete file from disk — guard for client bundle context + Turbopack ignore
  if (deleteFile && typeof window === 'undefined') {
    try {
      const { unlink } = await import(/* turbopackIgnore: true */ 'fs/promises');
      await unlink(artifact.artifactPath);
    } catch {
      // ignore — file may not exist (e.g. after volume path changes)
    }
  }

  await db.modelArtifact.delete({
    where: { name_version: { name, version } },
  });

  // Invalidate cache
  modelCache.delete(name);
  invalidateXgbModelCache(artifact.artifactPath);

  return { deleted: true };
}

// Re-export for convenience
export type { XgbModel } from './xgbLoader';
export { invalidateXgbModelCache } from "./xgbLoader";
export type { TeamStrengthModel } from './teamStrengthKalman';
export type { XtGrid } from './xtGrid';

// Helper to compute the default artifact path (same convention as trainer)
export function defaultArtifactPath(name: ModelName, version: string): string {
  const dir = process.env.ML_DATA_DIR || join(process.cwd(), 'data');
  return join(dir, 'ml-models', `${name}-v${version}.json`);
}

/**
 * Resolve an artifact path that might have been written by the
 * trainer container (which mounts the shared volume at /data)
 * instead of the app container (which mounts it at <cwd>/data).
 *
 * If the stored path starts with /data/, rewrite it to <cwd>/data/
 * so the file is found regardless of which container saved the path.
 *
 * This is a pure string-transform function — no I/O.
 * Downstream callers (status route, backtest loader) do their own
 * existsSync check against the resolved path.
 */
export function resolveArtifactPath(storedPath: string): string {
  const dir = process.env.ML_DATA_DIR || join(process.cwd(), 'data');
  // Trainer writes to /data/ml-models/... but app sees /app/data/ml-models/
  if (storedPath.startsWith('/data/')) {
    return join(dir, storedPath.slice(6));
  }
  // Legacy paths recorded before ML_DATA_DIR was introduced —
  // old code used process.cwd()=/app/web giving /app/web/data/...
  if (storedPath.startsWith('/app/web/data/')) {
    return join(dir, storedPath.slice(14));
  }
  return storedPath;
}
