// ── Per-League Calibration Cache ────────────────────────────────────
// Lightweight in-memory cache for league-specific Dixon-Coles params.
// Source values live in dixonColes.ts LEAGUE_GAMMA (static, derived
// from historical goal ratios 2020-2026). Caching layer here adds:
//   - Default fallback for unknown league IDs
//   - Reset hook for test isolation
//   - Future-ready: replace static map with DB-driven overrides
//
// TTL is intentionally omitted — current values are static. Add expiresAt
// when setLeagueParams() for dynamic calibration lands.

export const LEAGUE_GAMMA: Record<number, number> = {
  0: 1.10,
  1: 1.12,
  2: 1.08,
  3: 1.14,
  4: 1.06,
  5: 1.09,
  6: 1.18,
  7: 1.13,
  10: 1.17,
  11: 1.10,
  100: 1.12,
  101: 1.10,
};

const DEFAULT_GAMMA = 1.10;
const cache = new Map<number, number>();

export function getCachedLeagueGamma(leagueId: number): number {
  const cached = cache.get(leagueId);
  if (cached !== undefined) return cached;
  const value = LEAGUE_GAMMA[leagueId] ?? DEFAULT_GAMMA;
  cache.set(leagueId, value);
  return value;
}

export function resetLeagueCalibrationCache(): void {
  cache.clear();
}
