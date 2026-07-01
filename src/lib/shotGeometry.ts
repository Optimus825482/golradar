// ── Shot Geometry Utilities ──────────────────────────────────────
// FotMob shotmap x,y koordinatlarından shot angle, distance ve
// goalkeeper proxy değerlerini hesaplar.
//
// FotMob koordinat sistemi: x=0-100 (kale çizgisinden), y=0-100 (kenar çizgisinden)
// Goal merkezi: x=100, y=50
// Goal genişliği: 7.32m → y aralığı 44.1-55.9 (7.32/100 * 100)
//
// Reference: Singh 2025 — freeze-frame features reach AUC 0.878.
// We only have x,y from FotMob (no defender positions) so we
// approximate defender presence and GK distance with shot xG.
//
// This module is a pure utility (no side effects). It feeds
// featureEngineering.ts and is independently testable.

export interface ShotGeometry {
  /** Radyan — gol açısı (şut noktasından kaleye). */
  angle: number;
  /** Metre — kaleye mesafe. */
  distance: number;
  /** Merkezden mi (|y-50| < 15). */
  isCentral: boolean;
  /** Ceza sahası içinde mi (x > 83). */
  inBox: boolean;
  /** Goalkeeper distance proxy (0-1, 1=uzakta). */
  gkDistanceProxy: number;
  /** Defans sayısı proxy (0-1, 1=az defans). */
  defendersInConeProxy: number;
}

const GOAL_X = 100;
const GOAL_Y = 50;
const GOAL_WIDTH = 7.32; // metre
const FIELD_LENGTH = 105; // metre
const FIELD_WIDTH = 68;   // metre
const BOX_X = 83;         // Ceza sahası başlangıcı (x)

/**
 * FotMob (x, y) + xG → geometri.
 *
 * @param x 0..100 — kale çizgisinden yatay uzaklık (FotMob)
 * @param y 0..100 — kenar çizgisinden dikey konum (50 = orta)
 * @param expectedGoals 0..1 — model xG değeri
 */
export function computeShotGeometry(
  x: number,
  y: number,
  expectedGoals: number,
): ShotGeometry {
  // FotMob x,y → metre cinsine çevir
  const xMeters = (x / 100) * FIELD_LENGTH;
  const yMeters = ((y - 50) / 50) * (FIELD_WIDTH / 2);
  const goalXMeters = FIELD_LENGTH;
  const goalYMeters = 0;

  // Distance to goal center
  const dx = goalXMeters - xMeters;
  const dy = goalYMeters - yMeters;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Shot angle: görüş açısı kaleye
  // Goal yarı genişliği: GOAL_WIDTH/2 metre
  const goalHalfWidth = GOAL_WIDTH / 2;
  const angleLeft = Math.atan2(dy + goalHalfWidth, dx);
  const angleRight = Math.atan2(dy - goalHalfWidth, dx);
  const angle = Math.abs(angleLeft - angleRight);

  // Goalkeeper distance proxy: yüksek xG = kaleci pozisyonu kötü/uzakta.
  // Singh 2025: xG > 0.3 genelde kaleci uzakta veya pozisyon hatası.
  const gkDistanceProxy = Math.min(1, expectedGoals / 0.5);

  // Defenders in cone proxy: xG düşük = defans yoğun, xG yüksek = defans az.
  // Ceza sahası dışından (x < 83) atılan şutlarda defans daha çok.
  const inBox = x > BOX_X;
  const defendersInConeProxy = Math.min(
    1,
    Math.max(0, (expectedGoals - 0.05) / 0.5),
  );

  return {
    angle: Math.min(Math.PI / 2, angle),
    distance: Math.max(0, distance),
    isCentral: Math.abs(y - 50) < 15,
    inBox,
    gkDistanceProxy,
    defendersInConeProxy,
  };
}

export interface ShotGeometryAggregate {
  avgAngle: number;
  avgDistance: number;
  centralShotRatio: number;
  inBoxRatio: number;
  avgGkDistanceProxy: number;
  avgDefendersProxy: number;
  shotCount: number;
}

const NEUTRAL: ShotGeometryAggregate = {
  avgAngle: 0.3,
  avgDistance: 20,
  centralShotRatio: 0.5,
  inBoxRatio: 0.5,
  avgGkDistanceProxy: 0.3,
  avgDefendersProxy: 0.3,
  shotCount: 0,
};

/**
 * Bir takımın tüm şutlarından ortalama shot geometry hesapla.
 * Boş shot dizisi için nötr değerler döndürür.
 */
export function aggregateShotGeometry(
  shots: Array<{ x: number; y: number; expectedGoals: number }>,
): ShotGeometryAggregate {
  if (shots.length === 0) return { ...NEUTRAL };

  const geometries = shots.map(s =>
    computeShotGeometry(s.x, s.y, s.expectedGoals),
  );

  const avg = (sel: (g: ShotGeometry) => number) =>
    geometries.reduce((acc, g) => acc + sel(g), 0) / geometries.length;

  return {
    avgAngle: avg(g => g.angle),
    avgDistance: avg(g => g.distance),
    centralShotRatio:
      geometries.filter(g => g.isCentral).length / geometries.length,
    inBoxRatio:
      geometries.filter(g => g.inBox).length / geometries.length,
    avgGkDistanceProxy: avg(g => g.gkDistanceProxy),
    avgDefendersProxy: avg(g => g.defendersInConeProxy),
    shotCount: geometries.length,
  };
}
