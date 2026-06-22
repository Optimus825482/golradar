import { describe, expect, test, beforeEach } from 'bun:test';
import { getCachedLeagueGamma, resetLeagueCalibrationCache } from '../ml/leagueCalibration';

describe('leagueCalibration: getCachedLeagueGamma', () => {
  beforeEach(() => {
    resetLeagueCalibrationCache();
  });

  test('returns default 1.10 for unknown league', () => {
    const gamma = getCachedLeagueGamma(999);
    expect(gamma).toBeCloseTo(1.10, 4);
  });

  test('returns LEAGUE_GAMMA entry for known league (Süper Lig = 1.18)', () => {
    const gamma = getCachedLeagueGamma(6);
    expect(gamma).toBeCloseTo(1.18, 4);
  });

  test('caches result on second call (no recompute)', () => {
    const first = getCachedLeagueGamma(6);
    const second = getCachedLeagueGamma(6);
    expect(second).toBe(first);
  });
});
