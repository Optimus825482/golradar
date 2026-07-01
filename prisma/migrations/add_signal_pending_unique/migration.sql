-- Partial unique index: pending sinyaller (goalHappened IS NULL) için
-- aynı (matchCode, date, signalSide) kombinasyonunu engelle
-- Önce olası duplicate'leri temizle
DELETE FROM "Signal" s1 USING "Signal" s2 
WHERE s1.id > s2.id 
  AND s1."matchCode" = s2."matchCode" 
  AND s1.date = s2.date 
  AND s1."signalSide" = s2."signalSide" 
  AND s1."goalHappened" IS NULL 
  AND s2."goalHappened" IS NULL;

-- Partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS "signal_pending_unique" 
ON "Signal"("matchCode", "date", "signalSide") 
WHERE "goalHappened" IS NULL;
