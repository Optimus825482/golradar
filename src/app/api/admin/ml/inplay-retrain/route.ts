// ── Admin: In-Play Retrain Trigger ────────────────────────────────
// Manually kick off a 5-min-horizon in-play XGBoost retrain.
// Useful for smoke tests or after major team changes. The
// scheduler runs this on a 6h cadence automatically.

import { NextResponse } from 'next/server';
import { triggerInPlayRetrainNow } from "@/lib/ml/trainingScheduler";
import { adminRoute } from "@/lib/adminRoute";

export const dynamic = 'force-dynamic';

export const POST = adminRoute(async () => {
  if (typeof window !== 'undefined') {
    return NextResponse.json({ error: 'server-only' }, { status: 503 });
  }
  try {
    const result = await triggerInPlayRetrainNow();
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 503 });
    }
    return NextResponse.json({ ok: true, startedAt: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { error: 'retrain-failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
});
