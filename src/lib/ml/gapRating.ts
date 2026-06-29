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
 * MatchSnapshot.statsJson (ham nesine MatchStats formatı) parse eder.
 * `featuresJson` yerine doğrudan MatchSnapshot'taki `{home: number, away: number}`
 * yapısını kullanır — normalize etmez. GAP için `matchMinute` ile bölerek
 * oran hesaplar.
 */
export function extractGapFeaturesFromMatchSnapshot(
  statsJson: string | null | undefined,
  matchMinute: number,
): GapFeatures | null {
  if (!statsJson) return null;
  try {
    const raw = JSON.parse(statsJson) as Record<string, { home: number; away: number } | undefined>;
    const minute = Math.max(1, matchMinute);

    const sot = raw.shots_on_target;
    const corners = raw.corners;
    const da = raw.dangerous_attacks;
    const xgRaw = raw.xg;
    const sotA = raw.shots_on_target; // away symmetric

    const hasAny = sot != null || corners != null || da != null || xgRaw != null;
    if (!hasAny) return null;

    // Rate = count / (minute * 90) scale → 0-1 normalized
    const toRate = (v: { home: number; away: number } | undefined) => ({
      home: (v?.home ?? 0) / (minute / 90),
      away: (v?.away ?? 0) / (minute / 90),
    });

    const rateSot = toRate(sot);
    const rateCorners = toRate(corners);
    const rateDa = toRate(da);

    return {
      dangerousAttacksHomeRate: Math.min(1, rateDa.home / 15), // max ~15 DA/maç
      shotsOnTargetHomeRate: Math.min(1, rateSot.home / 8),
      cornersHomeRate: Math.min(1, rateCorners.home / 10),
      xgHome: Math.min(1, (xgRaw?.home ?? 0) / 3.0),
      xgAway: Math.min(1, (xgRaw?.away ?? 0) / 3.0),
      dangerousAttacksAwayRate: Math.min(1, rateDa.away / 15),
      shotsOnTargetAwayRate: Math.min(1, rateSot.away / 8),
      cornersAwayRate: Math.min(1, rateCorners.away / 10),
    };
  } catch {
    return null;
  }
}

/**
 * Maç sonucunu içeren bir featuresJson kaydını state'e dahil et.
 * State'i mutate eder (in-memory; process-local kalıcı).
 *
 * Backward-compat stub: featuresJson boş olduğu için bu fonksiyon no-op
 * kalır. Gerçek güncelleme için `updateGapRatingFromMatchSnapshot` kullan.
 */
export function updateGapRating(
  state: GapRatingState,
  _homeKey: string,
  _awayKey: string,
  _features: GapFeatures,
): void {
  void state;
  state.totalUpdates += 0;
}

/**
 * MatchSnapshot.statsJson üzerinden gerçek GAP update (stub yok).
 * Wheatcroft (2024) formülü: S_H = (Ha + Ad) / 2
 * Update: rating' += λ · ω · (actual - expected)
 */
export function updateGapRatingFromMatchSnapshot(
  state: GapRatingState,
  homeKey: string,
  awayKey: string,
  features: GapFeatures,
): void {
  if (!features || features.xgHome === undefined || features.shotsOnTargetHomeRate === undefined) {
    return;
  }
  const home = state.teams.get(homeKey) ?? emptyRating();
  const away = state.teams.get(awayKey) ?? emptyRating();

  // Ev hücum rating: (Ha + Ad)/2 vs actual (shots + xG)
  const expHomeAttack = (home.Ha + away.Ad) / 2;
  const actualHome = (features.dangerousAttacksHomeRate +
    features.shotsOnTargetHomeRate +
    features.cornersHomeRate +
    features.xgHome) / 4;
  const deltaHa = actualHome - expHomeAttack;
  home.Ha = clamp(home.Ha + TIME_DECAY * LEARNING_RATE * deltaHa * 10);

  // Deplasman hücum
  const expAwayAttack = (away.Aa + home.Hd) / 2;
  const actualAway = (features.xgAway + (features.dangerousAttacksAwayRate ?? 0) +
    (features.shotsOnTargetAwayRate ?? 0) + (features.cornersAwayRate ?? 0)) / 4;
  const deltaAa = actualAway - expAwayAttack;
  away.Aa = clamp(away.Aa + TIME_DECAY * LEARNING_RATE * deltaAa * 10);

  // Cross-weight (Constantinou φ)
  home.Aa = clamp(home.Aa + CROSS_WEIGHT_HOME * deltaHa);
  away.Hd = clamp(away.Hd - CROSS_WEIGHT_HOME * deltaAa);

  home.matchesHa += 1;
  away.matchesHd += 1;
  home.matchesHd += 1;
  away.matchesAa += 1;
  home.lastUpdate = Date.now();
  away.lastUpdate = Date.now();

  state.teams.set(homeKey, home);
  state.teams.set(awayKey, away);
  state.totalUpdates += 1;
}

export function clamp(v: number): number {
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
