-- P1: String → Enum migration (2026-07-05)
-- Converts existing String columns to PostgreSQL native ENUM types.
-- Uses USING column::text::enum for in-place cast — ZERO data loss.
-- Default values are handled separately per column.

-- 1. Create enum types (IF NOT EXISTS safe for re-runs)
DO $$ BEGIN CREATE TYPE "public"."SignalSide" AS ENUM ('home', 'away', 'both'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "public"."SignalLevel" AS ENUM ('low', 'medium', 'high', 'critical'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "public"."SignalTier" AS ENUM ('elite', 'confirmed', 'watch', 'radar'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "public"."GoalSide" AS ENUM ('home', 'away'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "public"."PredictionSide" AS ENUM ('home', 'away', 'both', 'none'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "public"."PredictionLevel" AS ENUM ('low', 'medium', 'high', 'critical'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "public"."TrainingDatasetStatus" AS ENUM ('ready', 'consumed', 'failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "public"."FeatureSetStatus" AS ENUM ('generating', 'ready', 'failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "public"."PipelineRunStatus" AS ENUM ('pending', 'extracting', 'training', 'comparing', 'done', 'failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "public"."MatchEventType" AS ENUM ('goal', 'shot_on_target', 'shot_off_target', 'yellow_card', 'red_card', 'substitution', 'penalty_missed', 'halftime', 'fulltime'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Convert Signal columns
ALTER TABLE "public"."Signal" 
  ALTER COLUMN "signalSide" TYPE "public"."SignalSide" USING "signalSide"::text::"public"."SignalSide";

ALTER TABLE "public"."Signal" 
  ALTER COLUMN "signalLevel" TYPE "public"."SignalLevel" USING "signalLevel"::text::"public"."SignalLevel";

ALTER TABLE "public"."Signal" 
  ALTER COLUMN "goalSide" DROP NOT NULL,
  ALTER COLUMN "goalSide" TYPE "public"."GoalSide" USING "goalSide"::text::"public"."GoalSide";

ALTER TABLE "public"."Signal" 
  ALTER COLUMN "signalTier" TYPE "public"."SignalTier" USING "signalTier"::text::"public"."SignalTier";

-- 3. Convert PredictionLog columns
ALTER TABLE "public"."PredictionLog" 
  ALTER COLUMN "side" TYPE "public"."PredictionSide" USING "side"::text::"public"."PredictionSide";

ALTER TABLE "public"."PredictionLog" 
  ALTER COLUMN "level" TYPE "public"."PredictionLevel" USING "level"::text::"public"."PredictionLevel";

-- 4. Convert TrainingDataset
-- Drop default first, cast, then re-add default
ALTER TABLE "public"."TrainingDataset" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."TrainingDataset" 
  ALTER COLUMN "status" TYPE "public"."TrainingDatasetStatus" USING "status"::text::"public"."TrainingDatasetStatus";
ALTER TABLE "public"."TrainingDataset" ALTER COLUMN "status" SET DEFAULT 'ready';

-- 5. Convert FeatureSet
ALTER TABLE "public"."FeatureSet" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."FeatureSet" 
  ALTER COLUMN "status" TYPE "public"."FeatureSetStatus" USING "status"::text::"public"."FeatureSetStatus";
ALTER TABLE "public"."FeatureSet" ALTER COLUMN "status" SET DEFAULT 'generating';

-- 6. Convert PipelineRun
ALTER TABLE "public"."PipelineRun" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."PipelineRun" 
  ALTER COLUMN "status" TYPE "public"."PipelineRunStatus" USING "status"::text::"public"."PipelineRunStatus";
ALTER TABLE "public"."PipelineRun" ALTER COLUMN "status" SET DEFAULT 'pending';

-- 7. Convert MatchEvent
ALTER TABLE "public"."MatchEvent" 
  ALTER COLUMN "eventType" TYPE "public"."MatchEventType" USING "eventType"::text::"public"."MatchEventType";
