# Feature Flags — GolRadar2 Stratejik Faz 0-6 Aktivasyon Kılavuzu

Tüm yeni / değiştirilmiş çekirdek davranışlar **environment-variable gated**.
Default değerler mevcut production davranışla **birebir aynıdır** (sinyal sayısı invariant).

## Özet Tablo

| ENV Flag | Default | Faz | Açıklama | Aktivasyon Riski |
|---|---|---|---|---|
| `STACKING_BLEND_ALPHA` | `0` (kapalı) | A2+C | BMA çıktısını stacking meta-model ile blend eder (`alpha` ∈ [0,1]). α=0.5 önerilen (Brier −23.6%). Cold-start guard: 200+ eğitim örneği + agreement ≥ 0.4 gerekir. | **Düşük** — mevcut skeleton mevcut |
| `ENABLE_ONLINE_ADJUSTMENTS` | `false` | A3 | Rolling 500-window accuracy-based weight rebalance (son 500 prediction'dan). | **Düşük-Orta** — yeterli production trafiği ile |
| `ENABLE_GAP_RATING` | `false` | B (Faz 4) | Lite GAP Rating predictor aktif. **DİKKAT**: featuresJson DB'de boş olduğundan gerçek tahmin üretmiyor (stub mod). Aktifleştirmek için: featuresJson backfill job'u gerekli. | **Yüksek** — backfill gerek |
| `ENABLE_ZISM_CORRECTOR` | `false` | D (Faz 5) | Dixon-Coles corrector (Frank's κ veya ZISM β). over/under + BTTS tahminini zenginleştirir. | **Düşük** — %50 blend guardrail |
| `SKOR_KAPPA` | `-0.10` | D | Frank's Copula κ corrector parametresi. κ=-0.30 BTTS iyileşmesi −2.16% ile önerilen. | — |
| `ZISM_BETA` | `0.10` | D | ZISM zero-inflation β. β=0.20 0-0 şişirir. | — |
| `ZISM_MODE` | `'frank'` | D | 'frank' (κ) veya 'zism' (β) modu. | — |
| `BACKTEST_PERSIST_JSON` | `false` | Faz 6 | `data/backtest-results/*.json` dosyalarına backtest sonucu yaz. Trend analizi / shadow run için. | **Sıfır** (sadece diske yazma) |

## Aktivasyon Senaryoları

### 1. Stacking Blend (ilk adım — kanıtlanmış −23.6% Brier)
```bash
STACKING_BLEND_ALPHA=0.5 bun start
```
- 1 hafta shadow run
- Per-model Brier (Rule/Poisson/Elo/ML/InPlay/TeamStr) takibi
- Daily performance raporu (`data/backtest-results/*.json` aktifken)

### 2. ZISM Corrector (BTTS optimize)
```bash
ENABLE_ZISM_CORRECTOR=true SKOR_KAPPA=-0.30 bun start
```
- Frank κ=-0.30 BTTS −2.16% iyileşme üretti (dev-set 50K)
- Üretimde default κ=-0.10; κ=-0.30 BTTS için daha iyi

### 3. Online Drift (1 hafta veri biriktirdikten sonra)
```bash
STACKING_BLEND_ALPHA=0.5 ENABLE_ONLINE_ADJUSTMENTS=true bun start
```
- `recordPrediction` `goalSignalTracker.reportGoal` callback'inde zaten aktif
- 500+ gerçek prediction kaydı biriktirilmeli
- Window=2000 önerilen (1 haftalık veri)

### 4. Full Ensemble (Stacking + Corrector + Online)
```bash
STACKING_BLEND_ALPHA=0.5 \
  ENABLE_ZISM_CORRECTOR=true SKOR_KAPPA=-0.30 \
  ENABLE_ONLINE_ADJUSTMENTS=true \
  BACKTEST_PERSIST_JSON=true \
  bun start
```

### 5. GAP Rating (BACKLOG — featuresJson gerekli)
```bash
# Önce featuresJson backfill (Faz 6 backlog job):
# scripts/backfill-features-json.ts --take=50000

ENABLE_GAP_RATING=true bun start
```
- **Şu an çalıştırma**: gapRating.ts stub modda, BMA `gapP > 0` filtresi sebep → 0 katkı
- Backfill tamamlandıktan sonra aktif edilebilir

## Sinyal Sayısı Invariant Kanıtı

| Eşik | Default | Değişti mi? |
|---|---|---|
| `RADAR_THRESHOLD` | 65 | ❌ hayır |
| `SIGNAL_5MIN_THRESHOLD` | 0.25 | ❌ hayır |
| `MIN_PROB_FOR_SIGNAL` | 0.20 | ❌ hayır |
| `EXCLUDED_MINUTE_RANGES` | [0-2, 43-45, 93-120] | ❌ hayır |

Tüm yeni feature flag'ler default OFF. Yeni modüller (GAP, corrector, stacking):
- Ya `probability > 0` filtresiyle BMA'ya katılmaz (stub mod aktifken)
- Ya %50 blend ile küçük katkı (corrector, stacking α ≤ 1)
- Ya prod shadow ile doğrulanana kadar varsayılan kapalı

## Backtest Trend Analizi

`BACKTEST_PERSIST_JSON=true` ile her run sonucu diske yazılır:
```
data/backtest-results/backtest-2026-06-29T02-26-27-067Z-330.json
```
Her dosya: full backtest sonucu + config + signals. Trend analizi için external araçlarla işlenebilir (jq, pandas, vb.).

---

## Commit Timeline (Faz 0-6)

| # | SHA | Yol | Başlık |
|---|---|---|---|
| 1 | `71eb6c3` | A4 fix | tsRated clarity + O2.5/BTTS rule-based fallback |
| 2 | `42923c5` | A1 feat | Rule/Poisson/Elo bireysel Brier ölçümü + DB besleme |
| 3 | `fa1e936` | guard | Rule slot tier-archived guardrail |
| 4 | `414f2ed` | A2+C feat | Stacking file persistence + alpha-blend gating |
| 5 | `326649d` | A3 feat | recordPrediction canlıya al + applyOnlineAdjustments gating |
| 6 | `b8b3f3f` | B feat | Lite GAP predictor-stub + ensemble wiring |
| 7 | `b6c0029` | chore | .gitignore: arbor session runtime artifacts |
| 8 | `d259a6b` | docs | Birleştirilmiş oturum raporu (4 Arbor, 7 commit) |
| 9 | `5d5a9ef` | D feat | Dixon-Coles corrector (Frank κ + ZISM β) |
| 10+ | Faz 6.1+ | backtestEngine JSON writer + bu docs | (commit edilecek) |

## Arbor Oturumları

| Oturum | Oturum adı | Bulgu |
|---|---|---|
| 1 | model-brier-calibration | rule en kötü (0.3614) → guardrail |
| 2 | stacking-benchmark | α=0.5 optimal, Brier −23.6% |
| 3 | online-drift-benchmark | window=2000 → accuracy 0.710 (DB sample bias caveat) |
| 4 | gap-rating-benchmark | stub mode kanıtlandı (featuresJson DB'de boş) |
| 5 | dixoncoles-zism-corrector | Frank κ=-0.30 BTTS −2.16% en iyi |

Devam eden Faz 6 backlog: featuresJson backfill job (lite GAP aktifleştirmek için).
