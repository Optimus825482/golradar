# PMB Kayıt Dosyası — Gol Sinyalı Tüm Session Taraması (2026-07-04)

## FACT_TREE: Ana Bulgu

**Main:** Gol Sinyalı projesinde 14 Arbor session + 7 plan/worklog dosyası tarandı. 8 kritik matematiksel formül hatası bulundu ve düzeltildi. 3 yeni hata bugün düzeltildi.

**Subfacts:**
1. Horizon-aware labelling en kritik hata: ~%80.7 positive rate → gerçek %14. Trainer AUC 0.500→0.794
2. Stacking meta-model alpha=0.5 optimal: BMA'dan -%23.6 Brier iyileşmesi
3. Weibull+Frank k=-0.30: BTTS'de -%19.1 iyileşme
4. Poisson en güçlü bireysel model (Brier=0.295), Rule-based en zayıf (Brier=0.361)
5. Bugün düzeltilen: H1-Kalman EKF linearizasyonu, H2-Weibull PMF survival-based, H3-Lanczos logΓ
6. 266 test, 0 fail — regresyon yok
7. M1-M2 sinyal kalitesi: eşik 60 çok düşük, sinyallerin %47'si 60-64 bandında M1=%27.9

## DERSLER (Lessons)

### Matematiksel Formül Hataları
1. XGBoost base_score ve GBDT initPrediction: probability space ile log-odds space karıştırılmamalı. base_score olasılık uzayından log-odds'a çevrilmeli: Math.log(p/(1-p))
2. Pi-Rating sign hatası: predict fonksiyonunda savunma terimleri yanlış işarette. Ha + Ad olmalı Ha - Ad (güçlü savunma → az gol)
3. GAP Rating lambda: exp(Ha - Ad) maks exp(3) ~20 gol üretiyor. GAP_LAMBDA_SCALE=3 ile exp((Ha-Ad)/3) olarak düzeltildi
4. Glicko-2 void discard: updateOneRating saf fonksiyon ama sonuçlar void ile discard ediliyordu. Return tipi UpdatedRating yapıldı
5. PAVA backward merge: sadece ileri blok oluşturuyor, geri birleştirme yoktu → azalan non-monotonic çıktı. Backward merge while eklendi
6. Ensemble Brier map: 7 değişken / 9 promise destructure hatası. Rule-Based'e GBDT, Poisson'a XGB Brier'i atanıyordu
7. Elo K-factor compounding: if zincirinde 6 gol → k * 1.2 * 1.15 * 1.1. else if zinciri ile düzeltilmeli
8. Dixon-Coles corrector işaret: k<0 dalı eşit-olmayan skorları bastırmalı (pozitif korelasyon)

### Veri Etiketleme
9. Horizon-aware labelling: goalHappened = exists(goal in (minute, minute+HORIZON]). ESKİ formül tüm anları positive işaretliyordu
10. Train/val split: zaman serisinde orderBy desc + slice = look-ahead bias. EGITIM eski, VALIDASYON yeni veri olmalı

### Mimari
11. 9-model Bayesian Model Averaging: Rule/Poisson/Elo/XGBoost/Glicko-2/Pi/Kalman/GAP/InPlay. Brier-tier weights + stacking blend (alpha=0.5)
12. MLOps pipeline: train → shadow → compare → promote. Otomatik günlük 03:00
13. 80 feature, 8 kategori. FotMob shotmap → shot geometry. Closing line value. Referee stats (Transfermarkt)
14. SSE + In-Memory Cache: 1000+ istemci → single writer → 5s TTL → SSE push. 150s/poll → 5s/poll
15. N-of-M sinyal onay: Elite >=50 + 5/9, Confirmed >=55 + 3/9, Watch >=60 + 2/9, Radar >=65 + 1 model
16. Model collapse detection: AUC=0.500 + Brier=pos_rate*(1-pos_rate) → model sabit tahmin yapıyor
17. Sentetik veri riski: %30-40 goal oranı vs gerçek %14. Döngüsel bias. baseGoalP=0.14*(10/90) ile düzelt
18. 3-horizon XGBoost: 5dk, 10dk, 15dk için ayrı modeller

### Kalman EKF (bugün düzeltildi)
19. Kalman update EKF: K = P/(λ·P + 1), x_new = x + K·(y-λ), P_new = (1-K·λ)·P. ESKİ kod count-scale ve log-scale karıştırıyordu

### Weibull (bugün düzeltildi)
20. Weibull PMF: P(k) = S(k) - S(k+1), S(t) = exp(-(t/b)^c), b = λ/Γ(1+1/c). P(0) ASLA sabit 1 olamaz

### Lanczos logΓ (bugün düzeltildi)
21. Lanczos: z = x + 7.5, logΓ(x) = 0.5·ln(2π) + (x+0.5)·ln(z) - z + ln(ser/x). ESKİ kod tmp her zaman 7.0 yapıyordu
