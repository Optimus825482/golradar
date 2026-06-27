// ── Signal Thesis Tracker (AI Berkshire inspired) ───────────────
// Tracks prediction "theses" — what was predicted, why, and whether it was correct.
// Enables long-term strategy evaluation: which models/leagues/conditions are profitable.

export interface SignalThesis {
  id: string;
  matchCode: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  date: string;
  createdAt: number;       // unix ms

  // Prediction thesis
  predictedSide: 'home' | 'away' | 'both';
  predictedMinuteRange: [number, number]; // e.g. [60, 75]
  predictedProbability: number;           // 0-1
  expectedScore: number;                   // 0-100 radar score
  tier: 'HIGH' | 'MEDIUM' | 'LOW' | 'SKIP';

  // Why
  keyFactors: string[];       // e.g. ["pressure", "set_pieces", "odds_drop"]
  dominantModels: string[];   // which models agreed
  modelCount: number;
  dataSourceGrade: string;    // A/B/C

  // Outcome (filled after match)
  outcome: 'pending' | 'confirmed' | 'rejected' | 'expired';
  actualGoalMinute?: number;
  actualGoalSide?: 'home' | 'away' | null;
  minutesAfterSignal?: number;
  thesisCorrect?: boolean;    // side + time window correct
  partialCorrect?: boolean;   // goal happened but different side/time

  // Meta
  leagueProfit?: number;       // running P/L for this league
  modelProfit?: Record<string, number>; // running P/L per model
}

const theses: Map<string, SignalThesis> = new Map();

/**
 * Create a new thesis for a signal.
 */
export function createThesis(params: {
  matchCode: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  predictedSide: 'home' | 'away' | 'both';
  predictedMinuteRange: [number, number];
  predictedProbability: number;
  expectedScore: number;
  tier: 'HIGH' | 'MEDIUM' | 'LOW' | 'SKIP';
  keyFactors: string[];
  dominantModels: string[];
  dataSourceGrade: string;
}): SignalThesis {
  const id = `${params.matchCode}_${params.predictedSide}_${Date.now()}`;
  const thesis: SignalThesis = {
    id,
    ...params,
    date: new Date().toISOString().slice(0, 10),
    createdAt: Date.now(),
    modelCount: params.dominantModels.length,
    outcome: 'pending',
  };
  theses.set(id, thesis);
  return thesis;
}

/**
 * Resolve a thesis after the match.
 */
export function resolveThesis(
  id: string,
  outcome: {
    goalHappened: boolean;
    goalMinute?: number;
    goalSide?: 'home' | 'away' | null;
    minutesAfterSignal?: number;
  },
): SignalThesis | null {
  const thesis = theses.get(id);
  if (!thesis) return null;

  if (!outcome.goalHappened) {
    thesis.outcome = 'expired';
    thesis.thesisCorrect = false;
    thesis.partialCorrect = false;
    return thesis;
  }

  thesis.actualGoalMinute = outcome.goalMinute ?? 0;
  thesis.actualGoalSide = outcome.goalSide ?? null;
  thesis.minutesAfterSignal = outcome.minutesAfterSignal ?? 0;

  // Full correct: side matches + goal in predicted time window
  const sideMatch = outcome.goalSide === thesis.predictedSide || thesis.predictedSide === 'both';
  const inWindow = outcome.goalMinute != null
    && outcome.goalMinute >= thesis.predictedMinuteRange[0]
    && outcome.goalMinute <= thesis.predictedMinuteRange[1];

  thesis.thesisCorrect = sideMatch && inWindow;
  thesis.partialCorrect = outcome.goalHappened && !thesis.thesisCorrect;
  thesis.outcome = thesis.thesisCorrect ? 'confirmed'
    : thesis.partialCorrect ? 'rejected' : 'rejected';

  return thesis;
}

/**
 * Get all theses for a match.
 */
export function getMatchTheses(matchCode: number): SignalThesis[] {
  return Array.from(theses.values()).filter(t => t.matchCode === matchCode);
}

/**
 * Get thesis statistics.
 */
export function getThesisStats(): {
  total: number;
  confirmed: number;
  rejected: number;
  expired: number;
  pending: number;
  accuracy: number;
} {
  const all = Array.from(theses.values());
  const confirmed = all.filter(t => t.outcome === 'confirmed').length;
  const rejected = all.filter(t => t.outcome === 'rejected').length;
  const expired = all.filter(t => t.outcome === 'expired').length;
  const pending = all.filter(t => t.outcome === 'pending').length;
  const resolved = confirmed + rejected;

  return {
    total: all.length,
    confirmed,
    rejected,
    expired,
    pending,
    accuracy: resolved > 0 ? confirmed / resolved : 0,
  };
}
