// ── Zod Validation Schemas ────────────────────────────────────────
// Central validation for all API request bodies. All schemas use
// .strict() to reject unknown fields.
//
// Usage in route handlers:
//   import { signalRecordSchema, parseOrBadRequest } from "@/lib/validation";
//   const parsed = await parseOrBadRequest(request, signalRecordSchema);
//   if (!parsed.ok) return parsed.error;       // NextResponse 400
//   const { matchCode, side } = parsed.data;    // typed & validated

import { z } from "zod";
import { NextResponse } from "next/server";

// ══════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════

/** Format Zod issues into a flat { field: message } object. */
export function formatZodError(
  issues: z.core.$ZodIssue[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.join(".");
    out[path || "_root"] = issue.message;
  }
  return out;
}

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: NextResponse };

/**
 * Parse a JSON request body against a Zod schema. Returns the
 * validated/typed payload on success, or a 400 NextResponse on failure.
 */
export async function parseOrBadRequest<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<ParseResult<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      error: NextResponse.json(
        { ok: false, reason: "invalid JSON body" },
        { status: 400 },
      ),
    };
  }

  const result = schema.safeParse(body);
  if (result.success) {
    return { ok: true, data: result.data };
  }

  return {
    ok: false,
    error: NextResponse.json(
      {
        ok: false,
        reason: "validation error",
        errors: formatZodError(result.error.issues),
      },
      { status: 400 },
    ),
  };
}

// ══════════════════════════════════════════════════════════════════
// GOAL SIGNALS — POST /api/goal-signals
// ══════════════════════════════════════════════════════════════════

export const signalRecordSchema = z
  .object({
    matchCode: z.number().int().positive(),
    homeTeam: z.string().min(1).max(128),
    awayTeam: z.string().min(1).max(128),
    league: z.string().min(1).max(128),
    matchTime: z.string().max(64).default(""),
    minute: z.string().min(1).max(16),
    score: z.number().int().min(0).max(100),
    side: z.enum(["home", "away"]),
    level: z.enum(["low", "medium", "high", "critical"]).default("medium"),
    factors: z.array(z.string().max(128)).max(32).default([]),
    calibratedP: z.number().min(0).max(1).default(0),
    poissonP: z.number().min(0).max(1).default(0),
    homeScore: z.number().int().default(0),
    awayScore: z.number().int().default(0),
    homeGoals: z.number().int().min(0).default(0),
    awayGoals: z.number().int().min(0).default(0),
  })
  .strict();

export const expireHalftimeSchema = z
  .object({
    matchCodes: z.array(z.number().int().positive()).min(1).max(200),
  })
  .strict();

// ── Per-action wrappers for discriminated union ──────────────────
// signalRecordSchema gets `.extend({ action: ... })` so the existing
// schema (used by tests) keeps working unchanged, and the new union
// can route by `action`.
export const signalRecordActionSchema = signalRecordSchema.extend({
  action: z.literal("record"),
});

export const expireHalftimeActionSchema = z
  .object({
    action: z.literal("expireHalftime"),
    matchCodes: expireHalftimeSchema.shape.matchCodes,
  })
  .strict();

export const cleanupActionSchema = z
  .object({
    action: z.literal("cleanup"),
    activeCodes: z.array(z.number().int().positive()).min(1).max(500),
  })
  .strict();

export const reportGoalActionSchema = z
  .object({
    action: z.literal("reportGoal"),
    matchCode: z.number().int().positive(),
    goalSide: z.enum(["home", "away"]),
    goalMinute: z.number().int().min(0).max(120),
  })
  .strict();

export const checkPendingActionSchema = z
  .object({
    action: z.literal("checkPending"),
  })
  .strict();

export const goalSignalsActionSchema = z.discriminatedUnion("action", [
  signalRecordActionSchema,
  expireHalftimeActionSchema,
  cleanupActionSchema,
  reportGoalActionSchema,
  checkPendingActionSchema,
]);

export type SignalRecordActionInput = z.infer<typeof signalRecordActionSchema>;
export type ExpireHalftimeActionInput = z.infer<typeof expireHalftimeActionSchema>;
export type CleanupActionInput = z.infer<typeof cleanupActionSchema>;
export type ReportGoalActionInput = z.infer<typeof reportGoalActionSchema>;
export type CheckPendingActionInput = z.infer<typeof checkPendingActionSchema>;
export type GoalSignalsActionInput = z.infer<typeof goalSignalsActionSchema>;

// ══════════════════════════════════════════════════════════════════
// PREDICT — POST /api/predict
// ══════════════════════════════════════════════════════════════════

export const predictRecordSchema = z
  .object({
    matchCode: z.number().int().positive(),
    minute: z.number().int().min(0).max(120),
    score: z.number().int().min(0).max(100),
    side: z.enum(["home", "away", "both"]),
    calibratedP: z.number().min(0).max(1),
    goalScored: z.boolean(),
    minutesToGoal: z.number().int().min(0).max(120).nullable(),
    modelVariant: z.string().max(64).default("champion"),
    features: z.array(z.number()).max(64).optional(),
  })
  .strict();

// ══════════════════════════════════════════════════════════════════
// ML TRAIN — POST /api/admin/ml/train
// ══════════════════════════════════════════════════════════════════

export const mlTrainSchema = z
  .object({
    name: z.enum(["gbdt", "xgb", "inplay", "team-strength", "xt-grid"]),
    version: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
    horizon_min: z.number().int().min(1).max(120).optional(),
    dataset_id: z.string().optional(),
    dataset_path: z.string().optional(),
  })
  .strict();

// ══════════════════════════════════════════════════════════════════
// AUTH — POST /api/admin/auth
// ══════════════════════════════════════════════════════════════════

export const authLoginSchema = z
  .object({
    action: z.literal("login"),
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(256),
  })
  .strict();

export const authChangePasswordSchema = z
  .object({
    action: z.literal("change-password"),
    username: z.string().optional(),
    password: z.string().min(1).max(256),
    newPassword: z.string().min(6).max(256),
  })
  .strict();

export const authLogoutSchema = z
  .object({
    action: z.literal("logout"),
  })
  .strict();

export type SignalRecordInput = z.infer<typeof signalRecordSchema>;
export type ExpireHalftimeInput = z.infer<typeof expireHalftimeSchema>;
export type PredictRecordInput = z.infer<typeof predictRecordSchema>;
export type MLTrainInput = z.infer<typeof mlTrainSchema>;
export type AuthLoginInput = z.infer<typeof authLoginSchema>;
export type AuthChangePasswordInput = z.infer<typeof authChangePasswordSchema>;
