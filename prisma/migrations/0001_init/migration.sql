-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordSalt" TEXT NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "sessionToken" TEXT,
    "sessionExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EloImportJob" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "totalTeams" INTEGER NOT NULL,
    "fetchedTeams" INTEGER NOT NULL DEFAULT 0,
    "failedTeams" INTEGER NOT NULL DEFAULT 0,
    "currentTeam" TEXT,
    "progressPct" INTEGER NOT NULL DEFAULT 0,
    "resultJson" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EloImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchSnapshot" (
    "id" TEXT NOT NULL,
    "matchCode" INTEGER NOT NULL,
    "minute" INTEGER NOT NULL,
    "homePressure" INTEGER NOT NULL,
    "awayPressure" INTEGER NOT NULL,
    "homeGoals" INTEGER NOT NULL DEFAULT 0,
    "awayGoals" INTEGER NOT NULL DEFAULT 0,
    "statsJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchEvent" (
    "id" TEXT NOT NULL,
    "matchCode" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "minute" INTEGER NOT NULL,
    "player" TEXT,
    "xg" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredictionLog" (
    "id" TEXT NOT NULL,
    "matchCode" INTEGER NOT NULL,
    "minute" INTEGER NOT NULL,
    "rawScore" INTEGER NOT NULL,
    "homeScore" INTEGER NOT NULL,
    "awayScore" INTEGER NOT NULL,
    "calibratedP" DOUBLE PRECISION NOT NULL,
    "side" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "factorsJson" TEXT NOT NULL,
    "goalScored" BOOLEAN,
    "minutesToGoal" INTEGER,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "homeElo" INTEGER,
    "awayElo" INTEGER,
    "poissonHomeP" DOUBLE PRECISION,
    "poissonAwayP" DOUBLE PRECISION,
    "modelVariant" TEXT NOT NULL DEFAULT 'champion',
    "featuresJson" TEXT,
    "goalTimestamp" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PredictionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacktestRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "daysBack" INTEGER NOT NULL,
    "maxMatches" INTEGER NOT NULL,
    "signalThreshold" INTEGER NOT NULL DEFAULT 60,
    "totalMatches" INTEGER NOT NULL,
    "signalsRecorded" INTEGER NOT NULL,
    "goalsDetected" INTEGER NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "avgTimeToGoal" DOUBLE PRECISION,
    "resultJson" TEXT NOT NULL,

    CONSTRAINT "BacktestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamRating" (
    "id" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "teamNameTr" TEXT,
    "elo" INTEGER NOT NULL DEFAULT 1500,
    "attackStrength" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "defenseWeakness" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "matchesPlayed" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "goalsFor" INTEGER NOT NULL DEFAULT 0,
    "goalsAgainst" INTEGER NOT NULL DEFAULT 0,
    "xgFor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "xgAgainst" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "formJson" TEXT NOT NULL DEFAULT '[]',
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMapping" (
    "id" TEXT NOT NULL,
    "nesineCode" INTEGER,
    "nesineName" TEXT,
    "scoremerId" TEXT,
    "scoremerName" TEXT,
    "fotmobId" INTEGER,
    "fotmobName" TEXT,
    "fotmobSlug" TEXT,
    "fotmobLogoUrl" TEXT,
    "netscoresId" TEXT,
    "netscoresName" TEXT,
    "canonicalName" TEXT NOT NULL,
    "eloRating" INTEGER,
    "eloSource" TEXT,
    "country" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastVerified" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelMetrics" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "brierScore" DOUBLE PRECISION NOT NULL,
    "logLoss" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "totalPredictions" INTEGER NOT NULL,
    "totalGoals" INTEGER NOT NULL,
    "avgCalibratedP" DOUBLE PRECISION NOT NULL,
    "goalAfterSignalP" DOUBLE PRECISION NOT NULL,
    "avgMinutesToGoal" DOUBLE PRECISION NOT NULL,
    "calibrationError" DOUBLE PRECISION NOT NULL,
    "poissonBrier" DOUBLE PRECISION,
    "eloBrier" DOUBLE PRECISION,
    "gbdtBrier" DOUBLE PRECISION,
    "xgbBrier" DOUBLE PRECISION,
    "teamStrengthBrier" DOUBLE PRECISION,
    "inPlayBrier" DOUBLE PRECISION,
    "shadowBrierDelta" DOUBLE PRECISION,
    "nShadowSamples" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "matchCode" INTEGER NOT NULL,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "matchTime" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "signalMinute" INTEGER NOT NULL,
    "signalSide" TEXT NOT NULL,
    "signalScore" INTEGER NOT NULL,
    "calibratedP" DOUBLE PRECISION NOT NULL,
    "poissonP" DOUBLE PRECISION NOT NULL,
    "signalLevel" TEXT NOT NULL,
    "activeFactors" JSONB NOT NULL,
    "lastScore" INTEGER,
    "lastCalibratedP" DOUBLE PRECISION,
    "lastPoissonP" DOUBLE PRECISION,
    "lastFactors" JSONB NOT NULL DEFAULT '[]',
    "homeScore" INTEGER NOT NULL,
    "awayScore" INTEGER NOT NULL,
    "currentHomeGoals" INTEGER NOT NULL,
    "currentAwayGoals" INTEGER NOT NULL,
    "signalTimestamp" TIMESTAMP(3) NOT NULL,
    "lastSignalTimestamp" TIMESTAMP(3),
    "goalHappened" BOOLEAN,
    "goalMinute" INTEGER,
    "goalSide" TEXT,
    "correctPrediction" BOOLEAN,
    "minutesAfterSignal" INTEGER,
    "goalTimestamp" TIMESTAMP(3),
    "finalHomeScore" INTEGER,
    "finalAwayScore" INTEGER,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FotMobCache" (
    "id" TEXT NOT NULL,
    "fotmobId" INTEGER NOT NULL,
    "matchDate" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetchStatus" INTEGER NOT NULL DEFAULT 200,
    "fetchError" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMP(3),

    CONSTRAINT "FotMobCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingDataset" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "horizonMin" INTEGER NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "brier" DOUBLE PRECISION,
    "logLoss" DOUBLE PRECISION,
    "path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "errorMsg" TEXT,
    "dataStart" TIMESTAMP(3),
    "dataEnd" TIMESTAMP(3),

    CONSTRAINT "TrainingDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelArtifact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metricsJson" TEXT NOT NULL,
    "artifactPath" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "promotedAt" TIMESTAMP(3),
    "supersededBy" TEXT,
    "isChampion" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "bytes" INTEGER,

    CONSTRAINT "ModelArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamHistoryMatch" (
    "id" TEXT NOT NULL,
    "matchDate" TEXT NOT NULL,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "homeGoals" INTEGER NOT NULL,
    "awayGoals" INTEGER NOT NULL,
    "league" TEXT,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamHistoryMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_sessionToken_key" ON "User"("sessionToken");

-- CreateIndex
CREATE INDEX "User_username_idx" ON "User"("username");

-- CreateIndex
CREATE INDEX "MatchSnapshot_matchCode_minute_idx" ON "MatchSnapshot"("matchCode", "minute");

-- CreateIndex
CREATE INDEX "MatchSnapshot_matchCode_createdAt_idx" ON "MatchSnapshot"("matchCode", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MatchSnapshot_matchCode_minute_key" ON "MatchSnapshot"("matchCode", "minute");

-- CreateIndex
CREATE INDEX "MatchEvent_matchCode_eventType_idx" ON "MatchEvent"("matchCode", "eventType");

-- CreateIndex
CREATE INDEX "MatchEvent_matchCode_minute_idx" ON "MatchEvent"("matchCode", "minute");

-- CreateIndex
CREATE INDEX "PredictionLog_matchCode_minute_idx" ON "PredictionLog"("matchCode", "minute");

-- CreateIndex
CREATE INDEX "PredictionLog_calibratedP_goalScored_idx" ON "PredictionLog"("calibratedP", "goalScored");

-- CreateIndex
CREATE INDEX "PredictionLog_createdAt_idx" ON "PredictionLog"("createdAt");

-- CreateIndex
CREATE INDEX "PredictionLog_modelVariant_idx" ON "PredictionLog"("modelVariant");

-- CreateIndex
CREATE INDEX "PredictionLog_matchCode_createdAt_idx" ON "PredictionLog"("matchCode", "createdAt");

-- CreateIndex
CREATE INDEX "BacktestRun_createdAt_idx" ON "BacktestRun"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamRating_teamName_key" ON "TeamRating"("teamName");

-- CreateIndex
CREATE INDEX "TeamRating_teamName_idx" ON "TeamRating"("teamName");

-- CreateIndex
CREATE INDEX "TeamRating_elo_idx" ON "TeamRating"("elo");

-- CreateIndex
CREATE INDEX "TeamMapping_nesineName_idx" ON "TeamMapping"("nesineName");

-- CreateIndex
CREATE INDEX "TeamMapping_scoremerId_idx" ON "TeamMapping"("scoremerId");

-- CreateIndex
CREATE INDEX "TeamMapping_fotmobId_idx" ON "TeamMapping"("fotmobId");

-- CreateIndex
CREATE INDEX "TeamMapping_country_idx" ON "TeamMapping"("country");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMapping_canonicalName_key" ON "TeamMapping"("canonicalName");

-- CreateIndex
CREATE UNIQUE INDEX "ModelMetrics_date_key" ON "ModelMetrics"("date");

-- CreateIndex
CREATE INDEX "ModelMetrics_date_idx" ON "ModelMetrics"("date");

-- CreateIndex
CREATE INDEX "Signal_matchCode_date_signalSide_idx" ON "Signal"("matchCode", "date", "signalSide");

-- CreateIndex
CREATE INDEX "Signal_date_idx" ON "Signal"("date");

-- CreateIndex
CREATE INDEX "Signal_matchCode_idx" ON "Signal"("matchCode");

-- CreateIndex
CREATE INDEX "Signal_goalHappened_idx" ON "Signal"("goalHappened");

-- CreateIndex
CREATE INDEX "Signal_signalSide_idx" ON "Signal"("signalSide");

-- CreateIndex
CREATE INDEX "Signal_calibratedP_idx" ON "Signal"("calibratedP");

-- CreateIndex
CREATE INDEX "FotMobCache_fotmobId_idx" ON "FotMobCache"("fotmobId");

-- CreateIndex
CREATE INDEX "FotMobCache_matchDate_idx" ON "FotMobCache"("matchDate");

-- CreateIndex
CREATE INDEX "FotMobCache_expiresAt_idx" ON "FotMobCache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "FotMobCache_fotmobId_matchDate_key" ON "FotMobCache"("fotmobId", "matchDate");

-- CreateIndex
CREATE INDEX "TrainingDataset_createdAt_idx" ON "TrainingDataset"("createdAt");

-- CreateIndex
CREATE INDEX "TrainingDataset_horizonMin_status_idx" ON "TrainingDataset"("horizonMin", "status");

-- CreateIndex
CREATE INDEX "TrainingDataset_status_createdAt_idx" ON "TrainingDataset"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ModelArtifact_name_isChampion_idx" ON "ModelArtifact"("name", "isChampion");

-- CreateIndex
CREATE INDEX "ModelArtifact_name_createdAt_idx" ON "ModelArtifact"("name", "createdAt");

-- CreateIndex
CREATE INDEX "ModelArtifact_isChampion_name_idx" ON "ModelArtifact"("isChampion", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ModelArtifact_name_version_key" ON "ModelArtifact"("name", "version");

-- CreateIndex
CREATE INDEX "TeamHistoryMatch_matchDate_idx" ON "TeamHistoryMatch"("matchDate");

-- CreateIndex
CREATE INDEX "TeamHistoryMatch_homeTeam_matchDate_idx" ON "TeamHistoryMatch"("homeTeam", "matchDate");

-- CreateIndex
CREATE INDEX "TeamHistoryMatch_awayTeam_matchDate_idx" ON "TeamHistoryMatch"("awayTeam", "matchDate");

-- CreateIndex
CREATE INDEX "TeamHistoryMatch_source_fetchedAt_idx" ON "TeamHistoryMatch"("source", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamHistoryMatch_matchDate_homeTeam_awayTeam_key" ON "TeamHistoryMatch"("matchDate", "homeTeam", "awayTeam");

