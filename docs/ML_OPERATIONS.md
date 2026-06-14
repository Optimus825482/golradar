# ML Operations Runbook

Production operations guide for the XGBoost + Kalman + xT ML
stack (W1–W7).

## Stack at a glance

- **Runtime**: TypeScript/Bun, no Python in app container
- **Trainer (opt-in)**: FastAPI sidecar, `docker compose --profile ml up`
- **Models**: XGBoost JSON (`xgb`, `inplay`), Kalman state-space
  (`team-strength`), xT grid (`xt-grid`)
- **Registry**: PostgreSQL `ModelArtifact(isChampion, name, version)`
- **Storage**: `data/ml-models/<name>-v<version>.json`
  + `data/ml-training/<horizon>min-<date>.jsonl`

## Daily cadence

| Hour (UTC+3) | Action | Cadence |
|--------------|--------|---------|
| 03:00 | Training data export (5/10/15-min horizons) | daily |
| 04:00 | Team strength Kalman fit + register | daily |
| 03:00 + 09:00 + 15:00 + 21:00 | In-play XGBoost re-train (match windows only) | 6h |
| Every 5 min | Prisma cache + signal log updates | live |

## Endpoints (admin auth required)

All endpoints require `Authorization: Bearer $ADMIN_API_TOKEN`
or `?token=...` query param. In dev with `NODE_ENV !== 'production'`
the guard is permissive.

- `GET  /api/admin/ml/status` — scheduler uptime, champion per name, latest datasets, latest ModelMetrics
- `GET  /api/admin/ml/compare?name=xgb&version=1.0.0&days=30` — champion vs candidate Brier delta
- `POST /api/admin/ml/promote {name, version, confirm: true, notes}` — atomic demote-then-promote
- `POST /api/admin/ml/train {name, version, horizon_min, dataset_id}` — kick off trainer sidecar
- `POST /api/admin/ml/inplay-retrain` — manual 5-min horizon re-train
- `POST /api/admin/ml/team-strength-fit {startDate?, endDate?, minMatches?, notes?, promote?}` — backfill + fit
- `POST /api/admin/ml/export {horizon?}` — manual training data export
- `GET  /api/admin/fotmob-cache-stats` — FotMob cache health

## Promotion gate (A/B test)

Auto-promote requires **all**:
1. Brier improvement `≥ 0.005` (candidate lower than champion)
2. Sample count `≥ 200`
3. `nShadowSamples` valid for the day

Manual override always available via `/api/admin/ml/promote`.

## Alerts & monitoring

### Brier drift
- Source: `ModelMetrics.shadowBrierDelta` (signed: negative = shadow wins)
- Alert: any shadow `> 0.02` worse than champion for **2+ consecutive days**
  → the shadow row's `notes` field is flagged for human review
- Recovery: drop the artifact via admin endpoint or retrain with more data

### Scheduler liveness
- Source: `MLScheduler.uptimeMs` from `/api/admin/ml/status`
- Alert: `uptimeHuman == '0s'` for >5 min → check `docker logs golradar-ml-trainer`
  (when profile is enabled) or restart the app container

### Cache hit rate
- Source: `fotMobCacheStats.cacheHitRatePct` from `/api/admin/fotmob-cache-stats`
- Alert: < 50% for 1h → likely cache TTL misconfig or upstream rate-limit
- Target: ≥ 85%

### Training job failures
- Source: `TrainingDataset.status = "failed"` with non-null `errorMsg`
- Alert: 3+ failures in 24h → check trainer sidecar logs and sidecar reachability

### Schema drift
- Source: `prisma migrate status` (CI gate)
- Hard fail: `prisma db push --accept-data-loss` is the only path. Container refuses to start if push fails (entrypoint exits 1).

## Grafana query hints

```sql
-- Brier by variant per day
SELECT
  date_trunc('day', "createdAt") AS day,
  "modelVariant",
  COUNT(*) AS n,
  AVG(("calibratedP" - (CASE WHEN "goalScored" THEN 1.0 ELSE 0.0 END))^2) AS brier
FROM "PredictionLog"
WHERE "goalScored" IS NOT NULL AND "createdAt" > NOW() - INTERVAL '30 days'
GROUP BY day, "modelVariant"
ORDER BY day DESC, "modelVariant";

-- Per-name champion metrics
SELECT
  name, version, "metricsJson", "isChampion", "promotedAt"
FROM "ModelArtifact"
WHERE "isChampion" = true
ORDER BY name;

-- Training data health
SELECT
  "horizonMin", COUNT(*), MIN("createdAt"), MAX("createdAt")
FROM "TrainingDataset"
WHERE "status" = 'ready'
GROUP BY "horizonMin";
```

## Rollout checklist (new model)

1. **Backfill** (if needed): `POST /api/admin/ml/team-strength-fit?promote=false`
2. **Export** training data: `POST /api/admin/ml/export {horizon: 5}`
3. **Train** on sidecar: `POST /api/admin/ml/train {name, version, dataset_id}` (or `inplay-retrain`)
4. **Shadow** runs for **7 days minimum**, write `PredictionLog.modelVariant = "shadow:<name>@<version>"`
5. **Compare**: `GET /api/admin/ml/compare?name=...&version=...&days=7&minSamples=200`
6. **Auto-promote** gate fires if `deltaBrier < -0.005` for 3 consecutive days + `nShadowSamples ≥ 200`
7. **Manual promote** (operator override): `POST /api/admin/ml/promote {name, version, confirm: true, notes: 'manual'}`
8. **Verify** the next `/api/admin/ml/status` shows the new `isChampion=true` row

## Disaster recovery

| Failure | Recovery |
|---------|----------|
| Trainer sidecar down | `docker compose --profile ml up ml-trainer`. App inference falls through to shipped JSON artifact (no degradation). |
| Champion artifact corrupted | Old artifact kept as `notes='rolled-back'`; re-train from latest dataset; restore old copy from backup if needed. |
| DB schema drift | `npx prisma db push --accept-data-loss` from inside the app container; entrypoint re-runs push on boot. |
| Calibration drift > 0.05 | Reduce `weights.inplay` and `weights.teamStrength` in `ensemble.ts` to 0.05; tighten threshold. |
| Shadow Brier > champion by 0.05 | Auto-suspend by setting `isChampion=false` on the row; re-train; or fall back to the previous champion. |

## Key files

- `src/lib/ml/trainingScheduler.ts` — daily export + 6h in-play
- `src/lib/ml/modelRouter.ts` — champion loader
- `src/lib/ml/modelBacktest.ts` — `runCompareBacktest`
- `src/lib/ml/shadowEvaluator.ts` — daily `ModelMetrics` rollup
- `src/lib/adminAuth.ts` + `src/lib/adminRoute.ts` — auth wrapper
- `mini-services/ml-trainer/app.py` — FastAPI trainer
- `mini-services/ml-trainer/xt_build.py` — StatsBomb grid build
- `prisma/schema.prisma` — `TrainingDataset`, `ModelArtifact`, `PredictionLog.modelVariant`, `ModelMetrics` Brier columns

## Onboarding

- Set `ADMIN_API_TOKEN` to a 32+ char secret in production env
- Configure log shipping to your aggregator (stdout JSON is already structured enough for most pipelines)
- Set up the `ml-trainer` service only in dev/CI; in prod, ship pre-built JSON artifacts via release pipeline
