// ── xG Estimation: Research-backed improved model ─────────────────
//
// Replaces the overly simplistic inline formula:
//   SOT×0.38 + off×0.05 + blocked×0.03 + corner×0.04 + DA×0.01
// which produced inflated xG (2.0+ per match for mid-table teams).
//
// Research sources:
//   - StatsBomb open data: open-play xG ≈ 0.09 per shot
//   - Opta/XGBoost model: ~1M shots from 40 competitions
//   - Understat: EPL avg xG per shot 0.08-0.11
//   - Corner-derived chance: ~0.12-0.20 per corner
//   - Penalty: fixed 0.79
//   - Big chance (pen + one-on-one): ~0.35-0.45
//
// Outputs club-level xG (not per-shot), calibrated so that a typical
// EPL/Süper Lig team shows xG ≈ 1.0-1.4 per 90 min.
//
// When the API provides xG (stats.xg.home/away), those values are
// used directly — this fallback only fires when API xG is absent.

	import type { MatchStats } from './nesineTypes';
	import { getXgCoefficients, type XgLeagueCoefficients } from './smartCalibration';
	
	// ── Per-shot xG coefficients (research-calibrated) ────────────────
	// Sources: StatsBomb open data, Understat, Opta analyst
	// Open-play shot: ~0.09 across all leagues
	// Bu sabitler getXgCoefficients(leagueId) ile geçersiz kılınabilir.
	const SHOT_COEFFS = {
	  onTarget:   0.085,  // SOT: best proxy (includes box + long range)
	  offTarget:  0.030,  // Mostly long-range wild hits
	  blocked:    0.025,  // Deflection → goal still possible but low
	} as const;
	
	// Corner-derived chance on-target (average ~0.14 per corner)
	// Second-half corners > first half (fatigue, set-piece focus)
	const CORNER_WEIGHT = {
	  firstHalf:    0.14,  // min 1-45
	  secondHalf:   0.20,  // min 46-90+
	} as const;
	
	/**
	 * Liga göre ayarlanmış şut katsayılarını döndürür.
	 * Smart calibration'dan gelen lig profiline göre SOT→xG katsayısı ayarlanır.
	 */
	function getCoefs(leagueId?: number | null): { shot: { onTarget: number; offTarget: number; blocked: number }; corner: { firstHalf: number; secondHalf: number } } {
	  if (!leagueId) return { shot: { ...SHOT_COEFFS }, corner: { ...CORNER_WEIGHT } };
	  const lc = getXgCoefficients(leagueId);
	  return {
	    shot: { onTarget: lc.onTarget, offTarget: lc.offTarget, blocked: lc.blocked },
	    corner: { firstHalf: lc.cornerFirstHalf, secondHalf: lc.cornerSecondHalf },
	  };
	}

// ── Context quality factors ───────────────────────────────────────
// Pressure-based modifier (team building up chances well = better quality)
const PRESSURE_HIGH_THRESHOLD    = 55; // above this = good build-up quality
const PRESSURE_QUALITY_COEFF     = 0.003; // pressure contribution per point
const PRESSURE_BOOST_MAX         = 0.30;  // cap at +30%

// Shot accuracy proxy for quality (shots on target / total shots)
const HIGH_ACCURACY_RATIO = 0.40; // SOT/Tot > 40% → close-range accuracy
const LOW_ACCURACY_RATIO  = 0.20;  // SOT/Tot < 20% → mostly long balls

const HIGH_ACC_QUALITY    = 1.15; // +15% quality boost
const LOW_ACC_QUALITY     = 0.80;  // -20% quality penalty

// Dangerous attacks as quality signal
// More DA per shot = better team movement → higher xG conversion likelihood
const HIGH_DA_PER_SHOT    = 4.0;  // >4 DA per total shot → quality build-up
const DA_QUALITY_COEFF    = 0.02; // per DA unit beyond threshold

// Possession advantage (higher possession teams generate better opportunities)
const POSSESSION_THRESHOLD = 55;   // >55% possession = advantage
const POSSESSION_COEFF     = 0.004; // per possession point above threshold
const POSSESSION_BOOST_MAX = 0.15;  // cap at +15%

// Odds-derived calibration (when movement analysis is available)
// Odds movement reflects market's collective intelligence on goal probability
const ODDS_CALIBRATION_COEFF = 0.10; // how much to trust odds movement

// Penalty xG (FIFA penalty conversion rate ~75-79%)
export const PENALTY_XG = 0.79;

// Clamp bounds — no team xG < 0.05 or > 5.0 for club football
const XG_MIN = 0.05;
const XG_MAX = 5.0;

// ── Shot quality estimator (thin wrapper, not full ML model) ──────
// Estimates per-shot quality from available stats:
//   - DA/total ratio → build-up quality proxy
//   - SOT/total ratio → shot selection quality proxy
//   - Possession → control quality proxy
// Quality ∈ [0.5, 1.8]: 1.0 = average match shot quality

export function estimateShotQuality(
  stats: MatchStats,
  side: 'home' | 'away',
  minute: number,
): number {
  const sot      = stats.shots_on_target?.[side] ?? 0;
  const total    = stats.shots_total?.[side] ?? 0;
  const da       = stats.dangerous_attacks?.[side] ?? 0;
  const poss     = stats.possession?.[side] ?? 50;

  // Guard against division by zero
  const totalSafe = Math.max(1, total);

  // ── Pressure quality (build-up quality proxy) ────────────────────
  // Higher pressure = more structured attacks = better shot quality
  // Simple pressure model without full calculatePressure dependency
  // (avoids circular import with nesineTypes)
  const threadDanger = da > 0 ? (sot / totalSafe) * da : 0;
  const pressure = Math.min(70, 35 + threadDanger * 3);
  let quality = 1.0;
  if (pressure > PRESSURE_HIGH_THRESHOLD) {
    const pressureBoost = Math.min(
      PRESSURE_BOOST_MAX,
      (pressure - PRESSURE_HIGH_THRESHOLD) * PRESSURE_QUALITY_COEFF,
    );
    quality += pressureBoost;
  }

  // ── Shot accuracy quality ────────────────────────────────────────
  const accRatio = sot / totalSafe;
  if (accRatio > HIGH_ACCURACY_RATIO) {
    quality *= HIGH_ACC_QUALITY;
  } else if (accRatio < LOW_ACCURACY_RATIO && total >= 3) {
    quality *= LOW_ACC_QUALITY;
  }

  // ── DA per shot quality ──────────────────────────────────────────
  if (total >= 2) {
    const daPerShot = da / totalSafe;
    if (daPerShot > HIGH_DA_PER_SHOT) {
      const daBoost = Math.min(0.15, (daPerShot - HIGH_DA_PER_SHOT) * DA_QUALITY_COEFF);
      quality += daBoost;
    }
  }

  // ── Possession advantage ─────────────────────────────────────────
  if (poss > POSSESSION_THRESHOLD) {
    const possBoost = Math.min(
      POSSESSION_BOOST_MAX,
      (poss - POSSESSION_THRESHOLD) * POSSESSION_COEFF,
    );
    quality += possBoost;
  }

  return Math.max(0.5, Math.min(1.8, quality));
}

// ── Main estimator: club-level xG from match stats ────────────────
	export function estimateXgFromShots(
	  stats: MatchStats,
	  side: 'home' | 'away',
	  minute: number = 45,
	  oddsCalibration: number = 0, // from odds movement boost (0-10 scale)
	  leagueId?: number | null,
	): number {
	  // 0. League-adjusted coefficients
	  const coefs = getCoefs(leagueId);
	
	  // 1. Use API xG directly if available
	  const apiXg = side === 'home' ? stats.xg?.home : stats.xg?.away;
	  if (apiXg != null && apiXg > 0) return apiXg;
	
	  // 2. Shot counts
	  const sot    = stats.shots_on_target?.[side] ?? 0;
	  const total  = stats.shots_total?.[side] ?? 0;
	  const blocked = stats.shots_blocked?.[side] ?? 0;
	  const offTarget = Math.max(0, total - sot - blocked);
	  const corners  = stats.corners?.[side] ?? 0;
	  const da       = stats.dangerous_attacks?.[side] ?? 0;
	
	  // 3. Shot quality modifier
	  const quality = estimateShotQuality(stats, side, minute);
	
	  // 4. Per-shot xG (research-calibrated, league-adjusted)
	  let xg =
	    sot * coefs.shot.onTarget +
	    offTarget * coefs.shot.offTarget +
	    blocked * coefs.shot.blocked;

	  // 5. Corner contribution (independent of shot coefficient, league-adjusted)
	  const isSecondHalf = minute >= 46;
	  const cornerBonus = (isSecondHalf ? coefs.corner.secondHalf : coefs.corner.firstHalf) * corners;
  xg += cornerBonus;

  // 6. Apply shot quality modifier
  xg *= quality;

  // 7. DA completeness bonus: high DA/shot ratio means team creating chances
  //    that aren't yet shots — these will likely convert to xG-earning shots soon
  const totalAttempts = Math.max(total, da * 0.3); // floor prevents division by zero
  if (total >= 2 && da > 0) {
    const daRatio = da / totalAttempts;
    if (daRatio > 0.8) xg *= 1.10; // weaving through defense → likely scoring soon
  }

  // 8. Odds calibration (market intelligence)
  if (oddsCalibration > 0) {
    const oddsFactor = 1 + oddsCalibration * ODDS_CALIBRATION_COEFF;
    xg *= Math.min(oddsFactor, 1.30); // cap at +30% from odds
  }

  // 9. Clamp to realistic bounds
  return clampXg(xg);
}

// ── Two-sided wrapper (convenience, replaces 4 separate calls) ────
	export function estimateXgFromShotsBoth(
	  stats: MatchStats,
	  minute: number = 45,
	  homeOddsCal: number = 0,
	  awayOddsCal: number = 0,
	  leagueId?: number | null,
	): { home: number; away: number } {
	  return {
	    home: estimateXgFromShots(stats, 'home', minute, homeOddsCal, leagueId),
	    away: estimateXgFromShots(stats, 'away', minute, awayOddsCal, leagueId),
	  };
	}

// ── Penetration rate: new DA relative to opponent's DA ─────────────
// Measures how much a team is breaking through opponent's press
export function calculateXgVelocity(
  stats: MatchStats,
  prevStats: MatchStats | undefined,
  side: 'home' | 'away',
  elapsedMin: number,
): number {
  if (!prevStats || elapsedMin <= 0) return 0;

  const currentDa = stats.dangerous_attacks?.[side] ?? 0;
  const prevDa    = prevStats.dangerous_attacks?.[side] ?? 0;
  const deltaDa   = currentDa - prevDa;
  const oppDa     = (side === 'home'
    ? stats.dangerous_attacks?.away
    : stats.dangerous_attacks?.home) ?? 0;
  const prevOppDa = (side === 'home'
    ? prevStats.dangerous_attacks?.away
    : prevStats.dangerous_attacks?.home) ?? 0;

  // Delta relative to opponent's current level (normalization)
  const oppTotal = Math.max(1, oppDa + prevOppDa);
  const penetration = deltaDa / (oppTotal * 0.5);

  // xG flow = current estimated xG velocity per minute
  const currentXg = estimateXgFromShots(stats, side, elapsedMin);
  const prevXg    = prevStats.xg?.[side] ?? estimateXgFromShots(prevStats, side, elapsedMin);
  const xgDelta   = Math.max(0, currentXg - prevXg);
  const xgPerMin  = elapsedMin > 0 ? xgDelta / elapsedMin : 0;

  return xgPerMin * (1 + Math.max(-0.5, Math.min(1.5, penetration)));
}

// ── SMART xG delta detection (replaces raw xG delta) ──────────────
// Uses quality-adjusted delta to detect genuine xG accumulation vs noise
export function computeXgDelta(
  stats: MatchStats,
  prevStats: MatchStats | undefined,
  side: 'home' | 'away',
  minute: number,
): { delta: number; isSignificant: boolean; quality: number } {
  const currentXg  = stats.xg?.[side] ?? estimateXgFromShots(stats, side, minute);
  const prevXg     = prevStats?.xg?.[side] ?? (prevStats ? estimateXgFromShots(prevStats, side, minute) : 0);
  const rawDelta   = currentXg - prevXg;
  const quality    = estimateShotQuality(stats, side, minute);
  const adjustedDelta = rawDelta > 0 ? rawDelta * (0.7 + quality * 0.3) : rawDelta;

  // Significant if delta > 0.07 AND quality-adjusted
  const isSignificant = adjustedDelta > 0.07 && quality > 0.75;

  return {
    delta: Math.round(adjustedDelta * 100) / 100,
    isSignificant,
    quality: Math.round(quality * 100) / 100,
  };
}

// ── Helper ────────────────────────────────────────────────────────

function clampXg(xg: number): number {
  return Math.max(XG_MIN, Math.min(XG_MAX, xg));
}
