# GolRadar2 — Sinyal Doğruluğu Artırma Stratejik Programı (Rapor)

**Oturum tarihi:** 2026-06-29  
**Toplam commit:** 7 (`71eb6c3` → `b6c0029`)  
**Toplam Arbor oturumu:** 4 (16+ hipotez, 12 completed, 4 pruned)  
**Sinyal sayısı invariant:** Tüm feature flag'ler default kapalı; mevcut eşikler (RADAR=65, SIGNAL_5MIN=0.25) değişmedi.

---

## 1. Commit Timeline

| # | SHA | Yol | Başlık |
|---|---|---|---|
| 1 | `71eb6c3` | A4 (fix) | tsRated clarity + O2.5/BTTS rule-based fallback |
| 2 | `42923c5` | A1 (feat) | Rule/Poisson/Elo bireysel Brier ölçümü + DB besleme |
| 3 | `fa1e936` | guard | Rule slot tier-archived guardrail (sinyal sayısı invariant) |
| 4 | `414f2ed` | A2+C (feat) | Stacking file persistence + alpha-blend gating |
| 5 | `326649d` | A3 (feat) | recordPrediction canlıya al + applyOnlineAdjustments gating |
| 6 | `b8b3f3f` | B (feat) | Lite GAP predictor-stub + ensemble wiring |
| 7 | `b6c0029` | chore | .gitignore: arbor session runtime artifacts |

---

## 2. Arbor Oturum Sonuçları

### 2.1 model-brier-calibration

| Metrik | Değer |
|---|---|
| Primary metric | brierRule (minimize) |
| Baseline | **0.3614** (rule-based en kötü) |
| Optimal | (öçülmedi — prod shadow gerek) |

**Bulgular:**
- 80K dev örnek, positive rate %38.9
- brierRule = **0.3614** (en kötü, A4 guardrail gerektirdi)
- brierPoisson = **0.2948** (en iyi, çok düşük ağırlıkla)
- brierElo = 0.3101, brierML = 0.3832
- brierMultiBaseline = 0.321 (mevcut WR=0.45/WP=0.35/WE=0.20)
- H1.1 baseline completed, H1.2/3/4 pruned (prod shadow gerek; Faz 6'ya taşındı)

**Karar:** Rule slot tier-archived guardrail'i (commit `fa1e936`) — BRier ≥ 0.35 ise null döndür.

### 2.2 stacking-benchmark

| Metrik | Değer |
|---|---|
| Primary metric | brierBmaStackingWeighted (minimize) |
| Baseline (BMA-only) | **0.3210** |
| Optimal α | **0.5** |
| Optimal brierBlend | **0.2452** |
| Delta vs BMA | **−23.6 %** |

**Alpha sweep (80K dev):**

| α | brierBlend |
|---|---|
| 0.0 (BMA) | 0.3210 |
| 0.1 | 0.2966 |
| 0.3 | 0.2617 |
| **0.5** | **0.2452** |
| 0.7 | 0.2474 |
| 1.0 (Stack) | 0.2853 |

**Beklenmedik bulgu:** Cold-start'ta bile (default eşit ağırlıklar) stacking meta-model BMA'dan iyi (0.2853 vs 0.3210). ML katkısı eklendiği için zenginleşme doğal.

### 2.3 online-drift-benchmark

| Metrik | Değer |
|---|---|
| Primary metric | maxAccuracy (maximize) |
| Baseline (window=500) | **0.562** |
| Optimal (window=2000) | **0.710** |

**Window sweep:**

| Window | accuracy | positiveRate |
|---|---|---|
| 200 | 0.115 | 0.910 |
| 500 | 0.562 | 0.478 |
| 1000 | 0.682 | 0.336 |
| **2000** | **0.710** | 0.302 |

**Beklenmedik bulgu:** DB sample bias — son N kayıtlar aktif maçlardan (henüz completed olmamış), positiveRate ciddi distorsiyon yaratıyor. Üretim shadow run'da dikkate alınmalı.

### 2.4 gap-rating-benchmark (Yol B)

| Metrik | Değer |
|---|---|
| Primary metric | brierBlend (minimize) |
| Baseline (100K) | **0.1414** |

**Beklenmedik bulgu:** predictionLog.featuresJson kolonu DB'de dolu değil (matchesWithFeatures=0). GAP predictor stub modunda committed.

**Stub mod:** updateGapRating no-op, predictGapMatch gapP=0 döndürür. BMA `gapP > 0` filtresi sayesinde ensemble etkilenmez (sinyal sayısı invariant).

---

## 3. Aktifleştirme Rehberi (Production)

Tüm yeni özellikler environment-variable gated:

| ENV | Default | Aktivasyon | Etki |
|---|---|---|---|
| `STACKING_BLEND_ALPHA` | 0 (kapalı) | 0.5 (önerilen) | BMA + stacking meta-model blend |
| `ENABLE_ONLINE_ADJUSTMENTS` | false | true | rolling 500-window accuracy → ensemble weight rebalance |
| `ENABLE_GAP_RATING` | false | true (Faz 6 backlog) | Lite GAP aktif (featuresJson backfill gerek) |

**Önerilen shadow run planı:**
1. İlk olarak `STACKING_BLEND_ALPHA=0.5` 1 hafta shadow
2. Brier delta doğrulanırsa ENABLE_ONLINE_ADJUSTMENTS=true 1 hafta
3. Lite GAP için featuresJson backfill job'u yazıp ENABLE_GAP_RATING=true

---

## 4. Sinyal Sayısı Invariant Kanıtı

Her commit'te `RADAR_THRESHOLD` ve `SIGNAL_5MIN_THRESHOLD` değişmedi:
- `RADAR_THRESHOLD=65` (env override range 40-80)
- `SIGNAL_5MIN_THRESHOLD=0.25`
- Yeni modeller **gapP > 0** filtresiyle BMA'ya katılır → aktif değilken etkisiz
- Rule slot tier-archived guardrail (RULE_BRIER_FLOOR=0.35) tier rotasyonundan korur

---

## 5. Dosya / Modül Eklemeleri

**Yeni dosyalar (7):**
- `src/lib/ml/gapRating.ts` — Lite GAP predictor-stub
- `src/lib/ml/brierCache.ts` — ölçülmüş Brier DB önbelleği
- `scripts/measure-model-briers.ts` — per-model Brier ölçer
- `scripts/stacking-benchmark.ts` — stacking Brier benchmark
- `scripts/online-drift-benchmark.ts` — drift accuracy tracker
- `scripts/gap-rating-benchmark.ts` — GAP Brier benchmark
- `.arbor/{model-brier-calibration, stacking-benchmark, online-drift-benchmark, gap-rating-benchmark}/eval.py`

**Önemli düzenlemeler:**
- `src/lib/ensemble.ts`: gapP entegrasyonu, alpha-blend gating, finalEnsembleP
- `src/lib/goalSignalTracker.ts`: recordPrediction canlıya alındı
- `src/lib/ml/stackingEnsemble.ts`: file persistence, gap slot
- `src/lib/ml/weightTuner.ts`: TIER_CAPS.gap, applyOnlineAdjustments gap
- `src/lib/ml/brierCache.ts`: 'gap' MeasuredModelName

---

## 6. Kapsam Dışı (Faz 5 + Faz 6 — Backlog)

### Faz 5 (Yol D) — Frank's Copula / ZISM corrector
- **Plan durumu:** Planlandı (Task ID yok); kullanıcı manual review tercih etti
- **Kapsam:** new `dixonColesCorrector.ts` (κ corrector + ZISM mode), factors.ts patch, benchmark, 4 hipotez

### Faz 6 — Rollout + BacktestEngine JSON writer
- `data/backtest-results/` JSON yazıcı (şu an boş)
- Production feature flag dokümantasyonu
- 48 saat shadow run klavuzu
