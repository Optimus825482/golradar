// ── Per-Signal P&L Calculation (P3) ────────────────────────────────
// Kelly-stake sizing and P&L math for signal → outcome resolution.
//
// Kelly criterion: full_kelly = p - q / b, where b = decimal_odds - 1
// and q = 1 - p. We default to a quarter-Kelly (fraction=0.25) which
// is the conservative choice used by most professional bettors and
// matches Wong's "Professional Betting" guidance.
//
// P&L: outcome=1 → stake * (odds - 1), outcome=0 → -stake. Returned as
// a multiple of stake (e.g. +1.85 means the bet paid 1.85x the stake).
//
// Reference: Kelly, J. L. (1956). "A new interpretation of the
// information rate." Wong, S. (2021). "Professional Betting on
// Horse Racing."

/** Fractional Kelly stake (default 0.25 = quarter-Kelly). */
export function calculateKellyStake(
  p: number,
  odds: number,
  fraction: number = 0.25,
): number {
  if (odds <= 1) return 0;
  const b = odds - 1;
  const q = 1 - p;
  const fullKelly = p - q / b;
  return Math.max(0, fraction * fullKelly);
}

/** P&L multiple of stake given outcome and odds. */
export function calculatePnL(
  stake: number,
  odds: number,
  outcome: 0 | 1,
): number {
  if (stake <= 0) return 0;
  return outcome === 1 ? stake * (odds - 1) : -stake;
}

/**
 * Build a complete P&L record from inputs. Returns null when odds are
 * missing/invalid (caller should treat as "skip P&L" and persist a
 * row with pnl=null so historical analytics still work).
 */
export function buildSignalPnL(input: {
  signalId: string;
  calibratedP: number;
  closingOdds: number | null;
  outcome: 0 | 1;
  signalTier?: string | null;
}): {
  signalId: string;
  calibratedP: number;
  closingOdds: number | null;
  outcome: 0 | 1;
  pnl: number | null;
  kellyStake: number | null;
  signalTier: string | null;
} {
  const odds = input.closingOdds ?? 0;
  if (odds <= 1 || input.calibratedP <= 0 || input.calibratedP >= 1) {
    return {
      signalId: input.signalId,
      calibratedP: input.calibratedP,
      closingOdds: input.closingOdds,
      outcome: input.outcome,
      pnl: null,
      kellyStake: null,
      signalTier: input.signalTier ?? null,
    };
  }
  const kellyStake = calculateKellyStake(input.calibratedP, odds);
  const pnl = calculatePnL(kellyStake, odds, input.outcome);
  return {
    signalId: input.signalId,
    calibratedP: input.calibratedP,
    closingOdds: input.closingOdds,
    outcome: input.outcome,
    pnl,
    kellyStake,
    signalTier: input.signalTier ?? null,
  };
}