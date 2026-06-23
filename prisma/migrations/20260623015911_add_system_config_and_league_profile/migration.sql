-- AlterTable
ALTER TABLE "TeamHistoryMatch" ADD COLUMN     "awayXG" DOUBLE PRECISION,
ADD COLUMN     "homeXG" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "SystemConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "LeagueProfile" (
    "leagueId" INTEGER NOT NULL,
    "leagueName" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "avgGoalMinute" DOUBLE PRECISION NOT NULL,
    "medianGoalMinute" DOUBLE PRECISION NOT NULL,
    "goalTimeStdDev" DOUBLE PRECISION NOT NULL,
    "earlyGoalRate" DOUBLE PRECISION NOT NULL,
    "lateGoalRate" DOUBLE PRECISION NOT NULL,
    "halftimeGoalRate" DOUBLE PRECISION NOT NULL,
    "matchCount" INTEGER NOT NULL DEFAULT 0,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueProfile_pkey" PRIMARY KEY ("leagueId")
);
