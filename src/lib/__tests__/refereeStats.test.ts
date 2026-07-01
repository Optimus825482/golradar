// ── Referee Stats Module — Unit Tests ─────────────────────────────
// Pure-function tests. The DB-touching code paths are exercised
// by integration tests in src/__tests__/.

import { describe, test, expect } from 'bun:test';
import { refereeStatsToFeatures, type RefereeStatsData } from '../refereeStats';

describe('refereeStatsToFeatures', () => {
  test('null stats → neutral defaults', () => {
    const f = refereeStatsToFeatures(null);
    expect(f.ref_card_rate).toBe(0.5);
    expect(f.ref_penalty_rate).toBe(0.1);
    expect(f.ref_foul_rate).toBe(0.5);
  });

  test('low cardRate maps to low ref_card_rate', () => {
    const f = refereeStatsToFeatures({
      refereeName: 'X',
      matchesCount: 100,
      avgYellowCards: 0.02,
      avgRedCards: 0,
      avgFouls: 20,
      avgPenalties: 0.001,
      penaltyRate: 0.001,
      cardRate: 0.02,
    });
    expect(f.ref_card_rate).toBeLessThan(0.1);
  });

  test('high cardRate saturates at 1.0', () => {
    const f = refereeStatsToFeatures({
      refereeName: 'X',
      matchesCount: 100,
      avgYellowCards: 8,
      avgRedCards: 2,
      avgFouls: 30,
      avgPenalties: 0.6,
      penaltyRate: 0.6,
      cardRate: 10,
    });
    expect(f.ref_card_rate).toBe(1);
  });

  test('penaltyRate normalization boundary', () => {
    // 0.5 / 0.5 = 1.0 (saturate)
    const f = refereeStatsToFeatures({
      refereeName: 'X',
      matchesCount: 100,
      avgYellowCards: 3,
      avgRedCards: 0.1,
      avgFouls: 25,
      avgPenalties: 0.5,
      penaltyRate: 0.5,
      cardRate: 3.1,
    });
    expect(f.ref_penalty_rate).toBe(1);
  });

  test('foul rate normalization maps 15-35 to 0-1', () => {
    const mkStats = (fouls: number): RefereeStatsData => ({
      refereeName: 'X',
      matchesCount: 50,
      avgYellowCards: 2,
      avgRedCards: 0,
      avgFouls: fouls,
      avgPenalties: 0.1,
      penaltyRate: 0.1,
      cardRate: 2,
    });
    expect(refereeStatsToFeatures(mkStats(15)).ref_foul_rate).toBe(0);
    expect(refereeStatsToFeatures(mkStats(25)).ref_foul_rate).toBe(0.5);
    expect(refereeStatsToFeatures(mkStats(35)).ref_foul_rate).toBe(1);
    // Clamping
    expect(refereeStatsToFeatures(mkStats(5)).ref_foul_rate).toBe(0);
    expect(refereeStatsToFeatures(mkStats(50)).ref_foul_rate).toBe(1);
  });
});
