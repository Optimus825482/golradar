import { describe, expect, test } from 'bun:test';
import { determineSide, determineSideByStats } from '../goalRadar/side';
import type { PressureSnapshotLite } from '../goalRadar';

const snap = (homePressure: number, awayPressure: number): PressureSnapshotLite => ({
  homePressure,
  awayPressure,
  stats: {} as never,
});

describe('determineSide (score-based)', () => {
  test('high home score → home', () => {
    // awayScore < 30 ile home dominant → home
    expect(determineSide(65, 29)).toBe('home');
  });
  test('high away score → away', () => {
    // homeScore < 25 ile away dominant → away
    expect(determineSide(24, 65)).toBe('away');
  });
  test('both high → both', () => {
    expect(determineSide(70, 70)).toBe('both');
  });
  test('sustained + spike (40-59 + son 3 pressure > 55 en az 2)', () => {
    const hist = [snap(40, 30), snap(58, 30), snap(58, 30)];
    expect(determineSide(45, 30, hist)).toBe('home');
  });
  test('low + no spike → null', () => {
    const hist = [snap(30, 30), snap(35, 30), snap(35, 30)];
    expect(determineSide(35, 30, hist)).toBe(null);
  });
});

describe('determineSideByStats (ensemble heuristic)', () => {
  const stats = (homeDA: number, awayDA: number, homeSOT: number, awaySOT: number) => ({
    dangerous_attacks: { home: homeDA, away: awayDA },
    shots_on_target: { home: homeSOT, away: awaySOT },
  });
  test('home pressure > 1.5× away → home', () => {
    expect(determineSideByStats(stats(20, 10, 5, 2) as never)).toBe('home');
  });
  test('away pressure > 1.5× home → away', () => {
    expect(determineSideByStats(stats(10, 20, 2, 5) as never)).toBe('away');
  });
  test('both > 3 → both', () => {
    expect(determineSideByStats(stats(10, 10, 2, 2) as never)).toBe('both');
  });
  test('low + unbalanced → null', () => {
    expect(determineSideByStats(stats(0, 0, 0, 0) as never)).toBe(null);
  });
});
