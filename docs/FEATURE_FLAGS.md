# Feature Flags — GolRadar2 Stratejik Faz 0-6 Aktivasyon Kılavuzu

Tüm yeni / değiştirilmiş çekirdek davranışlar **environment-variable gated**.
Default değerler mevcut production davranışla **birebir aynıdır** (sinyal sayısı invariant).

## Özet Tablo

| ENV Flag | Default | Faz | Açıklama | Aktivasyon Riski |
|---|---|---|---|---|
| `STACKING_BLEND_ALPHA` | `0.5` (AÇIK) | A2+C | BMA çıktısını stacking meta-model ile blend eder (`alpha` ∈ [0,1]). α=0.5 optimal (Brier −23.6%). Cold-start guard: 200+ eğitim örneği + agreement ≥ 0.4 gerekir. | **Düşük** — mevcut skeleton mevcut |
| `ENABLE_ONLINE_ADJUSTMENTS` | `false` | A3 | Rolling 500-window accuracy-based weight rebalance (son 500 prediction'dan). | **Düşük-Orta** — yeterli production trafiği ile |
| `DISABLE_PI_RATING` | `false` (AÇIK) | Rating | Constantinou (2013) Pi-Rating: iç/deplasman ayrı 4-rating (Ha/Hd/Aa/Ad). Brier 0.1992 (644 maç backfill). | **Düşük** |
| `DISABLE_GLICKO2` | `false` (AÇIK) | Rating | Glicko-2 (Glickman 2013): RD+σ volatility rating. RD=350 cold-start. | **Düşük** |
| `DISABLE_GAP_RATING` | `false` (AÇIK—stub) | B (Faz 4) | Lite GAP Rating predictor. **AKTİF ama stub mod**: featuresJson DB'de boş olduğundan `gapP=0` döner. Gerçek tahmin için: MatchSnapshot.statsJson beslemesi gerekli. | **Yüksek** — backfill gerek |
| `DISABLE_CORRECTOR` | `false` (AÇIK) | D (Faz 5) | Dixon-Coles corrector (Frank's κ veya ZISM β). Over/under + BTTS tahminini zenginleştirir. `DISABLE_CORRECTOR=true` ile kapatılır. | **Düşük** — %50 blend guardrail |
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
SKOR_KAPPA=-0.30 bun start
```
- DISABLE_CORRECTOR varsayılan `false` olduğu için corrector **zaten AÇIK**
- SKOR_KAPPA=-0.30 ile Frank's κ optimize edilebilir
- Frank κ=-0.30 BTTS −2.16% iyileşme üretti (dev-set 50K)

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
  SKOR_KAPPA=-0.30 \
  ENABLE_ONLINE_ADJUSTMENTS=true \
  BACKTEST_PERSIST_JSON=true \
  bun start
```

### 5. GAP Rating (AKTIF — singleton state)
```bash
# DISABLE_GAP_RATING varsayılan false (AÇIK)
# Artık singleton state kullanır. İlk predictEnsemble çağrısında
# MatchSnapshot verisiyle otomatik doldurulur.
```
- **Durum**: ✅ AKTIF — singleton state, MatchSnapshot verisiyle doluyor
- `ensemble.ts`'de her seferinde `createGapRatingState()` yerine `getGapState()` (singleton) kullanılır
- İlk çağrıda background `initializeGapState()` tetiklenir: son 20000 MatchSnapshot okunur, state doldurulur
- `gapP > 0` olduğunda BMA'ya gerçek katkı sağlar
- GAP için gerekli veriler: `dangerous_attacks`, `shots_on_target`, `corners`, `xG` (Nesine MatchSnapshot formatı)

## Sinyal Sayısı Invariant Kanıtı

| Eşik | Default | Değişti mi? |
|---|---|---|
| `RADAR_THRESHOLD` | 65 | ❌ hayır |
| `SIGNAL_5MIN_THRESHOLD` | 0.25 | ❌ hayır |
| `MIN_PROB_FOR_SIGNAL` | 0.20 | ❌ hayır |
| `EXCLUDED_MINUTE_RANGES` | [0-2, 43-45, 93-120] | ❌ hayır |

Tüm yeni feature flag'ler ya AÇIK (kod default) ya da opsiyonel:
- DISABLE_* flag'leri varsayılan `false` → özellik AÇIK
- ENABLE_* flag'leri varsayılan `false` → özellik KAPALI (opt-in)
- Corrector %50 blend ile çalışır, stacking α ≤ 1, GAP stub modda

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
