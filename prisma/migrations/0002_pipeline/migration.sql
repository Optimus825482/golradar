-- Migration 0002_pipeline: Add FeatureSet and PipelineRun tables
CREATE TABLE "FeatureSet" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "horizonMin" INTEGER NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "featureCount" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'generating',
    "errorMsg" TEXT,
    "dataStart" TIMESTAMP(3),
    "dataEnd" TIMESTAMP(3),
    "durationMs" INTEGER,
    CONSTRAINT "FeatureSet_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FeatureSet_createdAt_idx" ON "FeatureSet"("createdAt");
CREATE INDEX "FeatureSet_status_idx" ON "FeatureSet"("status");

CREATE TABLE "PipelineRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "modelName" TEXT NOT NULL,
    "horizonMin" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progressPct" INTEGER NOT NULL DEFAULT 0,
    "step" TEXT NOT NULL DEFAULT '',
    "errorMsg" TEXT,
    "featureSetId" TEXT,
    "featureSetRowCount" INTEGER,
    "oldChampionVersion" TEXT,
    "oldChampionBrier" DOUBLE PRECISION,
    "oldChampionAcc" DOUBLE PRECISION,
    "newVersion" TEXT,
    "newBrier" DOUBLE PRECISION,
    "newLogLoss" DOUBLE PRECISION,
    "newAccuracy" DOUBLE PRECISION,
    "newCalibrationError" DOUBLE PRECISION,
    "newTrainRows" INTEGER,
    "brierDelta" DOUBLE PRECISION,
    "isBetter" BOOLEAN,
    "isPromoted" BOOLEAN,
    CONSTRAINT "PipelineRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PipelineRun_createdAt_idx" ON "PipelineRun"("createdAt");
CREATE INDEX "PipelineRun_status_idx" ON "PipelineRun"("status");
