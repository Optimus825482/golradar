-- Migration 20260701_add_signal_tier_and_pnl
--
-- Adds the Signal.signalTier column (multi-tier N-of-M confirmation from
-- Faz A) and the SignalPnL table (per-signal P&L tracking with Kelly staking
-- from Faz D).
--
-- Both changes were introduced in IMPLEMENTATION_PLAN.md (Faz A Task A4
-- and Faz D Task D1) but the migration was never written, leaving the
-- production DB out of sync with the schema. The application then logs
-- `prisma:error ... column "Signal.signalTier" does not exist` on every
-- goal signal POST / reportGoal call.

-- ── Signal.signalTier ──────────────────────────────────────────────
ALTER TABLE "Signal" ADD COLUMN "signalTier" TEXT;

-- ── SignalPnL table ───────────────────────────────────────────────
CREATE TABLE "SignalPnL" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "calibratedP" DOUBLE PRECISION NOT NULL,
    "closingOdds" DOUBLE PRECISION,
    "outcome" INTEGER NOT NULL,
    "pnl" DOUBLE PRECISION,
    "kellyStake" DOUBLE PRECISION,
    "signalTier" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SignalPnL_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SignalPnL_signalId_idx" ON "SignalPnL"("signalId");
CREATE INDEX "SignalPnL_createdAt_idx" ON "SignalPnL"("createdAt");
CREATE INDEX "SignalPnL_signalTier_idx" ON "SignalPnL"("signalTier");