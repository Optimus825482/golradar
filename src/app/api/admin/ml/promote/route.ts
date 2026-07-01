// ── Admin: ML Model Promote ────────────────────────────────────────
// Flips an artifact to champion. Atomic: demote current, promote
// new. Records `promotedAt`, `supersededBy`, and `notes` on the
// artifact rows.
//
// The auto-promote gate is enforced by the caller (the admin UI
// or a scheduled job should not blindly POST). The endpoint itself
// is unconditional — operators may have reasons to override.

import { NextResponse } from 'next/server';
import { promoteArtifact, listArtifacts, type ModelName } from '@/lib/ml/modelRouter';
import { adminRoute } from '@/lib/adminRoute';

export const dynamic = 'force-dynamic';

const VALID_NAMES: ModelName[] = ['gbdt', 'xgb', 'inplay', 'team-strength', 'xt-grid', 'lightgbm'];

export const POST = adminRoute(async (request: Request) => {
  if (typeof window !== 'undefined') {
    return NextResponse.json({ error: 'server-only' }, { status: 503 });
  }

  let body: { name?: string; version?: string; notes?: string; confirm?: boolean } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }

  const { name, version, notes, confirm } = body;
  if (!name || !VALID_NAMES.includes(name as ModelName)) {
    return NextResponse.json(
      { error: `name must be one of: ${VALID_NAMES.join(', ')}` },
      { status: 400 },
    );
  }
  if (!version) {
    return NextResponse.json({ error: 'version is required' }, { status: 400 });
  }
  if (!confirm) {
    return NextResponse.json(
      {
        error: 'confirmation-required',
        message: 'POST with {confirm: true} to acknowledge demote-then-promote',
      },
      { status: 400 },
    );
  }

  const result = await promoteArtifact(name as ModelName, version, notes);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 404 });
  }
  return NextResponse.json({ ok: true, promoted: `${name}@${version}` });
});

export const GET = adminRoute(async () => {
  if (typeof window !== 'undefined') {
    return NextResponse.json({ error: 'server-only' }, { status: 503 });
  }
  // List all artifacts for the UI; useful "what's champion?" view.
  const artifacts = await listArtifacts();
  return NextResponse.json({ ok: true, artifacts });
});
