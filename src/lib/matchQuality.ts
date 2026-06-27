// ── Match Quality Funnel (AI Berkshire inspired) ────────────────
// Filters matches by data source quality before running predictions.
// Funnel: All matches → Source quality filter → Consensus filter → Signal

export type DataSourceQuality = 'A' | 'B' | 'C';

export interface MatchQuality {
  matchCode: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  sourceQuality: DataSourceQuality;
  sourceCount: number;
  activeSources: string[];
  hasLiveData: boolean;
  hasOddsData: boolean;
  hasHistoricalData: boolean;
  score: number;       // 0-100 quality score
  passFunnel: boolean; // passes initial filter
}

const SOURCE_WEIGHTS: Record<string, number> = {
  nesine: 1.0,       // primary, live stats via socket
  goaloo: 0.9,       // momentum + odds movement
  fotmob: 0.8,       // historical + lineup + weather
  sofascore: 0.8,    // detailed stats (via bridge)
  netscores: 0.7,    // real-time via websocket
  scoremer: 0.5,     // only finished matches
};

/**
 * Assess data source quality for a match.
 * 
 * A (zengin): 4+ sources, live data + odds
 * B (orta): 2-3 sources, at least one live
 * C (kıt): 1 source or no live data
 */
export function assessSourceQuality(activeSources: string[]): {
  grade: DataSourceQuality;
  score: number;
} {
  const unique = Array.from(new Set(activeSources));
  const totalScore = unique.reduce((s, src) => {
    const weight = SOURCE_WEIGHTS[src.toLowerCase()] ?? 0.3;
    return s + weight;
  }, 0);

  const hasLive = unique.some(s => ['nesine', 'netscores', 'goaloo'].includes(s.toLowerCase()));
  const hasOdds = unique.some(s => ['goaloo', 'nesine'].includes(s.toLowerCase()));

  if (unique.length >= 4 && hasLive && totalScore >= 3.0) {
    return { grade: 'A', score: Math.min(100, Math.round(totalScore * 25)) };
  }
  if (unique.length >= 2 && hasLive && totalScore >= 1.5) {
    return { grade: 'B', score: Math.min(70, Math.round(totalScore * 20)) };
  }
  return { grade: 'C', score: Math.min(40, Math.round(totalScore * 15)) };
}

/**
 * Funnel check: does this match pass quality filter?
 * Only A and B grade matches generate signals.
 */
export function passFunnel(quality: MatchQuality): boolean {
  return quality.sourceQuality !== 'C';
}

/**
 * Build a match quality report.
 */
export function assessMatchQuality(params: {
  matchCode: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  activeSources: string[];
}): MatchQuality {
  const { grade, score } = assessSourceQuality(params.activeSources);

  return {
    matchCode: params.matchCode,
    homeTeam: params.homeTeam,
    awayTeam: params.awayTeam,
    league: params.league,
    sourceQuality: grade,
    sourceCount: params.activeSources.length,
    activeSources: params.activeSources,
    hasLiveData: params.activeSources.some(s => ['nesine', 'netscores', 'goaloo'].includes(s.toLowerCase())),
    hasOddsData: params.activeSources.some(s => ['goaloo', 'nesine'].includes(s.toLowerCase())),
    hasHistoricalData: params.activeSources.some(s => ['fotmob', 'sofascore', 'scoremer'].includes(s.toLowerCase())),
    score,
    passFunnel: grade !== 'C',
  };
}
