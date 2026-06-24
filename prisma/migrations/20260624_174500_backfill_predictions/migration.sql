-- Backfill: historical signals that have goalHappened=true but correctPrediction=NULL
-- (caused by the reportGoal ordering bug in goalSignalTracker.ts)
UPDATE "Signal"
SET "correctPrediction" = true
WHERE "goalHappened" = true AND "correctPrediction" IS NULL;
