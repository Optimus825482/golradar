// ── Stacking Ensemble Meta-Model ──────────────────────────────
// Instead of weighted averaging, train a small logistic regression
// meta-model that takes individual model probabilities as input.
//
// Reference: Wolpert, D.H. (1992). "Stacked generalization."
// Training: use PredictionLog records with known outcomes.
//
// Faz 2 (A2) — trainingData process-local mutable array'den JSONL dosyasına
// (data/ml-training/stacking-samples.jsonl) taşındı.
//
// CRITICAL — Client-bundle guard: Bu dosya `predictStacking()` gibi
// server-only API'leri içerir (fs/path tabanlı persistence). Ancak
// `ensemble.ts` client boundary'leri tarafından implicit import edilir
// (page.tsx → goalRadar → fotmobIntelligence → ensemble → stackingEnsemble).
// Webpack bu zinciri client bundle'a çeker; fs/path modüllerini
// resolve edemeyince build fail eder.
//
// Çözüm: 'fs' ve 'path' import'ları bu dosyada TOP-LEVEL DEĞİL; lazy
// import + dynamic export. Server runtime'da fonksiyonlar çağrıldığında
// fs/path modülleri yüklenir; client bundle'a hiçbir zaman dahil edilmez.
// Bu pattern Next.js'in "use server" approach'u ile uyumludur (fonksiyon
// bazlı izolasyon).

export interface StackingInput {
  ruleBased: number;
  poisson: number;
  elo: number;
  ml: number;
  teamStrength: number;
  inplay: number;
  gap: number;
  pi: number;
  glicko2: number;
}

export interface StackingWeights {
  intercept: number;
  ruleBased: number;
  poisson: number;
  elo: number;
  ml: number;
  teamStrength: number;
  inplay: number;
  gap: number;
  pi: number;
  glicko2: number;
}

// Default eşit ağırlık (eğitim verisi yoklen)
let currentWeights: StackingWeights = {
  intercept: 0,
  ruleBased: 1,
  poisson: 1,
  elo: 1,
  ml: 1,
  teamStrength: 1,
  inplay: 1,
  gap: 0,
  pi: 0,
  glicko2: 0,
};

const MAX_TRAINING_SAMPLES = 5000;

// In-memory ring buffer (process-local mirror of JSONL dosyası)
const trainingData: Array<{ input: StackingInput; actual: number }> = [];
let dirty = false;

/**
 * Lazy-init: stack verisinin bulunduğu JSONL dosya yolu.
 * Server runtime'da ilk erişildiğinde hesaplanır; client bundle'a
 * `path` modülünü çekmemek için dynamic import.
 */
let _STACKING_DATA_PATH_CACHE: string | null = null;
async function getStackingDataPath(): Promise<string> {
  if (_STACKING_DATA_PATH_CACHE !== null) return _STACKING_DATA_PATH_CACHE;
  const path = await import('node:path');
  _STACKING_DATA_PATH_CACHE = path.join(
    process.cwd(), 'data', 'ml-training', 'stacking-samples.jsonl',
  );
  return _STACKING_DATA_PATH_CACHE;
}

/**
 * Process başlangıcında JSONL'den ring buffer'a yükle.
 * Idempotent; predictStacking çağrılmadan önce implicit çağrılabilir
 * veya route-layer'dan explicit.
 *
 * fs modülü lazy import edilir — Next.js client bundle'a sızmasını
 * engellemek için (predictStacking server tarafında çağrılır).
 */
export async function loadStackingSamples(): Promise<number> {
  try {
    const fs = await import('node:fs/promises');
    const STACKING_DATA_PATH = await getStackingDataPath();
    const raw = await fs.readFile(STACKING_DATA_PATH, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.input && typeof parsed.actual === 'number') {
          trainingData.push(parsed as { input: StackingInput; actual: number });
        }
      } catch { /* skip corrupt line */ }
    }
    if (trainingData.length > MAX_TRAINING_SAMPLES) {
      trainingData.splice(0, trainingData.length - MAX_TRAINING_SAMPLES);
    }
    return trainingData.length;
  } catch {
    return 0;
  }
}

/**
 * Yeni bir eğitim örneği ekle. Dosyaya async append (best-effort);
 * bellek ring buffer'ı tutuyor, çıkışta flush.
 */
export async function addStackingSample(input: StackingInput, actualGoal: number): Promise<void> {
  const sample = { input, actual: actualGoal };
  trainingData.push(sample);
  if (trainingData.length > MAX_TRAINING_SAMPLES) {
    trainingData.shift();
  }
  dirty = true;
  // Best-effort dosyaya yaz; hata olursa in-memory ring yine geçerli.
  // Tüm disk operasyonları lazy: client bundle'a fs modülü sızmaz.
  try {
    const [fs, path] = await Promise.all([
      import('node:fs/promises'),
      import('node:path'),
    ]);
    await fs.mkdir(path.join(process.cwd(), 'data', 'ml-training'), { recursive: true });
    const STACKING_DATA_PATH = await getStackingDataPath();
    await fs.appendFile(
      STACKING_DATA_PATH,
      JSON.stringify(sample) + '\n',
      'utf-8',
    );
  } catch { /* swallow — ring buffer authoritative */ }
}

/**
 * Process çıkışında çağrılabilecek flush (graceful shutdown).
 */
export async function flushStackingSamples(): Promise<void> {
  // dosya zaten append olmuş durumda; in-memory ile senkron tutmak için
  // yeniden yazmak isteğe bağlı. Şu an no-op (append yeterli).
  dirty = false;
}

/**
 * Logistic regression meta-model train.
 * Features: her modelin probability'si.
 * Target: goal oldu mu (0/1).
 *
 * Dosya persistence: ilk çağrıda JSONL'i yükler, sonrasında in-memory ring
 * kullanılır. n < 100 ise mevcut ağırlıkları döndürür (cold-start guard).
 */
export async function trainStackingMetaModel(): Promise<StackingWeights> {
  // İlk çağrıda disk'ten yükle (process yeniden başladıktan sonra)
  if (trainingData.length === 0) {
    await loadStackingSamples();
  }
  const n = trainingData.length;
  if (n < 100) return currentWeights;

  // Gradient descent for logistic regression
  let w = { ...currentWeights };
  const lr = 0.01;
  const epochs = 500;

  for (let epoch = 0; epoch < epochs; epoch++) {
    let gradIntercept = 0;
    let gradRule = 0, gradPoisson = 0, gradElo = 0, gradMl = 0, gradTs = 0, gradInplay = 0, gradGap = 0, gradPi = 0, gradGlicko2 = 0;

    for (const sample of trainingData) {
      const z = w.intercept
        + w.ruleBased * sample.input.ruleBased
        + w.poisson * sample.input.poisson
        + w.elo * sample.input.elo
        + w.ml * sample.input.ml
        + w.teamStrength * sample.input.teamStrength
        + w.inplay * sample.input.inplay
        + w.gap * sample.input.gap
        + (w.pi || 0) * (sample.input.pi || 0)
        + (w.glicko2 || 0) * (sample.input.glicko2 || 0);
      const pred = 1 / (1 + Math.exp(-z));
      const err = pred - sample.actual;

      gradIntercept += err;
      gradRule += err * sample.input.ruleBased;
      gradPoisson += err * sample.input.poisson;
      gradElo += err * sample.input.elo;
      gradMl += err * sample.input.ml;
      gradTs += err * sample.input.teamStrength;
      gradInplay += err * sample.input.inplay;
      gradGap += err * sample.input.gap;
      gradPi += err * (sample.input.pi || 0);
      gradGlicko2 += err * (sample.input.glicko2 || 0);
    }

    w.intercept -= lr * (gradIntercept / n);
    w.ruleBased -= lr * (gradRule / n);
    w.poisson -= lr * (gradPoisson / n);
    w.elo -= lr * (gradElo / n);
    w.ml -= lr * (gradMl / n);
    w.teamStrength -= lr * (gradTs / n);
    w.inplay -= lr * (gradInplay / n);
    w.gap -= lr * (gradGap / n);
    w.pi = (w.pi || 0) - lr * (gradPi / n);
    w.glicko2 = (w.glicko2 || 0) - lr * (gradGlicko2 / n);
  }

  currentWeights = w;
  return w;
}

/**
 * Meta-model ile tahmin yap.
 * Önce linear kombinasyon, sonra sigmoid.
 */
export function predictStacking(input: StackingInput): number {
  const z = currentWeights.intercept
    + currentWeights.ruleBased * input.ruleBased
    + currentWeights.poisson * input.poisson
    + currentWeights.elo * input.elo
    + currentWeights.ml * input.ml
    + currentWeights.teamStrength * input.teamStrength
    + currentWeights.inplay * input.inplay
    + currentWeights.gap * input.gap
    + (currentWeights.pi || 0) * (input.pi || 0)
    + (currentWeights.glicko2 || 0) * (input.glicko2 || 0);

  // Sigmoid
  const p = 1 / (1 + Math.exp(-z));
  return Math.round(p * 1000) / 1000;
}

/**
 * Mevcut stacking ağırlıklarını döndür.
 */
export function getStackingWeights(): StackingWeights {
  return { ...currentWeights };
}

/**
 * Benchmark/test için: ring buffer snapshot.
 */
export function getStackingSamples(): Array<{ input: StackingInput; actual: number }> {
  return [...trainingData];
}

/**
 * Benchmark/test için: ring buffer boyutu.
 */
export function getStackingSamplesCount(): number {
  return trainingData.length;
}
