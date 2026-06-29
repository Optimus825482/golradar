// ── Lite GAP (Generalized Attacking Performance) Rating ──────────
// Faz 4 (Yol B) — Wheatcroft'un GAP modeli için predictor stub.
//
// NOT: Bu modül şu an predictor-stub olarak duruyor (Aralık 2026 durumu).
// predictionLog.featuresJson alanı DB'de büyük ölçüde boş olduğu için
// in-memory GAP replay yararlı rating üretmiyor (matchesWithFeatures=0).
// Bu yüzden updateGapRating no-op; predictGapMatch → gapP=0, confidence=0.
//
// Modüler yapı + API kontratı korundu; ileride:
//   - teamHistoryMatch'e shots/corners/DA kolonları eklenirse
//   - veya featuresJson doldurma backfill job'u yazılırsa
// predictGapMatch aktif hale gelebilir (Faz 6 backlog).
//
// Referanslar (implementasyona hazır, mevcut değil):
//   - Wheatcroft (2024) "Forecasting football match outcomes using
//     non-rare events like shots and corners"
//   - Constantinou & Fenton (2013) "Determining the level of ability
//     of football teams by dynamic ratings"
//
// 4 rating per team:
//   Ha = home attack strength (higher = more shots/SOT/xG at home)
//   Hd = home defense strength (higher = conceding fewer dangerous attacks)
//   Aa = away attack strength
//   Ad = away defense strength
//
// Beklenen istatistik (Wheatcroft): S_H = (Ha_i + Ad_j) / 2
// Update step: rating' += time_decay × (actual - expected) × learning_rate

const TIME_DECAY = 0.003; // λ — per-record decay (günlük)
const LEARNING_RATE = 0.05; // EMA-style update rate
const CROSS_WEIGHT_HOME = 0.15; // φ1 — ev performansının deplasmana etkisi
const CROSS_WEIGHT_AWAY = 0.15; // φ2 — deplasman performansının ev performansına
const INITIAL_RATING = 0.0; // tüm rating'ler 0'dan başlar (lig ortalaması)
const RATING_CLAMP = 1.5; // abs|rating| ≤ 1.5
const MIN_MATCHES_FOR_CONFIDENCE = 5; // matches < 5 → confidence düşük

export interface TeamGapRating {
  Ha: number; // home attack
  Hd: number; // home defense
  Aa: number; // away attack
  Ad: number; // away defense
  matchesHa: number;
  matchesHd: number;
  matchesAa: number;
  matchesAd: number;
  lastUpdate: number;
}

export interface GapRatingState {
  teams: Map<string, TeamGapRating>;
  totalUpdates: number;
  version: string;
}

export interface GapPrediction {
  lambdaHome: number;
  lambdaAway: number;
  homeWinP: number;
  drawP: number;
  awayWinP: number;
  gapP: number; // imminent-goal probability 0-1 (ensemble P input)
  confidence: number; // 0-1
  matchesHome: number;
  matchesAway: number;
}

/**
 * Boş bir GAP state oluştur. Process başlangıcında çağrılır.
 */
export function createGapRatingState(): GapRatingState {
  return {
    teams: new Map(),
    totalUpdates: 0,
    version: 'gap-1.0-lite',
  };
}

function emptyRating(): TeamGapRating {
  return {
    Ha: INITIAL_RATING,
    Hd: INITIAL_RATING,
    Aa: INITIAL_RATING,
    Ad: INITIAL_RATING,
    matchesHa: 0,
    matchesHd: 0,
    matchesAa: 0,
    matchesAd: 0,
    lastUpdate: Date.now(),
  };
}

/**
 * Normalize edilmiş featuresJson değerinden (0-1 clamped) beklenen istatistiği geri çevir.
 * featuresJson shape: featureEngineering.ts:24-110. GAP için kullandıklarımız:
 *   - dangerous_attacks_home_rate
 *   - shots_on_target_home_rate
 *   - corners_home_rate
 *   - xg_home (normalized 0-1, cap 3.0)
 *   - xg_away
 */
export interface GapFeatures {
  dangerousAttacksHomeRate: number;
  shotsOnTargetHomeRate: number;
  cornersHomeRate: number;
  xgHome: number;
  xgAway: number;
  // Deplasman tarafı (away stats in a normal match perspective):
  dangerousAttacksAwayRate?: number;
  shotsOnTargetAwayRate?: number;
  cornersAwayRate?: number;
}

/**
 * predictionLog.featuresJson → GapFeatures çıkar. Eski veri uyumluluğu
 * için alan bulunamazsa 0.0 döner (cold-start semantiği = nötr).
 */
export function extractGapFeatures(featuresJson: string | null | undefined): GapFeatures | null {
  if (!featuresJson) return null;
  try {
    const f = JSON.parse(featuresJson) as Record<string, number>;
    const hasAny =
      f.dangerous_attacks_home_rate != null ||
      f.shots_on_target_home_rate != null ||
      f.corners_home_rate != null ||
      f.xg_home != null;
    if (!hasAny) return null;
    return {
      dangerousAttacksHomeRate: Number(f.dangerous_attacks_home_rate) || 0,
      shotsOnTargetHomeRate: Number(f.shots_on_target_home_rate) || 0,
      cornersHomeRate: Number(f.corners_home_rate) || 0,
      xgHome: Number(f.xg_home) || 0,
      xgAway: Number(f.xg_away) || 0,
      dangerousAttacksAwayRate: Number(f.dangerous_attacks_away_rate) || 0,
      shotsOnTargetAwayRate: Number(f.shots_on_target_away_rate) || 0,
      cornersAwayRate: Number(f.corners_away_rate) || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Maç sonucunu içeren bir featuresJson kaydını state'e dahil et.
 * State'i mutate eder (in-memory; process-local kalıcı).
 *
 * Beklenen istatistik formülü (Wheatcroft):
 *   S_H = (Ha_i + Ad_j) / 2
 * Update: rating += λ · learning_rate · (actual - expected)
 *
 * STUB: featuresJson boş olduğu için stub modunda no-op.
 * İleride featuresJson backfill veya teamHistoryMatch tablo genişlemesi
 * ile aktif edilebilir.
 */
export function updateGapRating(
  state: GapRatingState,
  homeKey: string,
  awayKey: string,
  features: GapFeatures,
): void {
  // STUB: veri yok → no-op. Gerçek implementasyon aşağıda yorum olarak.
  // Refactor notu: features.xgHome > 0 gibi bir gate ile koşullandırılabilir,
  // ama valid 0 değerinin (soğuk bir maç 0-xG olabilir) false-positive'a
  // düşmemesi için featuresJson varlığı kontrolü daha güvenilir.
  if (!features) return;

  // Gerçek implementasyon (şu an kapalı; yukarıdaki stub tarafından atlanır):
  // const home = state.teams.get(homeKey) ?? emptyRating();
  // const away = state.teams.get(awayKey) ?? emptyRating();
  // const expHomeAttack = (home.Ha + away.Ad) / 2;
  // const deltaHa = ((features.dangerousAttacksHomeRate + features.shotsOnTargetHomeRate +
  //                   features.cornersHomeRate + features.xgHome) / 4) - expHomeAttack;
  // home.Ha = clamp(home.Ha + TIME_DECAY * LEARNING_RATE * deltaHa * 10);
  // ... (aşağıdaki yorum bloğundaki tüm mantık burada açılır)
  state.totalUpdates += 0;
}

function clamp(v: number): number {
  return Math.max(-RATING_CLAMP, Math.min(RATING_CLAMP, v));
}

/**
 * Mevcut state üzerinden bir maç için 1X2 + imminent-goal olasılığı hesapla.
 * confidence: her iki takım için matches min'i. MIN_MATCHES altında düşük.
 *
 * STUB: featuresJson olmadığı için state boş, predictGapMatch her zaman
 * gapP=0 döner. İleride featuresJson backfill sonrası tam predictor açılır.
 */
export function predictGapMatch(
  state: GapRatingState,
  homeKey: string,
  awayKey: string,
): GapPrediction {
  // STUB: state boş döngüsünde → gapP=0. Production'da BMA `gapP > 0`
  // filtresi sayesinde ensemble'a katılmaz (sinyal sayısı invariant).
  void state; void homeKey; void awayKey;
  return {
    lambdaHome: 1.0,
    lambdaAway: 1.0,
    homeWinP: 0.45,
    drawP: 0.27,
    awayWinP: 0.28,
    gapP: 0,
    confidence: 0,
    matchesHome: 0,
    matchesAway: 0,
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Compute Poisson goal matrix (5x5). P(H=i, A=j).
 */
function poissonMatrix(lambdaHome: number, lambdaAway: number, max: number): number[][] {
  const grid: number[][] = Array.from({ length: max }, () => Array(max).fill(0));
  for (let h = 0; h < max; h++) {
    for (let a = 0; a < max; a++) {
      grid[h][a] = poissonPMF(lambdaHome, h) * poissonPMF(lambdaAway, a);
    }
  }
  return grid;
}

function poissonPMF(lambda: number, k: number): number {
  let factorial = 1;
  for (let i = 2; i <= k; i++) factorial *= i;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial;
}

/**
 * State snapshot'ı JSON-serializable forma çevir (debug/benchmark için).
 */
export function serializeGapState(state: GapRatingState): {
  totalUpdates: number;
  version: string;
  teams: Record<string, TeamGapRating>;
} {
  const obj: Record<string, TeamGapRating> = {};
  for (const [k, v] of state.teams.entries()) obj[k] = { ...v };
  return { totalUpdates: state.totalUpdates, version: state.version, teams: obj };
}
