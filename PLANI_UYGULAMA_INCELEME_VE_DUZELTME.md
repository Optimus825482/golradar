# Plan Uygulama ve PHASE 4-5 Düzeltme Planı

## ✅ PHASE 1: goalRadar.ts NaN guard
**Durum:** TAMAMLANDI

### Değişiklik
```typescript
// L326: goalProbability5min hesaplamasına NaN guard eklendi
goalProbability5min = Math.min(0.95, 1 - Math.exp(-Math.max(0, xgRate * 5)));
```

**Neden:** `xgRate` negatif olduğunda `1 - Math.exp(-neg)` NaN üretiyordu. Bu NaN, subsequent `goalProbability5min >= 0.20` comparisons'da `false` yerine `false` değer döndürüyordu (JavaScript NaN comparison her zaman false).

**Upgrade:** Calibration data entegrasyonu için subsequent analysis gerekiyor.

---

## ✅ PHASE 2: Ponytail markers upgrade path ile güncelleme
**Durum:** TAMAMLANDI

### Değişiklikler

#### goalSignalTracker.ts:299
```typescript
// ponytail: bu ~%90 DB sorgusunu keser (30sn poll'de çoğu cooldown içinde).
//Upgrade path: Redis if distributed workers
if (checkCooldownCache(matchCode, signalSide)) {
```

#### goalSignalTracker.ts:410
```typescript
// ponytail: single-interval cleanup on set is cheaper than a background sweeper
//Upgrade path: Map-scanning sweeper if TTL policy grows complex
setTimeout(() => cooldownCache.delete(key), COOLDOWN_CACHE_TTL_MS + 1000);
```

**Neden:** Önceki yorumlar upgrade path tanımlı değildi. Şimdi hem compromising rationale hem de upgrade path açıkça tanımlı.

---

## ✅ PHASE 3: featureEngineering.ts home_advantage_factor env override
**Durum:** TAMAMLANDI

### Değişiklikler
```typescript
// HOME_ADVANTAGE const default 0.53, upgrade: calibrated from DB
const HOME_ADVANTAGE = (() => {
  const env = parseFloat(process.env.HOME_ADVANTAGE ?? '');
  return isNaN(env) ? 0.53 : Math.max(0.40, Math.min(0.70, env));
})();

// L710: sabit değer yerine env-based değer
home_advantage_factor: HOME_ADVANTAGE_ENV,
```

**Neden:** 0.53 sabit, lig bazlı varyasyonu yok. Environment override ile Future calibration system'ten value override edilebilir.

**Upgrade:** DB SystemConfig entegrasyonu — `home_advantage_factor` için kalibre edilmiş değerler future phase'ta DB'ye taşınacak.

---

## ✅ PHASE 4: calibration.ts Zod schema ile type safety
**Durum:** TAMAMLANDI

### Değişiklikler

```typescript
import { z } from 'zod';

// Schema definitions added (L67-76)
const CalibrationParamsSchema = z.object({
  L: z.number(), k: z.number(), x0: z.number(), T: z.number(),
});

const IsotonicTableSchema = z.object({
  x: z.array(z.number()), y: z.array(z.number()),
  fittedAt: z.number(), fittedN: z.number(),
});

const BetaParamsSchema = z.object({
  a: z.number(), b: z.number(), c: z.number(),
  fittedAt: z.number(), fittedN: z.number(),
});

// hydrateCalibrationFromDB updated (L150-176)
for (const row of rows) {
  if (row.key === SYSTEM_KEY_PARAMS) {
    const parsed = CalibrationParamsSchema.safeParse(row.value);
    if (parsed.success) {
      CALIBRATION_PARAMS.L = parsed.data.L;
      CALIBRATION_PARAMS.k = parsed.data.k;
      CALIBRATION_PARAMS.x0 = parsed.data.x0;
      CALIBRATION_PARAMS.T = parsed.data.T;
    } else {
      logError('calibration', `Invalid calibration params in DB: ${parsed.error.message}`);
    }
  } else if (row.key === SYSTEM_KEY_ISOTONIC) {
    const isoParsed = IsotonicTableSchema.safeParse(row.value);
    if (isoParsed.success) cachedIsotonic = isoParsed.data;
    else logError('calibration', `Invalid isotonic table in DB: ${isoParsed.error.message}`);
  } else if (row.key === SYSTEM_KEY_BETA) {
    const betaParsed = BetaParamsSchema.safeParse(row.value);
    if (betaParsed.success) cachedBeta = betaParsed.data;
    else logError('calibration', `Invalid beta params in DB: ${betaParsed.error.message}`);
  }
}
```

**Neden:** DB jsonb values'lerine loose structural cast yerine strict Zod validation. Type safety artar, runtime errors azalır.

**Upgrade:** none

---

## ⬜ PHASE 5: calibration.ts beta entegrasyonu (Yapısal)
**Durum:** EKSİK — future phase

### TODO
```typescript
// calibration.ts: applyBeta fonksiyonuna Clamp ekle
function applyBeta(rawScore: number): number | null {
  if (!cachedBeta) return null;
  // ponytail: log(0) guard, [-Inf, Inf] avoid
  const s = Math.max(1e-6, Math.min(1 - 1e-6, rawScore / 100));
  const z = cachedBeta.a * Math.log(s) - cachedBeta.b * Math.log(1 - s) + cachedBeta.c;
  const calibrated = 1 / (1 + Math.exp(-z));
  return Math.round(calibrated * 1000) / 1000;
}
```

### Testler
- `src/lib/__tests__/calibrationBeta.test.ts`
- `src/lib/__tests__/smartCalibration.test.ts`
- `src/lib/__tests__/modelRouter.test.ts`

---

## 📋 PHASE 6-7: Analiz notları

### Ponytail Debt Ledger

| marker | dosya | upgrade path | status |
|--------|-------|-------------|--------|
| L299 | goalSignalTracker.ts | Redis if distributed | ✅ triggered |
| L410 | goalSignalTracker.ts | Map-scanning sweeper if TTL policy grows complex | ✅ triggered |
| L326 | goalRadar.ts | Calibration data entegrasyonu | ⬜ future |
| L710 | featureEngineering.ts | DB SystemConfig entegrasyonu | ⬜ future |
| L481 | poll/route.ts | None (already optimized) | ✅ clean |

### Notlar

1. **calibration.ts Zod entegrasyonu sonrası:** Eski loose cast pattern test edilmeli.
2. **HOME_ADVANTAGE env override:** `process.env.HOME_ADVANTAGE` default `.env` överride ile set edilebilir.
3. **NaN guard (goalRadar.ts):** Loglanacak events — `goalProbability5min: NaN` filtering ile loglanmalı.

---

## 🎯 Önceki Oturum Notları (NEXT_SESSION.md)

1. ✅ DONE: Feature Vector 67→87 + Nesine Data Fix
2. ✅ DONE: Poll-Writer Timeout Fix  
3. ⚠️ calibratedP too low — score=3 mapped to near-zero
4. ⏳ ML Model Retrain with Real Data (Brier=0.0026, data leakage)

---

## 🔧 Sonraki Oturumda Direkt Devam Edilecek Alanlar

1. **PHASE 5:** calibration.ts beta entegrasyonu + test dosyaları
2. **PHASE 6:** ensemble analytics test coverage
3. **NEXT_SESSION.md hatalarının çözümü:** calibratedP sorunu
