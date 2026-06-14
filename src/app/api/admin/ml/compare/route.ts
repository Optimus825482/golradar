// ── Admin: ML Model Compare ────────────────────────────────────────
// Compares the current champion against a candidate artifact
// (typically a freshly trained shadow). Returns Brier/logLoss
// deltas and a winner verdict based on the auto-promote gate
// (Brier improvement >= 0.005, sample count >= 200).
//
// Query params:
//   ?name=xgb&version=1.0.0
//   &days=30 (default 30)
//   &side=home|away|both (default both)
//   &minSamples=200 (default 200)

import { NextResponse } from 'next/server';
import { runCompareBacktest } from '@/lib/ml/modelBacktest';
import type { ModelName } from '@/lib/ml/modelRouter';
import { adminRoute } from '@/lib/adminRoute';

export const dynamic = 'force-dynamic';

const VALID_NAMES: ModelName[] = ['gbdt', 'xgb', 'inplay', 'team-strength'];

export const GET = adminRoute(async (request: Request) => {
  if (typeof window !== 'undefined') {
    return NextResponse.json({ error: 'server-only' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name');
  const version = searchParams.get('version');
  const days = parseInt(searchParams.get('days') ?? '30', 10);
  const side = (searchParams.get('side') ?? 'both') as 'home' | 'away' | 'both';
  const minSamples = parseInt(searchParams.get('minSamples') ?? '200', 10);

  if (!name || !VALID_NAMES.includes(name as ModelName)) {
    return NextResponse.json(
      { error: `name must be one of: ${VALID_NAMES.join(', ')}` },
      { status: 400 },
    );
  }
  if (!version) {
    return NextResponse.json(
      { error: 'version is required' },
      { status: 400 },
    );
  }

  try {
    const result = await runCompareBacktest(
      { name: name as ModelName, version },
      { days, side, minSamples },
    );
    if (!result) {
      return NextResponse.json(
        {
          ok: false,
          error: 'insufficient-data',
          message: `one or both evaluators had < ${minSamples} samples in the last ${days} days`,
        },
        { status: 404 },
      );
    }
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'compare-failed',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
});

