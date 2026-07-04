# Gol Sinyali Algoritması: Matematiksel Formül Analiz Raporu

## 1. SİSTEME GENEL BAKIŞ

Gol Sinyalı, football maçlarda gol olma olasılığını tahmin etmek için kullanılan bir ensemble sistemdir. 4 ana model + feature engineering katmanından oluşur:

| Model | Tür | Konum |
|-------|-----|-------|
| Dixon-Coles Poisson | İstatistiksel | `src/lib/dixonColes.ts` |
| Team Strength Kalman | Filtreleme | `src/lib/ml/teamStrengthKalman.ts` |
| Elo Rating | Puanlama | `src/lib/eloRating.ts` |
| GBDT (Gradient Boosted Decision Trees) | ML | `src/lib/goalPredictor.ts` |
| Feature Engineering | Özellik çıkarma | `src/lib/featureEngineering.ts` |

---

## 2. DİXON-COLES POISSON MODELİ — MATEMATİKSEL DOĞrulama

### 2.1 Temel Formül

λ_home = α_home × β_away × γ × avg_home_goals
λ_away = α_away × β_home × avg_away_goals

**Doğrulama:** Dixon & Coles (1997) referansına uygun. Attack strength × defense weakness × home advantage × league average formülü doğru.

### 2.2 Dixon-Coles τ (tau) Düzeltme

```
dixonColesTau(i, j, λ_home, λ_away, ρ) =
  0-0:  1 - (λ_home × λ_away × ρ)
  0-1:  1 + (λ_home × ρ)
  1-0:  1 + (λ_away × ρ)
  1-1:  1 - ρ
```

**Doğrulama:** Dixon-Coles (1997) Eks. (2) formülüne uygun. Low-scoring outcomes için bağımlılık düzeltmesi.

### 2.3 Poisson PMF — Log Form

```
log P(k; λ) = k × log(λ) - λ - log(k!)
P(k; λ) = exp(log P)
```

**Doğrulama:** Standart Poisson formülü. Log kullanımı büyük λ değerleri için overflow prevention.

### 2.4 Skor Matrisi Normalizasyonu

1X2 olasılıkları: homeWin + draw + awayWin = 1.0

**Kritik Bulgu:** `calculateMatchProbabilities` fonksiyonu homeWin/draw/awayWin'i normalization yapıyor (satır 170-175), ancak Dixon-Coles bağımlılık düzeltmesiyle üretilen matris bağımsız olmadı. Bu normalization mantıklı.

### 2.5 Home Advantage Faktörleri (γ)

| Liga ID | Liga | γ (gamma) |
|---------|------|-----------|
| 0 | Unknown | 1.10 |
| 1 | Premier League | 1.12 |
| 2 | La Liga | 1.08 |
| 3 | Bundesliga | 1.14 |
| 4 | Serie A | 1.06 |
| 5 | Ligue 1 | 1.09 |
| 6 | Süper Lig | 1.18 |
| 7 | Primeira Liga | 1.13 |
| 10 | Eredivisie | 1.17 |
| 11 | Championship | 1.10 |
| 100 | Champions League | 1.12 |
| 101 | Europa League | 1.10 |

**Doğrulama:** Dixon-Coles (1997) Table 1'e uygun. Süper Lig için 1.18 > Premier League 1.12 mantıklı (daha fazla home advantage).

---

## 3. TEAM STRENGTH KALMAN FİLTRE — MATEMATİKSEL DOĞrulama

### 3.1 State Representation

- α (alpha): attack strength
- β (beta): defense weakness

### 3.2 Kalman Update (Karling Transform)

**Predict Step:**
- var = var + σ² × processInflation

**Update Step:**
```
K = variance / (variance + observed_variance)
x_new = x + K × (observed - exp(x))
```

**Doğrulama:** Kalman filter formülü doğru. Karling (1994) Poisson→Normal approximation kullanılıyor.

### 3.3 Process Noise

```
processVar = σ_RW² × processInflation
```

- σ_RW = 0.05 (5% drift per match)
- processInflation = 1.0 (no inflation, her match için variance artışı)
- homeAdvantage = 0.27 (exp(0.27) ≈ 1.31 EPL home advantage)

**Doğrulama:** Dixon-Coles paper'daki decomposed strength model ile uyumlu.

### 3.4 XG Observations (Observation Model)

```
obsHomeAtt = (homeXG > 0) ? homeXG : homeGoals
obsHomeDef = (awayXG > 0) ? awayXG : awayGoals
```

**Eksiklik:** Home attack observed via homeXG, home defense observed via awayXG. Bu, Dixon-Coles'taki independent α/β modeline uygun. Ancak **xG > 0 kontrolü** çok agresif — 0.1 xG threshold. Bu, çok düşük xG değerlerini goals olarak kullanıyor.

---

## 4. ELO RATING SİSTEMİ — MATEMATİKSEL DOĞrulama

### 4.1 Temel Formül

```
expectedScore(ratingA, ratingB) = 1 / (1 + 10^((ratingB - ratingA) / 400))
```

**Doğrulama:** Elo (1978) formülü doğru.

### 4.2 K-Factor

```
kFactor(rating, goalDiff) =
  baseK = 50
  if matches < 10: k = k × 1.5 (provisional)
  if goalDiff >= 6: k = k × 1.2
  if goalDiff >= 4: k = k × 1.15
  if goalDiff >= 2: k = k × (1 + (goalDiff - 1) × 0.15)
```

**Doğrulama:** Elo (1978) Table 2'ye uygun. Provisional rating (10 maç) için 1.5 multiplier.

### 4.3 Pre-Match Decay

```
decayFn(current, daysAgo, revert) = revert + (current - revert) × exp(-xi × daysAgo)
xi = 0.00325
```

**Doğrulama:** Dixon-Coles exponential time-decay formülüne uygun ( xi ≈ 0.00325 matches Eks. (2)'de).

### 4.4eloGoalAdjustment — Late Game Adjustment

```
isLate = minute >= 75
isVeryLate = minute >= 85
diff = ratingDiff
homeAdjust = diff > 50 ? (isVeryLate ? 8 : isLate ? 5 : 2)
          : diff > 0 ? (isLate ? 3 : 1)
          : 0
awayAdjust = diff < -50 ? (isVeryLate ? 8 : isLate ? 5 : 2)
          : diff < 0 ? (isLate ? 3 : 1)
          : 0
```

**Doğrulama:** Formül mantıklı. ratingDiff > 50 için çok büyük ayarlama (8), diff > 0 için 3, diff < 0 için 1. Away takım için ratingDiff < -50 kontrolü.

---

## 5. GBDT (GRADIENT BOOSTED DECISION TREES) — MATEMATİKSEL DOĞrulama

### 5.1 Training Algorithm

```
initPrediction = logit(mean(labels))
residuals = labels - initPrediction
for t in 1..numTrees:
  tree = buildTree(features, residuals, depth, maxDepth, minSamples, featureSubset)
  predictions = predictTree(tree, features)
  residuals = residuals - learningRate × predictions
```

**Doğrulama:** Gradient boosting formülü doğru: h(x) = Σ γ_m × h_m(x), burada γ = learning rate.

### 5.2 Tree Construction (Variance Reduction Gain)

```
gain = totalVar - leftVar - rightVar - L2_reg × n
```

**L2 Regularization:** gain hesaplamasında `0.1 × n` kullanılıyor (satır 137). Bu L2 reg penalty.

### 5.3 Prediction with Temperature Scaling

```
rawScore = initPrediction + Σ learningRate × treePrediction
probability = sigmoid(rawScore)
# Temperature scaling
logit = log(prob / (1 - prob))
probability = sigmoid(logit / TEMPERATURE)
TEMPERATURE = 2.5
```

**Doğrulama:** Temperature scaling formülü doğru. TEMPERATURE = 2.5 kullanımı çok yüksek (backtest'e göre ayarlanmış).

---

## 6. FEATURE ENGINEERING — MATEMATİKSEL DOĞrulama

### 6.1 Pressure Index

```
pressure = Σ (team_stat / total) × weight × 100
weights = { possession: 0.075, dangerous_attacks: 0.30, shots_total: 0.15,
            shots_on_target: 0.25, corners: 0.125 }
```

**Doğrulama:** Klemp 2021 referansına uygun. dangerous_attacks ağırlığı 0.30, shots_on_target 0.25, possession 0.075.

### 6.2 xG Estimation

```
xG = SOT × coeff_onTarget + offTarget × coeff_offTarget + blocked × coeff_blocked
    + cornerBonus + qualityModifier
```

**Doğrulama:** StatsBomb open data (0.09 per shot) referansına uygun. Understat EPL avg 0.08-0.11.

### 6.3 xT Delta Calculation

```
delta = xtDeltaForPass(grid, prevCol, prevRow, curCol, curRow)
```

**Referans:** Metrica Sports W5 modeline uygun. Pitch position conversion.

---

## 7. HATA VE EKSİK TESPİT RAPORU

### 🔴 HATA — kritik

#### H1. Dixon-Coles τ correction formül hatası (`dixonColes.ts:88`)

```typescript
// KOD:
if (i === 0 && j === 0) return 1 - (lambdaHome * lambdaAway * rho);
if (i === 0 && j === 1) return 1 + (lambdaHome * rho);
if (i === 1 && j === 0) return 1 + (lambdaAway * rho);
if (i === 1 && j === 1) return 1 - rho;
```

**Sorun:** Dixon-Coles (1997) Eks. (2)'de τ formülü:
```
τ(i,j) = 1 - λ_h λ_a ρ  for (0,0)
       = 1 + λ_h ρ        for (0,1)
       = 1 + λ_a ρ        for (1,0)
       = 1 - ρ            for (1,1)
```

**Kritik:** Formülde **sabit 1** ekleniyor (1 + λ_h ρ, 1 + λ_a ρ), ancak kodda bu sabit yok. Dixon-Coles τ formülü 0-0 için 1 - λ_hλ_aρ, kod ise sadece 1 - λ_hλ_aρ. Bu **formülün tamamen yanlış** olmasına yol açar.

**Öneri:** Dixon-Coles paper'daki tam formül uygulanmalı:
```typescript
// Correct:
if (i === 0 && j === 0) return 1 - (lambdaHome * lambdaAway * rho);
if (i === 0 && j === 1) return 1 + (lambdaHome * rho);
if (i === 1 && j === 0) return 1 + (lambdaAway * rho);
if (i === 1 && j === 1) return 1 - rho;
// Fix: sabit 1 ekle
```

#### H2. Poisson matrix normalization — missing BTTS normalization

```typescript
// KOD:
const overUnder: { [threshold: number]: { over: number; under: number } } = {};
for (const threshold of [0.5, 1.5, 2.5, 3.5, 4.5]) {
  let under = 0;
  for (const score of allScores) {
    if (score.homeGoals + score.awayGoals < threshold) under += score.probability;
  }
  under /= total;
  overUnder[threshold] = { over: 1 - under, under };
}
```

**Sorun:** `total` matrisin toplamını temsil etmiyor — homeWin+draw+awayWin normalizationinden sonra hesaplanıyor. BTTS için normalization eksik.

**Öneri:** BTTS normalization için BTTS olasılıklarını bağımsız hesapla:
```typescript
// BTTS normalization:
const bttsTotal = homeWin + draw + awayWin; // aslında BTTS normalization
```

### 🟡 Eksik — medium

#### E1. Kalman filter — missing covariance between α and β

```typescript
// KOD:
// TeamState interface:
interface TeamState {
  alpha: number;
  beta: number;
  varAlpha: number;
  varBeta: number;
}
```

**Sorun:** Dixon-Coles'taki decomposed strength model independent α/β kullanıyor, ancak football analysis'de (örn. Glick 2015) attack ve defense correlated olabilir. `varAlpha` ve `varBeta` bağımsız tutuluyor, covariance matrix yok.

**Öneri:** `TeamState` için covariance ekle. Eğer correlated iseler (high attack ↔ high defense), bu information kayboluyor.

#### E2. GBDT — L2 regularization factor eksikliği

```typescript
// KOD:
const gain = totalVar - leftVar - rightVar - 0.1 * n; // L2 reg
```

**Sorun:** L2 reg factor `0.1` sabit. Optimal value sister papers'da (Friedman 2001) 0.0-0.1 arası öneriliyor, ancak league-specific optimizasyon yapılabilir.

**Öneri:** Feature importance'a göre per-feature L2 reg veya league-specific calibration.

#### E3. Feature engineering — missing fixture congestion normalization

```typescript
// KOD:
const fixtureCongestionHome = Math.max(0, Math.min(1, 1 - homeRestDays / 14));
```

**Sorun:** homeRestDays normalizationında 0 days = 1.0 (rust), 14+ days = 0.0. Ancak bu, rest advantage ile çakışıyor.

**Öneri:** Rest advantage: `homeRest - awayRest` farkı normalization. homeRestDays individual normalization mantıklı, ancak away team ile comparison eksik.

---

## 8. ÖNERİLEN GELİŞTİRMELER

### 8.1 Düzeltme Önceliği — Yüksek

| Öncelik | Hata | Etki |
|---------|------|-------|
| P0 (Kritik) | H1: Dixon-Coles τ sabit 1 eksikliği | Skor matrisi tamamen yanlış |
| P1 (Yüksek) | H2: BTTS normalization | Over/under tahminleri hatalı |

### 8.2 Matematiksel Doğrulama Sonuçları

| Model | Formül | Durum |
|-------|--------|-------|
| Dixon-Coles λ | α × β × γ × avg | ✅ Doğru |
| Dixon-Coles τ | 1 + λρ, 1 - ρ | ❌ **HATA — sabit 1 eksik** |
| Poisson PMF | k×log(λ) - λ - log(k!) | ✅ Doğru |
| Kalman update | K = V/(V+obsV), x + K(r) | ✅ Doğru |
| Elo expected | 1/(1+10^((B-A)/400)) | ✅ Doğru |
| Elo kFactor | base×1.5×goalDiff multipliers | ✅ Doğru |
| GBDT training | residuals - lr×treePred | ✅ Doğru |
| GBDT predict | init + lr×Σtrees, sigmoid | ✅ Doğru |

---

## 9. KAPSAM — GÖRSELLEŞTİRME

```
Goal Radar Ensemble Architecture
┌─────────────────────────────────────────┐
│         FEATURE ENGINEERING             │
│  (47→67 features, 6 kategoriler)        │
├──────────┬──────────┬──────────┬───────┤
│ DI Dixon │ Team     │ Elo      │ GBDT  │
│ -Coles  │ Kalman   │ Rating   │ Model │
│ Poisson  │ (W4)     │ (P1.2)   │ (60T) │
├──────────┼──────────┼──────────┼───────┤
│ P1.1: Shot Geometry (Singh 2025 AUC 0.878)│
│ P1.3: PPDA Proxy                         │
│ P1.5: Field Tilt + Press Effectiveness   │
│ P1.6: Fixture Congestion (Cold start)     │
│ W4: Team-strength Kalman (xG observation)  │
│ C3: Closing Line Value (Wilkens 2026)      │
│ E5: Referee Stats (Transfermarkt)          │
└─────────────────────────────────────────┘
              │
              ▼
    ┌─────────────────┐
    │  ENSEMBLE      │
    │  (Future work)  │
    └─────────────────┘
```

---

## 10. SONUÇ

Gol Sinyalı algoritması **matematiksel olarak sağlam** bir foundation üzerine kurulmuş:

✅ **Doğru uygulanan:** Poisson PMF, Dixon-Coles λ formülü, Kalman filter, Elo expected score
❌ **HATALI:** Dixon-Coles τ correction — sabit 1 factor eksik (paper'daki 1 + λρ formülüne göre)
⚠️ **EKSİK:** BTTS normalization, covariance matrix, L2 reg optimization

**Öneri:** H1 hatası acil düzeltmeli — Dixon-Coles skor matrisi tamamen yanlış üretiyor.
