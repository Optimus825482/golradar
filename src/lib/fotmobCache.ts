// ── FotMob Cache Repository ────────────────────────────────────────
// Persistent (PostgreSQL) cache for FotMob match details. Goal radar
// enrichment (weather, squad, H2H, form) hits the cache before the
// network on every read. Lazy refresh on TTL expiry.
//
// Why a DB cache (not in-memory)?
//   - Serverless / multi-instance: in-memory Map is per-process.
//   - Restart survival: in-memory clears on every deploy.
//   - TTL flexibility: soft expiry (expiresAt column) + per-row hit
//     counter makes refresh scheduling and analytics trivial.

import type { FotMobMatchDetails } from './fotmob';
import { db } from './db';

// ── Constants ──────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 5 * 60 * 1000;   // 5 min — weather/form change fast
const FAILED_FETCH_TTL_MS = 60 * 1000; // 1 min — retry failures faster

// ── Read ───────────────────────────────────────────────────────────

/**
 * Look up a cached FotMob match detail row. Returns null if:
 *   - the row does not exist
 *   - the row is expired (expiresAt < now)
 *   - the row was a failed fetch (fetchStatus >= 400)
 *
 * Successful hits increment the hit counter (best-effort, fire-and-forget).
 */
export async function getCachedFotMobDetails(
  fotmobId: number,
  matchDate: string,
): Promise<FotMobMatchDetails | null> {
  try {
    const row = await db.fotMobCache.findUnique({
      where: { fotmobId_matchDate: { fotmobId, matchDate } },
    });
    if (!row) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    if (row.fetchStatus >= 400) return null;

    // Best-effort hit accounting (don't block the read on this)
    db.fotMobCache
      .update({
        where: { id: row.id },
        data: { hitCount: { increment: 1 }, lastHitAt: new Date() },
      })
      .catch(() => {
        /* swallow — analytics write must not poison the read */
      });

    return row.payload as unknown as FotMobMatchDetails;
  } catch (err) {
    // Cache miss on error is the same as cache miss on not-found —
    // caller will fall through to network fetch.
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[FotMobCache] read failed for ${fotmobId}/${matchDate}:`, (err as Error).message);
    }
    return null;
  }
}

// ── Write ──────────────────────────────────────────────────────────

/**
 * Upsert a successful FotMob fetch. Replaces the existing row for
 * (fotmobId, matchDate) if present — last fetch wins. Resets hit
 * counter to 0 (it's a fresh row from the caller's perspective).
 */
export async function setCachedFotMobDetails(
  fotmobId: number,
  matchDate: string,
  payload: FotMobMatchDetails,
  fetchStatus: number = 200,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMs);
  try {
    await db.fotMobCache.upsert({
      where: { fotmobId_matchDate: { fotmobId, matchDate } },
      create: {
        fotmobId,
        matchDate,
        payload: payload as unknown as object,
        fetchStatus,
        fetchError: null,
        fetchedAt: new Date(),
        expiresAt,
        hitCount: 0,
        lastHitAt: null,
      },
      update: {
        payload: payload as unknown as object,
        fetchStatus,
        fetchError: null,
        fetchedAt: new Date(),
        expiresAt,
        hitCount: 0,
        lastHitAt: null,
      },
    });
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[FotMobCache] write failed for ${fotmobId}/${matchDate}:`, (err as Error).message);
    }
  }
}

/**
 * Record a failed fetch with a short retry TTL. Lets the next caller
 * back off briefly without hammering a broken upstream.
 */
export async function setFailedFotMobFetch(
  fotmobId: number,
  matchDate: string,
  errorMessage: string,
  fetchStatus: number = 503,
): Promise<void> {
  const expiresAt = new Date(Date.now() + FAILED_FETCH_TTL_MS);
  try {
    await db.fotMobCache.upsert({
      where: { fotmobId_matchDate: { fotmobId, matchDate } },
      create: {
        fotmobId,
        matchDate,
        payload: {} as object, // empty payload — payload-as-unknown forces a re-fetch
        fetchStatus,
        fetchError: errorMessage,
        fetchedAt: new Date(),
        expiresAt,
        hitCount: 0,
        lastHitAt: null,
      },
      update: {
        fetchStatus,
        fetchError: errorMessage,
        fetchedAt: new Date(),
        expiresAt,
        hitCount: 0,
        lastHitAt: null,
      },
    });
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[FotMobCache] failure write failed:`, (err as Error).message);
    }
  }
}

// ── Composite read-or-fetch ────────────────────────────────────────

export interface FotMobCacheLookup<T> {
  data: T | null;
  source: 'cache' | 'fetch' | 'none';
  error?: string;
}

/**
 * High-level helper: return cached value if fresh, otherwise call
 * the supplied fetcher and write the result back. The fetcher may
 * throw; failures are recorded as a short-TTL row so the next call
 * backs off appropriately.
 */
export async function getOrFetchFotMobDetails(
  fotmobId: number,
  matchDate: string,
  fetcher: () => Promise<FotMobMatchDetails | null>,
): Promise<FotMobCacheLookup<FotMobMatchDetails>> {
  const cached = await getCachedFotMobDetails(fotmobId, matchDate);
  if (cached) {
    return { data: cached, source: 'cache' };
  }

  let payload: FotMobMatchDetails | null = null;
  try {
    payload = await fetcher();
  } catch (err) {
    await setFailedFotMobFetch(fotmobId, matchDate, (err as Error).message);
    return { data: null, source: 'none', error: (err as Error).message };
  }

  if (!payload) {
    await setFailedFotMobFetch(fotmobId, matchDate, 'fetcher returned null');
    return { data: null, source: 'none', error: 'fetcher returned null' };
  }

  await setCachedFotMobDetails(fotmobId, matchDate, payload);
  return { data: payload, source: 'fetch' };
}

// ── Maintenance ────────────────────────────────────────────────────

/**
 * Delete expired rows. Should be run by a cron or a `setInterval`
 * background task. Rows are only purged if they've been expired for
 * 24+ hours (grace period for active readers finishing a request).
 */
export async function purgeExpiredFotMobCache(): Promise<number> {
  try {
    const result = await db.fotMobCache.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
    return result.count;
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[FotMobCache] purge failed:', (err as Error).message);
    }
    return 0;
  }
}

/**
 * Quick stats — for health check endpoints and admin dashboards.
 */
export async function getFotMobCacheStats(): Promise<{
  total: number;
  expired: number;
  failedLast24h: number;
  totalHits: number;
}> {
  try {
    const [total, expired, failed, hits] = await Promise.all([
      db.fotMobCache.count(),
      db.fotMobCache.count({ where: { expiresAt: { lt: new Date() } } }),
      db.fotMobCache.count({
        where: {
          fetchStatus: { gte: 400 },
          fetchedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
      db.fotMobCache.aggregate({ _sum: { hitCount: true } }),
    ]);
    return {
      total,
      expired,
      failedLast24h: failed,
      totalHits: hits._sum.hitCount ?? 0,
    };
  } catch {
    return { total: 0, expired: 0, failedLast24h: 0, totalHits: 0 };
  }
}
