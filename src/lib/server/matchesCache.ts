// ── In-Memory Cache for /api/matches ──────────────────────────────
// Goal: scale /api/matches from ~4000 req/min (1000 users polling)
// down to ~4 req/min (one writer + cache hit fanout).
//
// Architecture (post-2026-07-01 refactor):
//   - A SINGLE writer (cron + single-user-trigger fallback) calls
//     /api/cron/poll-matches every 5s, fetches the data, and writes
//     to this cache via `setMatchesCache()`.
//   - Public /api/matches becomes a pure read: returns the cached
//     payload, or — if cache is stale — falls through to a direct
//     fetch on a single request to avoid thundering-herd rebuilds.
//   - SSE subscribers get notified via the event bus in matchEvents.ts.
//
// Why not unstable_cache or Redis? The dataset is ~50KB JSON with
// a 5s TTL and lives in the same Next.js process. Adding Redis adds
// operational cost for zero benefit at our scale. If/when we shard
// the app across multiple containers we'll swap this for Redis.

import { NextResponse } from "next/server";

export interface MatchesCacheEntry {
  /** Full response body the /api/matches route would return. */
  body: unknown;
  /** When the cache entry expires (ms since epoch). */
  expiresAt: number;
  /** When the entry was first written. Useful for monitoring age. */
  writtenAt: number;
  /** Source — "writer" (cron) or "fallback" (single in-flight request). */
  source: "writer" | "fallback";
}

const TTL_MS = 5_000;

// Process-local map. Each Next.js worker has its own copy; that's
// fine because every container has exactly one writer and reads are
// read-only. Multi-container deployments must switch to Redis.
const cache = new Map<string, MatchesCacheEntry>();

/** Read returns null on miss / expiry. Caller decides what to do. */
export function getMatchesCache(key: string): MatchesCacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry;
}

/** Write always succeeds — overwrites existing entry. */
export function setMatchesCache(
  key: string,
  body: unknown,
  source: MatchesCacheEntry["source"] = "writer",
): void {
  cache.set(key, {
    body,
    expiresAt: Date.now() + TTL_MS,
    writtenAt: Date.now(),
    source,
  });
}

/** Test/debug helper. */
export function clearMatchesCache(): void {
  cache.clear();
}

/** Test/debug helper. */
export function matchesCacheSize(): number {
  return cache.size;
}

/** Test/debug helper. */
export function matchesCacheTTL(): number {
  return TTL_MS;
}

/**
 * Wrap a Next.js route handler with cache lookup. The handler is
 * only invoked on cache miss, and the result is cached for the
 * next `TTL_MS` milliseconds.
 *
 * Usage:
 *   export const GET = withMatchesCache("all", async (request) => {
 *     const data = await fetchMatchesFresh();
 *     return NextResponse.json(data);
 *   });
 */
export function withMatchesCache<T>(
  cacheKey: string,
  handler: (request: Request) => Promise<NextResponse<T>>,
): (request: Request) => Promise<NextResponse<T>> {
  return async (request: Request): Promise<NextResponse<T>> => {
    const cached = getMatchesCache(cacheKey);
    if (cached) {
      return NextResponse.json<T>(cached.body as T, {
        headers: {
          "X-Cache": "HIT",
          "X-Cache-Source": cached.source,
          "X-Cache-Age-Ms": String(Date.now() - cached.writtenAt),
        },
      });
    }
    const response = await handler(request);
    // Best-effort cache write — the response body is a stream, so
    // we can't always re-read it. We only cache if the handler
    // returned a JSON-serializable body. For /api/matches, the
    // body is JSON (never a stream), so this works.
    try {
      const cloned = response.clone();
      const body = (await cloned.json()) as unknown;
      setMatchesCache(cacheKey, body, "fallback");
    } catch {
      // Non-JSON body — skip cache write. This is expected for SSE
      // or other streaming responses.
    }
    return response;
  };
}
