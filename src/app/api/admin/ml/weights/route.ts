// ── Admin: Model Weight Router ───────────────────────────────────
// Returns current model weights based on Brier tier system.
// Admin can disable a model manually via PUT.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adminRoute } from '@/lib/adminRoute';
import { computeModelWeights } from '@/lib/ml/modelWeightRouter';

export const dynamic = 'force-dynamic';

export const GET = adminRoute(async () => {
  const weights = await computeModelWeights();
  return NextResponse.json({
    ok: true,
    weights,
    tiers: {
      excellent: 'brier < 0.18 → weight 1.0',
      good: '0.18 ≤ brier < 0.25 → 0.75',
      fair: '0.25 ≤ brier < 0.32 → 0.5',
      poor: '0.32 ≤ brier < 0.40 → 0.25',
      disabled: '0.40 ≤ brier < 0.50 → 0.0 (disabled)',
      archived: 'brier ≥ 0.50 → archived',
    },
  });
});

export const PUT = adminRoute(async (request: Request) => {
  try {
    const body = await request.json();
    const { name, version, action } = body;
    if (!name || !version || !action) {
      return NextResponse.json({ error: 'name, version, action required' }, { status: 400 });
    }

    if (action === 'archive') {
      // Mark as deprecated — keep in DB but exclude from predictions
      await db.modelArtifact.update({
        where: { name_version: { name, version } },
        data: { notes: `[ARCHIVED ${new Date().toISOString()}] ` },
      });
      return NextResponse.json({ ok: true, action: 'archived' });
    }

    if (action === 'disable') {
      // Add disabled marker
      await db.modelArtifact.update({
        where: { name_version: { name, version } },
        data: { notes: `[DISABLED ${new Date().toISOString()}] ` },
      });
      return NextResponse.json({ ok: true, action: 'disabled' });
    }

    if (action === 'promote') {
      // Demote current champion, promote this artifact
      await db.$transaction(async (tx) => {
        const current = await tx.modelArtifact.findFirst({ where: { name, isChampion: true } });
        if (current) {
          await tx.modelArtifact.update({
            where: { name_version: { name, version: current.version } },
            data: { isChampion: false, supersededBy: version },
          });
        }
        await tx.modelArtifact.update({
          where: { name_version: { name, version } },
          data: { isChampion: true, promotedAt: new Date() },
        });
      });
      return NextResponse.json({ ok: true, action: 'promoted' });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'internal_error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});
