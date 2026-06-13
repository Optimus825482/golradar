// ── Backtest Types ────────────────────────────────────────────────
// Extracted from backtestEngine.ts for modularity

export interface BacktestConfig {
  startDate?: string;
  endDate?: string;
  minSignals?: number;
  thresholdRange?: number[];
  bucketCount?: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  generatedAt: string;
  signalCount: number;
  dateRange: { start: string; end: string };
  brierScore: number;
  brierDecomposition: BrierDecomposition;
  logLoss: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  specificity: number;
  thresholdAnalysis: ThresholdAnalysis[];
  calibrationCurve: CalibrationPoint[];
  calibrationError: number;
  overconfidence: number;
  timeDistribution: TimeDistribution;
  earlyWarningValue: number;
  signalDecayByMinute: SignalDecayPoint[];
  buckets: BacktestBucket[];
  sideAccuracy: SideAccuracyAnalysis;
  falsePositivePatterns: FalsePositivePattern[];
  levelAnalysis: Record<string, LevelStats>;
  factorImportance: FactorImportance[];
  dailyPerformance: DailyPerformance[];
  escalationPerformance: EscalationAnalysis;
}

export interface BrierDecomposition {
  reliability: number;
  resolution: number;
  uncertainty: number;
  brierScore: number;
}

export interface ThresholdAnalysis {
  threshold: number;
  signalCount: number;
  goalCount: number;
  precision: number;
  avgMinutesToGoal: number;
  correctSideRate: number;
  falsePositiveRate: number;
  f1Score: number;
}

export interface CalibrationPoint {
  predictedP: number;
  observedP: number;
  count: number;
  confidence: number;
}

export interface TimeDistribution {
  histogram: { range: string; count: number; goalCount: number; goalRate: number }[];
  percentiles: { p10: number; p25: number; p50: number; p75: number; p90: number };
}

export interface SignalDecayPoint {
  minuteRange: string;
  signalCount: number;
  goalRate: number;
  avgCalibratedP: number;
}

export interface BacktestBucket {
  range: string;
  minP: number;
  maxP: number;
  total: number;
  goals: number;
  goalRate: number;
  correctSide: number;
  correctSideRate: number;
  avgMinutesToGoal: number;
  avgCalibratedP: number;
  brierContribution: number;
}

export interface SideAccuracyAnalysis {
  overall: number;
  homeOnly: number;
  awayOnly: number;
  byScoreDifference: { range: string; accuracy: number; count: number }[];
}

export interface FalsePositivePattern {
  pattern: string;
  count: number;
  percentage: number;
  avgSignalScore: number;
  avgMinute: number;
}

export interface LevelStats {
  total: number;
  goals: number;
  goalRate: number;
  correctSideRate: number;
  avgMinutesToGoal: number;
}

export interface FactorImportance {
  factor: string;
  occurrenceRate: number;
  goalRateWhenPresent: number;
  goalRateWhenAbsent: number;
  lift: number;
}

export interface DailyPerformance {
  date: string;
  totalSignals: number;
  goals: number;
  goalRate: number;
  correctSideRate: number;
  avgMinutesToGoal: number;
  brierScore: number;
}

export interface EscalationAnalysis {
  totalEscalations: number;
  goalRateEscalated: number;
  goalRateNonEscalated: number;
  escalationLift: number;
  avgScoreIncrease: number;
}

export interface SignalRecord {
  matchCode: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchTime: string;
  date: string;
  signalMinute: number;
  signalSide: 'home' | 'away';
  signalScore: number;
  calibratedP: number;
  poissonP: number;
  signalLevel: string;
  activeFactors: string[];
  homeScore: number;
  awayScore: number;
  currentHomeGoals: number;
  currentAwayGoals: number;
  signalIndex: number;
  isEscalation: boolean;
  previousSignalScore: number | null;
  signalTimestamp: number;
  goalHappened: boolean | null;
  goalMinute: number | null;
  goalSide: 'home' | 'away' | null;
  correctPrediction: boolean | null;
  minutesAfterSignal: number | null;
  goalTimestamp: number | null;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
}

export interface QuickBacktestSummary {
  totalSignals: number;
  resolvedSignals: number;
  goalRate: number;
  brierScore: number;
  calibrationError: number;
  earlyWarningValue: number;
  bestThreshold: number;
  bestThresholdPrecision: number;
  topFactors: string[];
}
