# page.tsx Component Bölme Planı

## Goal
1768 satırlık `src/app/page.tsx`'i (31 useState, 14 useEffect) odaklanmış alt component'lere böl.

## Mevcut Yapı

```
page.tsx (1768 satır)
├── Data fetching orchestration (useEffects, useCallbacks)
├── Memo hesaplamaları (goalProbabilities, chartData, etc.)
├── AppHeader (85 satır)
├── RadarAlertBanner (30 satır)
├── UpcomingMatchList (110 satır, inline renderMatchList içinde)
├── MatchListView (274 satır renderMatchList)
├── DesktopDetailPanel (35 satır)
├── MobileDrawerPanel (35 satır)
├── GoalNotificationToasts (50 satır)
└── BottomNavBar (zaten ayrı component ✅)
```

## Tasks

- [ ] **Task 1: Extract `AppHeader`** → yeni `src/components/AppHeader.tsx`
  - Props: `lastUpdate`, `wsConnected`, `sortBy`, `onToggleSort`, `liveCount`, `radarCount`, `activeTab`, `onRadarClick`
  - Verify: sayfa açılır, header aynı görünür

- [ ] **Task 2: Extract `RadarAlertBanner`** → yeni `src/components/RadarAlertBanner.tsx`
  - Props: `radarCount`, `onClick`
  - Verify: radar threshold geçen maç varsa banner gözükür

- [ ] **Task 3: Extract `UpcomingMatchList`** → yeni `src/components/match/UpcomingMatchList.tsx`
  - Props: `upcomingMatches`, `isLoading`, `onSelectMatch`
  - Verify: "all" tab'inde yaklaşan maçlar listesi aynı render edilir

- [ ] **Task 4: Extract `DesktopDetailPanel`** → yeni `src/components/match/DesktopDetailPanel.tsx`
  - Props: `selectedMatch`, `detailProps`, `onClose`
  - Verify: masada maç seçince sağ panel açılır

- [ ] **Task 5: Extract `MobileDrawerPanel`** → yeni `src/components/match/MobileDrawerPanel.tsx`
  - Props: `drawerOpen`, `selectedMatch`, `detailProps`, `onClose`
  - Verify: mobilde maç seçince drawer açılır

- [ ] **Task 6: Extract `GoalNotificationToasts`** → yeni `src/components/GoalNotificationToasts.tsx`
  - Props: `goalNotifications`
  - Verify: gol olunca toast bildirimi gözükür

- [ ] **Task 7: Cleanup page.tsx** → kalan ~600-700 satır
  - Kalan: data fetching, memo hesaplamaları, top-level render
  - Tüm import'ları güncelle
  - Verify: sayfa build olur, tüm özellikler çalışır

## Riskler
- `detailProps` memo tüm alt component'lerin ihtiyacı olan birleşik prop — her extract'te props interface'i doğru taşınmalı
- `useCallback` referansları değişirse alt component'ler gereksiz re-render yiyebilir → `React.memo` wrapper gerekebilir
- Goal detection logic (712-838) page.tsx'te kalır çünkü `matches` + `favorites` + `prevGoalsRef` arasında karmaşık etkileşim var

## Done When
- [ ] page.tsx < 700 satır
- [ ] Tüm özellikler çalışıyor (match list, detail panel, drawer, notifications, goals)
- [ ] Admin sayfaları etkilenmedi
- [ ] Build hatasız geçiyor (`bun run build`)
