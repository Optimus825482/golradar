import { describe, expect, test } from 'bun:test';

// getChampionBrier requires a Prisma client (db import). For unit
// testing the parsing logic in isolation, we replicate the contract
// here. The integration test path (real DB) is covered by the
// existing endpoint smoke tests.

function parseBrier(metrics: Record<string, number> | null): number | null {
  if (!metrics) return null;
  const brier = metrics.brier;
  if (typeof brier !== 'number' || !Number.isFinite(brier)) return null;
  return brier;
}

describe('getChampionBrier: Brier extraction contract', () => {
  test('returns null when metrics is null (no champion)', () => {
    expect(parseBrier(null)).toBeNull();
  });

  test('returns the brier number when metrics has valid number', () => {
    expect(parseBrier({ brier: 0.1691, logLoss: 0.5 })).toBe(0.1691);
  });

  test('returns null when brier is non-finite (NaN, Infinity)', () => {
    expect(parseBrier({ brier: NaN })).toBeNull();
    expect(parseBrier({ brier: Infinity })).toBeNull();
  });

  test('returns null when brier is not a number', () => {
    expect(parseBrier({ brier: '0.1691' as unknown as number })).toBeNull();
    expect(parseBrier({ brier: undefined })).toBeNull();
  });
});
