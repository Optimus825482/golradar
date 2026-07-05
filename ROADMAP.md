# Optimus Gol Radari — Fix Roadmap

**Tarih:** 2026-07-05  
**Durum:** 62 fix complete, 12 false positive  
**Deploy:** ✅ Production stable — 12 commits today  

---

## ✅ TAMAMLANANLAR (62 fix)

| Kategori | Count |
|----------|-------|
| Acil (OOM, crash, data integrity) | 5 |
| ML Pipeline correctness | 12 |
| Entegrasyon (zombie, retry, cache, logging) | 15 |
| Database (indexes, cascade, pool, audit) | 9 |
| Frontend (SSE, WS, Suspense, errors) | 12 |
| Optimization + Code Hygiene | 7 |
| Runtime (heap 1024, Docker build fix) | 2 |

---

## ⏳ KALANLAR (27 adet, düşük öncelik)

### UI (6)
- U1: Signal pagination (server-side limit/offset)
- U2: CSV/JSON export on admin
- U3: Audit log page
- U4: Change password validation
- U5: console.error→logError
- U6: Array index key

### Infrastructure (5)  
- I1: Circuit breaker for external APIs
- I2: Subprocess pool
- I3: Zombie cleanup loop
- I4: /api/health/sources endpoint
- I5: Request deduplication

### Data (4)
- D1: 12 string→enum migration
- D2: eloRating JSON→PostgreSQL
- D3: Structured error format
- D4: TeamRating Zod validation

### Optimization (5)
- O1: xtGrid async fs
- O2: Levenshtein length gate
- O3: eloImportJob checkpoint
- O4: bayesianAveraging BMA
- O5: calibration→DB SystemConfig

### Code (7)
- C1: All console→logError
- C2: teamLogos CSV fix
- C3: config deprecated cleanup
- C4: Docker log noise
- C5: useCallback wrappers
- C6: useMatchStream stale closure
- C7: SystemConfig Zod
