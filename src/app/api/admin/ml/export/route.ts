// ── Admin: ML Training Data Export Trigger ────────────────────────
// Manually kicks off a training-data export. The scheduler runs
// this automatically once a day; the endpoint exists for ops use.
//
// NOTE: Production should guard this with an admin auth check
// (session role or API key). Kept open in dev for observability.

import { NextResponse } from 'next/server';
import { triggerExportNow } from '@/lib/ml/trainingScheduler';
import type { TrainingHorizon } from '@/lib/ml/exportTrainingData';
import { adminRoute } from '@/lib/adminRoute';

export const dynamic = 'force-dynamic';

const VALID_HORIZONS: TrainingHorizon[] = [5, 10, 15];

export const POST = adminRoute(async (request: Request) => {
  if (typeof window !== 'undefined') {
    return NextResponse.json({ error: 'server-only' }, { status: 503 });
  }

  let body: { horizon?: number } = {};
  try {
    body = (await request.json()) as { horizon?: number };
  } catch {
    // Empty body is OK — defaults to all horizons
  }

  let horizon: TrainingHorizon | undefined;
  if (typeof body.horizon === 'number') {
    if (!VALID_HORIZONS.includes(body.horizon as TrainingHorizon)) {
      return NextResponse.json(
        { error: `invalid horizon; must be one of ${VALID_HORIZONS.join(', ')}` },
        { status: 400 },
      );
    }
    horizon = body.horizon as TrainingHorizon;
  }

  try {
    const result = await triggerExportNow(horizon);
    return NextResponse.json({
      ok: true,
      triggered: result.horizons,
      startedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'export-failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
});
