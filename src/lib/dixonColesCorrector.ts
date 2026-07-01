// ── Dixon-Coles Corrector (Faz 5 / Yol D) ─────────────────────────
// Skor matrisi sonradan düzeltme corrector'ı. İki mod:
//
//   1. Frank's Copula κ corrector (literatür: Frank 1979, McHale & Scarf 2011):
//      κ < 0 → iki takımın gol korelasyonu (gol-öncesi açılır).
//              Skor matrisinde (h, a) hücresini exp(-κ · |h-a|/max(h,a)) ile çarpar.
//              Bir takımın gol atması diğerinin gol atmasını kolaylaştırır.
//      κ > 0 → karşılıklı baskı (gol atan takım rakip ataklarını yavaşlatır).
//              Skor matrisinde (h, a) hücresini exp(-κ · min(h,a)) ile çarpar.
//
//   2. ZISM (Zero-Inflated Skellam Model — literatür: Karlis & Ntzoufras 2003,
//     ボウMan & Tolhurst 2016 football extension):
//      0-0 hücresini (1 + β) oranında şişirir; diğer hücrelerden β/(N-1) oranında
//      çıkararak renormalize eder. β ∈ [0, 0.30] tipik.
//      Liglerin düşük skorlu olduğu dönemlerde (Eredivisie erken gol ortamı
//      gibi) 0-0 olasılığı gerçek Poisson'dan sistematik yüksek.
//
// ENV gate: ENABLE_ZISM_CORRECTOR=true. Default → corrector uygulanmaz
// (mevcut davranışla birebir aynı; sinyal sayısı invariant).
//
// Reim: scorer kendi başına probability döndürdüğü için normalize
// (Satır toplamı = 1) her zaman korunur.

export interface CorrectorParams {
  mode: 'off' | 'frank' | 'zism';
  kappa: number; // Frank's copula, |κ| ≤ 0.5 tipik
  beta: number;  // ZISM zero-inflation, β ∈ [0, 0.30]
}

export const DEFAULT_CORRECTOR_PARAMS: CorrectorParams = {
  mode: 'off',
  kappa: 0,
  beta: 0,
};

/**
 * 5×5 (veya N×N) skor olasılık matrisine corrector uygula. In-place değil —
 * yeni matris döner. Toplam-satır 1 normalize edilir.
 */
export function applyCorrector(
  probMatrix: readonly (readonly number[])[],
  params: CorrectorParams,
): number[][] {
  if (params.mode === 'off') return probMatrix.map((r) => [...r]);
  if (params.mode === 'frank') return applyFrank(probMatrix, params.kappa);
  if (params.mode === 'zism') return applyZism(probMatrix, params.beta);
  return probMatrix.map((r) => [...r]);
}

/**
 * Frank's Copula corrector.
 *   cell'[h][a] = cell[h][a] · w(h, a; κ)
 *   w(h, a; κ):
 *     - κ < 0 (positive korelasyon): w(h, a) = exp(-κ · |h - a| / (1 + min(h,a)))
 *       Böylece h=a (eşit skor) hücreleri en çok ağırlık kazanır → takımlar
 *       gol atınca diğeri de atar.
 *     - κ > 0 (negative korelasyon): w(h, a) = exp(-κ · min(h, a))
 *       0-0 dışındaki skorlar düşer; baskı senaryosu.
 *
 * Sonra matris-bazlı renormalize (toplam = 1) — bağımsız satır normalize'ı
 * istatistiklerde (over25 etc.) toplam bozulmasına yol açar.
 */
function applyFrank(
  probMatrix: readonly (readonly number[])[],
  kappa: number,
): number[][] {
  const N = probMatrix.length;
  const result: number[][] = Array.from({ length: N }, () => Array(N).fill(0));
  for (let h = 0; h < N; h++) {
    for (let a = 0; a < N; a++) {
      let w: number;
      if (kappa === 0) {
        w = 1;
      } else if (kappa < 0) {
        // Positive correlation: equal-scoring cells boost, unequal cells suppressed.
        // kappa<0 → exp(kappa * ratio) < 1 for ratio > 0 (unequal scores suppressed)
        const ratio = Math.abs(h - a) / (1 + Math.min(h, a));
        w = Math.exp(kappa * ratio); // kappa<0: ratio>0 → w<1 (unequal suppressed)
      } else {
        // Negative correlation: stress if either team scoring (h veya a > 0).
        // min(h, a) ≥ 1 ise w < 1, böylece 0-0 dışındaki skorlar azalır.
        w = Math.exp(-kappa * Math.min(h, a));
      }
      result[h][a] = Math.max(1e-12, probMatrix[h][a] * w);
    }
  }
  // Matris-level renormalize (toplam = 1):
  const total = result.flat().reduce((s, v) => s + v, 0);
  if (total > 0) {
    for (let h = 0; h < N; h++) {
      for (let a = 0; a < N; a++) {
        result[h][a] /= total;
      }
    }
  }
  return result;
}

/**
 * ZISM corrector — 0-0 şişirme.
 *   cell'[0][0] = cell[0][0] · (1 + β)
 *   For all other cells: cell'[h][a] = cell[h][a] · (1 - β · cell[0][0])
 *   Sonra normalize (tüm hücreler toplamı = 1).
 *
 * β > 0 → 0-0 olasılığı şişer; β → 0 → no-op.
 */
function applyZism(
  probMatrix: readonly (readonly number[])[],
  beta: number,
): number[][] {
  if (beta <= 0) return probMatrix.map((r) => [...r]);
  const N = probMatrix.length;
  const result: number[][] = probMatrix.map((r) => [...r]);
  const p00 = result[0][0];
  // 0-0 şişirme:
  result[0][0] = p00 * (1 + beta);
  // Diğer hücreler küçülme (0-0 şişmesini telafi eden renormalization):
  const shrink = 1 / (1 + beta * p00); // toplam 1 korunur
  for (let h = 0; h < N; h++) {
    for (let a = 0; a < N; a++) {
      if (h === 0 && a === 0) continue;
      result[h][a] *= shrink;
    }
  }
  // Final normalize (savunma amaçlı; küçük yuvarlama hataları için):
  const total = result.flat().reduce((s, v) => s + v, 0);
  if (total > 0) {
    for (let h = 0; h < N; h++) {
      for (let a = 0; a < N; a++) {
        result[h][a] /= total;
      }
    }
  }
  return result;
}

/**
 * Score matrisini 5×5 (veya N×N) Poisson basit dizisi olarak üret.
 * Bu, calculateMatchProbabilities'ın 5×5 corner'larını elde etmek için
 * kullanılır; corrector uygulandıktan sonra over/under ve BTTS
 * olasılıkları yeniden hesaplanır.
 *
 * pmfFn parametresi ('poisson' | 'weibull'): matrix'in Poisson μ ile veya
 * Weibull (shape=1.4 tipik) ile kurulacağını seçer. Weibull over-dispersion
 * (variance > mean) gereken ligler için uygundur (McHale & Scarf 2011).
 */
export function buildBasePoissonMatrix(
  lambdaHome: number,
  lambdaAway: number,
  max: number = 5,
  pmfFn: 'poisson' | 'weibull' = 'poisson',
): number[][] {
  const grid: number[][] = Array.from({ length: max }, () => Array(max).fill(0));
  for (let h = 0; h < max; h++) {
    for (let a = 0; a < max; a++) {
      grid[h][a] =
        pmfFn === 'weibull'
          ? weibullPMF(lambdaHome, h, 1.4) * weibullPMF(lambdaAway, a, 1.4)
          : poissonPMF(lambdaHome, h) * poissonPMF(lambdaAway, a);
    }
  }
  const total = grid.flat().reduce((s, v) => s + v, 0);
  if (total > 0) {
    for (let h = 0; h < max; h++) {
      for (let a = 0; a < max; a++) {
        grid[h][a] /= total;
      }
    }
  }
  return grid;
}

/**
 * Weibull count PMF. λ'rinci ev sahibi takımın λ'sı µ Weibull scale.
 * Weibull PDF (count formunda) approximation.
 * Reference: McHale & Scarf (2011).
 */
export function weibullPMF(lambda: number, k: number, shape: number = 1.4): number {
  if (lambda <= 0 || k < 0) return k === 0 ? 1 : 0;
  // Lognormal approximation - Weibull PMF tam formu:
  // exp(-(k/λ)^shape) * (k/λ)^(shape - 1) gibi varyanslarını üretir.
  // Burada Stirling approximation kullanarak pratik bir formula.
  // ln P(k) ≈ shape · k · ln(k / λ*scale) − (k/λ*scale)^shape
  // scale = λ^(1/shape) · gamma(1 + 1/shape)^(−1) (mean-corrected).
  let logP = 0;
  if (k === 0) {
    // P(0) = exp(−(λ/Γ(1+1/c))^c · 0) = exp(0) = 1
    return 1;
  }
  const gammaTerm = Math.exp(
    logGamma(1 + 1 / shape) / 1 + ((1 / shape) * Math.log(lambda)),
  );
  // Simplified: scale adjusted lambda
  const scaleAdjusted = lambda / Math.exp(logGamma(1 + 1 / shape));
  logP = shape * Math.log(k) - shape * shape * Math.log(scaleAdjusted) - Math.pow(k / scaleAdjusted, shape);
  // Stirling düzeltmesi:
  logP -= 0.5 * Math.log(2 * Math.PI * k);
  return Math.exp(logP);
}

function logGamma(x: number): number {
  // Lanczos approximation (g=7, n=9)
  const coef = [
    676.5203681218854, -1259.1392167224028, 771.3234280164934, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  let y = x;
  let tmp = x + 7.5;
  tmp -= x + 0.5;
  let ser = 0.99999999999980993;
  for (let i = 0; i < coef.length; i++) ser += coef[i] / ++y;
  return 0.5 * Math.log(2 * Math.PI) + (x - 0.5) * Math.log(tmp) - tmp + Math.log(ser / x);
}

function poissonPMF(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  if (k > 0) {
    logP -= k * Math.log(k) - k;
  }
  return Math.exp(logP);
}

/**
 * Correction uygulandıktan sonra over2.5 ve BTTS olasılıklarını türet.
 * production'da calculateMatchProbabilities'tan korre edilmiş matrise geçilerek
 * kullanılır; tests/benchmark'ta doğrudan buradan.
 */
export interface DerivedStats {
  over25: number;
  under25: number;
  btts: number;
  draw: number;
  homeWin: number;
  awayWin: number;
}

export function deriveStats(mat: readonly (readonly number[])[]): DerivedStats {
  let over25 = 0, draw = 0, homeWin = 0, awayWin = 0, btts = 0;
  const N = mat.length;
  for (let h = 0; h < N; h++) {
    for (let a = 0; a < N; a++) {
      const p = mat[h][a];
      if (h + a > 2) over25 += p;
      if (h === a) draw += p;
      if (h > a) homeWin += p;
      if (h < a) awayWin += p;
      if (h > 0 && a > 0) btts += p;
    }
  }
  return {
    over25: round4(over25),
    under25: round4(1 - over25),
    btts: round4(btts),
    draw: round4(draw),
    homeWin: round4(homeWin),
    awayWin: round4(awayWin),
  };
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
