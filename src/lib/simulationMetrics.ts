// ── Simulation Metrics: Profit & Betting ROI ──────────────────
// Sinyal doğruluğunu gerçek bahis getirisi olarak simüle eder.
// Her sinyale hypothetical bahis koyar: ne kadar kazanır/kaybederdik?

export interface SimulationResult {
  totalSignals: number;
  totalBets: number;
  wonBets: number;
  lostBets: number;
  winRate: number;
  totalStaked: number;    // hypothetical total wagered
  totalReturned: number;  // hypothetical total returned
  profit: number;          // totalReturned - totalStaked
  roi: number;             // return on investment (%)
  avgOdds: number;         // average implied odds
  sharpeRatio: number;     // risk-adjusted return
  maxDrawdown: number;     // largest peak-to-trough loss
}

export interface BetRecord {
  predicted: number;  // 0-1 probability
  actual: number;     // 0 or 1
  odds: number;       // implied decimal odds (1 / predicted)
  stake: number;      // hypothetical stake (default 1 unit)
  timestamp: number;
}

/**
 * Run profit simulation on a set of predictions.
 * Returns comprehensive betting metrics.
 */
export function simulateProfit(records: BetRecord[]): SimulationResult {
  if (records.length === 0) {
    return {
      totalSignals: 0, totalBets: 0, wonBets: 0, lostBets: 0, winRate: 0,
      totalStaked: 0, totalReturned: 0, profit: 0, roi: 0, avgOdds: 0,
      sharpeRatio: 0, maxDrawdown: 0,
    };
  }

  let totalStaked = 0;
  let totalReturned = 0;
  let wonBets = 0;
  let lostBets = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const returns: number[] = [];

  for (const r of records) {
    const stake = r.stake || 1;
    totalStaked += stake;

    // Kelly optimal stake fraction: (p * odds - 1) / (odds - 1)
    // But for simulation we use flat stake (1 unit per signal)
    if (r.actual === 1) {
      // Won: return stake * odds
      const returnAmt = stake * r.odds;
      totalReturned += returnAmt;
      wonBets++;
      returns.push(returnAmt - stake);
    } else {
      // Lost: lose stake
      lostBets++;
      returns.push(-stake);
    }

    // Track drawdown
    const runningProfit = totalReturned - totalStaked;
    if (runningProfit > peak) peak = runningProfit;
    const drawdown = peak - runningProfit;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  const profit = totalReturned - totalStaked;
  const totalBets = wonBets + lostBets;
  const roi = totalStaked > 0 ? (profit / totalStaked) * 100 : 0;

  // Sharpe ratio: mean(return) / std(return) * sqrt(n)
  const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length > 1
    ? returns.reduce((sum, r) => sum + (r - meanReturn) ** 2, 0) / (returns.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(returns.length) : 0;

  return {
    totalSignals: records.length,
    totalBets,
    wonBets,
    lostBets,
    winRate: totalBets > 0 ? wonBets / totalBets : 0,
    totalStaked: Math.round(totalStaked * 100) / 100,
    totalReturned: Math.round(totalReturned * 100) / 100,
    profit: Math.round(profit * 100) / 100,
    roi: Math.round(roi * 100) / 100,
    avgOdds: records.length > 0
      ? Math.round((records.reduce((s, r) => s + r.odds, 0) / records.length) * 100) / 100
      : 0,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
  };
}

/**
 * Signal'leri BetRecord'lara çevir.
 * opsiyonel: Kelly Criterion stake hesaplama.
 * Bankroll baslangıcı 100 birim, Kelly fraksiyonu cap 0.25.
 */
export function signalsToBetRecords(
  signals: Array<{ calibratedP: number; goalHappened: boolean | null; signalLevel?: string }>,
  stakePerSignal: number = 1,
  useKelly: boolean = false,
): BetRecord[] {
  let bankroll = 100;
  return signals
    .filter(s => s.calibratedP > 0 && s.calibratedP < 1 && s.goalHappened != null)
    .map(s => {
      const odds = Math.round((1 / s.calibratedP) * 100) / 100;
      let stake = stakePerSignal;
      if (useKelly) {
        // Kelly: f* = (p * odds - 1) / (odds - 1)
        const kellyFrac = (s.calibratedP * odds - 1) / (odds - 1);
        stake = Math.max(0.1, Math.min(bankroll * 0.25, bankroll * Math.max(0, kellyFrac)));
      }
      const result: BetRecord = {
        predicted: s.calibratedP,
        actual: s.goalHappened ? 1 : 0,
        odds,
        stake: Math.round(stake * 100) / 100,
        timestamp: Date.now(),
      };
      // Track bankroll for next Kelly calc
      if (useKelly) {
        bankroll += result.actual === 1 ? result.stake * (result.odds - 1) : -result.stake;
      }
      return result;
    });
}
