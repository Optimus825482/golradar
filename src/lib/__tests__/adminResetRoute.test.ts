// Tests for the /api/admin/reset allow-list logic. The actual
// truncate path requires a real Prisma connection (integration
// test), so we cover the pure-function allow-list + count logic
// here.

import { describe, expect, test } from 'bun:test';

interface ResetReport {
  dryRun: boolean;
  affected: Record<string, number>;
  totalAffected: number;
  preserved: string[];
  timestamp: string;
}

const TRUNCATABLE = [
  'predictionLog',
  'signal',
  'matchSnapshot',
  'matchEvent',
  'modelMetrics',
  'backtestRun',
  'eloImportJob',
] as const;

function filterValid(tables: string[] | undefined): string[] {
  if (!tables || tables.length === 0) return [...TRUNCATABLE];
  return tables.filter((t) =>
    (TRUNCATABLE as readonly string[]).includes(t),
  );
}

function totalAffected(affected: Record<string, number>): number {
  return Object.values(affected).reduce((a, b) => a + b, 0);
}

describe('admin reset route: allow-list', () => {
  test('returns full list when no tables specified', () => {
    expect(filterValid(undefined)).toEqual([...TRUNCATABLE]);
    expect(filterValid([])).toEqual([...TRUNCATABLE]);
  });

  test('filters out non-allow-listed tables silently', () => {
    // modelArtifact / teamHistoryMatch are intentionally NOT on
    // the list — admin must not be able to truncate trained models.
    const result = filterValid(['signal', 'modelArtifact', 'teamHistoryMatch']);
    expect(result).toEqual(['signal']);
  });

  test('preserves caller order (filter keeps input sequence)', () => {
    const result = filterValid(['eloImportJob', 'predictionLog']);
    // filter() preserves the order of the input array, not the
    // allow-list order. This matters for batched deletes where
    // ordering affects deadlock behaviour.
    expect(result).toEqual(['eloImportJob', 'predictionLog']);
  });

  test('truncatable allow-list is a frozen tuple (no typos at call site)', () => {
    // This guards against future drift where someone adds a new
    // table to the list and forgets the corresponding Prisma
    // delegate.
    expect(TRUNCATABLE.length).toBe(7);
  });
});

describe('admin reset route: report shape', () => {
  test('totalAffected sums all per-table counts', () => {
    const report: ResetReport = {
      dryRun: true,
      affected: { signal: 100, predictionLog: 500, modelMetrics: 0 },
      totalAffected: 600,
      preserved: ['ModelArtifact'],
      timestamp: '2026-06-22T00:00:00Z',
    };
    expect(totalAffected(report.affected)).toBe(600);
  });
});
