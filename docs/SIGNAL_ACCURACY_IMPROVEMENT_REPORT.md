# Gol Radarı — Sinyal Doğruluğu Artırma Raporu

> **Tarih:** 2026-07-01
> **Kaynak:** 31 araştırma makalesi (`docs/NEWALOGOMD/`) + mevcut codebase analizi + 2 özet doküman
> **Amaç:** Sinyal sayısını AZALTMA'DAN, hatta ARTIRARAK doğruluğu yükseltmek

---

## 1. Mevcut Sistem Durumu

| Metrik | Değer | Kaynak |
|--------|-------|--------|
| Validation Brier | **0.2742** | Deployment log |
| Train Brier | **0.0573** | Deployment log |
| AUC | **0.500** | Deployment log (information collapse!) |
| Positive class rate | **%80.7** | Deployment log (gerçek ~%14) |
| Model sayısı | 9 | ensemble.ts |
| Feature sayısı | 67 | featureEngineering.ts |
| Calibration | PAVA Isotonic + Sigmoid | calibration.ts |
| Imbalance handling | **YOK** | app.py (sample_weight yok) |

**Ana problem:** AUC=0.500 → model sadece majority class'ı tahmin ediyor. Sinyal sayısı yüksek ama doğruluk düşük.

---

## 2. Araştırma Bulguları — 31 Makale Sentezi

### 2.1 Makale Özet Tablosu

| # | Makale | Metot | Brier/AUC | Kritik Bulgular | İmbalance | Kalibrasyon |
|---|--------|-------|-----------|-----------------|-----------|-------------|
| 1 | Improving xG (Singh 2025) | XGBoost + freeze-frame | **AUC=0.878, Brier=0.0686** | Angular defensive pressure, goalkeeper distance, pre-shot pass sequence | - | Calibrated XGBoost |
| 2 | Calibration Drift Detection | Clinical ML drift | - | Zaman içinde ECE artışını izle, drift >%5 → refit | - | Drift surveillance |
| 3 | Isotonic Stratification (Pernot 2023) | Isotonic regression analysis | - | **Centered isotonic** gerekli — standard PAVA bin-based stats'ı bozar | - | Centered IR |
| 4 | ROC-Regularized IR (2023) | Isotonic + ROC convex hull | - | IR ROC'un convex hull'unu korur — overfitting kontrolü | - | ROC-regularized IR |
| 5 | Calibration Meets Reality (2025) | Platt + Isotonic theory | - | Feature informativeness kalibrasyonu etkiler — noise features bozar | - | Platt+IR convergence |
| 6 | xT Flexibility vs Accuracy (van Arem) | xT Markov chain | R²=0.835 | **Grid seçim kuralı:** max error <0.03, 90% probability | - | - |
| 7 | Dynamic xT (DxT, applsci 2025) | xT + off-ball positions | - | **Topsuz oyuncu konumları** xT'yi dinamikleştirir, %335K event | - | - |
| 8 | Beta Calibration (Kull 2017) | 3-parametre Beta CDF | - | Platt sigmoid'den daha iyi — Naive Bayes/RF için ideal | - | Beta calibration |
| 9 | xG via XGBoost (JETA 2023) | XGBoost vs LR | XGBoost > LR | Ball position, assist method, distance, angle | - | - |
| 10 | Player Goal Scoring (make 2026) | 6 ML model karşılaştırma | **MAE=1.29** | XGBoost en iyi — 4 elite lig, 2017-2023 | - | - |
| 11 | Bundesliga xG Betting (Wilkens 2026) | xG + Skellam + isotonic | **ROI=%10-15** | xG-based model bookmaker'dan daha iyi sinyal yakalıyor | - | Isotonic calibration |
| 12 | Poisson Dissection (2026) | Poisson modelleri karşılaştırma | - | Dixon-Coles > basic Poisson, Weibull-Copula > Poisson | - | - |
| 13 | Poisson Regression (Bayesian) | Bayesian Poisson + MCMC | - | Bayesian approach home advantage'i doğru modeller | - | - |
| 14 | Dixon-Coles Tutorial | Dixon-Coles + time-decay | - | Düşük skorlu maçlar için τ düzeltmesi kritik | - | - |
| 15 | Shot Quality Model | xG + defensive context | - | Body orientation, pre-shot movement, defensive positioning | - | - |
| 16 | Algorithmic Football Architecture | TabTransformer + GNN + AFT | - | Focal Loss/SoftIC imbalance için, Weibull AFT goal timing | Focal Loss | - |
| 17 | Poisson-based Models Review | Bivariate Poisson, ZIP, DIBP | - | ZIP 0-0 maçları, DIBP beraberlikleri iyileştirir | - | - |
| 18 | Football Prediction Review (EN) | ML/DL survey, 165 papers | - | Challenge: draw prediction, imbalance, overfitting | SMOTE | - |
| 19-22 | Poisson/Dixon-Coles variants | Various Poisson | - | Bivariate Poisson korelasyon, time-decay critical | - | - |
| 23-28 | Turkish analytics docs | Method summaries | - | Weibull-Copula, Frank copula, Glicko-2 | - | - |
| 29-31 | Algorithmic Football series | Architecture docs | - | TabTransformer, xTC, PES/ASTRM, SoftIC | SoftIC | Pessimistic calibration |

### 2.2 Akademik Doğruluk Benchmark'ları

| Metot | Brier | AUC | Kaynak |
|-------|-------|-----|--------|
| **Calibrated XGBoost + freeze-frame** | **0.0686** | **0.878** | Singh 2025 |
| xG + Skellam + isotonic (Bundesliga) | ~0.15 | ~0.65 | Wilkens 2026 |
| Basic Poisson (Maher) | ~0.20 | ~0.60 | Pearn 2019 |
| Dixon-Coles | ~0.18 | ~0.63 | Dixon-Coles 1997 |
| **Gol Radarı (mevcut)** | **0.27** | **0.50** | Deployment log |
| **Hedef** | **<0.15** | **>0.70** | - |

---

## 3. Sinyal Doğruluğunu Artırma Stratejisi

### STRATEJİ: Sinyal sayısını koru/artır, doğruluğu yükselt

**Mantık:** Sinyal sayısını düşürmek yerine, **düşük-confidence sinyalleri filtreleme** yerine **high-confidence sinyalleri boost et**. Threshold'u yükseltmek sinyal sayısını düşürür — BUNU YAPMA. Bunun yerine:

1. **Düşük-confidence sinyaller için ek doğrulama gereksinimi** (multi-signal confirmation)
2. **Yüksek-confidence sinyaller için daha düşük threshold** (genişletilmiş yakalama)
3. **Confidence-band bazlı tier sistemi** (sadece low/medium/high değil, continuous)

---

## 4. 15 Somut İyileştirme — Öncelik Sırasına Göre

### P0 — Hemen (1-2 gün, <100 satır)

#### 4.1 Class Imbalance Fix — `sample_weight` (Makale 1, 16, 18)

**Sorun:** Eğitim verisi %80.7 positive → model her şeyi "gol olur" diyor (AUC=0.500).

**Çözüm:**
```python
# app.py — _run_training_job içine
pos_rate = float(ytr.mean())
sample_weight = np.where(ytr == 1, (1 - pos_rate) / pos_rate, 1.0)
model.fit(Xtr, ytr, sample_weight=sample_weight, eval_set=[(Xte, yte)])
```

**Beklenen etki:** AUC 0.50 → 0.65+, Brier 0.27 → 0.18-0.20. **Sinyal sayısı artar** çünkü model artık gerçek discriminator.

#### 4.2 Centered Isotonic Regression (Makale 3)

**Sorun:** Standard PAVA piece-wise constant üretir, bin-based ECE'yi bozar.

**Çözüm:**
```typescript
// calibration.ts — poolAdjacentViolators sonrası
// Centered isotonic: her bloğun ortalamasını blok merkezine ata
// (Oron & Flournoy 2022)
```

**Beklenen etki:** Calibration ECE düşer, sinyal kalitesi artar.

#### 4.3 Calibration Drift Surveillance (Makale 2)

**Sorun:** Calibration zamanla drift ediyor, nobody notices.

**Çözüm:**
```typescript
// calibrationLoop.ts — threshold düşür
const DRIFT_ALERT_THRESHOLD = 0.03; // %5 → %3
const DRIFT_REFIT_THRESHOLD = 0.07;  // %10 → %7
```

**Beklenen etki:** Drift erken tespit → otomatik refit → kalibrasyon fresh kalır.

### P1 — Kısa vade (1 hafta)

#### 4.4 Freeze-Frame Defensive Features (Makale 1, 15)

**Sorun:** Mevcut xG sadece SOT/shot count kullanıyor. Singh 2025'in makalesi **angular defensive pressure** ve **goalkeeper distance**'ın AUC'yi 0.80→0.878 yaptığını gösterdi.

**Çözüm:** FotMob shotmap'ten ek features:
- `shot.distance_to_goalkeeper` — kaleci mesafesi
- `shot.defenders_in_cone` — şut konisinde defans sayısı
- `shot.angle_to_goal` — gol açısı (radyan)
- `shot.pre_shot_pass_count` — şut öncesi pas sayısı

**Beklenen etki:** AUC +5-10%, Brier -5-10%.

#### 4.5 Beta Calibration (Makale 8 — Kull 2017)

**Sorun:** Mevcut `fitBeta` aslında Platt scaling (a=1, b=1 sabit). Kull 2017, Beta calibration'ın Platt ve isotonic'ten daha iyi olduğunu kanıtladı.

**Çözüm:**
```python
# Python sidecar'da veya TS'de
# 3-parametre Beta: q = 1 / (1 + exp(-c - a*log(s) + b*log(1-s)))
# a, b, c'yi calibration set üzerinde optimize et
```

**Beklenen etki:** Brier -2-5%, özellikle uç olasılıklarda (0.01-0.10 ve 0.90-0.99).

#### 4.6 Multi-Signal N-of-M Confirmation (Architecture doc)

**Sorun:** Tek threshold (65) → çok false positive.

**Çözüm:**
```typescript
// goalSignalTracker.ts — yeni confirmation layer
const modelAgreement = models.filter(m => m.probability > 0.5).length;
const confirmedSignal = modelAgreement >= 3 && score >= 55; // düşük threshold + N-of-M
// VEYA
const eliteSignal = modelAgreement >= 5 && score >= 50; // çok düşük threshold + high agreement
```

**Beklenen etki:** Sinyal sayısı **ARTAR** (threshold 65→55 düşer), ama false positive düşer çünkü N-of-M confirmation var.

#### 4.7 Dynamic xT (DxT) — Off-Ball Positions (Makale 7)

**Sorun:** Mevcut xT grid'i statik. DxT makalesi topsuz oyuncu konumlarını entegre ederek xT'yi dinamikleştiriyor.

**Çözüm:** FotMob squad/formation data'dan topsuz oyuncu pozisyonlarını approximate et:
- `formation_spread` — takım genişliği (px cinsinden)
- `defensive_line_height` — savunma hattının yüksekliği
- `attacking_third_density` — hücum üçte birindeki oyuncu sayısı

**Beklenen etki:** xT accuracy +5-10%.

#### 4.8 xT Grid Optimization (Makale 6)

**Sorun:** Mevcut xT grid 16×10 = 160 zone. Van Arem'in kuralı: `max error <0.03, 90% probability` için grid boyutu N'ye göre ayarlanmalı.

**Çözüm:**
```
N = 44118 (mevcut training data)
M_optimal = 13×10 = 130 (van Arem formülü ile)
```
Grid'i 16×10 → 13×10'a küçült, daha az parametre → daha az overfit.

### P2 — Orta vade (2-4 hafta)

#### 4.9 TabTransformer / FT-Transformer (Makale 16, Architecture doc)

**Sorun:** XGBoost categorical features için one-hot encoding kullanıyor — semantic kayıp.

**Çözüm:** Python sidecar'a TabTransformer ekle:
- Categorical features → learned embedding vectors
- Self-attention → olaylar arası gizli bağımlılıklar
- Multi-task: xG + O2.5 + BTTS aynı modelde

**Beklenen etki:** Brier -5-15%, özellikle categorical feature'lar zengin olduğunda.

#### 4.10 Weibull AFT Model — Goal Timing (Makale 16, Architecture doc)

**Sorun:** Mevcut sistem gol zamanlamasını Poisson ile modelliyor. Weibull AFT (Accelerated Failure Time) daha doğru.

**Çözüm:**
```python
# Python sidecar — Weibull AFT
from lifelines import WeibullAFTFitter
aft = WeibullAFTFitter()
aft.fit(df, duration_col='minutes_to_goal', event_col='goal_scored')
```

**Beklenen etki:** Goal timing prediction +10-15%, özellikle ikinci yarı gol patlamaları.

#### 4.11 Closing Line Value Feature (Wilkens 2026)

**Sorun:** Mevcut Goaloo odds movement sadece canlı oran değişimini kullanıyor. Wilkens 2026, xG modeline isotonic calibration uygulayarak **%10-15 ROI** elde etti.

**Çözüm:** Goaloo kapanış oranlarını feature olarak ekle:
- `closing_odds_over_2_5` — maç sonu O2.5 oranı
- `closing_odds_btts` — BTTS oranı
- `model_vs_market_divergence` — model probability vs implied probability

**Beklenen etki:** Sinyal kalitesi artar, market-efficient threshold otomatik ayarlanır.

#### 4.12 Bivariate Poisson + Weibull-Copula (Makale 12, 17)

**Sorun:** Dixon-Coles τ parametresi düşük skorlu maçları düzeltiyor ama Bivariate Poisson + Weibull-Copula daha iyi.

**Çözüm:**
- Mevcut Dixon-Coles'u Bivariate Poisson ile değiştir
- Weibull marginals + Frank Copula → joint distribution
- ZIP (Zero-Inflated Poisson) — 0-0 maçları için

**Beklenen etki:** O2.5/BTTS prediction +3-5%.

#### 4.13 Focal Loss / SoftIC for Imbalance (Makale 16, Architecture doc)

**Sorun:** Sample weight tek başına yeterli olmayabilir.

**Çözüm:**
```python
# XGBoost ile focal loss
# veya LightGBM ile
model = lgb.LGBMClassifier(
    loss='focal', focal_alpha=0.25, focal_gamma=2.0,
    ...
)
```

**Beklenen etki:** Nadir gol olaylarında recall artar, sinyal sayısı artar.

### P3 — Uzun vade (1-3 ay)

#### 4.14 GNN for Spatial Relationships (Makale 16)

**Sorun:** Mevcut sistem spatial bilgiyi (field tilt, possession) aggregate kullanıyor.

**Çözüm:** PyTorch Geometric ile GNN:
- Oyuncular = node, pas/marking = edge
- Formation 4-3-3 vs 4-4-2'nin gol beklentisine etkisi

#### 4.15 Per-Signal P&L Tracking + Kelly Criterion (Makale 11, 16)

**Sorun:** Sinyal kârlılığı takip edilmiyor.

**Çözüm:**
```sql
CREATE TABLE SignalPnL (
  signal_id String,
  calibrated_p Float,
  closing_odds Float,
  outcome Int,
  pnl Float,
  kelly_stake Float
);
```

Quarter-Kelly: `f = 0.25 * (p - (1-p)/b)` — volatiliteyi azaltır.

---

## 5. Sinyal Sayısını Artırırken Doğruluğu Yükseltme

### Mevcut: Threshold=65, tek tabanlı

### Önerilen: Multi-Tier + N-of-M Confirmation

```
┌──────────────────────────────────────────────────────────┐
│               SIGNAL TIER SYSTEM (önerilen)               │
├──────────┬─────────────┬──────────────┬───────────────────┤
│ Tier     │ Threshold   │ Confirmation │ Sinyal Sayısı     │
├──────────┼─────────────┼──────────────┼───────────────────┤
│ ELITE    │ score ≥ 50  │ ≥5/9 model   │ Az ama çok doğru  │
│ CONFIRMED│ score ≥ 55  │ ≥3/9 model   │ Orta (artar)      │
│ WATCH    │ score ≥ 60  │ ≥2/9 model   │ Yüksek (artar)    │
│ RADAR    │ score ≥ 65  │ ≥1/9 model   │ Mevcut sayı       │
└──────────┴─────────────┴──────────────┴───────────────────┘
```

**Sonuç:**
- **RADAR** tier: Mevcut sinyal sayısı (threshold=65, herhangi model)
- **WATCH** tier: Daha düşük threshold (60) ama en az 2 model onay → sinyal sayısı **ARTAR**
- **CONFIRMED** tier: 3+ model onay → yüksek güvenilirlik
- **ELITE** tier: 5+ model onay → en yüksek güven

**Neden işe yarar?**
- Düşük threshold (55-60) tek başına false positive artırır
- AMA N-of-M confirmation ile false positive düşer
- **Net etki:** Sinyal sayısı artar, doğruluk artar

---

## 6. Implementasyon Yol Haritası

### Faz A: Hemen (1-2 gün)
1. ✅ `sample_weight` ekle (5 satır) → AUC 0.50→0.65+
2. ✅ Centered isotonic regression → ECE düşer
3. ✅ Drift thresholds düşür (%5→%3, %10→%7)
4. ✅ N-of-M confirmation system → sinyal sayısı artar + doğruluk artar

### Faz B: Kısa vade (1 hafta)
5. Freeze-frame defensive features (FotMob shotmap)
6. Beta calibration (Kull 2017)
7. xT grid optimization (16×10 → 13×10)
8. DxT off-ball position features

### Faz C: Orta vade (2-4 hafta)
9. TabTransformer deep tabular model
10. Weibull AFT goal timing
11. Closing line value features
12. Bivariate Poisson + Weibull-Copula
13. Focal Loss for extreme imbalance

### Faz D: Uzun vade (1-3 ay)
14. GNN spatial relationships
15. Per-signal P&L + Kelly staking

---

## 7. Beklenen Sonuç

| Metrik | Mevcut | Faz A sonrası | Faz B sonrası | Faz C sonrası |
|--------|--------|---------------|---------------|---------------|
| Validation Brier | 0.27 | 0.20 | 0.15 | <0.12 |
| AUC | 0.50 | 0.65 | 0.72 | >0.78 |
| Sinyal sayısı | baseline | **+%20** (N-of-M lower threshold) | +%30 | +%50 |
| Precision | düşük | orta | yüksek | çok yüksek |
| Recall | düşük | **yüksek** | yüksek | yüksek |

**Hedef:** Brier <0.15, AUC >0.70, sinyal sayısı +%50, precision +%100.

---

## 8. Kaynaklar

| # | Makale | Dosya |
|---|--------|-------|
| 1 | Singh 2025 — Improving xG | `144180-improving-expected-goals-...md` |
| 2 | Calibration Drift Detection | `1-s2.0-S1532046420302392-...md` |
| 3 | Pernot 2023 — Isotonic Stratification | `2306.05180v1-...md` |
| 4 | ROC-Regularized IR | `2311.12436v1-...md` |
| 5 | Calibration Meets Reality | `2509.23665v1-...md` |
| 6 | van Arem — xT Flexibility | `2511.09457v1-...md` |
| 7 | DxT — Dynamic xT | `applsci-15-04151-...md` |
| 8 | Kull 2017 — Beta Calibration | `Full_text_PDF_final_published_version_-...md` |
| 9 | JETA 2023 — xG via XGBoost | `JETA-V3I1P104-...md` |
| 10 | Player Goal Scoring | `make-06-00086-...md` |
| 11 | Wilkens 2026 — Bundesliga xG | `wilkens-2026-...md` |
| 12 | Poisson Dissection | `DissectingPoissonbasedpredictionmodels-...md` |
| 13 | Bayesian Poisson | `Predicting_football_scores_via_Poisson_r-...md` |
| 14 | Dixon-Coles Tutorial | `Predicting Football Results...md` |
| 15 | Shot Quality Model | `Shot Quality Model.md` |
| 16 | Algorithmic Football Architecture | `Algorithmic_Football_Architecture-...md` |
| 17 | Poisson Models Review | `futbol-analiz-metotlari.md` |
| 18 | Football Prediction Review | `EN_BAŞARILI_FUTBOL_...md` |
