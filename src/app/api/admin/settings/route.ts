// ── Admin: Feature Flags & Settings ─────────────────────────────
// GET /api/admin/settings → tüm feature flag'lerin durumunu döndür.
// Amaç: admin panel "Ayarlar" sayfası tarafından kullanılır.
// Değerler process.env'den okunur; runtime'da değiştirilemez
// (production'da deployment env ile set edilir).

import { NextResponse } from 'next/server';

interface FeatureFlag {
  key: string;
  label: string;
  description: string;
  value: string | undefined;
  type: 'toggle' | 'number' | 'select' | 'text';
  default: string;
  group: 'ensemble' | 'corrector' | 'rating' | 'system';
}

const FLAGS: FeatureFlag[] = [
  {
    key: 'STACKING_BLEND_ALPHA',
    label: 'Stacking Blend Alpha',
    description: 'BMA + stacking meta-model blend katsayısı (0=kapalı, 0.5=optimum, 1=full stacking)',
    value: process.env.STACKING_BLEND_ALPHA ?? '0.5',
    type: 'number',
    default: '0.5 (AÇIK)',
    group: 'ensemble',
  },
  {
    key: 'ENABLE_ONLINE_ADJUSTMENTS',
    label: 'Online Weight Drift',
    description: 'Son 500 prediction accuracy-based ensemble weight rebalance. Default KAPALI (prod veri gerek).',
    value: process.env.ENABLE_ONLINE_ADJUSTMENTS,
    type: 'toggle',
    default: 'false',
    group: 'ensemble',
  },
  {
    key: 'DISABLE_PI_RATING',
    label: 'Pi-Rating (Constantinou)',
    description: 'İç/deplasman ayrı 4-rating. Brier 0.1992 (644 maç backfill). Default AÇIK.',
    value: process.env.DISABLE_PI_RATING,
    type: 'toggle',
    default: 'false (AÇIK)',
    group: 'rating',
  },
  {
    key: 'DISABLE_GLICKO2',
    label: 'Glicko-2 Rating',
    description: 'RD+σ volatility rating. RD=350 cold-start. Default AÇIK.',
    value: process.env.DISABLE_GLICKO2,
    type: 'toggle',
    default: 'false (AÇIK)',
    group: 'rating',
  },
  {
    key: 'DISABLE_GAP_RATING',
    label: 'Lite GAP Rating',
    description: 'Generalized Attacking Performance. statsJson üzerinden. Default AÇIK.',
    value: process.env.DISABLE_GAP_RATING,
    type: 'toggle',
    default: 'false (AÇIK)',
    group: 'rating',
  },
  {
    key: 'DISABLE_CORRECTOR',
    label: 'ZISM Corrector',
    description: 'Frank κ veya ZISM β corrector (önerilen κ=-0.30, BTTS %19 iyileşme). Default AÇIK.',
    value: process.env.DISABLE_CORRECTOR,
    type: 'toggle',
    default: 'false (AÇIK)',
    group: 'corrector',
  },
  {
    key: 'SKOR_KAPPA',
    label: 'Corrector Kappa (κ)',
    description: 'Frank Copula korelasyon parametresi (−0.30 önerilen)',
    value: process.env.SKOR_KAPPA ?? '-0.30',
    type: 'number',
    default: '-0.30',
    group: 'corrector',
  },
  {
    key: 'ZISM_BETA',
    label: 'Corrector ZISM Beta (β)',
    description: 'Zero-inflation 0-0 şişirme (0.10 tipik)',
    value: process.env.ZISM_BETA,
    type: 'number',
    default: '0.10',
    group: 'corrector',
  },
  {
    key: 'ZISM_MODE',
    label: 'Corrector Modu',
    description: '"frank" veya "zism" modu',
    value: process.env.ZISM_MODE,
    type: 'select',
    default: 'frank',
    group: 'corrector',
  },
  {
    key: 'BACKTEST_PERSIST_JSON',
    label: 'Backtest JSON Writer',
    description: 'Her backtest sonucunu data/backtest-results/*.json yaz',
    value: process.env.BACKTEST_PERSIST_JSON,
    type: 'toggle',
    default: 'false',
    group: 'system',
  },
  {
    key: 'RADAR_THRESHOLD',
    label: 'Radar Threshold',
    description: 'Sinyal görünme eşiği (env override, varsayılan 65)',
    value: process.env.RADAR_THRESHOLD,
    type: 'number',
    default: '65',
    group: 'system',
  },
  {
    key: 'SIGNAL_5MIN_THRESHOLD',
    label: '5-Dk Gol Olasılık Eşiği',
    description: 'Sinyal için minimum P(gol | 5dk) (varsayılan 0.25)',
    value: process.env.SIGNAL_5MIN_THRESHOLD,
    type: 'number',
    default: '0.25',
    group: 'system',
  },
];

export async function GET() {
  return NextResponse.json({
    flags: FLAGS.filter((f) => !f.key.startsWith('_')),
    // Admin dokümantasyon linki
    docs: '/docs/FEATURE_FLAGS.md',
  });
}
