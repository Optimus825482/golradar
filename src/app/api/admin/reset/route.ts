// ── Admin: Reset System State ──────────────────────────────────────
// Truncates prediction, signal, and calibration tables so the new
// training pipeline (Aşama 1-12 improvements) can be evaluated
// against a clean slate. ModelArtifact rows are PRESERVED — trained
// models are not destroyed. TeamHistoryMatch is PRESERVED — it is
// the training data the next run will refit against.
//
// Dry-run mode (default true) returns the affected row counts
// without writing. Set dryRun=false to actually truncate.
//
// POST /api/admin/reset
// Body: { dryRun?: boolean, tables?: string[] }

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adminRoute } from '@/lib/adminRoute';

export const dynamic = 'force-dynamic';

// Tables this endpoint is allowed to truncate. Anything not in
// this list is refused — admin cannot accidentally delete trained
// models or user accounts.
const TRUNCATABLE_TABLES = [
  'predictionLog',
  'signal',
  'matchSnapshot',
  'matchEvent',
  'modelMetrics',
  'backtestRun',
  'eloImportJob',
] as const;

type TruncatableTable = (typeof TRUNCATABLE_TABLES)[number];

// Map each public name to the Prisma model delegate. Type-safe via
// the index signature — adding a new truncatable table requires
// updating both lists.
const DELEGATES: Record<TruncatableTable, 'predictionLog' | 'signal' | 'matchSnapshot' | 'matchEvent' | 'modelMetrics' | 'backtestRun' | 'eloImportJob'> = {
  predictionLog: 'predictionLog',
  signal: 'signal',
  matchSnapshot: 'matchSnapshot',
  matchEvent: 'matchEvent',
  modelMetrics: 'modelMetrics',
  backtestRun: 'backtestRun',
  eloImportJob: 'eloImportJob',
};

export interface ResetReport {
  dryRun: boolean;
  affected: Record<TruncatableTable, number>;
  totalAffected: number;
  preserved: string[];
  timestamp: string;
}

async function countAll(): Promise<Record<TruncatableTable, number>> {
  // Parallel count() queries — no transaction needed for read.
  const entries = await Promise.all(
    TRUNCATABLE_TABLES.map(async (name) => {
      const delegate = db[DELEGATES[name]] as unknown as {
        count: () => Promise<number>;
      };
      const count = await delegate.count();
      return [name, count] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<TruncatableTable, number>;
}

async function truncateAll(
  tables: TruncatableTable[],
): Promise<Record<TruncatableTable, number>> {
  // Single transaction so partial failure leaves the DB consistent.
  const affected = Object.fromEntries(
    tables.map((t) => [t, 0]),
  ) as Record<TruncatableTable, number>;

  await db.$transaction(async (tx) => {
    for (const t of tables) {
      const delegate = tx[DELEGATES[t]] as unknown as {
        deleteMany: (args?: object) => Promise<{ count: number }>;
      };
      const result = await delegate.deleteMany({});
      affected[t] = result.count;
    }
  });

  return affected;
}

export const POST = adminRoute(async (request: Request) => {
  let body: { dryRun?: boolean; tables?: string[] } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // Empty body is fine — defaults applied below.
  }

  // Reject any table the admin tries to truncate that is not on
  // the allow-list. This is a defense-in-depth check so a typo or
  // hostile UI cannot reach trained models.
  const requested = body.tables && body.tables.length > 0
    ? body.tables.filter((t): t is TruncatableTable =>
        (TRUNCATABLE_TABLES as readonly string[]).includes(t),
      )
    : [...TRUNCATABLE_TABLES];

  const invalid = (body.tables ?? []).filter(
    (t) => !(TRUNCATABLE_TABLES as readonly string[]).includes(t),
  );
  if (invalid.length > 0) {
    return NextResponse.json(
      {
        error: 'invalid-tables',
        message: `Tables not in allow-list: ${invalid.join(', ')}`,
        allowed: TRUNCATABLE_TABLES,
      },
      { status: 400 },
    );
  }

  const dryRun = body.dryRun ?? true;
  const affected = dryRun
    ? await countAll()
    : await truncateAll(requested);

  const totalAffected = Object.values(affected).reduce((a, b) => a + b, 0);

  return NextResponse.json({
    ok: true,
    dryRun,
    affected,
    totalAffected,
    preserved: [
      'ModelArtifact (eğitilmiş modeller)',
      'TeamHistoryMatch (eğitim verisi)',
      'TeamRating (Elo + attack/defense)',
      'TeamMapping (cross-source team map)',
      'User (admin hesabı)',
      'TrainingDataset (5/10/15dk datasetleri)',
      'FeatureSet (feature engineering output)',
      'PipelineRun (eğitim pipeline log)',
    ],
    timestamp: new Date().toISOString(),
  } satisfies ResetReport & { ok: true; preserved: string[] });
});
