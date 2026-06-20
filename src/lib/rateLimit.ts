// ── Simple In-Memory Rate Limiter ──────────────────────────────────
// Uses sliding window per IP. Production should use Redis.
// Prevents abuse of API routes (especially /api/predict?action=train)

interface RateLimitEntry {
  timestamps: number[];
}

const windows = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 5 minutes
if (typeof setInterval !== 'undefined') {
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of windows) {
      entry.timestamps = entry.timestamps.filter(t => now - t < 60_000);
      if (entry.timestamps.length === 0) windows.delete(key);
    }
  }, 300_000);
  cleanupInterval.unref?.();
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

const DEFAULTS = {
  strict: { windowMs: 60_000, maxRequests: 5 },   // /api/predict?action=train
  moderate: { windowMs: 60_000, maxRequests: 30 }, // POST endpoints
  relaxed: { windowMs: 60_000, maxRequests: 60 },  // GET endpoints
};

export function rateLimit(
  identifier: string,
  config: RateLimitConfig = DEFAULTS.relaxed,
): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  let entry = windows.get(identifier);

  if (!entry) {
    entry = { timestamps: [] };
    windows.set(identifier, entry);
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter(t => now - t < config.windowMs);

  const remaining = Math.max(0, config.maxRequests - entry.timestamps.length);
  const resetMs = entry.timestamps.length > 0
    ? config.windowMs - (now - entry.timestamps[0])
    : 0;

  if (entry.timestamps.length >= config.maxRequests) {
    return { allowed: false, remaining: 0, resetMs };
  }

  entry.timestamps.push(now);
  return { allowed: true, remaining: remaining - 1, resetMs };
}

export { DEFAULTS as RATE_LIMIT_DEFAULTS };
