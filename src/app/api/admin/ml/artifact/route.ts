// ── Admin: ML Artifact Delete ──────────────────────────────────────
// DELETE /api/admin/ml/artifact
//   body: { name: "xgb", version: "1.0.2" }
//
// Silinen artifact'in dosyasi da diskten silinir. Champion
// olan artifact silinemez — once baskasini champion yap.

import { NextResponse } from 'next/server';
import { deleteArtifact, type ModelName } from '@/lib/ml/modelRouter';
import { adminRoute } from '@/lib/adminRoute';

export const dynamic = 'force-dynamic';

const VALID_NAMES = new Set<ModelName>([
  'gbdt', 'xgb', 'inplay', 'team-strength', 'xt-grid',
]);

export const DELETE = adminRoute(async (request: Request) => {
  try {
    let body: { name?: string; version?: string; deleteFile?: boolean };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: 'JSON body gerekli' }, { status: 400 });
    }

    const name = body.name;
    const version = body.version;
    if (!name || !VALID_NAMES.has(name as ModelName)) {
      return NextResponse.json({ error: 'Gecerli model adi gerekli' }, { status: 400 });
    }
    if (!version) {
      return NextResponse.json({ error: 'Version gerekli' }, { status: 400 });
    }

    const result = await deleteArtifact(
      name as ModelName,
      version,
      body.deleteFile !== false,
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    const msg = (e as Error)?.message ?? String(e);
    console.error('[artifact-delete] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});
