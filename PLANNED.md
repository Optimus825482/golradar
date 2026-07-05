# Planned Migrations — Implementation Plan

**Tarih:** 2026-07-05 | **4 planned projects**

---

## P1: 12 string → PostgreSQL Enum Migration

### Summary
Convert 12 `String` fields to native PostgreSQL `ENUM` types for type safety.

### Fields to Convert

| Model | Fields | Enum Values |
|-------|--------|-------------|
| Signal | `signalSide` | `home`, `away`, `both` |
| Signal | `signalLevel` | `low`, `medium`, `high`, `critical` |
| Signal | `signalTier` | `elite`, `confirmed`, `watch`, `radar` |
| Signal | `goalSide` | `home`, `away` |
| PredictionLog | `side` | `home`, `away`, `both`, `none` |
| PredictionLog | `level` | `low`, `medium`, `high`, `critical` |
| PredictionLog | `modelVariant` | `champion`, `artifact:<name>@<ver>`, `shadow:<name>@<ver>` |
| TrainingDataset | `status` | `ready`, `consumed`, `failed` |
| FeatureSet | `status` | `generating`, `ready`, `failed` |
| PipelineRun | `status` | `pending`, `extracting`, `training`, `comparing`, `done`, `failed` |
| MatchEvent | `eventType` | `goal`, `shot_on_target`, `shot_off_target`, `yellow_card`, `red_card`, `substitution`, `penalty_missed` |
| ModelArtifact | `name` | `gbdt`, `xgb`, `inplay`, `team-strength`, `xt-grid`, `lightgbm`, `gap`, `pi`, `glicko2` |

### Steps

```
1. Add enum declarations to schema.prisma:
   enum SignalSide { home away both }
   enum SignalLevel { low medium high critical }
   enum SignalTier { elite confirmed watch radar }
   ... (for all 12)

2. Change field types:
   signalSide  SignalSide   (was String)
   signalLevel SignalLevel  (was String)
   ... (for all 12)

3. Migration SQL (Prisma auto-generates):
   prisma migrate dev --name add_enums_20260705

4. Generate Prisma client:
   prisma generate

5. Update TS code references:
   - Replace string comparisons with enum values
   - e.g. signalSide === "home" → signalSide === SignalSide.home
   (Optional: keep strings for now, enum maps automatically via Prisma)

6. Test:
   - Admin panel signals page loads
   - Matches route processes predictions
   - Training data export runs
   - Backtest runs successfully

7. Deploy:
   - git push → Coolify rebuild
   - Check for P2022 errors in logs
   - Verify enum values in DB with: SELECT DISTINCT signalSide FROM "Signal";
```

### Rollback
```sql
ALTER TABLE "Signal" ALTER COLUMN "signalSide" TYPE TEXT;
DROP TYPE "SignalSide";
... (repeat for all)
```

### Time Estimate: 3-4 hours

---

## P2: Elo Ratings JSON → PostgreSQL Migration

### Summary
Move Elo ratings from file-based JSON (`data/elo-ratings/ratings.json`) to `TeamRating` table in PostgreSQL. Eliminates split-brain between instances.

### Current State
- `src/lib/eloRating.ts` reads/writes local JSON file
- `data/elo-ratings/ratings.json` contains all ratings
- `TeamRating.elo` column already exists in DB for migrations

### Target State
- All Elo reads from `TeamRating` table
- `db.teamRating.findFirst({ where: { teamName } })` replaces `loadRatings().get(key)`
- `db.teamRating.upsert()` replaces `saveRatings()`
- JSON file kept as backup dump only

### Steps

```
1. Export current ratings to CSV (for backup):
   node -e "const {db}=require('@prisma/client'); ..." > backup-elo-20260705.csv

2. Import JSON ratings into TeamRating table:
   - Load ratings.json
   - For each team: db.teamRating.upsert({ where: { teamName },
     data: { elo: rating.rating, matchesPlayed: rating.matchesPlayed,
             lastUpdated: new Date(rating.lastUpdated) }})

3. Rewrite eloRating.ts:
   - Remove: getServerFs(), ensureDataDir(), loadRatings(), saveRatings()
   - Remove: DATA_DIR, RATINGS_FILE constants
   - Add: async loadRatings() → reads from DB
   - Add: async saveRating(key, rating) → db.teamRating.upsert()
   - Change: updateRatings() → async, reads/writes DB
   - Change: getAllRatings() → async, db.teamRating.findMany()
   - Change: setRating() → async
   - Change: bulkSetRatings() → async

4. Update all callers (12+ files):
   - updateRatings() → await updateRatings()
   - getRating() → await getRating()
   - getAllRatings() → await getAllRatings()
   - etc.

5. Test:
   - Elo import admin page
   - Matches route (elo values appear)
   - Team ratings admin page
   - ML pipeline (uses elo features)

6. Migration:
   - prisma migrate dev (if TeamRating schema changed)
   - git push
```

### Files to Change
```
src/lib/eloRating.ts       (main: ~100 lines change)
src/lib/eloFetcher.ts      (caller: add await)
src/lib/eloImportJob.ts    (caller: add await)
src/lib/eloFootball.ts     (caller: add await)
src/app/api/admin/elo/*    (caller: add await)
src/app/api/elo/*          (caller: add await)
src/lib/teamRatingUpdater.ts (caller: already uses TeamRating table)
src/lib/ensamble.ts        (caller: add await)
```

### Time Estimate: 4-5 hours

---

## P3: Calibration Params → DB SystemConfig

### Summary
Move calibration parameters (`L`, `k`, `x0`, `T`) from hardcoded `config.ts` to `SystemConfig` table. Enables hot-reload without deploy.

### Current State
```ts
// src/config.ts (lines 205-214)
export const DEFAULT_CALIBRATION_PARAMS = {
  L: 0.75, k: 0.03, x0: 40, T: 0.20,
};
```

```ts
// src/lib/calibration.ts — reads from DEFAULT_CALIBRATION_PARAMS at import time
```

### Target State
```ts
// Parameters loaded from SystemConfig table on first call
// Admin can change via /api/admin/settings without redeploy
```

### Steps

```
1. Write SystemConfig keys on first boot:
   INSERT INTO "SystemConfig" (key, value) VALUES
     ('calibration.L', '"0.75"'),
     ('calibration.k', '"0.03"'),
     ('calibration.x0', '"40"'),
     ('calibration.T', '"0.20"')
   ON CONFLICT (key) DO NOTHING;

2. Create calibrationParamLoader.ts:
   import { db } from './db';
   import { DEFAULT_CALIBRATION_PARAMS } from '@/config';
   
   let cached: typeof DEFAULT_CALIBRATION_PARAMS | null = null;
   
   export async function getCalibrationParams() {
     if (cached) return cached;
     // Read from SystemConfig, fall back to defaults
     const rows = await db.systemConfig.findMany({
       where: { key: { startsWith: 'calibration.' } }
     });
     // Parse values, fallback to DEFAULT_CALIBRATION_PARAMS
     cached = { /* parsed values */ };
     return cached;
   }
   
   export function invalidateCalibrationCache() { cached = null; }

3. Update calibration.ts:
   - Replace DEFAULT_CALIBRATION_PARAMS import with getCalibrationParams()
   - All calibration functions become async where they read params

4. Update autoCalibrateFromDB in calibration.ts:
   - After optimizing, write new params to SystemConfig
   - db.systemConfig.upsert({ key: 'calibration.k', value: JSON.stringify(newK) })

5. Admin settings page:
   - Already supports key-value writes via PATCH /api/admin/settings
   - Add calibration.L/k/x0/T as editable fields in UI

6. Test:
   - Auto-calibration writes to SystemConfig
   - Prediction probability matches expected
   - Admin can change L/k/x0/T and see effect on next prediction
```

### Time Estimate: 2-3 hours

---

## P4: Signal Pagination

### Summary
Add server-side pagination to signal endpoints (`/api/goal-signals`, `/api/admin/signals`). Currently loads all signals for a date in one fetch.

### Current State
```
GET /api/goal-signals?action=records&date=2026-07-05
→ returns ALL rows for that date (no limit)
```

### Target State
```
GET /api/goal-signals?action=records&date=2026-07-05&page=1&limit=50
→ returns page 1, 50 rows, with total count
```

### Steps

```
1. Backend: goal-signals route.ts
   - Accept query params: page (default 1), limit (default 50, max 200)
   - db.signal.findMany({ skip: (page-1)*limit, take: limit })
   - db.signal.count({ where }) for total
   - Return: { rows, total, page, totalPages }

2. Backend: admin signals route
   - Same pattern as above

3. Frontend: SignalsCenter.tsx
   - Add prev/next buttons
   - Add "Sayfa X / Y" display
   - Add limit selector (50/100/200)
   - Keep current date filter, add pagination

4. Frontend: admin/signals/page.tsx
   - Same pagination UI as SignalsCenter

5. Tests:
   - API returns correct page with skip/limit
   - Page 0 → defaults to 1
   - Limit > 200 → capped at 200
   - Empty page → returns empty with correct total

6. Deploy:
   - git push → Coolify rebuild
```

### Backend Pseudo-code
```ts
const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
const limit = Math.min(200, Math.max(10, parseInt(searchParams.get('limit') ?? '50')));

const [rows, total] = await Promise.all([
  db.signal.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
  db.signal.count({ where }),
]);

return NextResponse.json({ rows, total, page, totalPages: Math.ceil(total / limit) });
```

### Time Estimate: 2-3 hours

---

## Priority Order

```
1. P1 (Enum migration)      — 3-4h  → Most immediate safety win
2. P3 (Calibration → DB)    — 2-3h  → Enables admin hot-reload
3. P4 (Pagination)          — 2-3h  → UX improvement
4. P2 (Elo JSON → DB)       — 4-5h  → Biggest refactor, best done last
                                  Total: ~14 hours
```

---

## Execution Checklist

- [ ] P1: Add 12 enums to schema.prisma
- [ ] P1: Generate migration + test locally
- [ ] P1: Deploy to Coolify, verify no P2022
- [ ] P3: Create calibrationParamLoader.ts  
- [ ] P3: Update calibration.ts to read from DB
- [ ] P3: Wire admin settings to calibration params
- [ ] P3: Test hot-reload without deploy
- [ ] P4: Add pagination params to API
- [ ] P4: Add pagination UI components
- [ ] P4: Test with 1000+ signals
- [ ] P2: Export current Elo JSON to CSV backup
- [ ] P2: Import JSON into TeamRating table
- [ ] P2: Rewrite eloRating.ts (filesystem → DB)
- [ ] P2: Update all 12+ callers to await
- [ ] P2: Test all Elo-dependent features
