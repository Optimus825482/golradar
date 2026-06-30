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
 * Gerçek GAP state kullanılır (singleton, MatchSnapshot verisiyle doldurulur).
 *
 * Eğer hiç güncelleme yoksa (cold-start) gapP=0 döner →
 * ensemble BMA filtresi sayesinde katılmaz (sinyal sayısı invariant).
 */
export function predictGapMatch(
  state: GapRatingState,
  homeKey: string,
  awayKey: string,
): GapPrediction {
  const home = state.teams.get(homeKey);
  const away = state.teams.get(awayKey);

  if (!home || !away || home.matchesHa < 1 || away.matchesAa < 1) {
    return {
      lambdaHome: 1.0,
      lambdaAway: 1.0,
      homeWinP: 0.45,
      drawP: 0.27,
      awayWinP: 0.28,
      gapP: 0,
      confidence: 0,
      matchesHome: home?.matchesHa ?? 0,
      matchesAway: away?.matchesAa ?? 0,
    };
  }

  // Wheatcroft: S_H = (Ha + Ad)/2 — beklenen istatistik
  // Burada imminent-goal prob'u λ_h + λ_a → exp() formundan.
  const lambdaHome = Math.exp(home.Ha - away.Ad);
  const lambdaAway = Math.exp(away.Aa - home.Hd);
  const HORIZON_FRAC = 10 / 90; // 10 dk horizon
  const gapP = Math.max(0, Math.min(1, 1 - Math.exp(-(lambdaHome + lambdaAway) * HORIZON_FRAC)));

  // Poisson approximation for 1X2
  const goalGrid = poissonMatrix(lambdaHome, lambdaAway, 5);
  let homeWinP = 0, drawP = 0, awayWinP = 0;
  for (let h = 0; h < 5; h++) {
    for (let a = 0; a < 5; a++) {
      const p = goalGrid[h][a];
      if (h > a) homeWinP += p;
      else if (h === a) drawP += p;
      else awayWinP += p;
    }
  }

  const minMatches = Math.min(home.matchesHa, away.matchesAa);
  const confidence = minMatches >= 5
    ? Math.min(1, 0.4 + 0.05 * minMatches)
    : 0.2 + 0.04 * minMatches;

  return {
    lambdaHome: round3(lambdaHome),
    lambdaAway: round3(lambdaAway),
    homeWinP: round3(homeWinP),
    drawP: round3(drawP),
    awayWinP: round3(awayWinP),
    gapP: round3(gapP),
    confidence: round3(confidence),
    matchesHome: home.matchesHa,
    matchesAway: away.matchesAa,
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

// ── Singleton state (module-level, persists across predictions) ──
let _singletonState: GapRatingState | null = null;
let _initializing = false;
let _initialized = false;

/**
 * Singleton GAP state — module seviyesinde tek instance.
 * predictEnsemble her çağrıldığında yeni state oluşturmak yerine
 * bu singleton'ı kullanır. State, MatchSnapshot verisiyle kademeli
 * olarak doldurulur.
 */
export function getGapState(): GapRatingState {
  if (!_singletonState) {
    _singletonState = createGapRatingState();
  }
  return _singletonState;
}

/**
 * Mevcut MatchSnapshot verisiyle GAP state'ini doldur.
 * Backfill-gap-pi-ratings.ts ile aynı mantıkta çalışır.
 * İlk predictEnsemble çağrısında otomatik tetiklenir.
 */
export async function initializeGapState(limit = 20000): Promise<void> {
  if (_initialized || _initializing) return;
  _initializing = true;

  try {
    const { db } = await import('@/lib/db');
    const snapshots = await db.matchSnapshot.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    if (snapshots.length < 10) {
      console.error(`[GAP] Too few snapshots (${snapshots.length}), skipping init`);
      _initialized = true;
      return;
    }

    // Unique matchCode'ları bul
    const allCodes = [...new Set(snapshots.map(s => s.matchCode))];

    // Team name'leri Signal tablosundan çöz
    const signalRows = await db.signal.findMany({
      where: { matchCode: { in: allCodes } },
      select: { matchCode: true, homeTeam: true, awayTeam: true },
      distinct: ['matchCode'],
    });
    const teamMap = new Map(signalRows.map(r => [r.matchCode, { home: r.homeTeam, away: r.awayTeam }]));

    // Fallback: PredictionLog
    const missingCodes = allCodes.filter(c => !teamMap.has(c));
    if (missingCodes.length > 0) {
      const logRows = await db.predictionLog.findMany({
        where: { matchCode: { in: missingCodes } },
        select: { matchCode: true, homeTeam: true, awayTeam: true },
        distinct: ['matchCode'],
      });
      for (const r of logRows) {
        if (!teamMap.has(r.matchCode)) {
          teamMap.set(r.matchCode, { home: r.homeTeam, away: r.awayTeam });
        }
      }
    }

    const state = getGapState();
    let updates = 0;

    // Snapshots'ları matchCode + minute ile grupla, kronolojik sırala
    const grouped = new Map<number, Array<typeof snapshots[0]>>();
    for (const s of snapshots) {
      const arr = grouped.get(s.matchCode) ?? [];
      arr.push(s);
      grouped.set(s.matchCode, arr);
    }
    for (const arr of grouped.values()) {
      arr.sort((a, b) => a.minute - b.minute);
    }

    // Her maç için state güncelle
    for (const [matchCode, arr] of grouped) {
      const teams = teamMap.get(matchCode);
      if (!teams) continue;

      for (const snap of arr) {
        const features = extractGapFeaturesFromMatchSnapshot(snap.statsJson, snap.minute);
        if (features) {
          updateGapRatingFromMatchSnapshot(state, teams.home, teams.away, features);
          updates++;
        }
      }
    }

    console.error(`[GAP] Initialized: ${updates} updates across ${teamMap.size} matches, ${state.teams.size} teams`);
  } catch (e) {
    console.error('[GAP] Init failed:', e);
  }

  _initialized = true;
  _initializing = false;
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
