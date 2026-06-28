// ── Merkezi uygulama konfigürasyonu ──────────────────────────────
// Sinyal algoritması, kalibrasyon ve ensemble ile ilgili magic sayıları
// tek yerden yönetir. Faz 0 — plan: bright-watching-sutton.md.
//
// Bu dosya saf sabitler içerir — yan etkisi yok, mutasyon yok.
// Runtime'da değişecek değerler (CALIBRATION_PARAMS, league profilleri)
// Faz 2'de DB SystemConfig tablosuna taşınacak; buradaki sabitler
// yalnızca başlangıç/default değer rolu oynayacak.

// ── Sinyal eşikleri & zamanlama ──────────────────────────────────

/** Goal Radar skoru bu değerin altındaysa sinyal oluşturulmaz (0-100). */
export const SIGNAL_THRESHOLD = 60;

/**
 * Dinamik eşik hesaplama — lig, dakika ve Elo farkına göre threshold ayarlar.
 * Düşük skorlu ama yüksek olasılıklı durumları yakalamak için.
 *
 * Lig offset'leri: atak liglerde eşik düşer (daha fazla sinyal), defans liglerde yükselir.
 * Dakika offset'i: ilk yarıda daha yüksek eşik (az veri), son 15dk'da daha düşük.
 * Elo offset'i: büyük farklı maçlarda eşik yükselir (favorit etkisi).
 */
export function getDynamicThreshold(
  leagueId?: number | null,
  minute?: number,
  eloDiff?: number,
): number {
  let threshold = SIGNAL_THRESHOLD;

  // Lig bazlı offset
  // Atak liglerde eşik düşük, defans liglerde yüksek
  if (leagueId != null) {
    const LEAGUE_OFFSETS: Record<number, number> = {
      1: -2,   // Premier League
      2: 0,    // La Liga
      3: -4,   // Bundesliga — atak ligi
      4: 4,    // Serie A — defansif
      5: -2,   // Ligue 1
      6: -3,   // Eredivisie — çok atak
      7: 2,    // Primeira Liga
      8: 1,    // Süper Lig
      9: -1,   // Championship
      10: -4,  // Jupiler Pro — yüksek skor
      13: 3,   // La Liga 2
    };
    threshold += LEAGUE_OFFSETS[leagueId] ?? 0;
  }

  // Dakika bazlı offset
  if (minute != null) {
    if (minute < 20) threshold += 5;       // Erken: yüksek eşik, az veri
    else if (minute < 30) threshold += 3;
    else if (minute < 60) threshold += 0;  // Normal seyir
    else if (minute < 75) threshold -= 3;  // Tehlikeli bölge
    else threshold -= 5;                    // Son düdük yakın
  }

  // Elo farkı offset'i: büyük fark = favorit maçı, eşik yüksek
  if (eloDiff != null) {
    const absDiff = Math.abs(eloDiff);
    if (absDiff > 300) threshold += 5;
    else if (absDiff > 200) threshold += 3;
    else if (absDiff > 100) threshold += 1;
  }

  return Math.max(40, Math.min(80, threshold));
}

/** Side detection için RADAR eşiği (score >= this → side "on"). */
export const RADAR_THRESHOLD = 60;

/** Side detection için SUSTAINED eşiği (40-59 arası + pressure spike → side "on"). */
export const SUSTAINED_THRESHOLD = 40;

/** 5-dk içinde gol olasılığı eşiği — altında sinyal level "low"a düşer. */
export const SIGNAL_5MIN_THRESHOLD = 0.25;

/** Momentum yükselirken kullanılan daha düşük 5-dk olasılık eşiği. */
export const MIN_PROB_FOR_SIGNAL = 0.20;

/** Sinyal oluştuktan sonra gol için bekleme süresi (dakika). Aşılırsa fail. */
export const SIGNAL_EXPIRY_MINUTES = 15;

/** Arka plan expiry denetim aralığı (ms). */
export const EXPIRY_CHECK_INTERVAL_MS = 30 * 1000;

/** Aynı match+side için iki sinyal arası minimum bekleme (ms). */
export const SIGNAL_COOLDOWN_MS = 3 * 60 * 1000;

/** Dakika (string/number) kabul aralığı üst sınırı. */
export const MAX_MINUTE = 120;

/** Sinyal oluşturulması GÜVENİLMEZ kabul edilen dakika bölgeleri (kapalı aralık). */
export interface MinuteRange {
  /** Dahil. */
  start: number;
  /** Dahil. */
  end: number;
  /** Bölge neden dışlanıyor — kalibrasyon için trace. */
  reason: string;
}

export const EXCLUDED_MINUTE_RANGES: readonly MinuteRange[] = [
  { start: 0, end: 2, reason: "Maç bağlamı henüz oluşmuyor" },
  { start: 43, end: 45, reason: "Devre arası öncesi taktiksel belirsizlik" },
  // FIX: 89+ tamamen engelleme — uzatma dakikalarında gol oluyor.
  // Sadece 90+3 sonrasi engelle (gereksiz uzatma).
  { start: 93, end: MAX_MINUTE, reason: "Aşırı uzatma" },
];

// ── Shared Brier Tier System ──────────────────────────────────────────
// Single source of truth for modelWeightRouter.ts and weightTuner.ts.
// Prevents tier drift between the two weight systems.
export const BRIER_TIERS: readonly { maxBrier: number; weight: number }[] = [
  { maxBrier: 0.18, weight: 1.0 },
  { maxBrier: 0.25, weight: 0.75 },
  { maxBrier: 0.32, weight: 0.50 },
  { maxBrier: 0.40, weight: 0.25 },
  { maxBrier: 0.50, weight: 0.0 },
] as const;

/** Unranked baseline weight (null Brier = 0.20, matches old default). */
export const UNRANKED_WEIGHT = 0.20;

/** Resolve weight from Brier via shared tiers. Returns 0 for brier ≥ 0.50. */
export function tierWeight(brier: number | null | undefined): number {
  if (brier == null) return UNRANKED_WEIGHT;
  for (const t of BRIER_TIERS) {
    if (brier < t.maxBrier) return t.weight;
  }
  return 0;
}

// ── Promotion Significance Threshold ──────────────────────────────────
// Minimum Brier improvement required to auto-promote. Scales inversely
// with sample count — tiny deltas on < 500 samples are likely noise.
export function minDeltaForPromotion(nSamples: number): number {
  if (nSamples < MIN_REAL_SAMPLES_FOR_PROMOTION) return Infinity;
  if (nSamples < 500) return 0.015;
  if (nSamples < 1000) return 0.010;
  if (nSamples < 5000) return 0.005;
  return 0.003;
}

// ── In-play ML model geçidi ───────────────────────────────────────

/** 5-dakika-ileri in-play modeli yalnızca bu dakikadan sonra ağırlık kazanır. */
export const INPLAY_MIN_GATE = 20;

// ── Ensemble skor tavanı ──────────────────────────────────────────

/**
 * Ensemble `score` çıktısı üst sınırı (0-100).
 *
 * Önceki değer 85 idi — bu, `critical` seviyesinin (≥%60) doğal yüksek
 * skorlarını boğuyordu. SIGNAL_THRESHOLD (60) ile hizalı 100'e çıkarıldı.
 */
export const ENSEMBLE_SCORE_CAP = 100;

// ── Eğitim geçidi ─────────────────────────────────────────────────

/**
 * GBDT modelinin prod'a promote edilmesi için gereken minimum GERÇEK
 * (sentezik olmayan) sinyal kaydı sayısı. Altındaysa sentetik-eğitimli
 * model promote edilmez, rule-based fallback kullanılır.
 * Faz 5'te kullanılır.
 */
export const MIN_REAL_SAMPLES_FOR_PROMOTION = 200;

// ── Kalibrasyon default parametreleri ─────────────────────────────

/**
 * Sigmoid kalibrasyon çekirdeği için başlangıç değerleri.
 * `calibrateScore`: `p = L / (1 + exp(-k * (score - x0)))`.
 *
 * Faz 2'de `autoCalibrateFromDB` bu değerleri DB üzerinden optimize
 * eder (L dahil grid search). Buradaki değerler yalnızca ilk-çalıştırma
 * /fallback içindir.
 *
 * Not: Önceki kodda `L=0.95` (kod) vs yorumda "0.80" çelişkisi vardı.
 * Resmi kaynak değer 0.95; yorum Faz 2'de düzeltilecek veya L grid
 * search'a dahil edilip sabit kaldırılacak.
 */
export const DEFAULT_CALIBRATION_PARAMS: { L: number; k: number; x0: number; T: number } = {
  /** Maksimum olasılık (tavan). Grid-opt: 0.95→0.90 (570K labeled). */
  L: 0.90,
  /** Eğim (steepness). Grid-opt: 0.065→0.05 */
  k: 0.05,
  /** Skor → %50 olasılık orta noktası. Grid-opt: 65→30 */
  x0: 30,
  /** Temperature scaling. Grid-opt: 1.0→0.08 */
  T: 0.08,
};

// ── Model güven türetme ──────────────────────────────────────────

/**
 * Champion Brier'dan güven (confidence) türetme — Faz 6.
 *
 * `confidence = clamp(1 - brier, MIN_MODEL_CONFIDENCE, MAX_MODEL_CONFIDENCE)`.
 * Brier 0 (mükemmel) → confidence 0.95; Brier 0.25 (zayıf) → 0.75.
 */
export const MIN_MODEL_CONFIDENCE = 0.1;
export const MAX_MODEL_CONFIDENCE = 0.95;

/**
 * Champion metaverisi olmayan modeller (ruleBrier/poissonBrier/eloBrier=null)
 * için kullanılan unranked-baseline Brier değeri.
 * `computeEnsembleWeights`'te null=0.20 default'tu; burada tek sabit.
 */
export const UNRANKED_MODEL_BRIER = 0.2;

/** `confidence = clamp(1 - brier, min, max)` — Faz 6 yardımcı. */
export function brierToConfidence(brier: number): number {
  const c = 1 - brier;
  return Math.max(MIN_MODEL_CONFIDENCE, Math.min(MAX_MODEL_CONFIDENCE, c));
}

// ── League kalibrasyon eşikleri ───────────────────────────────────

/** Ligo profili EMA koruması için minimum maç sayısı. Altındaysa default'lar aşırı ezilemez. */
export const MIN_LEAGUE_SAMPLES = 10;