# MatchDetailContent Yeniden Yapılandırma Planı

## Mevcut Yapı (Sorun)

```
1. Match Header (score, pressure gauges, Goal Radar)
   ↓
2. Momentum & Dangerous Attacks Charts ✅ (DOKUNMA)
   ↓
3. 🔴 Maç İstatistikleri (Nesine) ← statKeys ile
4. 🔴 Scoremer Stats (biten maçlar) ← AYNI ŞEYLER!
5. 🔴 FotMobSection (tabs: events | stats | info)
6. Upcoming Match Prediction (sadece gelecek maç)
7. 🔴 Takım Bilgileri (Elo + Pi + Last 5) ← FotMob.info ile AYNI!
```

## Hedef Yapı (Çözüm)

```
1. Match Header (score, pressure gauges, Goal Radar)
   ↓
2. Momentum & Dangerous Attacks Charts ✅ (DOKUNMA)
   ↓
3. 📊 BİRLEŞİK MAÇ İSTATİSTİKLERİ [YENİ]
   ├── Nesine stats (canlı)
   ├── Scoremer stats (biten maçlar için zenginleştirilmiş)
   ├── FotMob stats (shots, xG, cards)
   └── Events timeline (en altta)
   ↓
4. 🔮 Maç Tahmini (sadece gelecek maç)
   ↓
5. 👥 BİRLEŞİK TAKIM BİLGİLERİ [YENİ]
   ├── Elo + Atak/Savunma
   ├── Pi-Rating
   ├── Son 5 Maç
   ├── Sezon istatistikleri
   └── Hava durumu + Kadro (FotMob.info'dan)
```

## Değişiklik Listesi

### 1. FotMobSection.tsx — Tab yapısını kaldır, 3 bölümü ayrı export et

**Değişiklik:** Mevcut `FotMobSection` component'ini 3 ayrı export'a böl:
- `FotMobStatsBlock` — shotmap, xG, cards
- `FotMobInfoBlock` — weather, squad, formation, referee
- `FotMobEventsBlock` — goal, card, substitution timeline

**Kod:** 94 satır → yeni 3 component × ~40 satır = ~120 satır

### 2. MatchDetailContent.tsx — Yeniden yapılandır

| Bölge | Yeni Yapı | Efor |
|-------|-----------|------|
| Satır 460-523 (Nesine stats) | Birleşik Stats'ın 1. kısmı | ~3 satır header değişikliği |
| Satır 526-577 (Scoremer stats) | Birleşik Stats'ın 2. kısmı | Scoremer'ı birleşik container'a taşı |
| Satır 579-588 (FotMobSection) | `FotMobStatsBlock` + `FotMobEventsBlock` | Tab'ları kaldır, events en alta |
| Satır 661-833 (Takım Bilgileri) | `FotMobInfoBlock` ile birleştir | İki takım block'u + FotMob info |

### 3. Görsel İyileştirmeler

- **Renk kodu:** Stats'ta ev = portakal (#f97316), deplasman = mavi (#3b82f6) — header'daki renklerle tutarlı
- **Mobile-first:** Events timeline için swipeable/drawer alternatifi
- **Loading states:** Her bölüm için skeleton loading
- **Compact mode:** Stats satırlarını daha sıkışık göster (text-[11px] → text-[10px], padding azalt)

## Uygulama Adımları

```bash
# 1. FotMobSection'u 3 parçaya böl
touch src/components/fotmob/FotMobStatsBlock.tsx
touch src/components/fotmob/FotMobInfoBlock.tsx
touch src/components/fotmob/FotMobEventsBlock.tsx

# 2. MatchDetailContent.tsx'i yeniden yapılandır
# 3. Test + type check
```

## Riskler

| Risk | Seviye | Mitigasyon |
|------|--------|-----------|
| FotMobSection kırılması | ORTA | Eski component'i import edip wrapper yap, yavaş geç |
| Momentum chart etkilenmesi | DÜŞÜK | Aynı props'u geç, hiçbir şey değiştirme |
| Null/fotmobData yok | DÜŞÜK | Mevcut guard'lar korunuyor |

## Onay

Bu planı onaylarsan implemente edeyim. Momentum grafiğine KESİNLİKLE DOKUNMAYACAĞIM. 
