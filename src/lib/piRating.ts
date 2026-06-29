// ── Pi-Rating (Constantinou & Fenton 2013) ──────────────────────────
// Futbola özel dinamik takım gücü derecelendirmesi.
//
// 4 rating per takım — iç saha / deplasman ayrı:
//   Ha = home attack strength (yüksek = ev sahibi daha çok gol atar)
//   Hd = home defense strength (yüksek = ev sahibi daha az gol yer)
//   Aa = away attack strength
//   Ad = away defense strength
//
// Beklenen gol farkı: δ_exp = (Ha_i + Ad_j) / 2 − (Hd_i + Aa_j) / 2
// Update: rating' += ξ · ω · (actual_goal_diff − δ_exp)
//   ξ = time-decay (~3.25e-3 / gün), ω = learning_rate = 0.05
// Cross-weight φ=0.15: iç saha performansı deplasman puanını hafifçe yansıtır.
//
// Maç sonu prod'dan gelir (teamHistoryMatch veya rapor API'si).
// predictPiFromRating() EloPrediction tipine uyumlu çıktı verir →
// ensemble.ts bunu eloHomeWin/eloDraw/eloAwayWin yerine okuyabilir.
//
// Backward-compat: ENABLE_PI_RATING=false → predictPiFromRating
// tüm çıktılar aynı Elo fallback döner (ensemble davranışı değişmez).

export interface PiTeamRating {
  Ha: number; // home attack
  Hd: number; // home defense
  Aa: number; // away attack
  Ad: number; // away defense
  matches: number; // total matches observed
  lastUpdate: number; // epoch ms
}

export interface PiPrediction {
  homeWinP: number;
  drawP: number;
  awayWinP: number;
  homeRating: number; // (Ha + Hd) / 2
  awayRating: number;
  ratingDiff: number;
  goalDiffExpected: number;
}

const TIME_DECAY = 3.25e-3; // ξ (gün başına)
const LEARNING_RATE = 0.05; // ω
const CROSS_WEIGHT = 0.15; // φ
const RATING_CLAMP = 1.5; // floor |rating| ≤ 1.5
const HOME_ADVANTAGE = 0.27; // trend gol farkı bias

// In-process cache. Production'da DB'ye persist etmek için bir
// TeamPiRating tablosu gerekir (Faz 6 backlog); benchmark script
// replay yaptığı için cold-start sıkıntısı yok.
const piCache: Map<string, PiTeamRating> = new Map();

export function emptyPiRating(): PiTeamRating {
  return {
    Ha: 0,
    Hd: 0,
    Aa: 0,
    Ad: 0,
    matches: 0,
    lastUpdate: Date.now(),
  };
}

function clampRating(v: number): number {
  return Math.max(-RATING_CLAMP, Math.min(RATING_CLAMP, v));
}

/**
 * Maç sonucunu rating state'e dahil et. Goal difference = homeGoals - awayGoals.
 * Cross-weight φ: home rating hafifçe away'a, away rating hafifçe home'a yansır.
 * Processes-local (in-memory); process restart'ta yeniden eğitilmeli.
 */
export function updatePiRating(
  homeKey: string,
  awayKey: string,
  homeGoals: number,
  awayGoals: number,
): void {
  const home = piCache.get(homeKey) ?? emptyPiRating();
  const away = piCache.get(awayKey) ?? emptyPiRating();
  const gdActual = homeGoals - awayGoals;
  // Beklenen gol farkı = (Ha + Ad)/2 - (Hd + Aa)/2 + HOME_ADVANTAGE
  // Constantinou & Fenton ayrıntı (Wikipedia'dan sadeleştirilmiş).
  const expHome = home.Ha - away.Ad + HOME_ADVANTAGE;
  const expAway = away.Aa - home.Hd;
  const gdExpected = (expHome - expAway) / 2; // ≈ (Ha + Ad − Hd − Aa)/4 + adv/2

  const error = gdActual - gdExpected;
  const delta = TIME_DECAY * LEARNING_RATE * error;

  // Strike ratings. Hedef: home gerçek gol farkını beklenenden çok
  // daha yüksek yaptıysa Ha yükselir, Ad düşer.
  home.Ha = clampRating(home.Ha + delta);
  away.Ad = clampRating(away.Ad - delta);
  away.Aa = clampRating(away.Aa + error * TIME_DECAY * LEARNING_RATE * 0.5);
  home.Hd = clampRating(home.Hd - error * TIME_DECAY * LEARNING_RATE * 0.5);

  // Cross-weight (yakalama öğrenme oranı).
  home.Aa = clampRating(home.Aa + CROSS_WEIGHT * delta);
  away.Hd = clampRating(away.Hd - CROSS_WEIGHT * delta);

  home.matches += 1;
  away.matches += 1;
  home.lastUpdate = Date.now();
  away.lastUpdate = Date.now();

  piCache.set(homeKey, home);
  piCache.set(awayKey, away);
}

/**
 * Mevcut state üzerinden 1X2 + expected goal-difference tahmini.
 * ensemble.ts'in okuduğu EloPrediction şekline uyumlu.
 */
export function predictPiFromRating(
  homeKey: string,
  awayKey: string,
): PiPrediction {
  const home = piCache.get(homeKey);
  const away = piCache.get(awayKey);

  if (!home || !away) {
    // Cold-start: Elo fallback davranışı
    return {
      homeWinP: 0.45,
      drawP: 0.27,
      awayWinP: 0.28,
      homeRating: 0,
      awayRating: 0,
      ratingDiff: 0,
      goalDiffExpected: 0,
    };
  }

  const homeOffAvg = (home.Ha + away.Ad) / 2;
  const awayOffAvg = (away.Aa + home.Hd) / 2;
  const goalDiffExpected = homeOffAvg - awayOffAvg + HOME_ADVANTAGE;

  // Poisson-basit yaklaşım (gol-farkı dağılımı):
  // P(H=W), P(D), P(A=W) oranlarını formülden türet.
  // Triangular approximation: skor-farkı ~ N(goalDiffExpected, 1.5)
  // (Fark dağılımı standart sapma = 1.5 gol — Constantinou 2013).
  const stddev = 1.5;
  const z = goalDiffExpected / stddev;
  // Nor(0,1) CDF table approximation
  const Phi = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
  // P(home wins) = P(gd > 0.5)
  const homeWinP = 1 - Phi(0.5 - z);
  // P(draw) = P(-0.5 ≤ gd ≤ 0.5)
  const drawP = Phi(0.5 - z) - Phi(-0.5 - z);
  // P(away wins) = rest
  const awayWinP = Phi(-0.5 - z);
  const homeRating = (home.Ha + home.Hd) / 2;
  const awayRating = (away.Aa + away.Ad) / 2;
  return {
    homeWinP: round3(homeWinP),
    drawP: round3(drawP),
    awayWinP: round3(awayWinP),
    homeRating: round3(homeRating),
    awayRating: round3(awayRating),
    ratingDiff: round3(homeRating - awayRating),
    goalDiffExpected: round3(goalDiffExpected),
  };
}

/**
 * Mevcut state'i export et (benchmark + debug için snapshot).
 */
export function exportPiState(): Record<string, PiTeamRating> {
  const out: Record<string, PiTeamRating> = {};
  for (const [k, v] of piCache.entries()) out[k] = { ...v };
  return out;
}

/**
 * Process-local cache'i yeniden başlat (testler için).
 */
export function resetPiState(): void {
  piCache.clear();
}

/**
 * Çoklu rating kaydını import et (geriye yükleme).
 */
export function bulkImportPiRatings(entries: Array<[string, PiTeamRating]>): void {
  for (const [k, v] of entries) piCache.set(k, { ...v });
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Math erf approximation (Abramowitz & Stegun 7.1.26).
 * |x| ≤ 3.0 için yeterli doğruluk.
 */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}
