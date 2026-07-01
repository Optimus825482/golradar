-- Migration 20260702_add_referee_stats
--
-- Adds the RefereeStats table for storing per-referee aggregates
-- scraped from Transfermarkt. Used as control features in the
-- ML pipeline (Faz E Task E5).
--
-- Source: scripts/scrape_referee_stats.py → src/lib/refereeStats.ts
-- Features: ref_card_rate, ref_penalty_rate, ref_foul_rate

-- ── RefereeStats table ───────────────────────────────────────────
CREATE TABLE "RefereeStats" (
    "id" TEXT NOT NULL,
    "refereeName" TEXT NOT NULL,
    "matchesCount" INTEGER NOT NULL DEFAULT 0,
    "avgYellowCards" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgRedCards" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgFouls" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgPenalties" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "penaltyRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cardRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefereeStats_pkey" PRIMARY KEY ("id")
);

-- ── Uniqueness + indexes ─────────────────────────────────────────
CREATE UNIQUE INDEX "RefereeStats_refereeName_key" ON "RefereeStats"("refereeName");
CREATE INDEX "RefereeStats_refereeName_idx" ON "RefereeStats"("refereeName");
