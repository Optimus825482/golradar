// ── Goal Radar type definitions ───────────────────────────────────
export interface PressureSnapshotLite {
  homePressure: number;
  awayPressure: number;
  stats: import('../nesineTypes').MatchStats;
  homeGoals?: number;
  awayGoals?: number;
  timestamp?: number;
}

export interface GoalProbability {
  score: number;
  homeScore: number;
  awayScore: number;
  side: 'home' | 'away' | 'both' | null;
  level: 'low' | 'medium' | 'high' | 'critical';
  factors: string[];
  calibratedP: number;
  poissonP: number;
  eloAdj: { homeAdjust: number; awayAdjust: number } | null;
  overUnder25: number;
  btts: number;
  timeMultiplier: number;
  goalProbability5min: number;
  /** Faz A4 N-of-M: how many models predict >0.5 for this match.
   *  Tier determination in goalSignalTracker uses this count
   *  (elite ≥5/9, confirmed ≥3/9, watch ≥2/9). */
  modelAgreementCount: number;
}

export interface FotMobEnrichedResult {
  goalRadar: GoalProbability;
  intelligence: import('../fotmobIntelligence').MatchIntelligence;
}
