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
import { predictFromElo, getFormIndex, getRating } from './eloRating';
import { getTimeBasedGoalMultiplier } from './dixonColes';
import { logError } from '@/lib/devLog';

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
}

// Normalization helpers
function normLinear(value: number, min: number, max: number): number {
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function normRate(per15min: number, maxExpected: number = 10): number {
  return Math.max(0, Math.min(1, per15min / maxExpected));
}

export async function extractFeatures(input: FeatureExtractionInput): Promise<MatchFeatures> {
  const { stats, minute, homeGoals, awayGoals, pressureHistory, weather, homeTeam, awayTeam } = input;

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
      homeFormIdx = getFormIndex(homeTeam);
      awayFormIdx = getFormIndex(awayTeam);
      homeEloMatches = (getRating(homeTeam)?.matchesPlayed ?? 0) / 50;
      awayEloMatches = (getRating(awayTeam)?.matchesPlayed ?? 0) / 50;
    } catch (e) { logError('featureEngineering', e); }
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
  };
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
  return FEATURE_NAMES.map(name => features[name]);
}

// ── Training data record ───────────────────────────────────────────

export interface TrainingRecord {
  features: number[];       // 47-element feature vector
  label: number;            // 1 = goal scored within 10 min, 0 = no goal
  matchCode: number;
  minute: number;
  timestamp: number;
  side: 'home' | 'away' | 'both'; // Which side scored
}
