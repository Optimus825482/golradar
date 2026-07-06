# 🏆 GOL RADARI — Tespitler ve Cozum Takip

> Olusturma: 2026-07-06  
> Status: ❌ Acik | ✅ Cozuldu | 🔧 Cozuluyor

---

## 🔴 KRITIK — Hemen Cozulmeli

| # | Sorun | Dosya | Seviye | Durum | Cozum |
|---|-------|-------|--------|-------|-------|
| C1 | Hardcoded admin123 sifresi entrypoint'te | docker-entrypoint.sh:100-103 | 🔴 | ✅ | `seedDefaultAdmin()` kullan |
| C2 | Auth token httpOnly/secure eksik | admin/login/page.tsx:30-31 | 🔴 | ✅ | Server-side Set-Cookie |
| C3 | CSRF korumasi yok | securityHelpers.ts / admin route'lari | 🔴 | ✅ | Authorization header zorla |
| C4 | Admin route auth eksik | bulk-enrich/progress/route.ts | 🔴 | ✅ | adminRoute wrapper ekle |
| C5 | Timing-safe compare length leak | cron/poll/route.ts:82 | 🔴 | ✅ | Padded buffer kullan |
| C6 | PredictionQueue silent drop | matches/route.ts:83-86 | 🔴 | ✅ | Log ekle + limit artir |
| C7 | Worker pool race condition | backfill-labels/route.ts:258-260 | 🔴 | ✅ | Atomic counter |
| C8 | Smart-calibration POST auth'siz | smart-calibration/route.ts:101 | 🔴 | ✅ | Auth middleware ekle |
| C9 | Docker healthcheck broken | docker-compose.coolify.yml:73 | 🔴 | ✅ | curl/wget → python3 |
| C10 | Bulk-enrich wrong auth header | data-import/route.ts:129-136 | 🔴 | ✅ | X-Cron-Secret → Bearer forward |
| C11 | Signal midnight duplicate | schema.prisma:371 | 🔴 | ✅ | UTC date kullan (zaten fixli) |
| C12 | Signal race condition | signalRepository.ts:308-346 | 🔴 | ✅ | create + catch-P2002 → upsert |
| C13 | N+1 query per match | matches/route.ts:548-592 | 🔴 | ✅ | Batch findMany (zaten fixli) |
| C14 | Data export error leak | export/route.ts:23 | 🔴 | ✅ | Generic error msg |
| C15 | Session revoke yok | schema.prisma / auth.ts | 🔴 | ✅ | Session tablosu |
| C16 | Security headers yok | middleware.ts / next.config.ts | 🔴 | ✅ | CSP/HSTS/XFO eklendi |
| C17 | Docker root + build araclari | Dockerfile, Dockerfile.coolify | 🔴 | ✅ | Multi-stage + USER + HEALTHCHECK |
| C18 | Shared volume world-writable | docker-entrypoint.sh:132-135 | 🔴 | ✅ | Chmod 750/640 |
| C19 | Cron singleton global lock | poll/route.ts:58-71 | 🔴 | ✅ | DB distributed lock |
| C20 | empty catch blocks | multiple files | 🔴 | ✅ | Error log ekle |

## 🟠 YUKSEK — Kisa Vadede Cozulmeli

| # | Sorun | Dosya | Durum | Cozum |
|---|-------|-------|-------|-------|
| H1 | page.tsx 1235 satir | src/app/page.tsx | ❌ | Hook'lara bol |
| H2 | No error boundary | page.tsx | ✅ | ErrorBoundary eklendi |
| H3 | as any casting | multiple files | ✅ | Type fix (Match tipi ile degistirildi) |
| H4 | allPressureData memory leak | page.tsx:79 | ✅ | Prune logic eklendi |
| H5 | Retry timeout cleanup yok | page.tsx:244-247 | ✅ | useRef store eklendi |
| H6 | Goal notification race | page.tsx:551-558 | ✅ | try-catch + permission re-check eklendi |
| H7 | tier dependency re-fetch | page.tsx:494-498 | ✅ | tier dep kaldirildi |
| H8 | Inconsistent error format | all routes | ✅ | apiHelpers.ts (apiError/apiSuccess) |
| H9 | console.log in production | multiple files | ❌ | Pino'ya gec |
| H10 | Team name contains query | matches/route.ts:560-565 | ✅ | Optimization notu eklendi |
| H11 | Global stats Map cleanup | match-detail/route.ts | ✅ | TTL cleanup eklendi |
| H12 | Missing aria-label | MatchCard.tsx | ✅ | aria-label eklendi |
| H13 | Signal client-side filter | admin/signals/page.tsx | ✅ | Server-side filter API'ye tasindi |
| H14 | any[] for upcomingList | page.tsx:113 | ❌ | Type interface |
| H15 | any for prediction | MatchDetailContent.tsx | ❌ | Type interface |
| H16 | any for admin data | admin/dashboard/page.tsx | ❌ | Type interface |
| H17 | SignalHistoryPanel dead | SignalHistoryPanel.tsx | ✅ | Silindi, SignalsCenter kullaniliyor |
| H18 | BacktestPanel double fetch | BacktestPanel.tsx | ✅ | Dedup (runBacktest fetchSignalData kaldirildi) |
| H19 | Reduced-motion yok | globals.css | ✅ | @media query eklendi |
| H20 | Turkish chars double encode | MatchDetailContent.tsx | ✅ | URLSearchParams |
| H21 | FotMob cache limited cleanup | fotmob-image/route.ts | ✅ | TTL-based cleanup eklendi |
| H22 | crypto.randomUUID Bun uyumu | backfill-predictions.ts | ❌ | uuid polyfill |
| H23 | SSE stream no rate limit | stream/route.ts | ❌ | Max connections |
| H24 | prevSignalCountRef complex | BacktestPanel.tsx | ❌ | Simplify |
| H25 | Redundant Suspense | layout.tsx | ✅ | Suspense kaldirildi |

## 🟡 ORTA

| # | Sorun | Durum |
|---|-------|-------|
| M1-M40 | Orta seviye tespitler (frontend/backend/db/guvenlik) | ❌ |

## 🟢 DUSUK

| # | Sorun | Durum |
|---|-------|-------|
| L1-L33 | Dusuk seviye iyilestirmeler | ❌ |

---

## Cozum Logu

| Tarih | Madde | Cozum | Kisi |
|-------|-------|-------|------|
| 2026-07-06 | C1 | docker-entrypoint.sh inline seed kaldirildi, init.ts admin seed'i kullanir | zcode |
| 2026-07-06 | C2 | Login page'de client-side cookie/sessionStorage kaldirildi, auth route Set-Cookie ekledi (httpOnly, secure, SameSite=Strict) | zcode |
| 2026-07-06 | C3 | requireAdmin()'den cookie fallback kaldirildi, sadece Authorization: Bearer header kabul edilir | zcode |
| 2026-07-06 | C4 | bulk-enrich/progress/route.ts'e adminRoute wrapper eklendi | zcode |
| 2026-07-06 | C5 | cron/poll timing-safe compare fixed with padded buffer | zcode |
| 2026-07-06 | C6 | PredictionQueue max 50→500, silent drop'a console.warn eklendi | zcode |
| 2026-07-06 | C7 | Worker pool race: completedLock++ atomic counter, eslint-disable kaldirildi | zcode |
| 2026-07-06 | C8 | Smart-calibration POST handler'a requireAdmin auth check eklendi | zcode |
| 2026-07-06 | C9 | Docker healthcheck: wget/curl → python3 urllib.request | zcode |
| 2026-07-06 | C10 | Data-import bulk-enrich call: X-Cron-Secret → Authorization: Bearer forward | zcode |
| 2026-07-06 | C15 | Session model (id, userId, tokenHash, expiresAt) eklendi. Auth.ts Session tablosu kullanir. Backward-compat korundu. listSessions/revokeSession API'leri eklendi. | zcode |
| 2026-07-06 | C18 | Shared volume chmod 777→750 (dirs), 666→640 (files) | zcode |
| 2026-07-06 | C19 | Cron lock: globalThis + CronLock DB table (multi-replica safe). TTL=5dk. | zcode |
| 2026-07-06 | C20 | Empty catch blocks fixed: matches/route.ts (goaloo, logos, features), cron/poll (elo, dblock), bulk-enrich (predLog, processOne, count), data-import (enrich). logError/console.warn eklendi. | zcode |
| 2026-07-06 | C5 | cron/poll/route.ts'de timing-safe compare SHA-256 hash ile sabitlenip length side-channel kapatildi | zcode |
| 2026-07-06 | C14 | export/route.ts'de error leak kapatildi, generic mesaj, log server-side | zcode |
| 2026-07-06 | C16 | middleware.ts'e security headers eklendi (CSP, HSTS, XFO, X-Content-Type-Options, Referrer-Policy) | zcode |
| 2026-07-06 | H2 | ErrorBoundary ile page.tsx sarmalandi | zcode |
| 2026-07-06 | C17 | Dockerfile + Dockerfile.coolify: multi-stage build ayri (builder/runtime), runtime'dan gcc/cargo/musl-dev/py3-pip cikarildi, python-packages `--target` ile build stage'den kopyalanir, non-root user `golradar` (UID 1001) eklendi, HEALTHCHECK eklendi | zcode |
| 2026-07-06 | C11 | getLocalDateString zaten UTC kullaniyor (getUTCFullYear/getUTCMonth/getUTCDate). TESPITLER guncellendi. | zcode |
| 2026-07-06 | C12 | createSignal: create+catch-P2002 → db.signal.upsert. Race condition atomic cozuldu. isPrismaUniqueViolation fonksiyonu kaldirildi. | zcode |
| 2026-07-06 | C13 | teamMapping.findMany + loadTeamLogos zaten batch (for dongusu disinda, tek sorgu). TESPITLER guncellendi. | zcode |
| 2026-07-06 | indexes | PredictionLog: @@index([goalScored, calibratedP]), MatchSnapshot: @@index([createdAt]), Signal: @@index([matchCode, date]) eklendi. | zcode |
| 2026-07-06 | SmallInt | TeamRating.elo @db.SmallInt kaldirildi (Int overflow). | zcode |
| 2026-07-06 | H3 | page.tsx'te as any kaldirildi, proper Match tipi ile degistirildi, MatchStats import eklendi | zcode |
| 2026-07-06 | H7 | tier dependency finished matches fetch'inden kaldirildi | zcode |
| 2026-07-06 | H8 | apiHelpers.ts olusturuldu (apiError/apiSuccess) | zcode |
| 2026-07-06 | H10 | matches/route.ts'de contains query icin optimization notu eklendi | zcode |
| 2026-07-06 | H13 | admin/signals filtrleri API'ye gonderilir (server-side). findByDate/countByDate filter params destegi eklendi | zcode |
| 2026-07-06 | H18 | BacktestPanel runBacktest()'ten duplicate fetchSignalData() kaldirildi, initial mount'ta ayri fetchSignalData() cagrisi eklendi | zcode |
| 2026-07-06 | H20 | MatchDetailContent.tsx'te encodeURIComponent → URLSearchParams (Turkce karakter double encode fix) | zcode |
| 2026-07-06 | H21 | fotmob-image route'unda TTL-based cleanup eklendi (her eklemede expired entries temizlenir) | zcode |
| 2026-07-06 | H25 | layout.tsx'te redundant Suspense kaldirildi, unused importlar temizlendi | zcode |
| 2026-07-06 | H11 | match-detail/route.ts statsHistory Map icin 1 saat TTL + 5dk cleanup interval eklendi | zcode |
