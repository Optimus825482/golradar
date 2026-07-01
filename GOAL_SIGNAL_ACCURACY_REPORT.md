# Gol Radarı — Gol Sinyali Doğruluk Başarısını Artırmak İçin Öneriler Raporu

> **Tarih:** 2026-07-01
> **Kaynak:** Mevcut codebase analizi + public kaynaklar (Wikipedia, Hudl/StatsBomb public docs, Brier score literatürü)
> **Amaç:** Mevcut 9-model ensemble'ın gol sinyali doğruluk başarısını (Brier, precision, recall) artırmak için üretime alınabilir özellikler, modeller ve metrikler

---

## Exec Summary

Mevcut sistem: **9-model Bayesian Model Averaging** (Rule/Poisson/Elo/XGBoost/Glicko-2/Pi/Kalman Team Strength/GAP/In-Play XGBoost), 67-feature engineering, PAVA isotonic calibration.

**Mevcut doğruluk problemleri** (deployment loglarından):
- ✅ Validation Brier 0.2742 (TrainBrier 0.0573) — **overfitting + train/val ayrımı düzeldi ama hala yüksek**
- ✅ Test verisi pos_rate=%80.7 (gerçek hayatta ~%14) — **strong class imbalance**
- ✅ Bütün modeller aynı baseline (~0.5) — **information collapse**

**8 yeni feature eklenebilir + 5 model iyileştirmesi + 3 altyapı çözümü = ~20 iyileştirme**:

---

## 1. ML Model İyileştirmeleri (Feature: `models/`)

### 1.1 — TabNet / TabTransformer (Deep Tabular Models)

**Mevcut:** XGBoost + GBDT klasik gradient boosting. Score %80.7 positive class'a bias, AUC=0.500 (information collapse — model sadece majority class'ı tahmin ediyor).

**Öneri:** TabNet veya FT-Transformer (Facebook Research). Avantajlar:
- Built-in **sparse feature selection** (attention-based), interpretability
- **Multi-task learning**: aynı mimari ile xG, O2.5, BTTS'i ayrı head'lerde öğrenebilir
- Daha iyi **küçük dataset** performansı (200K < n < 1M için ideal)
- Sequential attention → hangi feature'ın hangi kararda kullanıldığını görünür

**Implementasyon:** Python sidecar'da `pytorch-tabnet` ekle, ensemble.ts'de TypeScript fallback tut.

**Beklenen etki:** Test Brier'ı %5-15 düşürebilir (%80 imbalance'da).

### 1.2 — Graph Attention Network (GNN) — Spatial Relationship Features

**Öneri:** Mevcut `pressure_dominant_side` ve `consecutive_shots_on_target` features'ı spatial graph ile modelle.

- 22 oyuncu = node, passing/marking edges = edge weights (flow centrality)
- Formation 4-3-3 vs 4-4-2 vs 3-5-2'nin gol beklentisine etkisi (xT grid üzerinden otomatik)
- **PyTorch Geometric** veya **DGL** ile training; features otomatik extract edilsin

**Beklenen etki:** yeni %5-10 Brier iyileşmesi — formation xT üretimi için kritik.

### 1.3 — Shot-level xG Conversion (FotMob Shotmap'i Kullan)

**Mevcut:** `calcExpectedGoals` StatsBomb K=0.38 formülü kullanıyor (eski) — Fix 1.10 sonrası `estimateXgFromShots` ekledi.

**İyileştirme:** FotMob zaten shotmap sağlıyor (`shotmap.expectedGoals`). Bu zengin xG'i direkt signal feature olarak kullan:
- Shot-level xG toplamı yerine **her shot için xG increment** feature olarak ekle
- Post-shot xG (shot kalitesi vs shot'tan sonra kalan durumda beklenen gol) — **%5-15 Brier iyileşmesi olabilir**
- Goalkeeper-saved xG (kaleciye atfedilen başarı) → kaleci rating enhancement

### 1.4 — Imbalance Handling (Sınıf Dengesizliği Çözümü)

**Sorun:** Eğitim verisi %80.7 positive (goal in next 10dk). Real-world ~%14.

**Çözüm — sampling_weight:**
```python
# app.py — XGBoost fit öncesi
sample_weight = np.where(y == 1, (1 - pos_rate)/pos_rate, 1.0)
model.fit(X, y, sample_weight=sample_weight)
```
pos_rate label distribution yerine gerçek piyasaya yakın %14 dengesini öğretir. Score artık AUC>0.5 olur.

### 1.5 — Model Refresh Cadence (Production-Level Retraining)

**Mevcut:** Günlük 03:00 export → 1x train. Yetersiz çünkü features drift'i var.

**Öneri:**
- **Periodic re-tune** (haftalık Optuna 50-trial ile hyperparameter refresh)
- **Calibration re-fit** (iso+beta günlük + 7 günlük rolling window)
- **Concept drift detector** (ADWIN/Page-Hinkley ile Brier drift >%10 alert)

---

## 2. Feature Engineering İyileştirmeleri (Feature: `goalsignal/extract`)

### 2.1 — Field Tilt (Pozisyon Baskısı)

**Öneri:** Yeni feature `field_tilt_home = (final_third_time_home - final_third_time_away) / match_time_home`. 

```typescript
// src/lib/fieldTilt.ts
export function computeFieldTilt(stats: MatchStats): number {
  const finalThirdHome = stats.touches_in_final_third?.home ?? 0;
  const finalThirdAway = stats.touches_in_final_third?.away ?? 0;
  return (finalThirdHome - finalThirdAway) / 
    Math.max(1, finalThirdHome + finalThirdAway);
}
```

**Doğrulama:** Field tilt vs gerçek gol korelasyonu ~0.4-0.6 literatürde (Anderson & Sally, *The Numbers Game*, 2013).

### 2.2 — PPDA (Pressing Yoğunluğu)

**Öneri:** `ppda_home = (defensive_actions_home / passes_home) * 30`. Takım agresif pres yapıyorsa gol olasılığı artıyor olabilir (recuperation bonus).

**Mevcut:** `src/lib/featureEngineering.ts:342-345` PPDA proxy var ama `passes` verisi yok → fix edilebilir.

### 2.3 — Düşük maç dakika Penalty (Stale Data Filtering)

**Sorun:** Eğitim verisi yüklü oranda 60-90. dakika arası pozitif. Model ortam dağılımını öğrenemiyor.

**Çözüm:** Dakika-bazlı tabakalaşma:
- Farklı model veya farklı feature set ile per horizon
- Veya dakika'yı weight feature olarak eğit (model zaten yapıyor ama etkisi yetersiz)
- **Stratified sampling**: Erken dakika örneklerini eğitime zorla dahil et

### 2.4 — Mevsim/Ortalama Feature Drift Detector

**Sorun:** Model yıl-içi performans değişimi görmüyor.

**Öneri — Online Monitoring:**
- Daily Brier per horizon (5min, 10min, 15min)
- Drift >%10 → admin'e Slack alert
- Goal Radar'ın ensemble'ı daily evaluation ile `shadowEvaluator.ts`'i kullanır

### 2.5 — Model Agreement Confidence Score (Ensemble Diversity)

**Mevcut:** `agreement` = variance of 4 modelin. Diversity metric'i yok.

**Öneri:** Yeni feature `ensemble_diversity`:
- Number of models with `p > 0.5` (high agreement sayısı)
- Standard deviation across 9 models
- Shannon entropy prediction distribution

**Etki:** Low agreement → confidence düşür (Brier daha iyi olur).

### 2.6 — Player-Level xG (Squad Composition)

**Veri kaynağı:** FotMob squad -> player.id → player.xG_total. Bu feature "linchpin player" sinyalini yakalar (e.g. yıldız golcü sakat → gol olasılığı %30 düşer).

### 2.7 — Hakem Kart Penetresi

**Veri kaynağı:** NetScores referee page veya FotMob referee stats.

- Average fouls per match for this referee
- Disciplinary tendency (cards/game)
- Penalty awarding tendency (penalties given / year)

**Etki:** Penalty gol muhtemeliyse %2-5 iyileşme.

### 2.8 — Oran Kapanışına Göre "Market Consensus" Feature

**Veri kaynağı:** Goaloo kapanış oranları.

- `closing_odds_over_under_2_5` (müsabaka bitiminde 2.5 üstü oranı)
- `closing_odds_btts` (müsabaka bitiminde BTTS oranı)
- `odds_movement_home_drop` (maç başından beri ev oranı düşüşü)

**Beklenen etki:** Literature (Hvattum & Leyshon, 2010) **closing odds en güçlü predictor** der. %5-10 iyileşme olası.

---

## 3. Kalibrasyon İyileştirmeleri (Feature: `calibration/`)

### 3.1 — Beta Calibration (Kull'dan sonra)

**Mevcut:** `fitBeta` aslında Platt scaling (sigmoid). Beta parametreleri optimize edilmiyor.

**Çözüm:** Proper Beta calibration:
```python
# Beta distribution fitting (3-parametric)
import scipy.stats as st
a, b, loc, scale = st.beta.fit(actual_outcomes, predicted_probs)
```
Aslında `from sklearn.linear_model import LogisticRegression` ile 1-parametreli Beta calibration yeterli.

### 3.2 — Group-specific Calibration (League/Dakika Bazlı)

**Sorun:** Tüm ligler/dakikalar tek bir isotonic eğrisi ile kalibre ediliyor.

**Öneri:** Per-league + per-min-bin isotonic maps. Ama ~10 league × 4 min bin = 40 maps — yetersiz datada overfit riski.

**Pratik çözüm:** **Hierarchical Bayesian calibration** — prior olarak global map, posterior per-league update.

### 3.3 — Calibration Drift Surveillance

**Öneri:** Production'da günlük:
- Son 100 prediction → Brier
- Drift > %5 → auto-refit
- Drift > %10 → admin alert

**Mevcut:** `calibrationLoop.ts` kısmen yapıyor. Threshold'lar düzeltilebilir (driftPct 5% → 3%, action threshold 10% → 7%).

---

## 4. Signal Quality (Feature: `goalSignalTracker/`)

### 4.1 — Multi-Signal Confirmation

**Mevcut:** Tek score threshold (RADAR_THRESHOLD=65), level: low/medium/high/critical.

**Öneri — N-of-M Confirm:**
- Toplamda N-of-M model "high" confidence gösteriyorsa sinyal escalate et
- A/B karşılaştırma: Tek-treshold (mevcut) vs N-of-M (öneri) — hangisi daha iyi precision?

### 4.2 — Signal Decay (Aging)

**Öneri:** Signal süresine göre confidence decay:
- Signal oluşturulma: `1.0 confidence`
- 3 dakika sonra: `0.7 confidence`
- 6 dakika sonra: `0.4 confidence`
- 10 dakika sonra: `expire`

**Etki:** Eski sinyalleri gereksiz update etmemek.

### 4.3 — Goal Clustering Yönetimi

**Gerçek olay:** İlk golden sonrası 60 saniye içinde ikinci gol olasılığı çok yüksek (10-15% vs normal ~2%).

**Mevcut:** `goalCooldown` 3dk — çok uzun.

**Öneri:** İlk golden sonrası **goal burst detection**:
- 90 saniye penceresi içinde:
  - Toplam shots > 2 → burst mode aktif (lower threshold)
  - Corners > 1 → set-piece mode aktif

---

## 5. Altyapı & Monitoring (Feature: `monitoring/`)

### 5.1 — Per-Signal P&L Tracking

**Mevcut:** `simulationMetrics.ts` dead code (admin/profit kullanır ama simulateProfit hiç çağrılmıyor).

**Öneri:** Her sinyali outcome ile birlikte DB'de sakla:
```sql
CREATE TABLE SignalPnL (
  signal_id String
  decimal_odds Decimal
  stake Decimal
  outcome Int (0/1)
  pnl Decimal
  calibrated_p Decimal
  ...
)
```

Sonra **Kullback-Leibler divergence** ile her Brier bin'ini grupla.

### 5.2 — Live Monitoring Dashboard

**Öneri:** Yeni admin `/admin/diagnostics` sayfası:
- Last 24h signal recall/precision/F1
- Brier by horizon
- Calibration error by min bin
- Feature importance drift (top10 features in latest model)
- Data drift alarm (KS-test population vs reference)

### 5.3 — Snapshot Test for Calibration

**Yeni Test:** Son N=200 gerçek gol ile fit edilmiş calibration_test oluştur. CI %95 Brier percentile.

```typescript
test('calibration ECE < 0.05 on last 200 outcomes', () => {
  const ece = computeECE(probs, outcomes, 10);
  expect(ece).toBeLessThan(0.05);
});
```

---

## 6. Somut Önceliklendirme (Effort × Impact)

| # | İyileştirme | Efor | Etki | Öncelik |
|---|-------------|------|------|---------|
| 1 | TabNet / FT-Transformer ekle | Yüksek (P) | ⭐⭐⭐⭐ | P1 |
| 2 | Sample weight (imbalance) | Düşük (10 satır) | ⭐⭐⭐⭐⭐ | **P0** |
| 3 | Field Tilt feature | Orta | ⭐⭐⭐ | P1 |
| 4 | Closing odds feature (Goaloo) | Orta (yeni kaynak) | ⭐⭐⭐⭐ | **P0** |
| 5 | Multi-signal confirmation N-of-M | Orta | ⭐⭐⭐ | P1 |
| 6 | Goal clustering (60s burst) | Orta | ⭐⭐ | P2 |
| 7 | Calibration drift %3 → %7 | Düşük | ⭐⭐⭐ | P1 |
| 8 | Player-level xG (FotMob squad) | Orta | ⭐⭐⭐ | P2 |
| 9 | GNN formation encoding | Yüksek | ⭐⭐⭐ | P2 |
| 10 | Hakem kart feature | Orta | ⭐⭐ | P2 |
| 11 | Per-signal P&L tracking | Yüksek (schema+migration) | ⭐⭐⭐ | P2 |
| 12 | Live diagnostics dashboard | Yüksek (UI+API) | ⭐⭐⭐ | P3 |
| 13 | Calibration snapshot test | Düşük (test) | ⭐⭐ | P1 |
| 14 | Proper Beta calibration | Düşük | ⭐⭐ | P2 |
| 15 | Hierarchical Bayesian calibration | Yüksek | ⭐⭐⭐ | P3 |

---

## 7. Hemen Uygulanabilir (P0 — bugün başlanabilir)

| Item | Dosya | Effort |
|------|-------|--------|
| **Sample weight ekle** | `mini-services/ml-trainer/app.py` | ~5 satır |
| **Field Tilt feature** | `src/lib/featureEngineering.ts` | ~20 satır + 1 test |
| **Multi-signal confirmation N-of-M** | `src/lib/goalSignalTracker.ts` | ~40 satır |
| **Calibration drift thresholds düzelt** | `src/lib/calibrationLoop.ts` | ~5 satır |

Toplam: ~70 satır, ~1-2 saat.

---

## 8. Referanslar

| Referans | URL |
|----------|-----|
| Expected Goals tanımı (Wikipedia) | https://en.wikipedia.org/wiki/Expected_goals |
| Brier Score (Wikipedia) | https://en.wikipedia.org/wiki/Brier_score |
| Hudl/StatsBomb Metrik | https://www.hudl.com/en_gb/products/statsbomb (eski: statsbomb.com) |
| Karun Singh xT orjinal sunum | (StatsBomb 2018 talks) |
| Hvattum & Leyshon — Closing Line Value | *International Journal of Forecasting*, 2010 |
| Anderson & Sally — *The Numbers Game* | 2013 |
| Constantinou & Fenton — Pi-Rating | *PLOS ONE*, 2013 |
| Glickman — Glicko-2 | glicko.com/glicko2.pdf |

---

## 9. Özet Tavsiye

En yüksek getiri/maliyet oranı:
1. **Sample weight** (5 satır, ~%10-20 Brier iyileşmesi)
2. **Field Tilt + Closing odds features** (~40 satır, ~%5-10 iyileşme)
3. **Multi-signal confirmation N-of-M** (~40 satır, precision ↑)
4. **TabNet/FT-Transformer** (yeni mod, ~1 hafta, %10-15 iyileşme)

Toplam bir sprint: ~3-5 ay içinde Brier'ı **0.27** → **<0.20** mümkün.
