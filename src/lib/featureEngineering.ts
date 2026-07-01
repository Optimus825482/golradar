// ── Feature Engineering Module ────────────────────────────────────
// Extracts structured numerical features from match data for ML model input.
// Features are designed based on football analytics research:
//   - Klemp 2021: In-play prediction features
//   - Fan & Wang 2024: Set piece & shot quality features
//   - Ayana et al. 2025: Temporal features
//   - Dixon & Coles 1997: Team strength features
//
// Each feature is normalized to [0, 1] range for ML model compatibility.

import type { MatchStats } from './nesineTypes';
import { estimateXgFromShots as estimateXgShared } from './estimateXg';
import { predictFromElo, getFormIndexEma, getRating } from './eloRating';
import { getTimeBasedGoalMultiplier } from './dixonColes';
import { logError } from '@/lib/devLog';
// teamHistoryBackfill pulls in sofascore.ts (uses child_process via
// Python bridge) — keep it out of the client bundle by deferring
// the import to call time.
import { predictMatch } from './ml/teamStrengthKalman';

// ── Feature Vector Definition ──────────────────────────────────────

export interface MatchFeatures {
  // Pressure & dominance features (7)
  pressure_home: number;           // Home pressure index (0-1)
  pressure_away: number;           // Away pressure index (0-1)
  pressure_gap: number;            // |home - away| pressure gap (0-1)
  pressure_dominant_side: number;  // 1 = home, 0 = away, 0.5 = balanced
  possession_home: number;         // Home possession % (0-1)
  possession_gap: number;          // |home_poss - away_poss| / 100
  dangerous_attacks_home_rate: number; // Home DA per 15 min, normalized

  // Shot quality features (8)
  shots_total_home_rate: number;   // Home total shots per 15 min, normalized
  shots_total_away_rate: number;   // Away total shots per 15 min, normalized
  shots_on_target_home_rate: number; // Home SOT per 15 min, normalized
  shots_on_target_away_rate: number; // Away SOT per 15 min, normalized
  sot_ratio_home: number;          // Home SOT/total shots ratio (0-1)
  sot_ratio_away: number;          // Away SOT/total shots ratio (0-1)
  xg_home: number;                 // Home xG, normalized (0-1, capped at 3.0)
  xg_away: number;                 // Away xG, normalized (0-1, capped at 3.0)

  // Set piece features (4)
  corners_home_rate: number;       // Home corners per 15 min, normalized
  corners_away_rate: number;       // Away corners per 15 min, normalized
  free_kicks_home_rate: number;    // Home free kicks per 15 min, normalized
  free_kicks_away_rate: number;    // Away free kicks per 15 min, normalized

  // Momentum & trend features (6)
  momentum_trend_home: number;     // Home pressure trend (0-1, 0.5 = flat)
  momentum_trend_away: number;     // Away pressure trend (0-1, 0.5 = flat)
  momentum_accel_home: number;     // Home acceleration (0-1)
  momentum_accel_away: number;     // Away acceleration (0-1)
  sustained_pressure_home: number; // Home consecutive high pressure (0-1)
  sustained_pressure_away: number; // Away consecutive high pressure (0-1)

  // Temporal features (4)
  match_minute_norm: number;       // Minute / 90 (0-1)
  time_multiplier: number;         // Time-based goal multiplier (0-1, norm of 0.7-1.3)
  is_first_half: number;           // 1 if first half, 0 if second
  is_peak_goal_time: number;       // 1 if 76-90+, 0 otherwise

  // Team strength features (6)
  elo_diff_norm: number;           // Elo difference, normalized (-1 to 1)
  home_form_index: number;         // Home form 0-1
  away_form_index: number;         // Away form 0-1
  home_elo_matches: number;        // Home Elo match count, normalized
  away_elo_matches: number;        // Away Elo match count, normalized
  home_advantage_factor: number;   // Home advantage (fixed 0.53 for home, 0.47 for away)

  // Context features (5)
  score_gap: number;               // |home_goals - away_goals| / 5, normalized
  total_goals_norm: number;        // (home_goals + away_goals) / 6, normalized
  is_draw: number;                 // 1 if draw, 0 otherwise
  home_leading: number;            // 1 if home leading, 0 otherwise
  red_cards_home: number;          // Home red cards (0 or 1+)
  red_cards_away: number;          // Away red cards (0 or 1+)

  // Weather features (3) - from FotMob
  temperature_norm: number;        // Temperature normalized (0-1, -10 to 40°C)
  wind_speed_norm: number;         // Wind speed normalized (0-1, 0-50 km/h)
  precipitation_norm: number;      // Precipitation normalized (0-1, 0-10 mm)

  // xG advanced features (4)
  xg_rate_home: number;            // xG per 15 min home, normalized
  xg_rate_away: number;            // xG per 15 min away, normalized
  xg_dominance_ratio: number;      // home_xg / (home_xg + away_xg) (0-1)
  xg_spike: number;                // Recent xG delta, normalized (0-1)

  // xT advanced features (3) — from W5 grid + recent event stream
  xt_home_recent: number;          // Avg xT delta of last 5 home actions (0-1, norm of 0-0.06)
  xt_away_recent: number;          // Avg xT delta of last 5 away actions (0-1)
  xt_dominance: number;            // xt_home_recent - xt_away_recent, [-1, +1]

  // Live in-play features (4) — for W6 5-min ahead model
  last_5min_pressure_growth: number; // Δ pressure over last 5 snapshots, [-1, +1]
  last_5min_xg_delta_home: number;   // xG added by home in last 5 min, normalized [0, 1]
  last_5min_xg_delta_away: number;   // xG added by away in last 5 min, normalized [0, 1]
  consecutive_shots_on_target_home: number; // SOT count last 10 min home, normalized [0, 1]

  // ── P1.1: Shot geometry (FotMob shotmap) ──
  shot_avg_angle_norm: number;       // Mean shot angle normalized [0,1]
  shot_avg_distance_norm: number;    // Mean shot distance normalized [0,1]
  shot_defenders_avg: number;        // Avg defenders on shot line, normalized [0,1]

  // ── B1: Freeze-frame defensive features (Singh 2025 — AUC 0.878) ──
  shot_angle_home: number;           // Avg shot angle for home shots, normalized [0,1]
  shot_angle_away: number;           // Avg shot angle for away shots, normalized [0,1]
  shot_distance_home: number;        // Avg shot distance for home shots, normalized [0,1]
  shot_distance_away: number;        // Avg shot distance for away shots, normalized [0,1]
  defenders_in_cone_home: number;    // Proxy for defenders in shooting cone, normalized [0,1]
  defenders_in_cone_away: number;    // Proxy for defenders in shooting cone, normalized [0,1]

  // ── P1.3: PPDA proxy (pressing intensity) ──
  ppda_home: number;                 // dangerous_attacks / (attacks+1) normalized
  ppda_away: number;

  // ── P1.5: Field Tilt proxy (Anderson & Sally 2013) ──
  // DA / total attacks: how much play is in the opponent's half.
  // Higher = team applying sustained territorial pressure.
  field_tilt_home: number;           // DA_home / attacks_home normalized [0,1]
  field_tilt_away: number;
  field_tilt_dominance: number;      // share of total DA taken by home (0-1, 0.5 = balanced)

  // ── P1.5: Press effectiveness (defensive actions / opponent attacks) ──
  press_effectiveness_home: number;  // (saves + offsides) / away_attacks
  press_effectiveness_away: number;
  gk_distance_proxy_home: number;    // GK distance — proxy from shotmap high-xG shot share
  gk_distance_proxy_away: number;

  // ── P1.6: Context features ──
  fixture_congestion_home: number;   // Days since last match, normalized [0,1] (0=fresh)
  fixture_congestion_away: number;
  rest_advantage: number;            // (home_rest - away_rest) / 7, [-1, +1]

  // ── W4: Team-strength Kalman (4) ──
  team_alpha_home: number;           // Home attack strength (log-xG), clamped [-3, +3]
  team_beta_home: number;            // Home defense weakness (log-xG), clamped [-3, +3]
  team_alpha_away: number;           // Away attack strength (log-xG), clamped [-3, +3]
  team_beta_away: number;            // Away defense weakness (log-xG), clamped [-3, +3]

  // ── C3: Closing Line Value features (Wilkens 2026 — ROI %10-15) ──
  closing_over25_implied: number;    // Implied prob from closing over25 odds [0,1]
  closing_btts_implied: number;      // Implied prob from closing BTTS odds [0,1]
  model_vs_market_divergence: number;// |ensembleP - marketP| for over25 [0,1]
}

// ── Feature extraction function ────────────────────────────────────

export interface FeatureExtractionInput {
  stats: MatchStats;
  minute: string;
  isLive: boolean;
  homeGoals: number;
  awayGoals: number;
  homeTeam?: string;
  awayTeam?: string;
  pressureHistory?: Array<{
    homePressure: number;
    awayPressure: number;
    stats: MatchStats;
    homeGoals?: number;
    awayGoals?: number;
  }>;
  /** Recent event stream for xT deltas (W5). Optional. */
  recentEvents?: Array<{
    startXPct: number;  // 0..100 — pitch position (length axis)
    startYPct: number;  // 0..100 — width axis
    side: 'home' | 'away';
  }>;
  /** Skip the xT grid lazy load. When true, the three xT features
   * fall back to neutral 0.5 / 0 — used in hot paths where the
   * grid hasn't been registered yet. */
  skipXtGrid?: boolean;
  weather?: {
    temperature: number;
    windSpeed: number;
    precipitation: number;
  } | null;
  /** P1.1: FotMob shotmap for shot geometry features. */
  shotmap?: Array<{
    x: number; y: number;
    expectedGoals: number;
    shotType: string;
    situation: string;
    isBlocked: boolean;
    isOnTarget: boolean;
    teamId: number;
  }> | null;
  /** P1.1: Team IDs to assign shots to home/away */
  fotmobHomeTeamId?: number | null;
  fotmobAwayTeamId?: number | null;
  /** P1.6: Last-match timestamps (ms) for fixture congestion calc */
  homeLastMatchTs?: number | null;
  awayLastMatchTs?: number | null;
  /** C3: Closing odds for CLV features (Wilkens 2026). */
  closingOdds?: {
    over25: number;
    btts: number;
    homeWin: number;
    draw: number;
    awayWin: number;
  } | null;
  /** C3: Current model over25 probability for divergence feature. */
  ensembleP?: number | null;
}

// Normalization helpers
function normLinear(value: number, min: number, max: number): number {
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function normRate(per15min: number, maxExpected: number = 10): number {
  return Math.max(0, Math.min(1, per15min / maxExpected));
}

// P1.1: Pitch geometry helpers (FotMob uses 0-100 pct coords)
const PITCH_LEN = 105, PITCH_WID = 68, GOAL_WID = 7.32;
function shotAngleFromGoal(xPct: number): number {
  const dx = 100 - xPct;
  return Math.atan2(GOAL_WID / 2, Math.max(1, dx)) * 2;
}
function shotDistanceFromGoal(xPct: number, yPct: number): number {
  const dx = (100 - xPct) / 100 * PITCH_LEN;
  const dy = (50 - yPct) / 100 * PITCH_WID;
  return Math.sqrt(dx * dx + dy * dy);
}

export async function extractFeatures(input: FeatureExtractionInput): Promise<MatchFeatures> {
  const { stats, minute, homeGoals, awayGoals, pressureHistory, weather, homeTeam, awayTeam,
    shotmap, homeLastMatchTs, awayLastMatchTs, fotmobHomeTeamId, fotmobAwayTeamId,
    closingOdds, ensembleP } = input;

  // Parse minute (handle stoppage time correctly: "45+2'" -> 47)
  let minNum = (() => {
    const plusMatch = minute.match(/^(\d+)\s*\+\s*(\d+)/);
    if (plusMatch) {
      return parseInt(plusMatch[1], 10) + parseInt(plusMatch[2], 10);
    }
    const num = parseInt(minute.replace(/[^0-9]/g, ''), 10);
    return isNaN(num) ? 45 : num;
  })();
  if (!minNum || minNum === 0) minNum = 45;
  minNum = Math.max(1, Math.min(120, minNum));

  const elapsed15 = Math.max(1, minNum / 15);
  const getStat = (key: string, side: 'home' | 'away'): number => {
    const s = stats[key];
    if (!s) return 0;
    return (side === 'home' ? s.home : s.away) ?? 0;
  };

  // ── Pressure features ──
  const possH = getStat('possession', 'home');
  const possA = getStat('possession', 'away');
  const daH = getStat('dangerous_attacks', 'home');
  const daA = getStat('dangerous_attacks', 'away');
  const sotH = getStat('shots_on_target', 'home');
  const sotA = getStat('shots_on_target', 'away');
  const totalShotsH = getStat('shots_total', 'home');
  const totalShotsA = getStat('shots_total', 'away');
  const cornersH = getStat('corners', 'home');
  const cornersA = getStat('corners', 'away');

  // Pressure calculation (same weights as nesine.ts)
  const pressureWeights: Record<string, number> = {
    possession: 0.075,
    dangerous_attacks: 0.30,
    shots_total: 0.15,
    shots_on_target: 0.25,
    corners: 0.125,
  };

  let homePressure = 0;
  let awayPressure = 0;
  for (const [key, weight] of Object.entries(pressureWeights)) {
    const stat = stats[key];
    if (stat && stat.home != null && stat.away != null) {
      const total = stat.home + stat.away;
      if (total > 0) {
        homePressure += (stat.home / total) * weight * 100;
        awayPressure += (stat.away / total) * weight * 100;
      }
    }
  }

  const pressureHome = homePressure / 100;
  const pressureAway = awayPressure / 100;
  const pressureGap = Math.abs(pressureHome - pressureAway);

  // ── Shot quality features ──
  const sotRateH = (sotH / elapsed15);
  const sotRateA = (sotA / elapsed15);
  const totalRateH = (totalShotsH / elapsed15);
  const totalRateA = (totalShotsA / elapsed15);
  const sotRatioH = totalShotsH > 0 ? sotH / totalShotsH : 0;
  const sotRatioA = totalShotsA > 0 ? sotA / totalShotsA : 0;

  // xG estimation (shared formula from estimateXg.ts)
  const xgHome = estimateXgShared(stats, 'home', minNum);
  const xgAway = estimateXgShared(stats, 'away', minNum);

  // ── Set piece features ──
  const fkH = getStat('free_kicks', 'home');
  const fkA = getStat('free_kicks', 'away');

  // ── Momentum features ──
  let homeTrend = 0;
  let awayTrend = 0;
  let homeAccel = 0;
  let awayAccel = 0;
  let homeSustained = 0;
  let awaySustained = 0;

  if (pressureHistory && pressureHistory.length >= 5) {
    const recent = pressureHistory.slice(-5);
    homeTrend = (recent[4].homePressure - recent[0].homePressure) / 100;
    awayTrend = (recent[4].awayPressure - recent[0].awayPressure) / 100;
    homeAccel = ((recent[4].homePressure - recent[2].homePressure) - (recent[2].homePressure - recent[0].homePressure)) / 100;
    awayAccel = ((recent[4].awayPressure - recent[2].awayPressure) - (recent[2].awayPressure - recent[0].awayPressure)) / 100;
    homeSustained = recent.filter(s => s.homePressure > 55).length / 5;
    awaySustained = recent.filter(s => s.awayPressure > 55).length / 5;
  }

  // ── Temporal features ──
  const timeMult = getTimeBasedGoalMultiplier(minNum);
  const isFirstHalf = minNum <= 45 ? 1 : 0;
  const isPeakGoalTime = minNum >= 76 ? 1 : 0;

  // ── Team strength features (Elo) ──
  let eloDiffNorm = 0;
  let homeFormIdx = 0.5;
  let awayFormIdx = 0.5;
  let homeEloMatches = 0;
  let awayEloMatches = 0;

  if (homeTeam && awayTeam) {
    try {
      const prediction = predictFromElo(homeTeam, awayTeam);
      eloDiffNorm = Math.max(-1, Math.min(1, prediction.ratingDiff / 400));
      // P1.2: EMA-weighted form index (~2-week half-life)
      homeFormIdx = getFormIndexEma(homeTeam);
      awayFormIdx = getFormIndexEma(awayTeam);
      homeEloMatches = (getRating(homeTeam)?.matchesPlayed ?? 0) / 50;
      awayEloMatches = (getRating(awayTeam)?.matchesPlayed ?? 0) / 50;
    } catch (e) { logError('featureEngineering', e); }
  }

  // ── P1.1: Shot geometry from FotMob shotmap ──
  let shotAvgAngle = 0.15; // neutral default (15° opening = typical mid-range)
  let shotAvgDistance = 0.5;
  let shotDefendersAvg = 0.5;
  // ── B1: Per-side freeze-frame defensive features (Singh 2025 — AUC 0.878) ──
  let shotAngleHome = 0.5;
  let shotAngleAway = 0.5;
  let shotDistanceHome = 0.5;
  let shotDistanceAway = 0.5;
  let defendersInConeHome = 0.5;
  let defendersInConeAway = 0.5;
  if (shotmap && shotmap.length > 0) {
    // Use the shared shotGeometry module for consistent unit conversion.
    // Defer import (server-only) — featureEngineering is hot-path so we
    // dynamic-import to keep heavy code off the client bundle.
    const { aggregateShotGeometry, computeShotGeometry } = await import('./shotGeometry');
    const angles: number[] = [];
    const distances: number[] = [];
    const blockers: number[] = [];
    // Split shots by team for per-side freeze-frame features
    const homeShots = fotmobHomeTeamId != null
      ? shotmap.filter(s => s.teamId === fotmobHomeTeamId)
      : [];
    const awayShots = fotmobAwayTeamId != null
      ? shotmap.filter(s => s.teamId === fotmobAwayTeamId)
      : [];
    for (const s of shotmap) {
      if (typeof s.x !== 'number' || typeof s.y !== 'number') continue;
      const geo = computeShotGeometry(s.x, s.y, s.expectedGoals ?? 0);
      angles.push(geo.angle);
      distances.push(geo.distance);
      // isBlocked proxy for defenders on shot line
      blockers.push(s.isBlocked ? 0.8 : 0.3);
    }
    if (angles.length > 0) {
      const meanAngle = angles.reduce((a, b) => a + b, 0) / angles.length;
      const meanDist = distances.reduce((a, b) => a + b, 0) / distances.length;
      const meanBlock = blockers.reduce((a, b) => a + b, 0) / blockers.length;
      // Normalize: angle [0, π/2] → [0,1], distance [0, ~80m] → [0,1]
      shotAvgAngle = Math.max(0, Math.min(1, meanAngle / (Math.PI / 2)));
      shotAvgDistance = Math.max(0, Math.min(1, meanDist / 50));
      shotDefendersAvg = meanBlock;
    }

    // ── B1: Per-side freeze-frame defensive features ──
    const homeGeo = aggregateShotGeometry(
      homeShots.map(s => ({ x: s.x, y: s.y, expectedGoals: s.expectedGoals ?? 0 })),
    );
    const awayGeo = aggregateShotGeometry(
      awayShots.map(s => ({ x: s.x, y: s.y, expectedGoals: s.expectedGoals ?? 0 })),
    );
    if (homeShots.length > 0) {
      shotAngleHome = normLinear(homeGeo.avgAngle, 0, Math.PI / 3);
      shotDistanceHome = normLinear(homeGeo.avgDistance, 5, 35);
      // Defenders in cone proxy: high xG shots = fewer defenders
      const highXgShots = homeShots.filter(s => (s.expectedGoals ?? 0) > 0.15).length;
      defendersInConeHome = normLinear(1 - Math.min(1, highXgShots / 5), 0, 1);
    }
    if (awayShots.length > 0) {
      shotAngleAway = normLinear(awayGeo.avgAngle, 0, Math.PI / 3);
      shotDistanceAway = normLinear(awayGeo.avgDistance, 5, 35);
      const highXgShots = awayShots.filter(s => (s.expectedGoals ?? 0) > 0.15).length;
      defendersInConeAway = normLinear(1 - Math.min(1, highXgShots / 5), 0, 1);
    }
  }

  // ── P1.3: PPDA proxy ──
  const attacksH = getStat('attacks', 'home');
  const attacksA = getStat('attacks', 'away');
  // Higher DA/Attacks ratio = more efficient pressing = better quality
  const ppdaH = attacksH > 0 ? daH / attacksH : 0;
  const ppdaA = attacksA > 0 ? daA / attacksA : 0;
  // Normalize: typical range 0.05-0.40 → [0,1]
  const ppdaHome = Math.max(0, Math.min(1, ppdaH / 0.40));
  const ppdaAway = Math.max(0, Math.min(1, ppdaA / 0.40));

  // ── P1.5: Field Tilt proxy (Anderson & Sally 2013) ──
  // DA / total_attacks for each side; high = lots of play in
  // opponent's final third → sustained territorial pressure.
  const totalDa = daH + daA;
  const totalAttacks = attacksH + attacksA;
  let fieldTiltHome = 0.5;
  let fieldTiltAway = 0.5;
  let fieldTiltDominance = 0.5;
  if (totalAttacks > 0) {
    fieldTiltHome = normLinear(daH / Math.max(1, attacksH), 0, 1);
    fieldTiltAway = normLinear(daA / Math.max(1, attacksA), 0, 1);
    fieldTiltDominance = totalDa > 0
      ? normLinear(daH / Math.max(1, totalDa) - 0.5, -0.3, 0.3)
      : 0.5;
  }

  // ── P1.5: Press effectiveness ──
  // Proxy: defensive output divided by opponent attack volume.
  // (saves + offsides) / opp_attacks → how often defence ended an attack.
  const savesH = getStat('saves', 'home');
  const savesA = getStat('saves', 'away');
  const offsidesH = getStat('offsides', 'home');
  const offsidesA = getStat('offsides', 'away');
  const pressEffectHome = Math.max(0, Math.min(1, (savesH + offsidesH) / Math.max(1, attacksA)));
  const pressEffectAway = Math.max(0, Math.min(1, (savesA + offsidesA) / Math.max(1, attacksH)));

  // ── P1.5 / E1: GK distance proxy from high-xG shots ──
  // High xG (>0.30) implies goalkeeper was poorly positioned (Singh 2025).
  // Already in shotmap aggregation; consolidated here.
  let gkDistProxyHome = 0.3;
  let gkDistProxyAway = 0.3;
  if (shotmap && shotmap.length > 0) {
    const teamH = shotmap.filter(s => fotmobHomeTeamId != null && s.teamId === fotmobHomeTeamId);
    const teamA = shotmap.filter(s => fotmobAwayTeamId != null && s.teamId === fotmobAwayTeamId);
    const avgHighXg = (arr: typeof teamH) => {
      if (arr.length === 0) return 0.3;
      const sum = arr.reduce((s, sh) => s + Math.min(1, (sh.expectedGoals ?? 0) / 0.5), 0);
      return sum / arr.length;
    };
    gkDistProxyHome = avgHighXg(teamH);
    gkDistProxyAway = avgHighXg(teamA);
  }

  // ── P1.6: Fixture congestion + rest advantage ──
  const nowTs = Date.now();
  const homeRestDays = homeLastMatchTs ? Math.max(0, (nowTs - homeLastMatchTs) / 86_400_000) : 7;
  const awayRestDays = awayLastMatchTs ? Math.max(0, (nowTs - awayLastMatchTs) / 86_400_000) : 7;
  // Normalize: 0 days = 1.0 (fatigue), 14+ days = 0.0 (rust)
  const fixtureCongestionHome = Math.max(0, Math.min(1, 1 - homeRestDays / 14));
  const fixtureCongestionAway = Math.max(0, Math.min(1, 1 - awayRestDays / 14));
  // Rest advantage: positive = home had more rest (home advantage)
  const restAdvantage = Math.max(-1, Math.min(1, (homeRestDays - awayRestDays) / 7));

  // ── W4: Team-strength Kalman features ──
  // Pulled from the champion team-strength artifact. Falls back to 0
  // when no champion exists yet (cold start) or teams are unrated
  // (fewer than minMatches appearances). The 0 fallback is safe: GBDT
  // trees trained without this signal treat the new features as
  // uninformative; once a team-strength fit registers and artifacts
  // retrain, the signal flows end-to-end.
  let teamAlphaHome = 0;
  let teamBetaHome = 0;
  let teamAlphaAway = 0;
  let teamBetaAway = 0;
  if (homeTeam && awayTeam) {
    try {
      const { loadLatestTeamStrength } = await import('./ml/teamHistoryBackfill');
      const tsModel = await loadLatestTeamStrength();
      if (tsModel.nTeams > 0) {
        const pred = predictMatch(tsModel, homeTeam, awayTeam);
        teamAlphaHome = pred.alphaHome;
        teamBetaHome = pred.betaHome;
        teamAlphaAway = pred.alphaAway;
        teamBetaAway = pred.betaAway;
      }
    } catch (e) {
      logError('featureEngineering', e);
    }
  }

  // ── xG advanced features ──
  const xgRateHome = xgHome / elapsed15;
  const xgRateAway = xgAway / elapsed15;
  const totalXg = xgHome + xgAway;
  const xgDominance = totalXg > 0 ? xgHome / totalXg : 0.5;

  let xgSpike = 0;
  if (pressureHistory && pressureHistory.length >= 2) {
    const current = pressureHistory[pressureHistory.length - 1];
    const lookback = Math.min(4, pressureHistory.length - 1);
    const previous = pressureHistory[pressureHistory.length - 1 - lookback];

    const homeDelta = Math.max(0, estimateXgShared(current.stats, 'home') - estimateXgShared(previous.stats, 'home'));
    const awayDelta = Math.max(0, estimateXgShared(current.stats, 'away') - estimateXgShared(previous.stats, 'away'));
    xgSpike = normLinear(Math.max(homeDelta, awayDelta), 0, 1.0);
  }

  // ── Score context ──
  const scoreGap = Math.abs(homeGoals - awayGoals);
  const isDraw = homeGoals === awayGoals ? 1 : 0;
  const homeLeading = homeGoals > awayGoals ? 1 : 0;

  // ── Weather features ──
  const tempNorm = weather ? normLinear(weather.temperature, -10, 40) : 0.5;
  const windNorm = weather ? normLinear(weather.windSpeed, 0, 50) : 0.1;
  const precipNorm = weather ? normLinear(weather.precipitation, 0, 10) : 0;

  // ── Red cards ──
  const redH = getStat('red_cards', 'home') + getStat('two_yellow_red', 'home');
  const redA = getStat('red_cards', 'away') + getStat('two_yellow_red', 'away');

  // ── xT advanced features ──
  // When an xT grid is registered, aggregate the last 5 actions per
  // side into a single delta-average. Without the grid we fall back
  // to the 0.5 neutral value. The TS runtime does a single lazy
  // load via the model router — failures degrade to 0.5.
  let xtHomeRecent = 0.5;
  let xtAwayRecent = 0.5;
  try {
    // Dynamic import to keep the heavy grid load off the hot path
    // when the feature isn't requested.
    const { loadXtGrid, xtDeltaForPass, pitch100ToGrid } = await import('./ml/xtGrid');
    const grid = loadXtGrid();
    const recentEvents: Array<{ x: number; y: number; side: 'home' | 'away' }> = [];
    if (input.recentEvents && input.recentEvents.length > 0) {
      for (const ev of input.recentEvents.slice(-10)) {
        recentEvents.push({
          x: ev.startXPct,
          y: ev.startYPct,
          side: ev.side,
        });
      }
    }
    const homeDeltas: number[] = [];
    const awayDeltas: number[] = [];
    for (let i = 1; i < recentEvents.length; i++) {
      const prev = recentEvents[i - 1];
      const cur = recentEvents[i];
      if (cur.side !== prev.side) continue; // skip transitions
      const prevXY = pitch100ToGrid(prev.x, prev.y, grid);
      const curXY = pitch100ToGrid(cur.x, cur.y, grid);
      const delta = xtDeltaForPass(grid, prevXY.col, prevXY.row, curXY.col, curXY.row);
      if (cur.side === 'home') homeDeltas.push(delta);
      else awayDeltas.push(delta);
    }
    const lastHome = homeDeltas.slice(-5);
    const lastAway = awayDeltas.slice(-5);
    if (lastHome.length > 0) {
      xtHomeRecent = Math.max(0, Math.min(1, 0.5 + lastHome.reduce((s, d) => s + d, 0) / lastHome.length * 8));
    }
    if (lastAway.length > 0) {
      xtAwayRecent = Math.max(0, Math.min(1, 0.5 + lastAway.reduce((s, d) => s + d, 0) / lastAway.length * 8));
    }
  } catch {
    // Best-effort — keep 0.5 fallbacks
  }
  const xtDominance = Math.max(-1, Math.min(1, xtHomeRecent - xtAwayRecent));

  // ── Live in-play deltas (W6) ──
  // Aggregated from the same pressure history as the momentum
  // features. Falls back to 0 (neutral) when fewer than 5 snapshots
  // are available.
  let livePressureGrowth = 0;
  let liveXgDeltaHome = 0;
  let liveXgDeltaAway = 0;
  if (pressureHistory && pressureHistory.length >= 5) {
    const last5 = pressureHistory.slice(-5);
    livePressureGrowth = (last5[4].homePressure + last5[4].awayPressure
      - last5[0].homePressure - last5[0].awayPressure) / 200;
    livePressureGrowth = Math.max(-1, Math.min(1, livePressureGrowth));
    liveXgDeltaHome = last5[4].stats.xg?.home != null && last5[0].stats.xg?.home != null
      ? Math.max(0, (last5[4].stats.xg.home - last5[0].stats.xg.home))
      : 0;
    liveXgDeltaAway = last5[4].stats.xg?.away != null && last5[0].stats.xg?.away != null
      ? Math.max(0, (last5[4].stats.xg.away - last5[0].stats.xg.away))
      : 0;
  }
  // Consecutive SOT count (10-min window) — best-effort from
  // pressureHistory if recent snapshots carry SOT. Falls back to
  // current-minute SOT rate normalized to [0,1] when history is
  // sparse.
  const sotCount10min = (() => {
    if (pressureHistory && pressureHistory.length >= 4) {
      const recent = pressureHistory.slice(-4);
      const startH = recent[0].stats.shots_on_target?.home ?? 0;
      const endH = recent[recent.length - 1].stats.shots_on_target?.home ?? 0;
      return Math.max(0, endH - startH);
    }
    return 0;
  })();
  const consecutiveSotH = Math.min(1, sotCount10min / 4);

  // ── C3: Closing Line Value features (Wilkens 2026 — ROI %10-15) ──
  let closingOver25Implied = 0;
  let closingBttsImplied = 0;
  let modelVsMarketDivergence = 0;
  if (closingOdds) {
    const impliedProb = (odds: number) => (odds > 0 ? 1 / odds : 0);
    closingOver25Implied = normLinear(impliedProb(closingOdds.over25), 0, 1);
    closingBttsImplied = normLinear(impliedProb(closingOdds.btts), 0, 1);
    const marketOver25 = impliedProb(closingOdds.over25);
    const ensP = typeof ensembleP === 'number' ? ensembleP : 0;
    modelVsMarketDivergence = normLinear(Math.abs(ensP - marketOver25), 0, 0.5);
  }

  return {
    // Pressure & dominance
    pressure_home: pressureHome,
    pressure_away: pressureAway,
    pressure_gap: pressureGap,
    pressure_dominant_side: pressureHome > pressureAway ? 1 : pressureHome < pressureAway ? 0 : 0.5,
    possession_home: possH / 100,
    possession_gap: Math.abs(possH - possA) / 100,
    dangerous_attacks_home_rate: normRate(daH / elapsed15, 8),

    // Shot quality
    shots_total_home_rate: normRate(totalRateH, 8),
    shots_total_away_rate: normRate(totalRateA, 8),
    shots_on_target_home_rate: normRate(sotRateH, 6),
    shots_on_target_away_rate: normRate(sotRateA, 6),
    sot_ratio_home: sotRatioH,
    sot_ratio_away: sotRatioA,
    xg_home: normLinear(xgHome, 0, 3.0),
    xg_away: normLinear(xgAway, 0, 3.0),

    // Set pieces
    corners_home_rate: normRate(cornersH / elapsed15, 5),
    corners_away_rate: normRate(cornersA / elapsed15, 5),
    free_kicks_home_rate: normRate(fkH / elapsed15, 8),
    free_kicks_away_rate: normRate(fkA / elapsed15, 8),

    // Momentum
    momentum_trend_home: normLinear(homeTrend, -0.5, 0.5),
    momentum_trend_away: normLinear(awayTrend, -0.5, 0.5),
    momentum_accel_home: normLinear(homeAccel, -0.3, 0.3),
    momentum_accel_away: normLinear(awayAccel, -0.3, 0.3),
    sustained_pressure_home: homeSustained,
    sustained_pressure_away: awaySustained,

    // Temporal
    match_minute_norm: minNum / 90,
    time_multiplier: normLinear(timeMult, 0.5, 1.5),
    is_first_half: isFirstHalf,
    is_peak_goal_time: isPeakGoalTime,

    // Team strength
    elo_diff_norm: eloDiffNorm,
    home_form_index: homeFormIdx,
    away_form_index: awayFormIdx,
    home_elo_matches: Math.min(1, homeEloMatches),
    away_elo_matches: Math.min(1, awayEloMatches),
    home_advantage_factor: 0.53,

    // Score context
    score_gap: normLinear(scoreGap, 0, 5),
    total_goals_norm: normLinear(homeGoals + awayGoals, 0, 6),
    is_draw: isDraw,
    home_leading: homeLeading,
    red_cards_home: Math.min(1, redH),
    red_cards_away: Math.min(1, redA),

    // Weather
    temperature_norm: tempNorm,
    wind_speed_norm: windNorm,
    precipitation_norm: precipNorm,

    // xG advanced
    xg_rate_home: normRate(xgRateHome, 2.0),
    xg_rate_away: normRate(xgRateAway, 2.0),
    xg_dominance_ratio: xgDominance,
    xg_spike: xgSpike,
    xt_home_recent: xtHomeRecent,
    xt_away_recent: xtAwayRecent,
    xt_dominance: xtDominance,
    last_5min_pressure_growth: livePressureGrowth,
    last_5min_xg_delta_home: Math.min(1, liveXgDeltaHome),
    last_5min_xg_delta_away: Math.min(1, liveXgDeltaAway),
    consecutive_shots_on_target_home: consecutiveSotH,

    // P1.1: Shot geometry
    shot_avg_angle_norm: shotAvgAngle,
    shot_avg_distance_norm: shotAvgDistance,
    shot_defenders_avg: shotDefendersAvg,

    // B1: Freeze-frame defensive features
    shot_angle_home: shotAngleHome,
    shot_angle_away: shotAngleAway,
    shot_distance_home: shotDistanceHome,
    shot_distance_away: shotDistanceAway,
    defenders_in_cone_home: defendersInConeHome,
    defenders_in_cone_away: defendersInConeAway,

    // P1.3: PPDA proxy
    ppda_home: ppdaHome,
    ppda_away: ppdaAway,

    // P1.5: Field Tilt proxy
    field_tilt_home: fieldTiltHome,
    field_tilt_away: fieldTiltAway,
    field_tilt_dominance: fieldTiltDominance,

    // P1.5: Press effectiveness + GK distance proxy
    press_effectiveness_home: pressEffectHome,
    press_effectiveness_away: pressEffectAway,
    gk_distance_proxy_home: gkDistProxyHome,
    gk_distance_proxy_away: gkDistProxyAway,

    // P1.6: Context features
    fixture_congestion_home: fixtureCongestionHome,
    fixture_congestion_away: fixtureCongestionAway,
    rest_advantage: restAdvantage,

    // W4: Team-strength Kalman
    team_alpha_home: teamAlphaHome,
    team_beta_home: teamBetaHome,
    team_alpha_away: teamAlphaAway,
    team_beta_away: teamBetaAway,

    // C3: Closing Line Value features
    closing_over25_implied: closingOver25Implied,
    closing_btts_implied: closingBttsImplied,
    model_vs_market_divergence: modelVsMarketDivergence,
  };
}

// P1.4: Feature drift monitor — in-memory ring buffer + JSON file flush.
// Scheduler (separate task) reads buffer, computes per-feature stats,
// writes to DriftLog table. Stays lightweight (sync write, no DB here).
export interface FeatureDriftRecord {
  date: string;
  n: number;
  perFeature: Record<string, { sum: number; sumSq: number; min: number; max: number }>;
}
let _driftBuffer: FeatureDriftRecord | null = null;
let _driftBufferN = 0;

export function pushFeatureSample(features: MatchFeatures): void {
  // Drift buffer flush uses fs — bail in client bundles to keep
  // 'fs' out of the browser trace entirely.
  if (typeof window !== 'undefined') return;
  const today = new Date().toISOString().slice(0, 10);
  if (!_driftBuffer || _driftBuffer.date !== today) {
    // Flush previous day + reset
    if (_driftBuffer && _driftBuffer.n > 0) {
      const snap = _driftBuffer;
      try {
        Promise.all([import('fs'), import('path')]).then(([fsMod, pathMod]) => {
          const pathModAny = pathMod as { default: { join: typeof import('path').join; dirname: typeof import('path').dirname } };
          const p = pathModAny.default.join(process.cwd(), 'data', 'drift', `${snap.date}.json`);
          fsMod.mkdirSync(pathModAny.default.dirname(p), { recursive: true });
          fsMod.writeFileSync(p, JSON.stringify(snap));
        }).catch(() => { /* best-effort */ });
      } catch { /* best-effort */ }
    }
    _driftBuffer = { date: today, n: 0, perFeature: {} };
    _driftBufferN = 0;
  }
  if (_driftBufferN >= 5000) return; // cap per-day samples
  _driftBuffer.n++;
  _driftBufferN++;
  for (const [k, v] of Object.entries(features)) {
    if (typeof v !== 'number' || !isFinite(v)) continue;
    const cur = _driftBuffer.perFeature[k] ?? { sum: 0, sumSq: 0, min: v, max: v };
    cur.sum += v;
    cur.sumSq += v * v;
    cur.min = Math.min(cur.min, v);
    cur.max = Math.max(cur.max, v);
    _driftBuffer.perFeature[k] = cur;
  }
}
export function getTodayDriftBuffer(): FeatureDriftRecord | null {
  return _driftBuffer;
}

// ── Feature vector to array (for ML input) ────────────────────────

export const FEATURE_NAMES: (keyof MatchFeatures)[] = [
  'pressure_home', 'pressure_away', 'pressure_gap', 'pressure_dominant_side',
  'possession_home', 'possession_gap', 'dangerous_attacks_home_rate',
  'shots_total_home_rate', 'shots_total_away_rate',
  'shots_on_target_home_rate', 'shots_on_target_away_rate',
  'sot_ratio_home', 'sot_ratio_away', 'xg_home', 'xg_away',
  'corners_home_rate', 'corners_away_rate',
  'free_kicks_home_rate', 'free_kicks_away_rate',
  'momentum_trend_home', 'momentum_trend_away',
  'momentum_accel_home', 'momentum_accel_away',
  'sustained_pressure_home', 'sustained_pressure_away',
  'match_minute_norm', 'time_multiplier', 'is_first_half', 'is_peak_goal_time',
  'elo_diff_norm', 'home_form_index', 'away_form_index',
  'home_elo_matches', 'away_elo_matches', 'home_advantage_factor',
  'score_gap', 'total_goals_norm', 'is_draw', 'home_leading',
  'red_cards_home', 'red_cards_away',
  'temperature_norm', 'wind_speed_norm', 'precipitation_norm',
  'xg_rate_home', 'xg_rate_away', 'xg_dominance_ratio', 'xg_spike',
  'xt_home_recent', 'xt_away_recent', 'xt_dominance',
  'last_5min_pressure_growth', 'last_5min_xg_delta_home',
  'last_5min_xg_delta_away', 'consecutive_shots_on_target_home',
  // P1.1: Shot geometry
  'shot_avg_angle_norm', 'shot_avg_distance_norm', 'shot_defenders_avg',
  // B1: Freeze-frame defensive features
  'shot_angle_home', 'shot_angle_away',
  'shot_distance_home', 'shot_distance_away',
  'defenders_in_cone_home', 'defenders_in_cone_away',
  // P1.3: PPDA proxy
  'ppda_home', 'ppda_away',
  // P1.5: Field Tilt + Press effectiveness + GK distance proxy
  'field_tilt_home', 'field_tilt_away', 'field_tilt_dominance',
  'press_effectiveness_home', 'press_effectiveness_away',
  'gk_distance_proxy_home', 'gk_distance_proxy_away',
  // P1.6: Context
  'fixture_congestion_home', 'fixture_congestion_away', 'rest_advantage',
  // W4: Team-strength Kalman
  'team_alpha_home', 'team_beta_home', 'team_alpha_away', 'team_beta_away',
  // C3: Closing Line Value features
  'closing_over25_implied', 'closing_btts_implied', 'model_vs_market_divergence',
];

// ── Concurrency limiter ───────────────────────────────────────────
// Caps parallel heavy-pipeline calls (extractFeatures + DB write) to
// avoid backpressure when many live matches are polled together.
// Usage: import in route handlers and wrap fire-and-forget blocks.
export class PipelineSemaphore {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly max: number = 8) {}
  acquire(): Promise<void> {
    if (this.active < this.max) { this.active++; return Promise.resolve(); }
    return new Promise<void>(resolve => this.queue.push(() => { this.active++; resolve(); }));
  }
  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

export function featuresToArray(features: MatchFeatures): number[] {
  return FEATURE_NAMES.map(name => features[name] ?? 0);
}

// ── Training data record ───────────────────────────────────────────

export interface TrainingRecord {
  features: number[];       // 67-element feature vector (47 → 67 eklendi: P1.1/P1.3/P1.6/W4)
  label: number;            // 1 = goal scored within 10 min, 0 = no goal
  matchCode: number;
  minute: number;
  timestamp: number;
  side: 'home' | 'away' | 'both'; // Which side scored
}
