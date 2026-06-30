// ── Admin: Feature Flags & Settings ─────────────────────────────
// GET  /api/admin/settings → tüm feature flag'lerin durumunu döndür.
//       DB override varsa onu göster, yoksa process.env, yoksa default.
// PATCH /api/admin/settings → runtime flag override (DB + process.env)
//
// Değerler process.env'den okunur; runtime'da PATCH ile değiştirilebilir.
// Deployment restart'ına gerek yoktur (RADAR_THRESHOLD gibi config.ts
// sabitleri restart gerektirebilir).

import { NextRequest, NextResponse } from 'next/server';
import { loadFlags, setFlag, getAllOverrides } from '@/lib/flags';

interface FeatureFlag {
  key: string;
  label: string;
  description: string;
  value: string | undefined;
  effectiveValue: string;
  type: 'toggle' | 'number' | 'select' | 'text';
  default: string;
  overridden: boolean;
  group: 'ensemble' | 'corrector' | 'rating' | 'system';
}

const FLAGS: Omit<FeatureFlag, 'value' | 'effectiveValue' | 'overridden'>[] = [
  {
    key: 'STACKING_BLEND_ALPHA',
    label: 'Stacking Blend Alpha',
    description: 'BMA + stacking meta-model blend katsayısı (0=kapalı, 0.5=optimum, 1=full stacking)',
    type: 'number',
    default: '0.5',
    group: 'ensemble',
  },
  {
    key: 'ENABLE_ONLINE_ADJUSTMENTS',
    label: 'Online Weight Drift',
    description: 'Son 500 prediction accuracy-based ensemble weight rebalance. Default KAPALI (prod veri gerek).',
    type: 'toggle',
    default: 'false',
    group: 'ensemble',
  },
  {
    key: 'DISABLE_PI_RATING',
    label: 'Pi-Rating (Constantinou)',
    description: 'İç/deplasman ayrı 4-rating. Brier 0.1992 (644 maç backfill). Default AÇIK.',
    type: 'toggle',
    default: 'false',
    group: 'rating',
  },
  {
    key: 'DISABLE_GLICKO2',
    label: 'Glicko-2 Rating',
    description: 'RD+σ volatility rating. RD=350 cold-start. Default AÇIK.',
    type: 'toggle',
    default: 'false',
    group: 'rating',
  },
  {
    key: 'DISABLE_GAP_RATING',
    label: 'Lite GAP Rating',
    description: 'Generalized Attacking Performance. statsJson üzerinden. Default AÇIK (stub mod).',
    type: 'toggle',
    default: 'false',
    group: 'rating',
  },
  {
    key: 'DISABLE_CORRECTOR',
    label: 'ZISM Corrector',
    description: 'Frank κ veya ZISM β corrector (önerilen κ=-0.30, BTTS %19 iyileşme). Default AÇIK.',
    type: 'toggle',
    default: 'false',
    group: 'corrector',
  },
  {
    key: 'SKOR_KAPPA',
    label: 'Corrector Kappa (κ)',
    description: 'Frank Copula korelasyon parametresi (−0.30 önerilen)',
    type: 'number',
    default: '-0.30',
    group: 'corrector',
  },
  {
    key: 'ZISM_BETA',
    label: 'Corrector ZISM Beta (β)',
    description: 'Zero-inflation 0-0 şişirme (0.10 tipik)',
    type: 'number',
    default: '0.10',
    group: 'corrector',
  },
  {
    key: 'ZISM_MODE',
    label: 'Corrector Modu',
    description: '"frank" veya "zism" modu',
    type: 'select',
    default: 'frank',
    group: 'corrector',
  },
  {
    key: 'BACKTEST_PERSIST_JSON',
    label: 'Backtest JSON Writer',
    description: 'Her backtest sonucunu data/backtest-results/*.json yaz',
    type: 'toggle',
    default: 'false',
    group: 'system',
  },
  {
    key: 'RADAR_THRESHOLD',
    label: 'Radar Threshold',
    description: 'Sinyal görünme eşiği (env override, varsayılan 65)',
    type: 'number',
    default: '65',
    group: 'system',
  },
  {
    key: 'SIGNAL_5MIN_THRESHOLD',
    label: '5-Dk Gol Olasılık Eşiği',
    description: 'Sinyal için minimum P(gol | 5dk) (varsayılan 0.25)',
    type: 'number',
    default: '0.25',
    group: 'system',
  },
];

const ALLOWED_KEYS = new Set(FLAGS.map(f => f.key));

// ── GET: tüm flag'leri döndür (DB override varsa onu göster) ─────
export async function GET() {
  await loadFlags();
  const overrides = await getAllOverrides();

  const flags: FeatureFlag[] = FLAGS.map(f => {
    // Öncelik: DB override → process.env → default
    const raw = overrides[f.key] ?? process.env[f.key];
    const effectiveValue = raw ?? f.default;
    const overridden = f.key in overrides;

    return {
      ...f,
      value: raw,
      effectiveValue,
      overridden,
    };
  });

  return NextResponse.json({
    flags,
    docs: '/docs/FEATURE_FLAGS.md',
  });
}

// ── PATCH: runtime flag override ─────────────────────────────────
export async function PATCH(request: NextRequest) {
  await loadFlags();

  let body: { key?: string; value?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  if (!body.key || !ALLOWED_KEYS.has(body.key)) {
    return NextResponse.json(
      { error: `Geçersiz flag key. İzin verilenler: ${[...ALLOWED_KEYS].join(', ')}` },
      { status: 400 },
    );
  }

  const val = body.value ?? null;
  await setFlag(body.key, val);

  const overrides = await getAllOverrides();
  const flag = FLAGS.find(f => f.key === body.key)!;
  const raw = overrides[flag.key] ?? process.env[flag.key];
  const effectiveValue = raw ?? flag.default;

  return NextResponse.json({
    ok: true,
    key: body.key,
    value: raw,
    effectiveValue,
    overridden: body.key in overrides,
  });
}
