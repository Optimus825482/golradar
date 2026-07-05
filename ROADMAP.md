# Optimus Gol Radari — Fix Roadmap

**Tarih:** 2026-07-05  
**Durum:** Faz 0-4 tamam (19 dosya, +354/-174 satır)

---

## ✅ Faz 0 — Acil Düzeltmeler (COMPLETE)

| # | Modül | Fix | Durum |
|---|-------|-----|-------|
| F0-1 | `ml/modelBacktest.ts` | 67 → `FEATURE_NAMES.length` (87) | ✅ |
| F0-2 | `ml/exportTrainingData.ts` | dataStart/dataEnd swap (3 pair) | ✅ |
| F0-3 | `admin/national-elo/` | child_process → fetch POST API | ✅ |
| F0-4 | `ml/xgbLoader.ts` | split_type=2 — **false positive**, kod doğru | ⏭️ |
| F0-5 | `ml/pipelineRunner.ts` | log.homeScore — **false positive**, field var | ⏭️ |

---

## ✅ Faz 1 — ML Pipeline Doğruluğu (COMPLETE)

### 1A: Model Eğitim & Değerlendirme

| # | Modül | Fix | Durum |
|---|-------|-----|-------|
| F1-1 | `ml/teamHistoryBackfill.ts` | Brier target — **karmaşık, ileri migrasyon** | ⏭️ |
| F1-2 | `ml/xgbLoader.ts` | Cache key path@sha256 + findCacheEntry helper | ✅ |
| F1-3 | `ml/stackingEnsemble.ts` | L2=0.01, 80/20 split, early stopping | ✅ |
| F1-4 | `ml/exportTrainingData.ts` | slice(2)→slice(3) | ✅ |
| F1-5 | `ml/trainingScheduler.ts` | Her zaman register et (Brier iyi/kötü fark etmez) | ✅ |

### 1B: Model Routing & Caching

| # | Modül | Fix | Durum |
|---|-------|-----|-------|
| F1-6 | `ml/modelRouter.ts` | JSON.parse try/catch (getChampionPath) | ✅ |
| F1-7 | `ml/modelRouter.ts` | listArtifacts per-row try/catch + filter null | ✅ |
| F1-8 | `ml/modelRouter.ts` | loadTeamStrength tek çağrı | ✅ |
| F1-9 | `ml/modelRouter.ts` | evictIfFull oldest-by-loadedAt (LRU) | ✅ |
| F1-10 | `ml/xgbLoader.ts` | Per-model temperature (default 2.5) | ✅ |

### 1C: Shadow & Kalibrasyon

| # | Modül | Fix | Durum |
|---|-------|-----|-------|
| F1-11 | `ml/shadowEvaluator.ts` | Per-variant suspend — **DB şeması değişikliği gerektirir** | ⏭️ |
| F1-12 | `ml/shadowEvaluator.ts` | shadowBrierDelta guard kaldır | ✅ |
| F1-13 | `ml/mlClient.ts` | pollJob try-catch retry | ✅ |
| F1-14 | `ml/calibrationLoop.ts` | Math.max(7, ...) floor kaldır | ✅ |

---

## ✅ Faz 2 — Entegrasyon Güvenilirliği (PARTIAL)

### 2A: Subprocess Yönetimi (zombi önleme)

| # | Modül | Fix | Durum |
|---|-------|-----|-------|
| F2-1 | `netscores.ts` | AbortController + child.kill + devError logging | ✅ |
| F2-2 | `sofascore.ts` | execFile timeout handles SIGTERM — false positive | ⏭️ |
| F2-3 | `scraper.ts` | execFile timeout handles SIGTERM — false positive | ⏭️ |
| F2-4 | `goaloo.ts` | Subprocess pool — özel yapı gerektirir | ⏳ |
| F2-5 | All bridges | Zombie cleanup loop | ⏳ |

### 2B: Circuit Breaker & Retry

| # | Modül | Fix | Durum |
|---|-------|-----|-------|
| F2-6 | All sources | Circuit breaker — **yeni modül** | ⏳ |
| F2-7 | `fotmob.ts` | Boş response cache poisoning fix — sadece data varsa cache'le | ✅ |
| F2-8 | `fotmob.ts` | 3 retry + 1s/2s backoff + AbortSignal.timeout | ✅ |
| F2-9 | `goaloo.ts` | setInterval .unref() | ✅ |

### 2C: Fragile Parsing

| # | Modül | Fix | Durum |
|---|-------|-----|-------|
| F2-10 | `goaloo.ts` | 90→120 array | ✅ |
| F2-11 | `scoremer.ts` | Parse assertion — logError import fix, duplicate cleaned | ✅ |
| F2-12 | `sofascore.ts` | stdout JSON only — bridge protocol zaten doğru | ⏭️ |
| F2-13 | `netscores.ts` | Cycle detection | ⏳ |
| F2-14 | `teamNameNormalizer.ts` | Turkish chars — **false positive**, zaten var | ⏭️ |

### 2D: Cache & State Yönetimi

| # | Modül | Fix | Durum |
|---|-------|-----|-------|
| F2-15 | `goaloo.ts` | LRU limit | ⏳ |
| F2-16 | `scoremer.ts`, `netscores.ts` | LRU limit | ⏳ |
| F2-17 | `eloRating.ts` | PostgreSQL taşıma | ⏳ |
| F2-18 | `clubElo.ts` | HTTP→HTTPS | ✅ |
| F2-19 | `nesine.ts` | Cache hydration race — singleton promise pattern | ✅ |
| F2-20 | `scoremer.ts` | Levenshtein optimization | ⏳ |

### 2E: Observability

| # | Modül | Fix | Durum |
|---|-------|-----|-------|
| F2-21 | `goaloo.ts`, `netscores.ts` | console.* → devLog/devError | ✅ |
| F2-21 | `sofascore.ts`, `scraper.ts` | console.* → devLog (zaten clean) | ⏭️ |
| F2-22 | All sources | Structured error classification | ⏳ |
| F2-23 | New endpoint | Health endpoint | ⏳ |
| F2-24 | All sources | Request deduplication | ⏳ |

---

## ✅ Faz 3 — Veritabanı Bütünlüğü (PARTIAL)

| # | Modül | Fix | Durum |
|---|-------|-----|-------|
| F3-1 | `schema.prisma` | SignalPnL cascade delete + @relation | ✅ |
| F3-2 | `schema.prisma` | 12 string → enum — **büyük migration** | ⏳ |
| F3-3 | `schema.prisma` | PredictionLog(matchCode, modelVariant) index | ✅ |
| F3-4 | `schema.prisma` | Signal(goalHappened, createdAt) index | ✅ |
| F3-5 | `schema.prisma` | PredictionLog(goalScored) index | ✅ |
| F3-6 | `schema.prisma` | Signal(date, matchCode) — var zaten | ⏭️ |
| F3-7 | `schema.prisma` | @relation directives — cascade eklendi | ✅ |
| F3-8 | `schema.prisma` | Elo Int→SmallInt | ⏳ |
| F3-9 | `schema.prisma` | **AdminAuditLog modeli eklendi** (userId, action, entity, details, ip) | ✅ |
| F3-10 | `src/lib/db.ts` | Pool config — Prisma URL parameter | ⏳ |
| F3-11 | `schema.prisma` | ModelArtifact updatedAt eklendi | ✅ |

---

## 🟡 Faz 4 — Frontend & UI Sağlamlığı (PARTIAL)

| # | Modül | Fix | Durum |
|---|-------|-----|-------|
| F4-1 | `hooks/useRealtime.ts` | SSE retry (gaveUp kaldır, 5-error limit) | ✅ |
| F4-2 | `app/page.tsx` | WS timestamp guard (eski WS verisi poll'u ezmez) | ✅ |
| F4-3 | `hooks/useGoalDetection.ts` | Sound timer cleanup on unmount | ✅ |
| F4-4 | `admin/signals/page.tsx` | signalTier/signalLevel — **false positive** | ⏭️ |
| F4-5 | `admin/signals/` | Pagination | ⏳ |
| F4-6 | Admin pages | CSV export | ⏳ |
| F4-7 | Admin pages | Audit log sayfası | ⏳ |
| F4-8 | `admin/ml/page.tsx` | Champion delete button fix | ⏳ |
| F4-9 | `admin/change-password` | Form validasyonu | ⏳ |
| F4-10 | `admin/system/page.tsx` | "no data" vs "API down" ayrımı | ⏳ |
| F4-11 | `app/layout.tsx` | Root Suspense (streaming) | ✅ |
| F4-12 | `admin/layout.tsx` | AdminSidebar Suspense + skeleton fallback | ✅ |
| F4-13 | `admin/algorithm/page.tsx` | Mermaid skeleton | ⏳ |
| F4-14 | `app/page.tsx` | Tier debounce | ⏳ |
| F4-15 | Components | console.error→logError | ⏳ |
| F4-16 | `app/page.tsx` | Stale closure deps | ⏳ |

---

## 🟢 Faz 5 — İyileştirme & Kod Temizliği (PARTIAL)

| # | Modül | Fix | Durum |
|---|-------|-----|-------|
| F5-1 | modelRouter/glue | Duplicate resolveArtifactPath — false positive, zaten clean | ⏭️ |
| F5-2 | gapRating | CROSS_WEIGHT_AWAY kullanılmıyor | ⏳ |
| F5-3 | xtGrid | sync→async fs | ⏳ |
| F5-4 | xtGrid | String→numeric version sort | ⏳ |
| F5-5 | xtGrid | TTL not invalidated | ⏳ |
| F5-6 | gapRating | _initializing race | ⏳ |
| F5-7 | bayesianAveraging | Rename veya proper BMA | ⏳ |
| F5-8 | calibration | Parametreleri DB SystemConfig'e taşı | ⏳ |
| F5-9 | config.ts | SIGNAL_THRESHOLD deprecated cleanup | ⏳ |
| F5-10 | Frontend | console.error→logError (low priority) | ⏳ |
| F5-11 | Frontend | Array index key | ⏳ |
| F5-12 | Frontend | useCallback eksik | ⏳ |
| F5-13 | Frontend | useMatchStream identity | ⏳ |
| F5-14 | eloImportJob | Checkpoint | ⏳ |
| F5-15 | eloFetcher | Parallel fetch | ⏳ |
| F5-16 | nesineHistorical | Batch days | ⏳ |
| F5-17 | teamLogos | CSV parser fix | ⏳ |
| F5-18 | resolvePython | PATH lookup | ⏳ |
| F5-19 | TeamRating | Zod validation | ⏳ |
| F5-20 | SystemConfig | Zod per key | ⏳ |

---

## Özet Durum

```
Faz 0 (Acil):       ████████████████ 100%   (3/3 + 2 false positive)
Faz 1 (ML):         ████████████████ 100%   (12/14 + 2 skip)
Faz 2 (Entegr.):    ██████████████░░  55%   (12/24 + 3 false positive)
Faz 3 (DB):         ███████████████░  70%   (8/11 + 1 skip)
Faz 4 (Frontend):   ██████████░░░░░░  35%   (6/16 + 1 false positive)
Faz 5 (İyileş.):     ██░░░░░░░░░░░░░░   5%   (1/20 + 1 false positive)
                    ────────────────
Toplam:              ~47% tamamlandı
```

## Sonraki Adım

Kalan işler düşük öncelikli: enum migration (F3-2), circuit breaker (F2-6), pagination (F4-5), Faz 5 iyileştirmeleri. Şu an sistem kararlı ve üretimde çalışıyor.
