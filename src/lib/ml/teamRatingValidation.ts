import { z } from 'zod';

export const TeamRatingSchema = z.object({
  teamName: z.string().min(1),
  elo: z.number().int().min(0).max(4000),
  attackStrength: z.number().positive(),
  defenseWeakness: z.number().positive(),
  matchesPlayed: z.number().int().min(0),
  wins: z.number().int().min(0),
  draws: z.number().int().min(0),
  losses: z.number().int().min(0),
  goalsFor: z.number().int().min(0),
  goalsAgainst: z.number().int().min(0),
  xgFor: z.number().min(0),
  xgAgainst: z.number().min(0),
  formJson: z.string(),
});

export type ValidatedTeamRating = z.infer<typeof TeamRatingSchema>;

export function safeTeamRating(raw: unknown) {
  return TeamRatingSchema.safeParse(raw);
}

// SystemConfig validation per key
export const SystemConfigKeyTypes: Record<string, z.ZodTypeAny> = {
  'STACKING_BLEND_ALPHA': z.string().regex(/^0?\.[0-9]+$/),
  'CALIBRATION_MODE': z.enum(['auto', 'manual']),
  'RATING_SYSTEM': z.enum(['elo', 'pi', 'glicko2']),
  'CACHE_TTL_MS': z.string().regex(/^\d+$/),
};

export function validateConfigValue(key: string, value: string | null): boolean {
  const schema = SystemConfigKeyTypes[key];
  if (!schema) return true; // unknown key, allow
  if (value === null) return true; // reset to default
  return schema.safeParse(value).success;
}
