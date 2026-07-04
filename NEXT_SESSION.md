# Sonraki Oturumda Yapılacaklar

## 1. Fresh Backtest — Gerçek Veriyle

**Sorun**: Predict API tüm tahminlerde 0.500 dönüyor.
**Sebep**: GBDT modeli OpenLigaDB verisiyle eğitildi (feature'lar çoğunlukla 0.5 nötr). Nesine'den gelen gerçek possession/shots/xG istatistiklerini görünce ne yapacağını bilmiyor.

**Yapılacaklar**:
- `backfill-training-data.py`'deki build_features fonksiyonunda Nesine stat formatını düzelt: `{h,a}` → `{home,away}`
- Nesine stats'larını featureEngineering'deki MatchFeatures yapısına doğru maple
- Convert aşamasında Nesine istatistiklerini feature vektörüne işle
- Modeli Nesine zengin verisiyle yeniden eğit
- Fresh backtest script'ini çalıştır (`node /tmp/bt.js`)

## 2. Coolify `--no-cache` Kaldır

**Sorun**: Her deploy tüm paketleri sıfırdan indiriyor (~10dk).
**Çözüm**: Coolify dashboard → golradar servisi → Build ayarları → `--no-cache` kaldır. Build süresi ~2dk'ya düşer.

## 3. Kalan Audit Bulguları

Düşük öncelikli, zaman kalırsa:
- goalRadar.ts: `goalProbability5min` NaN olabilir (sessiz hata)
- dixonColes.ts: rho tüm liglerde aynı (-0.13)
- featureEngineering.ts: `home_advantage_factor: 0.53` sabit (liga göre değişmeli)
