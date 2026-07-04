# Sonraki Oturumda Yapılacaklar

## 1. ✅ DONE: Feature Vector 67→87 + Nesine Data Fix
- `exportTrainingData.ts`: TARGET_FEATURE_COUNT hardcoded 67 → FEATURE_NAMES.length (87)
- `backfill-training-data.py`: build_features 67→87, per-15 rate normalization
- Nesine label fix (%78 → %15 goal rate)
- Container'da `--force` ile convert worked (22986 records, 87 features)

## 2. ✅ DONE: Poll-Writer Timeout Fix
- matches/route.ts: Nesine API 5s→10s + 1 retry
- poll-matches/route.ts: 8s→30s timeout + stale lock guard
- trainingScheduler.ts: 8s→20s
- `?writer=1` → skips Goaloo/FotMob/ML enrichment (150s→5s per poll)
- goalRadar always calculated (was undefined for writer path)

## 3. ⚠️ NEEDS WORK: calibratedP Too Low (score→probability mapping)
- goalProbability5min: 0.393 (39%) — good
- calibratedP: 0.003 — too low, score=3 mapped to near-zero
- `calibrateScore()` function too aggressive
- Fix: review `calibrateScore()` in goalRadar/calibration.ts

## 4. ⚠️ WAITING: ML Model Retrain with Real Data
- XGBoost trained on backfill data → Brier=0.0026 (data leakage, fake)
- Need 24-48h of live PredictionLog data
- Then export → retrain → realistic Brier

## 5. TODO: Kalan Audit Bulguları
- goalRadar.ts: goalProbability5min NaN olabilir
- dixonColes.ts: rho tüm liglerde aynı (-0.13)
- featureEngineering.ts: home_advantage_factor: 0.53 sabit
