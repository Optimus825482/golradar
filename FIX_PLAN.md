# Gol Radarı — Tüm Modeller Düzeltme ve Güncelleme Planı

> **Uygulayıcı model için:** Bu plan, 8 uzman agent tarafından yapılan derinlemesine analiz sonucu tespit edilen 146 sorunu kapsar. Her düzeltme için dosya yolu, satır numarası, mevcut kod ve düzeltilmiş kod verilmiştir. Faz sırasına göre uygulayın. Her faz sonunda test çalıştırın.

**Hedef:** 9 modelin doğruluk hatalarını düzeltmek, güvenlik açıklarını kapatmak, ölü kodu temizlemek ve kalibrasyon drift'ini durdurmak.

**Teknoloji:** Next.js 16, React 19, TypeScript, Bun, PostgreSQL, Prisma, Python FastAPI, XGBoost

## Global Kurallar

- Her düzeltme sonrası `bun test` çalıştırın
- Kritik düzeltmeler sonrası `bunx tsc --noEmit` ile type check yapın
- Prisma schema değişikliklerinde `bunx prisma db push` yapın
- Python dosyaları için `pytest mini-services/ml-trainer/tests/` çalıştırın
- Her faz sonunda `git add -A && git commit -m "fix(faz-N): ..."` ile commit yapın
- Magic number'ları config'e taşırken `src/config.ts` veya `src/lib/goalRadar/config.ts` kullanın
- Mevcut kod stilini koruyun (tab/space karışımı varsa mevcut dosya stilini takip edin)

---

## FAZ 1: KRİTİK MODEL DOĞRULUK DÜZELTMELERİ **(✓ TAMAM — 10/10)**

> Bu düzeltmeler kalibrasyonu doğrudan bozan hataları içerir. Her biri ~1-10 satır değişiklik.

### Fix 1. **[✓ UYGULANDI]**1: XGBoost base_score log-odds çevrimi **[✓ UYGULANDI]**

**Dosya:** `src/lib/ml/xgbLoader.ts:211-216`
**Sorun:** `base_score` olasılık uzayında (0.5) tutuluyor ama `predictRaw` log-odds sum'a ekliyor. Bu +0.5 log-odds bias → her tahmin ~%12 şişirilmiş.

**Mevcut kod (satır 211-216):**
```typescript
const baseScoreStr: string | undefined = learner?.objective?.base_score;
let baseScore = 0.5;
if (baseScoreStr !== undefined) {
  const parsed = parseFloat(baseScoreStr);
  if (!Number.isNaN(parsed)) baseScore = parsed;
}
```

**Düzeltilmiş kod:**
```typescript
const baseScoreStr: string | undefined = learner?.objective?.base_score;
let baseScore = 0; // log-odds uzayında 0 = olasılık 0.5
if (baseScoreStr !== undefined) {
  const parsed = parseFloat(baseScoreStr);
  if (!Number.isNaN(parsed)) {
    // XGBoost >=1.0 base_score'i olasılık olarak yazar; log-odds'a çevir
    const clamped = Math.max(1e-6, Math.min(1 - 1e-6, parsed));
    baseScore = Math.log(clamped / (1 - clamped));
  }
}
```

**Doğrulama:**
```bash
bun test src/lib/__tests__/ -- --grep xgb
# Bir maçta predictXgb sonucu 0.5'e daha yakın olmalı (öncesi ~0.62)
```

---

### Fix 1. **[✓ UYGULANDI]**2: Built-in GBDT initPrediction log-odds çevrimi **[✓ UYGULANDI]**

**Dosya:** `src/lib/goalPredictor.ts:226`
**Sorun:** `initPrediction = mean(labels)` olasılık uzayında ama `predictGBDT` log-odds olarak sigmoid'e giriyor.

**Mevcut kod (satır 225-229):**
```typescript
// Initial prediction = mean of labels
const initPrediction = labels.reduce((a, b) => a + b, 0) / n;

// Initialize residuals
let residuals = labels.map(y => y - initPrediction);
```

**Düzeltilmiş kod:**
```typescript
// Initial prediction in log-odds space (logit of mean labels)
const labelMean = Math.max(1e-6, Math.min(1 - 1e-6, labels.reduce((a, b) => a + b, 0) / n));
const initPrediction = Math.log(labelMean / (1 - labelMean));

// Initialize residuals in log-odds space
let residuals = labels.map(y => y - labelMean);
```

**Doğrulama:**
```bash
bun test src/lib/__tests__/ -- --grep gbdt
# predictGBDT çıkışları daha düşük olasılık üretmeli (bias düzelir)
```

---

### Fix 1. **[✓ UYGULANDI]**3: Kalman Team Strength champion model disk'ten yükleme **[✓ UYGULANDI]**

**Dosya:** `src/lib/ml/modelRouter.ts:151-161`
**Sorun:** `loadTeamStrengthChampion` her zaman boş default model döndürür, fitted model disk'ten yüklenmez → team-strength feature'ları (64-67) her zaman 0.

**Mevcut kod (satır 151-161):**
```typescript
export async function loadTeamStrengthChampion(): Promise<{
  model: TeamStrengthModel;
  version: string;
} | null> {
  const meta = await getChampionPath('team-strength');
  const model = loadTeamStrength();
  if (!meta) {
    return { model, version: model.version };
  }
  return { model, version: meta.version };
}
```

**Düzeltilmiş kod:**
```typescript
export async function loadTeamStrengthChampion(): Promise<{
  model: TeamStrengthModel;
  version: string;
} | null> {
  const meta = await getChampionPath('team-strength');
  if (!meta) {
    return { model: loadTeamStrength(), version: loadTeamStrength().version };
  }
  // Fitted model'i disk'ten yükle
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const fullPath = path.resolve(process.cwd(), meta.path);
    const raw = await fs.readFile(fullPath, 'utf-8');
    const serialized = JSON.parse(raw);
    const { deserializeTeamStrength } = await import('./teamStrengthKalman');
    const model = deserializeTeamStrength(serialized);
    return { model, version: meta.version };
  } catch {
    // Disk okuma hatası → fallback
    return { model: loadTeamStrength(), version: meta.version };
  }
}
```

**Doğrulama:** `deserializeTeamStrength` fonksiyonunun `teamStrengthKalman.ts`'te export edildiğinden emin olun. Eğer yoksa, şu fonksiyonu ekleyin:

```typescript
// src/lib/ml/teamStrengthKalman.ts sonuna ekle
export function deserializeTeamStrength(data: any): TeamStrengthModel {
  const model = createTeamStrengthModel();
  if (data.teams && typeof data.teams === 'object') {
    for (const [team, state] of Object.entries(data.teams)) {
      model.teams.set(team, state as TeamState);
    }
  }
  if (data.version) model.version = data.version;
  return model;
}
```

**Doğrulama:**
```bash
# Admin API'den champion kontrol et
curl http://localhost:3028/api/admin/ml/status
# team-strength champion version ve nonzero teams sayısı görünmeli
```

---

### Fix 1. **[✓ UYGULANDI]**4: Glicko-2 update sonucunu memory'ye yaz

**Dosya:** `src/lib/glicko2.ts:124-163`
**Sorun:** `updateOneRating` pure fonksiyon ama sonuçları `void` ile discard ediliyor. `home.r`, `home.RD`, `home.sigma` asla değişmiyor.

**Mevcut kod (satır 124-163):**
```typescript
function updateOneRating(
  mu: number,
  phi: number,
  sigma: number,
  games: GameRecord[],
): void {
  // ... hesaplamalar ...
  const newSigma = nextSigma(sigma, delta, v, phi, EPSILON);
  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * deltaNum;

  // Update cache (in-place)
  void { mu, phi, newSigma, phiPrime };
}
```

**Düzeltilmiş kod:**
```typescript
interface UpdatedRating {
  muPrime: number;
  phiPrime: number;
  newSigma: number;
}

function updateOneRating(
  mu: number,
  phi: number,
  sigma: number,
  games: GameRecord[],
): UpdatedRating {
  // 1. v (variance estimate)
  let v = 0;
  for (const g_ of games) {
    const e = expectedScore(mu, g_.muOpponent, g_.phiOpponent);
    v += g(g_.phiOpponent) * g(g_.phiOpponent) * e * (1 - e);
  }
  v = 1 / v;

  // 2. Δ (improvement)
  let deltaNum = 0;
  for (const g_ of games) {
    const e = expectedScore(mu, g_.muOpponent, g_.phiOpponent);
    deltaNum += g(g_.phiOpponent) * (g_.score - e);
  }
  const delta = v * deltaNum;

  // 3. New volatility
  const newSigma = nextSigma(sigma, delta, v, phi, EPSILON);

  // 4. phi*
  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);

  // 5. phi'
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  // 6. mu'
  const muPrime = mu + phiPrime * phiPrime * deltaNum;

  return { muPrime, phiPrime, newSigma };
}
```

**Ardından `updateGlicko2` fonksiyonunu güncelleyin (satır 88-116):**

Mevcut `updateGlicko2` fonksiyonunda `updateOneRating` çağrılarının sonuçlarını cache'e yazın:

```typescript
// Mevcut updateOneRating çağrılarını değiştirin:
// ESKİ: updateOneRating(muH, phiH, home.sigma, [...]);
// YENİ:
const homeResult = updateOneRating(muH, phiH, home.sigma, [
  { score: 1 - score, muOpponent: muA, phiOpponent: phiA },
]);
const awayResult = updateOneRating(muA, phiA, away.sigma, [
  { score: score, muOpponent: muH, phiOpponent: phiH },
]);

// Cache'e yaz
home.r = homeResult.muPrime * SCALE + 1500;
home.RD = Math.max(MIN_RD, homeResult.phiPrime * SCALE);
home.sigma = homeResult.newSigma;
home.lastUpdate = Date.now();

away.r = awayResult.muPrime * SCALE + 1500;
away.RD = Math.max(MIN_RD, awayResult.phiPrime * SCALE);
away.sigma = awayResult.newSigma;
away.lastUpdate = Date.now();

g2Cache.set(homeKey, home);
g2Cache.set(awayKey, away);
```

**Doğrulama:**
```bash
# Glicko-2 update testi yazın:
bun -e "
import { updateGlicko2, predictGlicko2 } from './src/lib/glicko2';
updateGlicko2('TeamA', 'TeamB', 1);
const pred = predictGlicko2('TeamA', 'TeamB');
console.log('Home win P:', pred.homeWinP);
// İlk update'ten sonra r != 1500 olmalı
"
```

---

### Fix 1. **[✓ UYGULANDI]**5: Pi-Rating predict sign hatası

**Dosya:** `src/lib/piRating.ts:134-136`
**Sorun:** Predict fonksiyonunda savunma terimleri yanlış işarette. `Ha + Ad` olmalı `Ha - Ad` (güçlü savunma → az gol).

**Mevcut kod (satır 134-136):**
```typescript
const homeOffAvg = (home.Ha + away.Ad) / 2;
const awayOffAvg = (away.Aa + home.Hd) / 2;
const goalDiffExpected = homeOffAvg - awayOffAvg + HOME_ADVANTAGE;
```

**Düzeltilmiş kod:**
```typescript
// Savunma terimleri çıkartılır: güçlü savunma → az beklenen gol
const homeOffAvg = (home.Ha - away.Ad) / 2;
const awayOffAvg = (away.Aa - home.Hd) / 2;
// HOME_ADVANTAGE update ile tutarlı (update'te gdExpected HA/2 içeriyor)
const goalDiffExpected = homeOffAvg - awayOffAvg + HOME_ADVANTAGE / 2;
```

**Doğrulama:**
```bash
# Update ve predict arasında tutarlılık testi:
bun -e "
import { updatePiRating, predictPi } from './src/lib/piRating';
// Güçlü home savunma takımı oluştur
updatePiRating('StrongDef', 'Weak', 0, 0); // 0-0 beraberlik
const pred = predictPi('StrongDef', 'Weak');
console.log('Home win:', pred.homeWinP, 'Draw:', pred.drawP);
// Güçlü savunma → düşük gol → beraberlik/düşük skor ağırlıklı olmalı
"
```

---

### Fix 1. **[✓ UYGULANDI]**6: Ensemble Brier map destructure hatası

**Dosya:** `src/lib/ensemble.ts:518-537`
**Sorun:** 7 değişken / 9 promise. Rule-Based'e GBDT Brier'ı, Poisson'a XGB Brier'ı atanıyor. Pi ve Glicko2 sonuçları kayboluyor.

**Mevcut kod (satır 517-537):**
```typescript
const brierMap: Record<string, number | null> = {};
try {
  const [rbBrier, poBrier, elBrier, mlBr, tsBrier, ipBrier, gapBrierDb] = await Promise.all([
    getChampionBrier('gbdt').catch(() => null),
    getChampionBrier('xgb').catch(() => null),
    null,
    getChampionBrier('gbdt').catch(() => null),
    getChampionBrier('team-strength').catch(() => null),
    getChampionBrier('inplay').catch(() => null),
    getMeasuredBrier('gap').catch(() => null),
    getMeasuredBrier('pi').catch(() => null),
    getMeasuredBrier('glicko2').catch(() => null),
  ]);
  brierMap['Rule-Based'] = rbBrier;
  brierMap['Poisson'] = poBrier;
  brierMap['Elo'] = null;
  brierMap['ML'] = mlBr;
  brierMap['TeamStrength'] = tsBrier;
  brierMap['InPlay5m'] = ipBrier;
  brierMap['GAP'] = gapBrierDb;
  brierMap['PiRating'] = await getMeasuredBrier('pi').catch(() => null);
  brierMap['Glicko2'] = await getMeasuredBrier('glicko2').catch(() => null);
} catch {}
```

**Düzeltilmiş kod:**
```typescript
const brierMap: Record<string, number | null> = {};
try {
  const [
    ruleBrier, poissonBrier, eloBrier, mlBrier,
    tsBrier, ipBrier, gapBrier, piBrier, glicko2Brier
  ] = await Promise.all([
    getMeasuredBrier('rule').catch(() => null),
    getMeasuredBrier('poisson').catch(() => null),
    null, // Elo has no champion Brier
    (async () => (await getChampionBrier('xgb')) ?? (await getChampionBrier('gbdt')))().catch(() => null),
    getChampionBrier('team-strength').catch(() => null),
    getChampionBrier('inplay').catch(() => null),
    getMeasuredBrier('gap').catch(() => null),
    getMeasuredBrier('pi').catch(() => null),
    getMeasuredBrier('glicko2').catch(() => null),
  ]);
  brierMap['Rule-Based'] = ruleBrier;
  brierMap['Poisson'] = poissonBrier;
  brierMap['Elo'] = eloBrier;
  brierMap['ML'] = mlBrier;
  brierMap['TeamStrength'] = tsBrier;
  brierMap['InPlay5m'] = ipBrier;
  brierMap['GAP'] = gapBrier;
  brierMap['PiRating'] = piBrier;
  brierMap['Glicko2'] = glicko2Brier;
} catch {}
```

**Doğrulama:**
```bash
# Ensemble predict sonrası weights kontrol:
curl -s 'http://localhost:3028/api/predict?action=predict&matchCode=123&home=Galatasaray&away=Fenerbahce&league=Süper Lig&minute=60&stats={}' | jq '.models[] | {name, weight}'
# Artık Rule-Based ve ML farklı Brier değerlerine sahip olmalı
```

---

### Fix 1. **[✓ UYGULANDI]**7: Calibration PAVA backward merge ekle

**Dosya:** `src/lib/calibration.ts:79-119`
**Sorun:** PAVA sadece ileri yönlü blok oluşturuyor, geriye birleştirme adımı eksik → azalan girdilerde non-monotonic çıktı.

**Mevcut kod (satır 79-119):** (yukarıda okundu)

**Düzeltilmiş kod:**
```typescript
function poolAdjacentViolators(xIn: number[], yIn: number[]): { x: number[]; y: number[] } {
  const pairs = xIn.map((x, i) => [x, yIn[i]] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const xs = pairs.map(p => p[0]);
  const ys: number[] = pairs.map(p => p[1]);

  // İleri yönlü blok oluşturma + geriye birleştirme (backward merge)
  const blockMeans: number[] = [];
  const blockSizes: number[] = [];
  let curMean = ys[0];
  let curSize = 1;
  for (let i = 1; i < ys.length; i++) {
    if (ys[i] >= curMean) {
      curMean = (curMean * curSize + ys[i]) / (curSize + 1);
      curSize++;
    } else {
      // Backward merge: önceki blok(lar)la birleştirilecek mi?
      blockMeans.push(curMean);
      blockSizes.push(curSize);
      curMean = ys[i];
      curSize = 1;
      // Geriye dönük birleştirme — monotonluk ihlali varsa
      while (blockMeans.length > 0 && blockMeans[blockMeans.length - 1] > curMean) {
        const prevMean = blockMeans.pop()!;
        const prevSize = blockSizes.pop()!;
        curMean = (curMean * curSize + prevMean * prevSize) / (curSize + prevSize);
        curSize = curSize + prevSize;
      }
    }
  }
  blockMeans.push(curMean);
  blockSizes.push(curSize);

  const calibrated = new Array<number>(xs.length);
  let idx = 0;
  for (let b = 0; b < blockMeans.length; b++) {
    for (let k = 0; k < blockSizes[b]; k++) {
      calibrated[idx++] = blockMeans[b];
    }
  }
  const outX: number[] = [];
  const outY: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (i === 0 || calibrated[i] !== outY[outY.length - 1]) {
      outX.push(xs[i]);
      outY.push(calibrated[i]);
    }
  }
  return { x: outX, y: outY };
}
```

**Test ekleyin:**
```typescript
// src/lib/__tests__/calibration.test.ts'ye ekle
test('PAVA handles non-monotonic input correctly', () => {
  // Azalan girdi: [0.9, 0.5, 0.1] → hepsi 0.5 olmalı (genel ortalama)
  const result = poolAdjacentViolators([1, 2, 3], [0.9, 0.5, 0.1]);
  expect(result.y.every(v => Math.abs(v - 0.5) < 0.01)).toBe(true);
});
```

**Doğrulama:**
```bash
bun test src/lib/__tests__/calibration.test.ts
# Non-monotonic test geçmeli
```

---

### Fix 1. **[✓ UYGULANDI]**8: Feedback loops sahte tahminleri kaldır

**Dosya:** `src/lib/feedbackLoops.ts:70-73`
**Sorun:** `onGoal` hardcoded 0.7/0.6/0.5 olasılıklarla sahte tahmin enjekte ediyor → online weight tuner gerçek verilerle değil sabit değerlerle eğitiliyor.

**Mevcut kod (satır 70-73):**
```typescript
recordPrediction('radar', 0.7, 1);
recordPrediction('poisson', 0.6, 1);
recordPrediction('elo', 0.5, 1);
```

**Düzeltilmiş kod:**
```typescript
// Gerçek model çıktılarını PredictionLog'dan çek (son kayıt)
try {
  const { db } = await import('./db');
  const recentLog = await db.predictionLog.findFirst({
    where: { matchCode: params.matchCode },
    orderBy: { createdAt: 'desc' },
  });
  if (recentLog) {
    if (recentLog.calibratedP != null) recordPrediction('rule', recentLog.calibratedP, 1);
    if (recentLog.poissonHomeP != null || recentLog.poissonAwayP != null) {
      recordPrediction('poisson', Math.max(recentLog.poissonHomeP ?? 0, recentLog.poissonAwayP ?? 0), 1);
    }
    if (recentLog.homeElo != null && recentLog.awayElo != null) {
      // Elo farkından basit goal probability
      const eloDiff = Math.abs(recentLog.homeElo - recentLog.awayElo);
      recordPrediction('elo', Math.min(0.85, 0.15 + eloDiff * 0.001), 1);
    }
  }
} catch { /* PredictionLog erişilemezse skip */ }
```

**Doğrulama:**
```bash
# Bir golden sonra weight tuner log'larını kontrol et:
# Öncesi: her golden sonra radar=0.7, poisson=0.6, elo=0.5
# Sonrası: gerçek model çıktıları kullanılmalı
```

---

### Fix 1. **[✓ UYGULANDI]**9: GAP Rating λ formülüne skaling ekle

**Dosya:** `src/lib/ml/gapRating.ts:294-295`
**Sorun:** `λ = exp(Ha - Ad)` maks exp(3) ≈ 20 gol — gerçekçi değil.

**Mevcut kod (satır 294-295):**
```typescript
const lambdaHome = Math.exp(home.Ha - away.Ad);
const lambdaAway = Math.exp(away.Aa - home.Hd);
```

**Düzeltilmiş kod:**
```typescript
// Skaling faktörü 3: maks exp(1) ≈ 2.72 (gerçekçi gol beklentisi)
const GAP_LAMBDA_SCALE = 3;
const lambdaHome = Math.exp((home.Ha - away.Ad) / GAP_LAMBDA_SCALE);
const lambdaAway = Math.exp((away.Aa - home.Hd) / GAP_LAMBDA_SCALE);
```

**Doğrulama:**
```bash
bun -e "
import { predictGapMatch, getGapState } from './src/lib/ml/gapRating';
const state = getGapState();
const pred = predictGapMatch(state, 'TeamA', 'TeamB');
console.log('lambdaHome:', pred.lambdaHome, 'lambdaAway:', pred.lambdaAway);
// Değerler 0-3 arası olmalı (öncesi 0-20 arası)
"
```

---

### Fix 1. **[✓ UYGULANDI]**10: Goal Radar xG modelini tekille

**Dosya:** `src/lib/goalRadar/factors.ts:86-104` ve `src/lib/goalRadar.ts:123`
**Sorun:** Sistem aynı anda iki farklı xG modeli kullanıyor (şişirilmiş eski + kalibreli yeni).

**Mevcut kod (factors.ts:86-104):**
```typescript
export function calcExpectedGoals(stats: MatchStats): { home: number; away: number } {
  // ... şişirilmiş SOT*0.38 formülü
}
```

**Düzeltme:** `calcExpectedGoals` fonksiyonunu `estimateXgFromShotsBoth` kullanacak şekilde değiştirin.

**Düzeltilmiş kod (factors.ts:86-104):**
```typescript
export function calcExpectedGoals(stats: MatchStats): { home: number; away: number } {
  // estimateXg.ts'deki kalibreli modeli kullan — tek xG kaynağı
  try {
    const { estimateXgFromShotsBoth } = require('./estimateXg');
    return estimateXgFromShotsBoth(stats, 90);
  } catch {
    // Fallback: basit SOT tabanlı (eski formül ama clamp'li)
    const homeSot = stats.shots_on_target?.home ?? 0;
    const awaySot = stats.shots_on_target?.away ?? 0;
    const homeOff = Math.max(0, (stats.shots_total?.home ?? 0) - homeSot);
    const awayOff = Math.max(0, (stats.shots_total?.away ?? 0) - awaySot);
    return {
      home: Math.min(5, homeSot * 0.085 + homeOff * 0.015),
      away: Math.min(5, awaySot * 0.085 + awayOff * 0.015),
    };
  }
}
```

**Ardından `goalRadar.ts:123`'te de aynı değişiklik:** (zaten `calcExpectedGoals` çağrılıyor, factors.ts import'u kullanıyor, ek değişiklik gerekmez).

**Doğrulama:**
```bash
bun -e "
import { calcExpectedGoals } from './src/lib/goalRadar/factors';
import { estimateXgFromShotsBoth } from './src/lib/estimateXg';
const stats = { shots_on_target: { home: 5, away: 3 }, shots_total: { home: 12, away: 8 } };
const a = calcExpectedGoals(stats);
const b = estimateXgFromShotsBoth(stats, 90);
console.log('factors xG:', a, 'estimateXg:', b);
// İki değer yakın olmalı
"
```

---

## FAZ 2: YÜKSEK ÖNCELİK MODEL KALİTESİ DÜZELTMELERİ **(✓ TAMAM — 10/10)**

### Fix 2. **[✓ UYGULANDI]**1: Goal Radar F2 asimetrik kapak düzeltme

**Dosya:** `src/lib/goalRadar/factors.ts:47,54`
**Sorun:** Ev 10, deplasman 14 — deplasman %40 fazla puan alıyor.

**Mevcut kod (satır 47):**
```typescript
r.homePts = Math.min(10, Math.round(rate * 3.5));
```
**Mevcut kod (satır 54):**
```typescript
r.awayPts = Math.min(14, Math.round(rate * 3.5));
```

**Düzeltilmiş kod (satır 47):**
```typescript
r.homePts = Math.min(12, Math.round(rate * 3.5));
```
**Düzeltilmiş kod (satır 54):**
```typescript
r.awayPts = Math.min(12, Math.round(rate * 3.5));
```

---

### Fix 2. **[✓ UYGULANDI]**2: Goal Radar calibratedP timing düzeltme

**Dosya:** `src/lib/goalRadar.ts:331-334`
**Sorun:** `calibratedP` FotMob zenginleştirmesinden önceki `finalScore` ile hesaplanıyor.

**Mevcut kod (satır 331-334):**
```typescript
// ── Calibrated probability ────────────────────────────────────
let calibratedP: number;
try { calibratedP = calibrateScore(finalScore); }
catch { calibratedP = 0.5; }
```

**Düzeltme:** Bu bloğu satır 408 sonrasına taşıyın (FotMob zenginleştirmesi ve son clamp'ten sonra).

**Silin (satır 331-334)** ve **satır 408 sonrasına ekleyin** (son clamp'ten sonra):
```typescript
// ── Calibrated probability (FotMob sonrası final score ile) ──
let calibratedP: number;
try { calibratedP = calibrateScore(finalFinalScore); }
catch { calibratedP = 0.5; }
```

---

### Fix 2. **[✓ UYGULANDI]**3: Dixon-Coles corrector κ<0 işaret düzeltme

**Dosya:** `src/lib/dixonColesCorrector.ts:79`
**Sorun:** κ<0 dalı eşit-olmayan skorları boost ediyor — yorumun tersi.

**Mevcut kod (satır 74-79):**
```typescript
} else if (kappa < 0) {
  // Positive correlation: equal-scoring cells boost.
  const ratio = Math.abs(h - a) / (1 + Math.min(h, a));
  w = Math.exp(-kappa * ratio); // kappa<0 ise -kappa>0, ratio büyüdükçe w büyür
```

**Düzeltilmiş kod:**
```typescript
} else if (kappa < 0) {
  // Positive correlation: equal-scoring cells boost, unequal cells suppressed.
  // kappa<0 → exp(kappa * ratio) < 1 for ratio > 0 (unequal scores suppressed)
  const ratio = Math.abs(h - a) / (1 + Math.min(h, a));
  w = Math.exp(kappa * ratio); // kappa<0: ratio>0 → w<1 (unequal suppressed)
```

---

### Fix 2. **[✓ UYGULANDI]**4: Dixon-Coles rho ve gamma'yı parametrik yap

**Dosya:** `src/lib/dixonColes.ts:134-135`
**Sorun:** `rho: 0` ve `gamma: 1.30` sabit → Dixon-Coles τ düzeltmesi devre dışı.

**Mevcut kod (satır 134-135):**
```typescript
rho: 0,
gamma: 1.30,
```

**Düzeltilmiş kod:**
```typescript
rho: rho ?? -0.13,  // Dixon-Coles standard correlation parameter
gamma: effectiveGamma,
```

**Ayrıca dönüş değerini düzeltin (satır 135):**
```typescript
// gamma: effectiveGamma (parametre veya lig default'u)
// rho: rho parametresi veya default -0.13
```

**Test güncelleme:** `src/lib/__tests__/dixonColes.test.ts` satır 53-54, 65, 70 — stale testleri güncelleyin:
```typescript
// Satır 53-54: rho: -0.13, gamma: lig default (1.10 Premier League)
// Satır 65: gamma: 1.10 (LEAGUE_GAMMA fallback)
// Satır 70: gamma: 1.5 (explicit override)
```

---

### Fix 2. **[✓ UYGULANDI]**5: Elo draw probability'yi rating farkından türet

**Dosya:** `src/lib/eloRating.ts:186`
**Sorun:** `eDraw = 0.25` sabit — rating farkından bağımsız.

**Mevcut kod (satır 186):**
```typescript
const eDraw = 0.25;
```

**Düzeltilmiş kod:**
```typescript
// Draw probability rating farkından türetilir
// Eşit takımlar (diff=0): ~0.30, 200 fark: ~0.10, 400+ fark: ~0.05
const ratingDiff = Math.abs(homeR - awayR);
const eDraw = Math.max(0.05, 0.30 * Math.exp(-ratingDiff / 300));
```

---

### Fix 2. **[✓ UYGULANDI]**6: Kalman residual düzeltme

**Dosya:** `src/lib/ml/teamStrengthKalman.ts:137`
**Sorun:** Residual λ'ye bölünüyor — log-uzayda `(obs-λ)` olmalı.

**Mevcut kod (satır 137):**
```typescript
const r = (observed - expMean) / expMean;
```

**Düzeltilmiş kod:**
```typescript
// Log-uzayda residual: observed - expected (λ)
// Score function: d/dλ logL = (obs/λ) - 1 = (obs - λ) / λ
// Ama Kalman update log-uzayda mean + K * (obs - λ) yapmalı
// (obs - λ) / λ score function, ama gain log-uzay için raw residual gerekir
const r = observed - expMean;
```

---

### Fix 2. **[✓ UYGULANDI]**7: Calibration train/val split ters çevir

**Dosya:** `src/lib/calibration.ts:310-322`
**Sorun:** `orderBy: desc` + `slice(0, midpoint)` = yeni veri train, eski val → look-ahead bias.

**Mevcut kod (satır 310-322):**
```typescript
const logs = await db.predictionLog.findMany({
  where: { goalScored: { not: null } },
  select: { rawScore: true, calibratedP: true, goalScored: true },
  orderBy: { createdAt: "desc" },
  take: 10000,
});

if (logs.length < 50) return null;

const midpoint = Math.floor(logs.length * 0.8);
const trainLogs = logs.slice(0, midpoint);
const valLogs = logs.slice(midpoint);
```

**Düzeltilmiş kod:**
```typescript
const logs = await db.predictionLog.findMany({
  where: { goalScored: { not: null } },
  select: { rawScore: true, calibratedP: true, goalScored: true, createdAt: true },
  orderBy: { createdAt: "asc" }, // Eskiden yeniye sırala
  take: 10000,
});

if (logs.length < 50) return null;

const midpoint = Math.floor(logs.length * 0.8);
const trainLogs = logs.slice(0, midpoint);  // Eski veri → train
const valLogs = logs.slice(midpoint);        // Yeni veri → validation
```

---

### Fix 2. **[✓ UYGULANDI]**8: Sentetik label oranını kalibre et

**Dosya:** `src/lib/goalPredictor.ts:486-490`
**Sorun:** Sentetik veri %30-40 gol oranı üretiyor (gerçek ~%14).

**Mevcut kod (satır 486-490):**
```typescript
const baseGoalP = (2.5 / 9) * (10 / 90);
const adjustedP = baseGoalP * timeFactor * (1 + xgRate * 0.8) * (1 + pressureIntensity * 0.3);
const label = rng() < Math.min(0.7, adjustedP * 10) ? 1 : 0;
```

**Düzeltilmiş kod:**
```typescript
// Gerçek gol oranı ~%14 (10-dk pencere, takım başına)
const baseGoalP = 0.14 * (10 / 90);
const adjustedP = baseGoalP * timeFactor * (1 + xgRate * 0.5) * (1 + pressureIntensity * 0.2);
// Cap 0.25 (öncesi 0.7 çok yüksekti)
const label = rng() < Math.min(0.25, adjustedP * 10) ? 1 : 0;
```

---

### Fix 2. **[✓ UYGULANDI]**9: Ensemble stoppage time parse düzeltme

**Dosya:** `src/lib/ensemble.ts:136`
**Sorun:** `"45+2"` → 452 (regex tüm sayıları birleştiriyor). `parseMinute` kullanılmıyor.

**Mevcut kod (satır 136):**
```typescript
let minNum = parseInt(minute.replace(/[^0-9]/g, ""), 10);
```

**Düzeltilmiş kod:**
```typescript
// parseMinute kullan — stoppage time "45+2" → 47 doğru handle edilir
import { parseMinute } from './goalSignalTracker';
let minNum = parseMinute(minute);
```

**Doğrulama:** Import' dosya başına ekleyin. Eğer `parseMinute` export edilmiyorsa, `goalSignalTracker.ts`'te export edildiğinden emin olun.

---

### Fix 2. **[✓ UYGULANDI]**10: Signal unique constraint ekle

**Dosya:** `prisma/schema.prisma:270`
**Sorun:** `(matchCode, date, signalSide)` index var ama unique değil → duplicate pending sinyaller.

**Mevcut kod (satır 270):**
```prisma
@@index([matchCode, date, signalSide])
```

**Düzeltilmiş kod — partial unique index ekleyin (pending sinyaller için):**

Schema'ya şu satırı ekleyin (satır 270 sonrası):
```prisma
// Pending sinyaller için unique constraint (goalHappened null iken)
// Doğrulama: Prisma partial unique index desteklemez, raw SQL kullanın
```

**Prisma migration yerine raw SQL kullanın:**
```sql
-- prisma/migrations/add_signal_pending_unique/migration.sql
CREATE UNIQUE INDEX "signal_pending_unique" ON "Signal"("matchCode", "date", "signalSide") WHERE "goalHappened" IS NULL;
```

**Uygulama:**
```bash
# Önce duplicate'leri temizle
psql -c "DELETE FROM \"Signal\" s1 USING \"Signal\" s2 WHERE s1.id > s2.id AND s1.\"matchCode\" = s2.\"matchCode\" AND s1.date = s2.date AND s1.\"signalSide\" = s2.\"signalSide\" AND s1.\"goalHappened\" IS NULL AND s2.\"goalHappened\" IS NULL;"

# Sonra unique index oluştur
psql -c 'CREATE UNIQUE INDEX "signal_pending_unique" ON "Signal"("matchCode", "date", "signalSide") WHERE "goalHappened" IS NULL;'

# Prisma client regenerate
bunx prisma generate
```

---

## FAZ 3: GÜVENLİK DÜZELTMELERİ **(✓ TAMAM — 7/7)**

### Fix 3. **[✓ UYGULANDI]**1: ML Trainer auth ekle

**Dosya:** `mini-services/ml-trainer/app.py`
**Sorun:** Tüm endpoint'ler auth olmadan açık.

**Çözüm:** FastAPI middleware ekle:

```python
# app.py başına ekle (import'lardan sonra)
import os
from fastapi import Request, HTTPException

TRAINER_KEY = os.environ.get("TRAINER_KEY", "")

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    # Health check açık kalsın
    if request.url.path == "/healthz":
        return await call_next(request)
    # Auth kontrol
    if TRAINER_KEY:
        provided = request.headers.get("x-trainer-key", "")
        if provided != TRAINER_KEY:
            raise HTTPException(status_code=401, detail="Unauthorized")
    return await call_next(request)
```

**docker-compose.coolify.yml'e ekle:**
```yaml
ml-trainer:
  environment:
    TRAINER_KEY: "${TRAINER_KEY:-}"
```

---

### Fix 3. **[✓ UYGULANDI]**2: SSRF kapat (netscores-proxy)

**Dosya:** `mini-services/ml-trainer/app.py:385-415`
**Sorun:** Arbitrary URL fetch, private IP'lere erişim.

**Düzeltme:** URL allowlist + private IP blok:

```python
@app.post("/netscores-proxy")
def netscores_proxy(req: NetscoresProxyRequest) -> Dict[str, Any]:
    """Fetch a URL via curl_cffi — restricted to allowed domains."""
    import ipaddress
    from urllib.parse import urlparse

    ALLOWED_DOMAINS = {"netscores.com", "www.netscores.com"}
    parsed = urlparse(req.url)
    
    # Domain kontrol
    if parsed.hostname not in ALLOWED_DOMAINS:
        return {"ok": False, "error": "Domain not allowed"}
    
    # Private IP blok
    try:
        ip = ipaddress.ip_address(parsed.hostname)
        if ip.is_private or ip.is_loopback or ip.is_link_local:
            return {"ok": False, "error": "Private IP blocked"}
    except ValueError:
        pass  # hostname, IP değil — domain kontrol yeterli

    try:
        from curl_cffi import requests
        result = requests.get(
            req.url,
            impersonate="chrome124",
            timeout=req.timeout_ms / 1000,
            headers={
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Accept-Language": "en-US,en;q=0.9",
                "Referer": "https://www.netscores.com/",
                "Origin": "https://www.netscores.com",
            },
        )
        if result.status_code != 200:
            return {"ok": False, "status": result.status_code}
        return {"ok": True, "data": result.json()}
    except ImportError:
        return {"ok": False, "error": "curl_cffi not installed"}
    except Exception:
        return {"ok": False, "error": "Fetch failed"}
```

---

### Fix 3. **[✓ UYGULANDI]**3: Path traversal kapat (/promote)

**Dosya:** `mini-services/ml-trainer/app.py:416-443`
**Sorun:** `name` ve `version` path'e direkt gömülüyor.

**Düzeltme:** Sanitize:

```python
import re

@app.post("/promote")
def promote(req: PromoteRequest) -> Dict[str, Any]:
    # Sanitize name ve version — sadece alphanumeric + dash + dot
    if not re.match(r'^[a-z0-9-]+$', req.name):
        return {"ok": False, "error": "Invalid name"}
    if not re.match(r'^[0-9]+(\.[0-9]+)*$', req.version):
        return {"ok": False, "error": "Invalid version"}
    
    # ... mevcut promote mantığı ...
```

---

### Fix 3. **[✓ UYGULANDI]**4: GET finalize → POST + auth

**Dosya:** `src/app/api/goal-signals/route.ts:165-177`
**Sorun:** GET ile state-changing operation, auth yok.

**Düzeltme:** `finalize` action'ını POST handler'a taşı ve admin auth ekle:

```typescript
// GET handler'dan finalize bloğunu SİL (satır 165-177)

// POST handler'a ekle:
if (action === "finalize") {
  // Admin auth kontrol
  const { requireAdmin } = await import('@/lib/adminRoute');
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const matchCode = asInt(body.matchCode);
  if (!matchCode) {
    return NextResponse.json({ error: "matchCode required" }, { status: 400 });
  }
  const homeScore = asInt(body.homeScore);
  const awayScore = asInt(body.awayScore);
  if (homeScore === null || awayScore === null) {
    return NextResponse.json({ error: "homeScore and awayScore required" }, { status: 400 });
  }
  await finalizeMatchSignals(matchCode, homeScore, awayScore);
  return NextResponse.json({ ok: true, matchCode });
}
```

**Doğrulama:** Frontend'de `finalize` çağrısını GET'ten POST'a güncelleyin:
```typescript
// src/app/page.tsx'deki finalize çağrısı
// ESKİ: fetch(`/api/goal-signals?action=finalize&matchCode=${m.code}&homeScore=${m.homeGoals}&awayScore=${m.awayGoals}`)
// YENİ:
fetch('/api/goal-signals', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'finalize', matchCode: m.code, homeScore: m.homeGoals, awayScore: m.awayGoals }),
})
```

---

### Fix 3. **[✓ UYGULANDI]**5: Cron secret timingSafeEqual

**Dosya:** `src/app/api/cron/poll/route.ts:73-81`
**Sorun:** `header === secret` timing-safe değil.

**Mevcut kod (satır 73-81):**
```typescript
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  const header = request.headers.get("x-cron-secret");
  return header === secret;
}
```

**Düzeltilmiş kod:**
```typescript
import crypto from 'crypto';

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  const header = request.headers.get("x-cron-secret") ?? "";
  if (header.length !== secret.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(secret));
  } catch {
    return false;
  }
}
```

---

### Fix 3. **[✓ UYGULANDI]**6: Rate limit public rotalara uygula

**Dosya:** `src/app/api/matches/route.ts` (başına ekle)
**Sorun:** `/api/matches` rate limit yok.

**Düzeltme:** Route'un başına rate limit ekle:

```typescript
import { rateLimit, RATE_LIMIT_DEFAULTS } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/securityHelpers";

export async function GET(request: Request) {
  // Rate limit
  const ip = getClientIp(request);
  const rl = rateLimit(`matches:${ip}`, RATE_LIMIT_DEFAULTS.relaxed);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", resetMs: rl.resetMs },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetMs / 1000)) } }
    );
  }
  // ... mevcut kod ...
```

**Aynı düzeltmeyi şu rotalara da uygulayın:**
- `src/app/api/upcoming-matches/route.ts`
- `src/app/api/finished-matches/route.ts`
- `src/app/api/health/route.ts` (strict limit)

---

### Fix 3. **[✓ UYGULANDI]**7: Cron POST pipeline token ekle

**Dosya:** `src/app/api/cron/poll/route.ts` (POST handler)
**Sorun:** `X-Pipeline-Source` header'ına güveniyor, ikinci auth faktörü yok.

**Düzeltme:** Pipeline source kontrolüne ek token ekle:

```typescript
// POST handler'da pipeline source kontrolünü güncelle:
const pipelineToken = process.env.PIPELINE_TOKEN;
const providedToken = request.headers.get("x-pipeline-token");
if (pipelineToken && providedToken !== pipelineToken) {
  return NextResponse.json({ error: "Invalid pipeline token" }, { status: 403 });
}
```

**docker-compose.coolify.yml'e ekle:**
```yaml
golradar:
  environment:
    PIPELINE_TOKEN: "${PIPELINE_TOKEN}"
pipeline:
  environment:
    PIPELINE_TOKEN: "${PIPELINE_TOKEN}"
```

**mini-services/pipeline-service/index.ts'de fetch çağrısına ekle:**
```typescript
headers: {
  "X-Cron-Secret": CRON_SECRET,
  "X-Pipeline-Source": "websocket",
  "X-Pipeline-Token": process.env.PIPELINE_TOKEN || "",
}
```

---

## FAZ 4: ORTA/DÜŞÜK ÖNCELİK DÜZELTMELERİ **(KISMİ — 12/20 uygulandı, 8 backlog)**

### Fix 4.1 **[✓ UYGULANDI]**: Goal Radar F16 kontra-atak mantığı düzelt

**Dosya:** `src/lib/goalRadar/factors.ts:371`
**Sorun:** `awaySOTDelta >= 1` ev kontra-atak koşulunda — `homeSOTDelta` olmalı.

```typescript
// ESKİ: if (homeDADelta >= 3 && homePossDrop > 10 && awaySOTDelta >= 1) {
// YENİ: if (homeDADelta >= 3 && firstHomePoss < 45 && homeSOTDelta >= 1) {
```

### Fix 4.2 **[✓ UYGULANDI]**: Goal Radar F12 pencere/bölme hatası

**Dosya:** `src/lib/goalRadar/factors.ts:266`
```typescript
// ESKİ: const window5min = pressureHistory.slice(-60);
// YENİ: const window5min = pressureHistory.slice(-10); // 5 dk @ 30s poll
```

### Fix 4.3 **[✓ UYGULANDI]**: Goal Radar FotMob xG'dan sonra goalProbability5min güncelle

**Dosya:** `src/lib/goalRadar.ts:386 sonrası`
```typescript
// FotMob xG boost'undan sonra 5-min gate'i yeniden hesapla
if (fXgH > xg.home || fXgA > xg.away) {
  try {
    const newXgHome = Math.max(xg.home, fXgH);
    const newXgAway = Math.max(xg.away, fXgA);
    goalProbability5min = Math.min(0.95, 1 - Math.exp(-Math.max(0, (newXgHome + newXgAway) * 5)));
  } catch { /* fallback */ }
}
```

### Fix 4.4 **[✓ UYGULANDI]**: Elo K-faktör compounding düzelt

**Dosya:** `src/lib/eloRating.ts:99-101`
```typescript
// ESKİ: if (goalDiff >= 2) k *= ...; if (goalDiff >= 4) k *= ...; if (goalDiff >= 6) k *= ...;
// YENİ: else if zinciri:
if (goalDiff >= 6) k *= 1.2;
else if (goalDiff >= 4) k *= 1.15;
else if (goalDiff >= 2) k *= 1 + (goalDiff - 1) * 0.15;
```

### Fix 4.5 **[✓ UYGULANDI]**: Glicko-2'yi teamRatingUpdater'a bağla

**Dosya:** `src/lib/teamRatingUpdater.ts:42-44`
```typescript
// Mevcut Pi-Rating replay'e Glicko-2 ekle:
for (const r of newMatches) {
  updatePiRating(r.homeTeam, r.awayTeam, r.homeGoals, r.awayGoals);
  updateGlicko2(r.homeTeam, r.awayTeam, r.homeGoals > r.awayGoals ? 1 : r.homeGoals < r.awayGoals ? 0 : 0.5);
}
```

### Fix 4.6: Pi-Rating ve Glicko-2 DB persistans

**Prisma schema'ya ekle:**
```prisma
model TeamPiRating {
  teamName  String   @id
  Ha        Float    @default(0)
  Hd        Float    @default(0)
  Aa        Float    @default(0)
  Ad        Float    @default(0)
  matches   Int      @default(0)
  lastUpdated DateTime @updatedAt
}

model TeamGlicko2Rating {
  teamName    String   @id
  r           Float    @default(1500)
  RD          Float    @default(350)
  sigma       Float    @default(0.06)
  lastUpdate  DateTime @default(now())
}
```

**Uygulama:** `piRating.ts` ve `glicko2.ts`'te cache read/write işlemlerini DB'ye taşıyın.

### Fix 4.7 **[✓ UYGULANDI]**: Stacking default α=0.0 yap

**Dosya:** `src/lib/ensemble.ts:591`
```typescript
// ESKİ: const stackingAlpha = parseFloat(process.env.STACKING_BLEND_ALPHA ?? '0.5');
// YENİ: const stackingAlpha = parseFloat(process.env.STACKING_BLEND_ALPHA ?? '0.0');
```

### Fix 4.8 **[✓ UYGULANDI]**: Weight tuner online metric: accuracy → Brier

**Dosya:** `src/lib/ml/weightTuner.ts:257`
```typescript
// ESKİ: const correct = (predicted > 0.5) === (actual === 1);
// YENİ: const brier = Math.pow(predicted - actual, 2);
// Accuracy yerine Brier kullan
```

### Fix 4.9: Ensemble modelleri Promise.all ile paralel

**Dosya:** `src/lib/ensemble.ts`
**Sorun:** 9 model sıralı çağrılıyor.

**Düzeltme:** Model 2-9'u gruplayıp `Promise.all` ile paralel çalıştırın. Bu büyük bir refaktör — ayrı bir task olarak planlayın.

### Fix 4.10: ML Trainer HPO ekle (Optuna)

**Dosya:** `mini-services/ml-trainer/app.py`
```python
# _run_training_job içine ekle:
try:
    import optuna
    study = optuna.create_study(direction="minimize", sampler=optuna.samplers.RandomSampler(seed=42))
    study.optimize(lambda trial: objective(trial, X_train, y_train), n_trials=20)
    best_params = study.best_params
except ImportError:
    best_params = {}  # Optuna yoksa default kullan
```

### Fix 4.11: ML Trainer k-fold CV ekle

**Dosya:** `mini-services/ml-trainer/app.py:170-179`
```python
# ESKİ: tek train_test_split
# YENİ: TimeSeriesSplit
from sklearn.model_selection import TimeSeriesSplit
tscv = TimeSeriesSplit(n_splits=5)
brier_scores = []
for train_idx, test_idx in tscv.split(X):
    X_train, X_test = X[train_idx], X[test_idx]
    y_train, y_test = y[train_idx], y[test_idx]
    model.fit(X_train, y_train)
    pred = model.predict_proba(X_test)[:, 1]
    brier_scores.append(np.mean((pred - y_test) ** 2))
avg_brier = np.mean(brier_scores)
```

### Fix 4.12: LightGBM early stopping fix

**Dosya:** `mini-services/ml-trainer/app.py:203`
```python
# ESKİ: model.fit(X_train, y_train, eval_set=[(X_test, y_test)])
# YENİ: 
import lightgbm as lgb
model.fit(
    X_train, y_train,
    eval_set=[(X_test, y_test)],
    callbacks=[lgb.early_stopping(stopping_rounds=50)],
)
```

### Fix 4.13: statsbombpy requirements'a ekle

**Dosya:** `mini-services/ml-trainer/requirements.txt`
```
# Ekle:
statsbombpy==1.16.*
```

### Fix 4.14: Multi-stage Dockerfile

**Dosya:** `mini-services/ml-trainer/Dockerfile`
```dockerfile
# Stage 1: Builder
FROM python:3.12-slim AS builder
RUN apt-get update && apt-get install -y gcc g++ && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Stage 2: Runtime
FROM python:3.12-slim AS runtime
RUN apt-get update && apt-get install -y libgomp1 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY app.py .
RUN useradd -m trainer
USER trainer
EXPOSE 9100
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "9100"]
```

### Fix 4.15: Dead code cleanup

**Silinecek dosyalar/kodlar:**
1. `src/lib/signalVerdict.ts` — `forceVerdict` hiç çağrılmıyor (entegre et veya sil)
2. `src/lib/signalThesis.ts` — in-memory Map, DB persist yok (entegre et veya sil)
3. `src/lib/simulationMetrics.ts` — hiç import edilmiyor (sil)
4. `mini-services/nesine-live/` — docker-compose'da yok (sil)

### Fix 4.16 **[✓ UYGULANDI]**: "LSTM" adını düzelt

**Dosya:** `src/lib/ml/trendLSTM.ts`
```typescript
// Dosya adını trendHeuristic.ts olarak değiştir
// Tüm import'ları güncelle
// "LSTM" referanslarını "Trend Heuristic" olarak değiştir
```

### Fix 4.17 **[✓ UYGULANDI]**: Goaloo team:'home' hardcoded düzelt

**Dosya:** `src/lib/goaloo.ts:763`
```typescript
// ESKİ: team: 'home', // Need match context
// YENİ: Goal event'ten home/away çıkar (score delta veya takım adı match)
const isHome = event.homeScore > event.awayScore; // veya takım adı karşılaştırması
team: isHome ? 'home' : 'away',
```

### Fix 4.18 **[✓ UYGULANDI]**: Cron isLive filter ACTIVE_STATUSES ile hizala

**Dosya:** `src/app/api/cron/poll/route.ts:121`
```typescript
// ESKİ: if (status === 4 || status === 5 || status === 6 || status === 7) {
// YENİ: import { ACTIVE_STATUSES } from '@/lib/nesine';
// if (ACTIVE_STATUSES.has(status)) {
```

### Fix 4.19 **[✓ UYGULANDI]**: Dominant model 9 model'e genişlet

**Dosya:** `src/lib/ensemble.ts:661-669`
```typescript
// modelWeights array'ine PiRating ve Glicko2 ekle:
const modelWeights = [
  { name: "Rule-Based", weight: weights.ruleBased * ruleBasedP },
  { name: "Poisson", weight: weights.poisson * poissonP },
  { name: "Elo", weight: weights.elo * eloP },
  { name: "ML", weight: weights.ml * mlP },
  { name: "TeamStrength", weight: weights.teamStrength * teamStrengthP },
  { name: "InPlay5m", weight: weights.inplay * inPlayP },
  { name: "GAP", weight: weights.gap * gapP },
  { name: "PiRating", weight: piRatingP }, // BMA weight kullanılmıyor ama katkı
  { name: "Glicko2", weight: glicko2P },
];
```

### Fix 4.20 **[✓ UYGULANDI]**: Agreement 9 model'e genişlet

**Dosya:** `src/lib/ensemble.ts:573`
```typescript
// ESKİ: const allPredictions = [ruleBasedP, poissonP, eloP, mlP].filter((p) => p > 0.01);
// YENİ: const allPredictions = [ruleBasedP, poissonP, eloP, mlP, teamStrengthP, inPlayP, gapP, piRatingP, glicko2P].filter((p) => p > 0.01);
```

---

## TEST VE DOĞRULAMA PLANI

### Her Faz Sonrası Çalıştırılacak Testler

```bash
# Faz 1 sonrası:
bun test                                    # Tüm testler
bunx tsc --noEmit                          # Type check
bun -e "console.log('XGBoost base_score test passed')"  # Quick smoke test

# Faz 2 sonrası:
bun test
bunx tsc --noEmit
bunx prisma db push                        # Schema değişiklikleri
curl -s http://localhost:3028/api/health   # Health check

# Faz 3 sonrası:
bun test
# Güvenlik testleri:
curl -s -o /dev/null -w "%{http_code}" http://localhost:3028/api/matches  # 200 (rate limit içinde)
# 100+ hızlı istek at → 429 beklenir
for i in $(seq 1 100); do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3028/api/matches; done
# ML trainer auth test:
curl -s -o /dev/null -w "%{http_code}" http://localhost:9100/train -X POST  # 401 beklenir

# Faz 4 sonrası:
bun test
bunx tsc --noEmit
pytest mini-services/ml-trainer/tests/     # Python testleri
```

### Kritik Doğrulama Senaryoları

1. **XGBoost base_score düzeltme:**
```bash
# Öncesi: predictXgb boş feature → ~0.62
# Sonrası: predictXgb boş feature → ~0.50
bun -e "
import { loadXgbModel, predictXgb } from './src/lib/ml/xgbLoader';
// Model yükle ve boş feature ile predict
"
```

2. **Glicko-2 update çalışıyor:**
```bash
# Öncesi: update sonrası r=1500 (değişmiyor)
# Sonrası: update sonrası r != 1500
bun -e "
import { updateGlicko2, predictGlicko2 } from './src/lib/glicko2';
updateGlicko2('A', 'B', 1);
const p = predictGlicko2('A', 'B');
console.assert(p.homeWinP !== 0.5, 'Glicko-2 update çalışmıyor!');
"
```

3. **Pi-Rating sign düzeltme:**
```bash
# Güçlü savunma takımı → düşük gol beklentisi
bun -e "
import { updatePiRating, predictPi } from './src/lib/piRating';
// Bir takımı güçlü savunma olarak eğit
for (let i = 0; i < 100; i++) updatePiRating('StrongDef', 'Weak', 0, 0);
const p = predictPi('StrongDef', 'Weak');
console.log('Home win:', p.homeWinP);
// Güçlü savunma → beraberlik/düşük skor olmalı
"
```

4. **Brier map düzeltme:**
```bash
# Ensemble predict sonrası weights kontrol
curl -s 'http://localhost:3028/api/predict?action=predict&matchCode=1&home=A&away=B&league=test&minute=60&stats=%7B%7D' | jq '.models[] | {name, weight}'
# Rule-Based ve ML farklı weight'lere sahip olmalı
```

---

## ÖZEL DURUMLAR VE DİKKAT EDİLECEKLER

1. **`deserializeTeamStrength` fonksiyonu:** `teamStrengthKalman.ts`'te bu fonksiyonun var olduğundan emin olun. Yoksa ekleyin (Fix 1.3'te kod verildi).

2. **`parseMinute` export:** `goalSignalTracker.ts`'te `parseMinute` fonksiyonunun export edildiğinden emin olun (Fix 2.9 için gerekli).

3. **Prisma partial unique index:** Prisma natively partial unique index desteklemez. Raw SQL ile oluşturun (Fix 2.10).

4. **Frontend finalize çağrısı:** `src/app/page.tsx`'teki `finalize` GET çağrısı POST'a güncellenmeli (Fix 3.4).

5. **Environment variables:** Yeni env var'lar eklendi (TRAINER_KEY, PIPELINE_TOKEN). `.env.example` ve `.env.coolify.example` dosyalarını güncelleyin.

6. **Python test:** `statsbombpy` eklendikten sonra `pytest mini-services/ml-trainer/tests/` çalıştırın.

7. **Migration sırası:** Faz 2'deki schema değişiklikleri (Fix 2.10, 4.6) için önce duplicate'leri temizleyin, sonra unique index oluşturun.

8. **Config güncellemeleri:** `src/config.ts`'te `DEFAULT_CALIBRATION_PARAMS.L` ve `x0` değerlerini test beklentileriyle senkronize edin (test'ler 0.95 ve >40 bekliyor, config 0.90 ve 30 veriyor).

---

## FAZ ÖNCELİK SIRASI VE TAHMİNİ SÜRE

| Faz | Fix Sayısı | Tahmini Süre | Etki |
|-----|-----------|--------------|------|
| **Faz 1** | 10 | 1-2 gün | Kalibrasyon drift'ini durdurur, 3 modeli hayata döndürür |
| **Faz 2** | 10 | 3-5 gün | Model kalitesini artırır, kalibrasyon doğruluğunu düzeltir |
| **Faz 3** | 7 | 1-2 gün | Güvenlik açıklarını kapatır |
| **Faz 4** | 20 | 2-4 hafta | Orta/low priority, teknik borç cleanup |
| **TOPLAM** | 47 | ~5-6 hafta | Tam sistem düzeltmesi |

**Doğrulama:** Faz 1'in 10 düzeltmesi (~50 satır değişiklik) ensemble'a 3 gerçek bağımsız sinyal daha kazandırır (Glicko-2, Pi-Rating, Kalman) ve XGBoost bias'ını %12 düzeltir. Bu, tahmin kalitesinde ölçülebilir bir Brier iyileşmesi sağlar.

---

## BAŞARI KRİTERLERİ

Faz 1-3 tamamlandıktan sonra:

1. ✅ XGBoost boş feature → ~0.50 (öncesi ~0.62)
2. ✅ Glicko-2 update sonrası r != 1500
3. ✅ Pi-Rating güçlü savunma → düşük gol beklentisi
4. ✅ Kalman team-strength champion nonzero teams
5. ✅ Ensemble Brier map: Rule-Based ≠ ML weight
6. ✅ PAVA non-monotonic girdi → monotonik çıktı
7. ✅ Feedback loops gerçek model çıktıları kullanır
8. ✅ GAP λ maks 2.72 (öncesi 20)
9. ✅ Goal Radar tek xG modeli
10. ✅ ML trainer 401 döner (auth aktif)
11. ✅ `/api/matches` 100 istek → 429 (rate limit)
12. ✅ Cron secret timingSafeEqual
13. ✅ Signal duplicate pending → unique constraint engeller

**Bu kriterler karşılandıktan sonra sistem re-evaluable durumda olacak.**
