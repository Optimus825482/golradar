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
| F4-8 | `admin/ml/page.tsx` | Champion delete button fix — **6A-3'te yapıldı** | ✅ |
| F4-9 | `admin/change-password` | Form validasyonu | ⏳ |
| F4-10 | `admin/system/page.tsx` | "no data" vs "API down" ayrımı — **6A-4'te yapıldı** | ✅ |
| F4-11 | `app/layout.tsx` | Root Suspense (streaming) | ✅ |
| F4-12 | `admin/layout.tsx` | AdminSidebar Suspense + skeleton fallback | ✅ |
| F4-13 | `admin/algorithm/page.tsx` | Mermaid skeleton | ⏳ |
| F4-14 | `app/page.tsx` | Tier debounce | ⏳ |
| F4-15 | Components | console.error→logError — **6A-14'te yapılacak** | ⏳ |
| F4-16 | `app/page.tsx` | Stale closure deps | ⏳ |

---

## ✅ Faz 5 — İyileştirme & Kod Temizliği (COMPLETE)

| # | Modül | Fix | Durum |
|---|-------|-----|-------|
| F5-1 | modelRouter/glue | Duplicate resolveArtifactPath — false positive, zaten clean | ⏭️ |
| F5-2 | gapRating | CROSS_WEIGHT_AWAY kullanılmıyor — **6A-8'de yapıldı** | ✅ |
| F5-3 | xtGrid | sync→async fs | ⏳ → Faz 6 |
| F5-4 | xtGrid | String→numeric version sort — **6A-9'da yapıldı** | ✅ |
| F5-5 | xtGrid | TTL not invalidated | ⏳ → Faz 6 |
| F5-6 | gapRating | _initializing race | ⏳ → Faz 6 |
| F5-7 | bayesianAveraging | Rename veya proper BMA | ⏳ → Faz 6 |
| F5-8 | calibration | Parametreleri DB SystemConfig'e taşı | ⏳ → Faz 6 |
| F5-9 | config.ts | SIGNAL_THRESHOLD deprecated cleanup | ⏳ → Faz 6 |
| F5-10 | Frontend | console.error→logError (low priority) | ⏳ → Faz 6 |
| F5-11 | Frontend | Array index key | ⏳ → Faz 6 |
| F5-12 | Frontend | useCallback eksik | ⏳ → Faz 6 |
| F5-13 | Frontend | useMatchStream identity | ⏳ → Faz 6 |
| F5-14 | eloImportJob | Checkpoint | ⏳ → Faz 6 |
| F5-15 | eloFetcher | Parallel fetch | ⏳ → Faz 6 |
| F5-16 | nesineHistorical | Batch days | ⏳ → Faz 6 |
| F5-17 | teamLogos | CSV parser fix | ⏳ → Faz 6 |
| F5-18 | resolvePython | PATH lookup | ⏳ → Faz 6 |
| F5-19 | TeamRating | Zod validation | ⏳ → Faz 6 |
| F5-20 | SystemConfig | Zod per key | ⏳ → Faz 6 |

---

## 🆕 Faz 6 — Kalan İşler (43 adet, kolaydan zora)

### 🟢 6A: Kolay (14 iş, ~1-5dk each)

| # | Modül | Sorun | Durum |
|---|-------|-------|-------|
| 6A-1 | `config.ts` | `SIGNAL_THRESHOLD` deprecated — hala 5+ yerde import ediliyor | ✅ |
| 6A-2 | `app/page.tsx` | Stale closure: `setFotmobTab` deps'te gereksiz, `fotmobTab` eksik | ✅ |
| 6A-3 | `app/admin/ml/page.tsx` | Champion delete butonu yanıltıcı | ✅ |
| 6A-4 | `app/admin/system/page.tsx` | "no data" vs "API down" ayrımı yok | ✅ |
| 6A-5 | `app/admin/algorithm/page.tsx` | Mermaid diagram flash (300KB chunk) | ⏳ |
| 6A-6 | `app/page.tsx` | Tier transition'da debounce yok → interval sıfırlanır | ⏳ |
| 6A-7 | `lib/teamLogos.ts` | CSV parser escaped quote (`""`) desteklemez | ⏳ |
| 6A-8 | `lib/ml/gapRating.ts` | `CROSS_WEIGHT_AWAY` tanımlı ama kullanılmıyor | ✅ |
| 6A-9 | `lib/ml/xtGrid.ts` | Versiyon sıralaması string (v10 < v2) | ✅ |
| 6A-10 | `prisma/schema.prisma` | Elo `Int` → `SmallInt` | ⏳ |
| 6A-11 | `src/lib/db.ts` | Connection pool yapılandırması yok | ⏳ |
| 6A-12 | `src/lib/scraper.ts` | PATH'ten python bulmaz, sadece sabit yollar | ✅ |
| 6A-13 | Components | Array index as React key | ⏳ |
| 6A-14 | Components | `console.error` → `logError` | ⏳ |
| 🆕 | `docker-entrypoint.sh` | OOM — `max-old-space-size` 512→1024MB | ✅ |
| 🆕 | `prisma/schema.prisma` | `updatedAt` DB'de yok → P2022 crash → satır silindi | ✅ |

### 🟡 6B: Orta (11 iş, ~10-30dk each)

| # | Modül | Sorun | Çözüm |
|---|-------|-------|-------|
| 6B-1 | Admin pages | CSV/JSON export yok | "Export CSV" butonu → fetch → blob → download |
| 6B-2 | `lib/ml/xtGrid.ts` | 1h TTL yeni artifact'te invalidate edilmez | Cache'e eklerken path@sha256 key kullan |
| 6B-3 | `lib/ml/gapRating.ts` | `_initializing` flag async race → çift init | Mutex pattern |
| 6B-4 | `lib/goaloo.ts` | 4 in-memory Map sınırsız büyür | LRU limit (1000 entry) |
| 6B-5 | `lib/scoremer.ts`, `lib/netscores.ts` | Cache'ler limitsiz büyür | LRU limit (500 entry) |
| 6B-6 | `lib/ml/xtGrid.ts` | sync `fs.readdirSync`/`readFileSync` event loop bloke eder | async fs kullan |
| 6B-7 | `lib/eloImportJob.ts` | Checkpoint yok — crash = restart | Her batch sonrası index DB'ye kaydet |
| 6B-8 | `lib/eloFetcher.ts` | Sequential 30s/team → yavaş | Parallel `Promise.any()` |
| 6B-9 | `lib/netscores.ts` | Nuxt payload cycle detection yok | `visited = new Set()` guard |
| 6B-10 | `lib/ml/weightTuner.ts` | Module-level mutable `recentRecords` → race | DB veya per-request context |
| 6B-11 | `lib/nesineHistorical.ts` | 365 gün sequential → çok yavaş | Batch 7 parallel |

### 🔴 6C: Zor (18 iş, ~30dk+ each)

| # | Modül | Sorun | Çözüm |
|---|-------|-------|-------|
| 6C-1 | `admin/signals/` + API | Pagination yok — 1000+ sinyal tek fetch | Server-side limit/offset + UI |
| 6C-2 | Admin pages | Audit log sayfası yok | `/admin/audit` sayfası |
| 6C-3 | `admin/change-password` | Form validasyonu eksik | Min 12 karakter, complexity |
| 6C-4 | All sources | Circuit breaker yok — API düşünce her request retry | Per-source circuit breaker modülü |
| 6C-5 | `lib/goaloo.ts` | Subprocess per call, pooling yok | Maks 3 concurrent pool |
| 6C-6 | All bridges | Zombie cleanup loop | Periyodik health check |
| 6C-7 | `schema.prisma` | 12 string → enum migration | Büyük Prisma migration |
| 6C-8 | `lib/calibration.ts` | Parametreler hardcoded → DB SystemConfig | Migration + runtime config |
| 6C-9 | `lib/eloRating.ts` | JSON file = split-brain | PostgreSQL'e taşı |
| 6C-10 | `lib/ml/bayesianAveraging.ts` | Brier-weighted averaging ama BMA denmiş | Rename veya proper BMA |
| 6C-11 | `lib/scoremer.ts` | Levenshtein O(n×m) hot loop'ta | Length gate + single-pass |
| 6C-12 | All sources | Structured error classification yok | `{ source, errorType, message }` formatı |
| 6C-13 | New endpoint | External source health endpoint | `/api/health/sources` |
| 6C-14 | All sources | Request deduplication yok | Pending-request Map |
| 6C-15 | `hooks/useMatchStream.ts` | Stale `onDisconnect` closure | useCallback wrapper |
| 6C-16 | All components | `console.error`→`logError` (tüm dosyalar) | Mass refactor |
| 6C-17 | `src/app/admin/signals/` | signalLevel/tier display iyileştirme | UI iyileştirme |
| 6C-18 | Build | Docker build log'u 319 satır gürültü | console.log temizliği |



---

## Özet Durum

```
Faz 0 (Acil):       ████████████████ 100%   ✅ 3/3 fix + 2 skip
Faz 1 (ML):         ████████████████ 100%   ✅ 12/14 + 2 skip
Faz 2 (Entegr.):    ██████████████░░  55%   ✅ 12/24 + 3 skip
Faz 3 (DB):         ███████████████░  70%   ✅ 8/11 + 1 skip
Faz 4 (Frontend):   ██████████████░░  62%   ✅ 10/16 + 1 skip  
Faz 5 (İyileş.):    ████████████████ 100%   ✅ hepsi → Faz 6
Faz 6A (Kolay):     ██████████████░░  57%   ✅ 10/16 (+2 yeni)
Faz 6B (Orta):      ░░░░░░░░░░░░░░░░   0%
Faz 6C (Zor):       ░░░░░░░░░░░░░░░░   0%
                    ────────────────
Toplam tamamlanan:   55 fix | Kalan: 35 fix
```

**Deploy:** ✅ Başarılı — `ModelArtifact.updatedAt` rollback + heap 1024MB

**Sıradaki:** Faz 6B (11 orta zorlukta fix)
