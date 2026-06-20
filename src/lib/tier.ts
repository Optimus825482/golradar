// ── Tier Resolver ────────────────────────────────────────────────
// Aktif kullanıcı sayısını polling/ML yoğunluk moduna çevirir.
// Mod sadece **yük azaltma** içindir — sinyal üretimi her modda
// çalışmaya devam eder (veri kaybı önlenir).

export type Tier = "LITE" | "MID" | "FULL";

export interface TierConfig {
  /** Maç listesi poll aralığı (ms) */
  pollIntervalMs: number;
  /** Snapshot DB'ye yazma: sadece score değiştiyse VEYA dakika bunu geçtiyse */
  snapshotMinuteEvery: number;
  /** ML predict: tüm maçlara mı yoksa sadece skor değişenlere mi */
  mlPredictAllMatches: boolean;
  /** Momentum / xG / threatIndex gibi ağır analytics */
  heavyAnalytics: boolean;
  /** Cron worker self-call aralığı (ms) — server yoksa bile çalışır */
  cronIntervalMs: number;
}

const TIER_TABLE: Record<Tier, TierConfig> = {
  LITE: {
    pollIntervalMs: 60_000,
    snapshotMinuteEvery: 5,
    mlPredictAllMatches: false,
    heavyAnalytics: false,
    cronIntervalMs: 90_000,
  },
  MID: {
    pollIntervalMs: 30_000,
    snapshotMinuteEvery: 2,
    mlPredictAllMatches: false,
    heavyAnalytics: false,
    cronIntervalMs: 45_000,
  },
  FULL: {
    pollIntervalMs: 15_000,
    snapshotMinuteEvery: 1,
    mlPredictAllMatches: true,
    heavyAnalytics: true,
    cronIntervalMs: 20_000,
  },
};

export function resolveTier(activeUsers: number): Tier {
  if (activeUsers <= 0) return "LITE";
  if (activeUsers <= 10) return "MID";
  return "FULL";
}

export function tierConfig(tier: Tier): TierConfig {
  return TIER_TABLE[tier];
}
