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
    value: process.env.STACKING_BLEND_ALPHA,
    type: 'number',
    default: '0',
    group: 'ensemble',
  },
  {
    key: 'ENABLE_ONLINE_ADJUSTMENTS',
    label: 'Online Weight Drift',
    description: 'Son 500 prediction accuracy-based ensemble weight rebalance',
    value: process.env.ENABLE_ONLINE_ADJUSTMENTS,
    type: 'toggle',
    default: 'false',
    group: 'ensemble',
  },
  {
    key: 'ENABLE_PI_RATING',
    label: 'Pi-Rating (Constantinou)',
    description: 'İç/deplasman ayrı 4-rating sistemi (backward-compat proxy: 1-0 gap)',
    value: process.env.ENABLE_PI_RATING,
    type: 'toggle',
    default: 'false',
    group: 'rating',
  },
  {
    key: 'ENABLE_GLICKO2',
    label: 'Glicko-2 Rating',
    description: 'RD+σ volatility rating (cold-start → RD=350, simplified Illinois)',
    value: process.env.ENABLE_GLICKO2,
    type: 'toggle',
    default: 'false',
    group: 'rating',
  },
  {
    key: 'ENABLE_GAP_RATING',
    label: 'GAP Rating (stub)',
    description: 'Generalized Attacking Performance — featuresJson backfill bekliyor',
    value: process.env.ENABLE_GAP_RATING,
    type: 'toggle',
    default: 'false',
    group: 'rating',
  },
  {
    key: 'ENABLE_ZISM_CORRECTOR',
    label: 'ZISM Corrector',
    description: 'Frank κ veya ZISM β corrector (over/under + BTTS iyileştirmesi)',
    value: process.env.ENABLE_ZISM_CORRECTOR,
    type: 'toggle',
    default: 'false',
    group: 'corrector',
  },
  {
    key: 'SKOR_KAPPA',
    label: 'Corrector Kappa (κ)',
    description: 'Frank Copula korelasyon parametresi (−0.30 önerilen)',
    value: process.env.SKOR_KAPPA,
    type: 'number',
    default: '-0.10',
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
