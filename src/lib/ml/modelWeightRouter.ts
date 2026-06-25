// ── Model Weight Router ──────────────────────────────────────────
// Assigns prediction weights to models based on recent Brier score.
// Models with high Brier get low weight; bad models get disabled or
// archived automatically.
//
// Thresholds (configurable):
//   brier < 0.18          → weight 1.0  (full trust)
//   0.18 ≤ brier < 0.25   → weight 0.75 (slightly reduced)
//   0.25 ≤ brier < 0.32   → weight 0.5  (penalized)
//   0.32 ≤ brier < 0.40   → weight 0.25 (heavily penalized)
//   0.40 ≤ brier < 0.50   → weight 0.0  (disabled — still in registry but excluded)
//   brier ≥ 0.50 or stale → archived (deprecated in DB)
//
// Champion always gets weight 1.0. Shadow models are ranked by
// Brier and weights assigned proportionally.

import { db } from '@/lib/db';
import { BRIER_TIERS, UNRANKED_WEIGHT } from '@/config';

export interface ModelWeight {
  name: string;
  version: string | null;
  isChampion: boolean;
  brierScore: number | null;
  weight: number; // 0..1
  status: 'active' | 'disabled' | 'archived';
  lastUpdated: string | null;
}

export function tierForBrier(brier: number | null): { weight: number; status: ModelWeight['status'] } {
  if (brier == null) return { weight: UNRANKED_WEIGHT, status: 'active' as const };
  for (const tier of BRIER_TIERS) {
    if (brier < tier.maxBrier) return { weight: tier.weight, status: 'active' as const };
  }
  // brier >= 0.50: archived
  return { weight: 0.0, status: 'archived' as const };
}

export async function computeModelWeights(): Promise<ModelWeight[]> {
  const artifacts = await db.modelArtifact.findMany({
    orderBy: [{ name: 'asc' }, { createdAt: 'desc' }],
  });

  const byName = new Map<string, typeof artifacts>();
  for (const a of artifacts) {
    if (!byName.has(a.name)) byName.set(a.name, []);
    byName.get(a.name)!.push(a);
  }

  const out: ModelWeight[] = [];
  for (const [name, list] of byName) {
    const champion = list.find((a) => a.isChampion);
    const latest = champion ?? list[0];
    if (!latest) continue;
    const metrics = JSON.parse(latest.metricsJson || '{}') as Record<string, number>;
    const brier = metrics.brier ?? null;

    if (champion) {
      const { weight, status } = tierForBrier(brier);
      out.push({
        name,
        version: champion.version,
        isChampion: true,
        brierScore: brier,
        weight,
        status,
        lastUpdated: champion.createdAt.toISOString(),
      });
    }

    // Add top 2 shadow models (sorted by brier asc)
    const shadows = list
      .filter((a) => !a.isChampion)
      .map((a) => {
        const m = JSON.parse(a.metricsJson || '{}') as Record<string, number>;
        return { a, brier: m.brier ?? Infinity };
      })
      .filter((x) => Number.isFinite(x.brier))
      .sort((x, y) => x.brier - y.brier)
      .slice(0, 2);

    for (const { a, brier: sb } of shadows) {
      const { weight, status } = tierForBrier(sb);
      out.push({
        name,
        version: a.version,
        isChampion: false,
        brierScore: sb,
        weight,
        status,
        lastUpdated: a.createdAt.toISOString(),
      });
    }
  }
  return out;
}

/**
 * Aggregate weights for a probability blend.
 * Returns null if no active weights remain → caller should fall back to champion only.
 */
export function blendProbabilities(
  weights: ModelWeight[],
  predictions: Array<{ name: string; prob: number }>,
): number | null {
  let num = 0;
  let denom = 0;
  for (const p of predictions) {
    const w = weights.find((x) => x.name === p.name && x.status === 'active');
    if (!w || w.weight === 0) continue;
    num += p.prob * w.weight;
    denom += w.weight;
  }
  if (denom === 0) return null;
  return num / denom;
}
