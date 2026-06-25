// ── Per-League Calibration Cache ────────────────────────────────────
// Lightweight in-memory cache for league-specific Dixon-Coles params.
// Source values live in dixonColes.ts LEAGUE_GAMMA (static, derived
// from historical goal ratios 2020-2026). Caching layer here adds:
//   - Default fallback for unknown league IDs
//   - Reset hook for test isolation
//   - DB-driven overrides via SystemConfig keys `league.gamma.<id>`
//
// TTL is intentionally omitted — current values are static. Add expiresAt
// when setLeagueParams() for dynamic calibration lands.

import { db } from '@/lib/db';
import { logWarn } from '@/lib/devLog';

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
/** leagueId → true if value was set by DB override (so we can refresh). */
const dbOverrides = new Map<number, boolean>();

const SYSTEM_KEY_LEAGUE_GAMMA = (leagueId: number): string => `league.gamma.${leagueId}`;

export function getCachedLeagueGamma(leagueId: number): number {
  const cached = cache.get(leagueId);
  if (cached !== undefined) return cached;
  const value = LEAGUE_GAMMA[leagueId] ?? DEFAULT_GAMMA;
  cache.set(leagueId, value);
  return value;
}

/**
 * Read DB overrides for the given league IDs and overlay them onto
 * the in-memory cache. Missing rows are no-ops (static value still used).
 * Call at boot (`hydrateFromDB()`) or after admin edits.
 */
export async function hydrateLeagueGammasFromDB(leagueIds: number[]): Promise<void> {
  if (leagueIds.length === 0) return;
  const keys = leagueIds.map(SYSTEM_KEY_LEAGUE_GAMMA);
  try {
    const rows = await db.systemConfig.findMany({ where: { key: { in: keys } } });
    for (const row of rows) {
      const idPart = row.key.slice('league.gamma.'.length);
      const id = Number(idPart);
      if (!Number.isFinite(id)) continue;
      const v = row.value as { gamma?: number } | number | null;
      const gamma = typeof v === 'number' ? v : v?.gamma;
      if (typeof gamma === 'number' && Number.isFinite(gamma) && gamma > 0) {
        cache.set(id, gamma);
        dbOverrides.set(id, true);
      }
    }
  } catch (e) {
    logWarn('leagueCalibration', 'hydrateFromDB failed:', e);
  }
}

/**
 * Persist a DB-driven override for one league's gamma. The static
 * `LEAGUE_GAMMA` map is the fallback when no override exists.
 */
export async function setLeagueGammaOverride(
  leagueId: number,
  gamma: number,
  updatedBy: string = 'leagueCalibration',
): Promise<void> {
  if (!Number.isFinite(gamma) || gamma <= 0) {
    throw new Error(`Invalid gamma: ${gamma}`);
  }
  await db.systemConfig.upsert({
    where: { key: SYSTEM_KEY_LEAGUE_GAMMA(leagueId) },
    create: { key: SYSTEM_KEY_LEAGUE_GAMMA(leagueId), value: { gamma }, updatedBy },
    update: { value: { gamma }, updatedBy },
  });
  cache.set(leagueId, gamma);
  dbOverrides.set(leagueId, true);
}

/** True when this league has a DB-driven override. */
export function hasLeagueGammaOverride(leagueId: number): boolean {
  return dbOverrides.get(leagueId) === true;
}

export function resetLeagueCalibrationCache(): void {
  cache.clear();
  dbOverrides.clear();
}
