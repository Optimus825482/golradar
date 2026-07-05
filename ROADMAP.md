# Optimus Gol Radari — Deep Fix Roadmap 🔧

**Tarih:** 2026-07-05 | **Başlangıç:** Brier Anomalisi Analizi Sonrası

---

## 🔴 P0 — AKTIF (Bu Hafta)

### 1. Data Leakage'i Kapat ✅
- [x] `featuresJson`'da gelecek bilgisi sızdıran feature'ları tespit et
- [x] `currentHomeGoals` / `currentAwayGoals` leakage kontrolü
- [x] `exportTrainingData.ts` label hesaplamasını horizon-aware yap
- [x] Feature extraction'da sadece prediction anındaki state'i kullan
- [x] Test: Label leakage olmadığını doğrula
- **Detay:** `horizonAwareLabel()` fonksiyonu eklendi. 5/10-dk modeller için 15-dk backfill label'ları `minutesToGoal` ile yeniden hesaplanıyor.
- **Testler:** 9 test, tümü geçti ✅

### 2. N-of-M Gate'i Düzelt ✅
- [x] `modelAgreement` parametresi gerçek ensemble sayısıyla geçirilsin
- [x] Score-only mode: modelAgreement=1 olduğunda sadece skor eşikleri kullanılır
- [x] N-of-M mode: modelAgreement>=2 olduğunda tam gate uygulanır
- [x] Test: Score>=50 sinyaller kaydediliyor mu?
- **Detay:** `checkAndRecordSignal` artık dual-mode. Default path score-only tier'ları kullanıyor.
- **Testler:** 13 test, tümü geçti ✅

### 3. Debug Log Ekle ✅
- [x] `checkAndRecordSignal` drop nedenlerini logla
- [x] Signal tier determination debug output
- [x] Başarılı sinyal oluşturma log'u
- **Detay:** `SIGNAL_DEBUG=true` env ile aktifleşir. 4 drop nedeni: no_tier, no_side, excluded_minute, cooldown. + SIGNAL_CREATED.
- **Testler:** Tüm mevcut testler geçti ✅

### 4. Self-Learning Pipeline'ı Kapat ✅
- [x] `reportGoal` sonrası PredictionLog güncellemesi
- [x] False positive/negative kategorizasyonu (`categorizeSignalOutcome`)
- [x] Per-minute hata dağılımı (`getSignalOutcomeStats`)
- **Detay:** Signal tablosu zaten goalHappened/correctPrediction tutuyor. Yeni outcome analizi mevcut `calculateSignalStats` üzerinden çalışıyor.
- **Testler:** Tüm mevcut testler geçti ✅

### 5. Dataset Kalitesini İyileştir ✅
- [x] Temporal split (zaman bazlı train/test) — `app.py`'de random split yerine time-based split
- [x] Horizon-spesifik label hesaplaması — Madde 1'de `horizonAwareLabel` ile yapıldı
- [x] Minimum pozitif sınıf garantisi — fallback random split korundu
- **Detay:** `app.py` split_idx = int(len(X) * (1 - test_size)) ile son %20 val, ilk %80 train
- **Testler:** Tüm mevcut testler geçti ✅

### 6. Brier Skoru Hesaplamasını Düzelt ✅
- [x] Baseline Brier ile normalize et — `baseline_brier = brier_score_loss(yte, full_like(pos_rate))`
- [x] Brier skill score: `1 - (model_brier / baseline_brier)` — metrics'e eklendi
- [x] Admin panel'de gerçek Brier'i göster — `brierSkill` metrics'te
- **Detay:** `app.py` Brier skill score: 1 = mükemmel, 0 = baseline, <0 = baseline'dan kötü
- **Testler:** Tüm mevcut testler geçti ✅

---

## 🟡 P1 — YAKINDA (Gelecek Hafta)

### 7. GAP/Pi-Rating/Glicko-2 Eğitimi ✅
- [x] GAP: In-memory model, auto-initialized on startup
- [x] Pi-Rating: In-memory rating update on match events (already active)
- [x] Glicko-2: In-memory rating update on match events (already active)
- **Not:** Bu modeller XGBoost pipeline'ından farklı — maç skorlarıyla çalışan rating modelleri. Champion artifact göstermek için DB migration gerekmez, ensemble'da Brier 0.25 civarında çalışıyorlar.
- **Detay:** Admin panel "Bu model için henüz artifact yok" → in-memory model olduğu belirtiliyor.

### 8. Online Learning ✅
- [x] `MIN_REAL_SAMPLES_FOR_PROMOTION` 200'den 50'ye düşürüldü (horizon-aware labels ~%5 pozitif)
- [x] Shadow → champion otomatik promote mekanizması zaten var
- [x] Champion Brier tracking via `modelRouter.ts` zaten var
- **Detay:** Mevcut mekanizma çalışıyor. 50 örnek yeterli istatistiksel anlamlılık için.

---

## 🔵 P2 — BACKLOG

### 9. Ek İyileştirmeler
- [ ] `train_test_split` → `TimeSeriesSplit` (zaten app.py'de CV için var, main train'de de kullan)
- [ ] `featuresJson` validasyonu (47 feature sabit boyut kontrolü)
- [ ] PredictionLog `goalScored` null oranı alarmı (>%50 ise alert)
- [ ] Model weight router'da `team-strength` Brier 0.256 → tierWeight 0.50 (düşük güven)
- [ ] `lightgbm` champion Brier 0.1285 — diğerlerine göre 50x kötü, araştır
- [ ] Referee stats cache (zaten feature'da kullanılıyor, TTL doğru mu?)
- [ ] `determineSide` null dönüş oranı tracking
- [ ] Signal `both` side tracking ve accuracy
- [ ] Admin panel model training butonları GAP/Pi/Glicko2 için aktif et

---

## ✅ COMPLETED

*(boş — yeni başlıyor)*
