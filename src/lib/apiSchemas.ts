import { z } from 'zod';

// ── Goal Signals ───────────────────────────────────────────────
export const signalSideSchema = z.enum(['home', 'away']);
export const signalLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);

const baseMatchFields = {
  matchCode: z.number().int().positive(),
  homeTeam: z.string().min(1).max(128),
  awayTeam: z.string().min(1).max(128),
  league: z.string().min(1).max(128),
  matchTime: z.string().min(1).max(64),
};

export const recordSignalSchema = z.object({
  ...baseMatchFields,
  minute: z.string().min(1).max(16),
  score: z.number().int().min(0).max(100),
  side: signalSideSchema,
  level: signalLevelSchema.default('medium'),
  factors: z.array(z.string().min(1).max(128)).max(32).default([]),
  calibratedP: z.number().min(0).max(1).default(0),
  poissonP: z.number().min(0).max(1).default(0),
  homeScore: z.number().int().min(0).max(99).default(0),
  awayScore: z.number().int().min(0).max(99).default(0),
  homeGoals: z.number().int().min(0).max(99).default(0),
  awayGoals: z.number().int().min(0).max(99).default(0),
});

export const expireHalftimeSchema = z.object({
  matchCodes: z.array(z.number().int().positive()).min(1).max(2000),
});

export const cleanupSignalsSchema = z.object({
  activeCodes: z.array(z.number().int().positive()).min(1).max(2000),
});

export const reportGoalSchema = z.object({
  matchCode: z.number().int().positive(),
  goalSide: signalSideSchema,
  goalMinute: z.number().int().min(0).max(130),
});

// ── Predict ────────────────────────────────────────────────────
export const predictQuerySchema = z.object({
  home: z.string().min(1).max(128),
  away: z.string().min(1).max(128),
  score: z.coerce.number().int().min(0).max(100).default(0),
  minute: z.string().min(1).max(8).default('45'),
  hg: z.coerce.number().int().min(0).max(50).default(0),
  ag: z.coerce.number().int().min(0).max(50).default(0),
  fotmobId: z.coerce.number().int().positive().optional(),
});

export const featuresQuerySchema = z.object({
  home: z.string().min(1).max(128).optional(),
  away: z.string().min(1).max(128).optional(),
  minute: z.string().min(1).max(8).default('45'),
  hg: z.coerce.number().int().min(0).max(50).default(0),
  ag: z.coerce.number().int().min(0).max(50).default(0),
});

export const recordTrainingSchema = z.object({
  features: z.array(z.number()).max(200),
  label: z.number(),
  matchCode: z.number().int().optional(),
  minute: z.number().int().min(0).max(130).optional(),
  side: z.enum(['home', 'away', 'both']).default('both'),
});

export const predictFullSchema = z.object({
  stats: z.record(z.string(), z.unknown()).optional(),
  minute: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  homeGoals: z.number().int().min(0).max(50).default(0),
  awayGoals: z.number().int().min(0).max(50).default(0),
  homeTeam: z.string().max(128).optional(),
  awayTeam: z.string().max(128).optional(),
  ruleBasedScore: z.number().int().min(0).max(100).optional(),
  fotmobId: z.number().int().positive().optional(),
});

// ── Smart Calibration ─────────────────────────────────────────
export const calibrationModeSchema = z.object({
  mode: z.enum(['off', 'auto', 'manual']),
  manualAvgGoalMinute: z.number().min(1).max(90).nullable().default(null),
  sensitivity: z.number().min(0).max(1).default(0.7),
  oddsCompoundEnabled: z.boolean().default(true),
  minSampleSize: z.number().int().min(0).max(10000).default(20),
});

export const updateProfileSchema = z.object({
  leagueId: z.number().int().positive(),
  leagueName: z.string().max(128).default(''),
  country: z.string().max(64).default(''),
  goalMinutes: z.array(z.number().int().min(0).max(130)).min(1).max(10000),
});

export const previewCompoundSchema = z.object({
  oddsSignificance: z.enum(['low', 'medium', 'high']).default('medium'),
  currentMinute: z.number().int().min(0).max(130).default(88),
  homeOddsBoost: z.number().min(0).max(50).default(6),
  awayOddsBoost: z.number().min(0).max(50).default(4),
  leagueId: z.number().int().positive().nullable().optional(),
});

export const parseActionBody = <T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
): { ok: true; data: z.infer<T> } | { ok: false; error: string } => {
  const result = schema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    return {
      ok: false,
      error: `${first.path.join('.') || 'body'}: ${first.message}`,
    };
  }
  return { ok: true, data: result.data };
};
