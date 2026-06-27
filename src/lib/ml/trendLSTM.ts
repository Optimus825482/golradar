// ── Lightweight Trend LSTM (TypeScript) ──────────────────────
// Basit bir RNN: son N dakikanın pressure trend'ini analiz eder.
// Giriş: [pressure_home, pressure_away] dizisi (son 10 dk)
// Çıkış: goal probability boost (0-1)
//
// Bu tam bir LSTM değil, sliding window + weighted combination.
// Gerçek LSTM için Python gerekir.

export interface TrendInput {
  /** Son N dakikanın pressure değerleri: [home, away] */
  windows: Array<[number, number]>;
  /** Maç dakikası */
  minute: number;
}

// Öğrenilmiş ağırlıklar (kalibrasyonla güncellenebilir)
let weights = {
  w_home: 0.6,
  w_away: 0.4,
  w_recent: 0.7,    // son 3dk ağırlığı
  w_medium: 0.2,    // 4-6dk önce
  w_old: 0.1,       // 7-10dk önce
  threshold: 55,    // pressure eşiği
  boost_max: 0.15,  // maksimum boost
};

/**
 * Pressure trend'inden goal probability boost hesapla.
 * 
 * Trend analizi:
 * - Pressure yükseliyorsa → boost artar
 * - Pressure düşüyorsa → boost azalır
 * - Ani sıçrama varsa → ek boost
 */
export function computeTrendBoost(input: TrendInput): number {
  const { windows, minute } = input;
  if (windows.length < 3) return 0; // yeterli veri yok

  // Son 10 pencereyi al
  const recent = windows.slice(-10);
  const n = recent.length;

  // Zaman ağırlıklı ortalama
  let weightedHome = 0;
  let weightedAway = 0;
  let totalW = 0;

  for (let i = 0; i < n; i++) {
    const age = n - 1 - i; // 0 = en yeni
    let ageWeight: number;
    if (age <= 2) ageWeight = weights.w_recent;
    else if (age <= 5) ageWeight = weights.w_medium;
    else ageWeight = weights.w_old;

    weightedHome += recent[i][0] * ageWeight;
    weightedAway += recent[i][1] * ageWeight;
    totalW += ageWeight;
  }

  if (totalW === 0) return 0;
  weightedHome /= totalW;
  weightedAway /= totalW;

  // Son trend direction (son 3 dk vs 3 dk önce)
  const last3 = recent.slice(-3);
  const prev3 = recent.slice(-6, -3);
  const homeTrend = last3.length > 0 && prev3.length > 0
    ? (last3.reduce((s, w) => s + w[0], 0) / last3.length) -
      (prev3.reduce((s, w) => s + w[0], 0) / prev3.length)
    : 0;

  const awayTrend = last3.length > 0 && prev3.length > 0
    ? (last3.reduce((s, w) => s + w[1], 0) / last3.length) -
      (prev3.reduce((s, w) => s + w[1], 0) / prev3.length)
    : 0;

  // Hangi taraf daha baskın?
  const side = weightedHome > weightedAway ? 'home' : 'away';
  const maxPressure = Math.max(weightedHome, weightedAway);
  const trend = side === 'home' ? homeTrend : awayTrend;

  // Boost hesapla
  let boost = 0;

  // Pressure eşik üstünde mi?
  if (maxPressure > weights.threshold) {
    boost += (maxPressure - weights.threshold) / 100 * 0.08;
  }

  // Trend yükseliyor mu?
  if (trend > 2) {
    boost += Math.min(0.05, trend / 100);
  }

  // Ani sıçrama? (son 1 dk'da büyük değişim)
  if (recent.length >= 2) {
    const lastDelta = Math.abs(recent[recent.length - 1][0] - recent[recent.length - 2][0]) +
                      Math.abs(recent[recent.length - 1][1] - recent[recent.length - 2][1]);
    if (lastDelta > 15) boost += 0.03;
  }

  // Maç sonlarına doğru daha hassas
  if (minute > 70) boost *= 1.2;
  if (minute > 80) boost *= 1.3;

  return Math.round(Math.min(weights.boost_max, boost) * 1000) / 1000;
}

/**
 * Ağırlıkları güncelle (kalibrasyon sonrası).
 */
export function updateTrendWeights(newWeights: Partial<typeof weights>): void {
  weights = { ...weights, ...newWeights };
}

/**
 * Mevcut ağırlıkları döndür.
 */
export function getTrendWeights(): typeof weights {
  return { ...weights };
}
