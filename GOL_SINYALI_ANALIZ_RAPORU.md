# Gol Sinyali Algoritması: Matematiksel Formül Analiz Raporu

**Tarih:** 2026-07-04  
**Durum:** ✅ Tüm hatalar düzeltildi — 266 test, 0 fail

---

## 1. SİSTEME GENEL BAKIŞ

Gol Sinyalı, football maçlarda gol olma olasılığını tahmin etmek için kullanılan bir ensemble sistemdir. 4 ana model + feature engineering katmanından oluşur:

| Model | Tür | Konum |
|-------|-----|-------|
| Dixon-Coles Poisson | İstatistiksel | `src/lib/dixonColes.ts` |
| Team Strength Kalman | Filtreleme | `src/lib/ml/teamStrengthKalman.ts` |
| Elo Rating | Puanlama | `src/lib/eloRating.ts` |
| GBDT (Gradient Boosted Decision Trees) | ML | `src/lib/goalPredictor.ts` |
| Feature Engineering | Özellik çıkarma | `src/lib/featureEngineering.ts` |
| Dixon-Coles Corrector | Skor düzeltme | `src/lib/dixonColesCorrector.ts` |
| Weibull PMF | Dağılım | `src/lib/dixonColesCorrector.ts:178` |

---

## 2. TESPİT EDİLEN VE DÜZELTİLEN HATALAR

### 🔴 H1 — Kalman Update: Log-Ölçek / Count-Ölçek Karışımı (DÜZELTİLDİ ✅)

**Dosya:** `src/lib/ml/teamStrengthKalman.ts:120-142`

**Hatanın Nedeni:**
Orijinal kod, Extended Kalman Filter (EKF) linearizasyonunu yanlış uyguluyordu:

```typescript
// ❌ ESKİ (hatalı):
const expMean = Math.exp(clamp(mean, -10, 10));
const obsVariance = Math.max(0.01, expMean);  // count-scale variance
const K = variance / (variance + obsVariance); // log-scale / count-scale → ölçek uyuşmazlığı
const r = observed - expMean;                   // count-scale residual
const newMean = clamp(mean + K * r, ...);       // log-scale + (karışık K) × count-scale
```

K sayısı `log-variance / (log-variance + count-variance)` ile hesaplanıyordu — iki farklı ölçek birbirine karışıyordu. Düşük skorlu maçlarda (0-0, 1-0) sistematik sapma üretiyordu.

**Uygulanan Düzeltme (EKF linearizasyonu):**

```typescript
// ✅ YENİ (doğru):
const lambda = Math.exp(clamp(mean, -10, 10));
// H = ∂exp(x)/∂x = exp(x) = λ
// S = H²·P + R = λ²·P + λ   (Poisson variance ≈ λ)
// K = P·H / S = P·λ / (λ²·P + λ) = P / (λ·P + 1)
const K = variance / (lambda * variance + 1);
const innovation = observed - lambda;
const newMean = clamp(mean + K * innovation, config.clampMin, config.clampMax);
// P_new = (1 - K·H)·P = (1 - K·λ)·P
const newVariance = (1 - K * lambda) * variance;
```

**Matematiksel Doğrulama:**
- `H = ∂h(x)/∂x = ∂exp(x)/∂x = exp(x) = λ` → Jacobian doğru
- `S = H·P·Hᵀ + R = λ²·P + λ` → Innovation covariance doğru
- `K = P·Hᵀ·S⁻¹ = P·λ / (λ²·P + λ) = P / (λ·P + 1)` → Kalman gain doğru
- Her şey log-ölçekte → **ölçek tutarlılığı sağlandı**

---

### 🔴 H2 — Weibull PMF: P(0) = 1 Hatası (DÜZELTİLDİ ✅)

**Dosya:** `src/lib/dixonColesCorrector.ts:178-199`

**Hatanın Nedeni:**
Weibull count distribution PMF'inde `P(K=0)` her zaman 1 döndürülüyordu:

```typescript
// ❌ ESKİ (hatalı):
if (k === 0) {
    return 1;  // Olasılık teorisine aykırı — PMF'te P(0) asla sabit 1 olamaz
}
```

Bu, Weibull modunda tüm 0-0 olasılıklarını olduğundan yüksek gösteriyordu.

**Uygulanan Düzeltme (survival-based PMF):**

```typescript
// ✅ YENİ (doğru):
export function weibullPMF(lambda: number, k: number, shape: number = 1.4): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  if (k < 0) return 0;
  // Survival-based: P(K=k) = S(k) - S(k+1)
  // S(k) = exp(-(k/b)^c),  b = λ/Γ(1+1/c)
  const scale = lambda / Math.exp(logGamma(1 + 1 / shape));
  const surv = (t: number) => Math.exp(-Math.pow(Math.max(t, 0) / scale, shape));
  const p = surv(k) - surv(k + 1);
  return Math.max(0, Math.min(1, p));
}
```

**Matematiksel Doğrulama:**
- Weibull survival: `S(k) = exp(-(k/b)^c)` — McHale & Scarf (2011) eq. 4
- Scale: `b = λ / Γ(1 + 1/c)` — mean-corrected, eq. 3
- PMF: `P(K=k) = S(k) - S(k+1)` — standart count distribution formülü
- Örnek: `λ=1.0, k=0, c=1.4` → `b ≈ 1.0/0.9106 ≈ 1.098` → `S(0)=1, S(1)=exp(-(1/1.098)^1.4) ≈ exp(-0.87) ≈ 0.42` → `P(0) ≈ 0.58` (artık 1 değil) ✅

---

### 🟡 H3 — Lanczos logΓ: Hatalı `tmp` Hesaplaması (DÜZELTİLDİ ✅)

**Dosya:** `src/lib/dixonColesCorrector.ts:201-213`

**Hatanın Nedeni:**
Lanczos log-Gamma yaklaşımında `z = x + g + 0.5` kullanılması gerekirken, `tmp` değişkeni hatalı hesaplanıyordu:

```typescript
// ❌ ESKİ (hatalı):
let tmp = x + 7.5;
tmp -= x + 0.5;  // tmp = (x + 7.5) - (x + 0.5) = 7.0 (HER ZAMAN!)
```

`tmp` her zaman 7.0 oluyordu — x'e bağlı değil. Bu, gamma fonksiyonunun doğruluğunu bozuyordu (özellikle küçük x değerleri için).

**Uygulanan Düzeltme:**

```typescript
// ✅ YENİ (doğru):
let y = x;
let z = x + 7.5;           // Lanczos g=7, n=9 → z = x + g + 0.5
let ser = 0.99999999999980993;
for (let i = 0; i < coef.length; i++) ser += coef[i] / ++y;
// log Γ(x) = ln(√(2π)) + (x+0.5)·ln(z) - z + ln(ser/x)
return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(z) - z + Math.log(ser / x);
```

**Not:** Aynı zamanda `(x - 0.5)` yerine `(x + 0.5)` kullanıldı — Lanczos formülü `(x + 1/2)·ln(x + g + 1/2)` kullanır.

---

### ✅ H4 — GBDT Residual Başlangıcı (YANLIŞ DEĞİL, ZATEN DOĞRU)

**Dosya:** `src/lib/goalPredictor.ts:226-230`

```typescript
const labelMean = ...;                               // mean(y)
const initPrediction = Math.log(labelMean / (1 - labelMean)); // logit(mean(y))
let residuals = labels.map(y => y - labelMean);      // y - sigmoid(initPrediction)
```

Bu, gradient boosting'teki **pseudo-residual** = gradient of log-loss w.r.t. log-odds.  
`y - sigmoid(F₀)` = `y - mean(y)`. Tam olarak doğru. **Düzeltme gerekmez.**

---

## 3. DOĞRULANMIŞ FORMÜLLER (HATA YOK)

| Model | Formül | Durum |
|-------|--------|-------|
| Dixon-Coles λ | `λ_h = α_h × β_a × γ × μ_h` | ✅ Dixon-Coles (1997) eq. 1 |
| Dixon-Coles τ (tau) | `1 + λρ, 1 - ρ` | ✅ Kod paper ile birebir aynı |
| Poisson PMF | `k·log(λ) - λ - log(k!)` | ✅ Log-form, overflow-safe |
| Kalman process noise | `P_pred = P + σ²` | ✅ Random-walk transition |
| Elo expected score | `1/(1+10^((RB-RA)/400))` | ✅ Elo (1978) |
| Elo kFactor | `50 × 1.5(provisional) × goalDiff` | ✅ |
| Elo time-decay | `exp(-ξ·t), ξ=0.00325` | ✅ Dixon-Coles compatible |
| GBDT tree gain | `Var(T) - Var(L) - Var(R) - L2·n` | ✅ Variance reduction |
| GBDT prediction | `F₀ + ν·Σtrees, sigmoid` | ✅ Standard boosting |
| Temperature scaling | `sigmoid(logit/T), T=2.5` | ✅ Post-hoc calibration |
| Shot geometry (Singh 2025) | `atan2(dy±3.66, dx)` | ✅ FotMob → metre çevrimi |
| xG estimation | `SOT×0.085 + off×0.03 + blocked×0.025 + corners` | ✅ StatsBomb kalibrasyonlu |
| Feature pressure index | `Σ(stat/Σ×weight×100), Σweight=1` | ✅ Klemp (2021) |
| Feature normalization | `(x-min)/(max-min)` | ✅ |
| BTTS normalization | `Σscore.p / total` | ✅ Tutarlı |

---

## 4. DÜZELTİLEN DOSYALAR

| Dosya | Değişiklik | Satır |
|-------|-----------|-------|
| `src/lib/ml/teamStrengthKalman.ts` | Kalman update → EKF linearizasyonu | 120-142 |
| `src/lib/dixonColesCorrector.ts` | Weibull PMF → survival-based | 178-187 |
| `src/lib/dixonColesCorrector.ts` | Lanczos logΓ → doğru z hesaplaması | 201-210 |

---

## 5. TEST SONUÇLARI

```
266 pass, 0 fail, 645 expect() calls
Ran 266 tests across 26 files. [1224ms]
```

Tüm mevcut testler geçti — regresyon yok.

---

## 6. KAPSAM MİMARİSİ

```
Goal Radar Ensemble Architecture
┌──────────────────────────────────────────────────────┐
│              FEATURE ENGINEERING                      │
│  (47→67 features: pressure, shot, set piece,           │
│   momentum, temporal, team strength, xG, xT,           │
│   shot geometry, PPDA, field tilt, press eff.,         │
│   fixture congestion, closing line value, referee)     │
├────────────┬────────────┬────────────┬────────────────┤
│ Dixon-Coles│ Team       │ Elo        │ GBDT           │
│ Poisson    │ Strength   │ Rating     │ (60 trees,     │
│ (τ+ρ)      │ Kalman (αβ)│ (ξ-decay)  │  depth 4,      │
│            │ EKF ✅     │            │  T=2.5)        │
├────────────┴────────────┴────────────┴────────────────┤
│             Ensemble Aggregation                       │
│     (Brier-weighted, inplay-gated, 9-submodel)        │
└──────────────────────────────────────────────────────┘
```

---

## 7. SONUÇ

- **3 hata düzeltildi:** Kalman EKF, Weibull PMF, Lanczos logΓ
- **1 yanlış alarm geri alındı:** GBDT residual zaten doğru
- **Tüm formüller matematiksel olarak doğrulandı** — Dixon-Coles, Elo, Poisson, Kalman
- **266 test, 0 fail** — regresyon yok
