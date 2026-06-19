// ── FotMob Cache Maintenance Scheduler ─────────────────────────────
// Server-side background task that periodically:
//   1. Purges expired FotMob cache rows (24h+ grace period)
//   2. Logs cache stats every 10 minutes for observability
//   3. Re-hydrates the in-memory FotMob ID mapping cache every
//      hour so newly-added team mappings are picked up promptly
//
// Singleton pattern — `startFotMobCacheMaintenance()` is safe to
// call multiple times (e.g. from hot-reload). The interval is
// stashed on `globalThis` so server restarts and HMR cycles can't
// double-stack timers.

import { purgeExpiredFotMobCache, getFotMobCacheStats } from './fotmobCache';
import { hydrateFotMobIdCache } from './nesine';
import { logError } from '@/lib/devLog';

const PURGE_INTERVAL_MS = 60 * 60 * 1000;        // 1h — purges expired rows
const STATS_LOG_INTERVAL_MS = 10 * 60 * 1000;   // 10m — dev log of cache health
const ID_REHYDRATE_INTERVAL_MS = 60 * 60 * 1000; // 1h — refresh team-mapping cache

interface MaintenanceState {
  purgeTimer: ReturnType<typeof setInterval> | null;
  statsTimer: ReturnType<typeof setInterval> | null;
  hydrateTimer: ReturnType<typeof setInterval> | null;
  startedAt: number;
}

const globalForMaintenance = globalThis as unknown as {
  fotMobCacheMaintenance: MaintenanceState | undefined;
};

function getState(): MaintenanceState {
  if (!globalForMaintenance.fotMobCacheMaintenance) {
    globalForMaintenance.fotMobCacheMaintenance = {
      purgeTimer: null,
      statsTimer: null,
      hydrateTimer: null,
      startedAt: 0,
    };
  }
  return globalForMaintenance.fotMobCacheMaintenance;
}

async function runPurge(): Promise<void> {
  try {
    const deleted = await purgeExpiredFotMobCache();
    if (deleted > 0 && process.env.NODE_ENV === 'development') {
      console.log(`[FotMobCache] Purged ${deleted} expired row(s)`);
    }
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[FotMobCache] Purge cycle failed:', (err as Error).message);
    }
  }
}

async function runStatsLog(): Promise<void> {
  if (process.env.NODE_ENV !== 'development') return;
  try {
    const stats = await getFotMobCacheStats();
    console.log(
      `[FotMobCache] total=${stats.total} expired=${stats.expired} ` +
        `failed24h=${stats.failedLast24h} hits=${stats.totalHits}`,
    );
  } catch (e) { logError('fotmobCacheMaintenance', e); /* swallow — stats logging is best-effort */ }
}

/**
 * Start all background maintenance tasks. Idempotent — repeated calls
 * are a no-op while timers are alive. Returns the state so the
 * caller can introspect (mostly for tests).
 */
export function startFotMobCacheMaintenance(): MaintenanceState {
  const state = getState();
  if (state.purgeTimer && state.statsTimer && state.hydrateTimer) {
    return state; // already started
  }

  // Use unref() so these timers don't keep the Node.js event loop alive
  // (matters in serverless / Edge runtimes where a dangling handle
  // could prevent process exit). Skip on platforms without unref.
  const setUnref = (t: ReturnType<typeof setInterval>) => {
    if (typeof (t as { unref?: () => void }).unref === 'function') {
      (t as { unref: () => void }).unref();
    }
    return t;
  };

  state.startedAt = Date.now();
  state.purgeTimer = setUnref(setInterval(runPurge, PURGE_INTERVAL_MS));
  state.statsTimer = setUnref(setInterval(runStatsLog, STATS_LOG_INTERVAL_MS));
  state.hydrateTimer = setUnref(
    setInterval(() => {
      void hydrateFotMobIdCache().catch((e) => { logError('fotmobCacheMaintenance', e); });
    }, ID_REHYDRATE_INTERVAL_MS),
  );

  if (process.env.NODE_ENV === 'development') {
    console.log(
      `[FotMobCache] Maintenance started — purge=${PURGE_INTERVAL_MS}ms, ` +
        `stats=${STATS_LOG_INTERVAL_MS}ms, hydrate=${ID_REHYDRATE_INTERVAL_MS}ms`,
    );
  }
  return state;
}

/**
 * Stop all background tasks. Mostly used in tests; production rarely
 * needs to call this since the singleton lives for the process lifetime.
 */
export function stopFotMobCacheMaintenance(): void {
  const state = getState();
  if (state.purgeTimer) clearInterval(state.purgeTimer);
  if (state.statsTimer) clearInterval(state.statsTimer);
  if (state.hydrateTimer) clearInterval(state.hydrateTimer);
  state.purgeTimer = null;
  state.statsTimer = null;
  state.hydrateTimer = null;
}

/**
 * Inspect the current scheduler state. Used by the admin endpoint to
 * confirm timers are alive.
 */
export function getMaintenanceStatus(): {
  running: boolean;
  startedAt: number;
  uptimeMs: number;
} {
  const state = getState();
  const running = !!(state.purgeTimer && state.statsTimer && state.hydrateTimer);
  return {
    running,
    startedAt: state.startedAt,
    uptimeMs: running && state.startedAt > 0 ? Date.now() - state.startedAt : 0,
  };
}

// ── Auto-start on server boot ──────────────────────────────────────
// Server-side imports: kick off the scheduler as soon as this module
// is first loaded. Gated by `typeof window === 'undefined'` to avoid
// running in the browser bundle (the cache uses Prisma which is
// server-only).

if (typeof window === 'undefined') {
  // Defer to the next tick so import chains finish resolving first.
  setImmediate(() => {
    try {
      startFotMobCacheMaintenance();
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[FotMobCache] Auto-start failed:', (err as Error).message);
      }
    }
  });
}
