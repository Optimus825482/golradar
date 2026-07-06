-- Create CronLock table for distributed cron locking
CREATE TABLE "CronLock" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "lockedAt" TIMESTAMPTZ NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL
);

-- Create index on expiresAt for efficient cleanup of expired locks
CREATE INDEX "CronLock_expiresAt_idx" ON "CronLock"("expiresAt");
