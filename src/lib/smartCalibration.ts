import { logError } from '@/lib/devLog';
import { db } from './db';
import { MIN_LEAGUE_SAMPLES } from '@/config';
// ── Smart Calibration System ────────────────────────────────────────
// League-aware, goal-timing adaptive calibration for the Goal Radar
// 12-factor scoring model. Adjusts F8 (Match Minute Context) based on
// historical average goal timing per league, and provides auto/manual
// calibration modes with user override capability.
//
// Key Insight: Average goal time of 16.4 min means goals tend to come
// EARLY in that league — the dampener on minutes 1-5 should be reduced,
// and the "danger zone" boost should start earlier. Conversely, leagues
// with avg goal time > 25 min (e.g., Serie A) need stronger dampening
// in early minutes and later surges.
//
// Reference: Ayana et al. 2025 — non-linear goal probability curves
// vary significantly by league due to tactical styles, pressing intensity,
// and defensive organization.
//
// Persistence: PostgreSQL `LeagueProfile` + `SystemConfig` (mode). Disk
// persistence (data/smart-calibration/*.json) was the v1 path and is
// REMOVED — multi-instance serverless requires a single source of truth.

// ════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════

export interface LeagueGoalProfile {
  leagueId: number;
  leagueName: string;
  country: string;
  /** Average minute of first goal in matches */
  avgGoalMinute: number;
  /** Median minute of first goal */
  medianGoalMinute: number;
  /** Standard deviation of goal timing */
  goalTimeStdDev: number;
  /** Percentage of goals in first 20 minutes */
  earlyGoalRate: number;       // 0-1
  /** Percentage of goals in last 15 minutes (76-90+) */
  lateGoalRate: number;        // 0-1
  /** Percentage of goals around halftime (35-45) */
  halftimeGoalRate: number;    // 0-1
  /** Sample size */
  matchCount: number;
  /** Last updated timestamp */
  lastUpdated: number;
}

export interface CalibrationMode {
  mode: 'auto' | 'manual' | 'off';
  /** Manual override: user-specified avg goal minute (only in 'manual' mode) */
  manualAvgGoalMinute: number | null;
  /** Auto-calibration sensitivity: 0.0 = no adjustment, 1.0 = full adjustment */
  sensitivity: number;         // 0-1, default 0.7
  /** Whether odds movement should compound with minute context (F8+odds) */
  oddsCompoundEnabled: boolean;
  /** Minimum matches required for auto-calibration to activate */
  minSampleSize: number;       // default 20
}

export interface F8CalibrationResult {
  /** Original dampener value (e.g., 0.85 for minutes 1-5) */
  originalDampener: number;
  /** Calibrated dampener value — adjusted based on league goal timing */
  calibratedDampener: number;
  /** Original boost for danger zone (e.g., 1.30 for 86+) */
  originalDangerBoost: number;
  /** Calibrated danger boost */
  calibratedDangerBoost: number;
  /** Shift in danger zone start minute (e.g., -3 means danger starts 3 min earlier) */
  dangerZoneShift: number;
  /** Shift in early dampener end minute (e.g., +2 means dampener applies 2 min longer) */
  dampenerZoneShift: number;
  /** Halftime surge start minute shift */
  halftimeSurgeShift: number;
  /** Source of calibration */
  source: 'auto' | 'manual' | 'default';
  /** League profile used (if auto) */
  leagueProfile: LeagueGoalProfile | null;
  /** Human-readable explanation */
  explanation: string;
}

interface SmartCalibrationState {
  mode: CalibrationMode;
  leagueProfiles: Map<number, LeagueGoalProfile>;
  globalProfile: LeagueGoalProfile | null;
}

// ════════════════════════════════════════════════════════════════
// LEAGUE GOAL TIMING DEFAULTS
// Research-based averages from major European leagues
// ════════════════════════════════════════════════════════════════

const LEAGUE_DEFAULTS: LeagueGoalProfile[] = [
  // Eredivisie (Netherlands) — attacking, early goals
  { leagueId: 10, leagueName: 'Eredivisie', country: 'NL', avgGoalMinute: 14.2, medianGoalMinute: 13.0, goalTimeStdDev: 12.5, earlyGoalRate: 0.32, lateGoalRate: 0.18, halftimeGoalRate: 0.15, matchCount: 0, lastUpdated: 0 },
  // Premier League — moderate, slightly early
  { leagueId: 1, leagueName: 'Premier League', country: 'GB', avgGoalMinute: 18.6, medianGoalMinute: 17.0, goalTimeStdDev: 14.2, earlyGoalRate: 0.24, lateGoalRate: 0.22, halftimeGoalRate: 0.14, matchCount: 0, lastUpdated: 0 },
  // La Liga — tactical, later goals
  { leagueId: 2, leagueName: 'La Liga', country: 'ES', avgGoalMinute: 22.1, medianGoalMinute: 21.0, goalTimeStdDev: 15.8, earlyGoalRate: 0.18, lateGoalRate: 0.25, halftimeGoalRate: 0.12, matchCount: 0, lastUpdated: 0 },
  // Bundesliga — pressing, early-moderate
  { leagueId: 3, leagueName: 'Bundesliga', country: 'DE', avgGoalMinute: 17.3, medianGoalMinute: 16.0, goalTimeStdDev: 13.6, earlyGoalRate: 0.27, lateGoalRate: 0.20, halftimeGoalRate: 0.16, matchCount: 0, lastUpdated: 0 },
  // Serie A — defensive, late goals
  { leagueId: 4, leagueName: 'Serie A', country: 'IT', avgGoalMinute: 24.8, medianGoalMinute: 23.5, goalTimeStdDev: 16.2, earlyGoalRate: 0.14, lateGoalRate: 0.28, halftimeGoalRate: 0.11, matchCount: 0, lastUpdated: 0 },
  // Ligue 1 — moderate
  { leagueId: 5, leagueName: 'Ligue 1', country: 'FR', avgGoalMinute: 20.5, medianGoalMinute: 19.0, goalTimeStdDev: 14.9, earlyGoalRate: 0.21, lateGoalRate: 0.23, halftimeGoalRate: 0.13, matchCount: 0, lastUpdated: 0 },
  // Süper Lig (Turkey) — chaotic, very early goals
  { leagueId: 6, leagueName: 'Süper Lig', country: 'TR', avgGoalMinute: 16.4, medianGoalMinute: 15.0, goalTimeStdDev: 11.8, earlyGoalRate: 0.29, lateGoalRate: 0.19, halftimeGoalRate: 0.17, matchCount: 0, lastUpdated: 0 },
  // Primeira Liga (Portugal) — attacking
  { leagueId: 7, leagueName: 'Primeira Liga', country: 'PT', avgGoalMinute: 17.8, medianGoalMinute: 16.5, goalTimeStdDev: 13.2, earlyGoalRate: 0.26, lateGoalRate: 0.21, halftimeGoalRate: 0.14, matchCount: 0, lastUpdated: 0 },
  // Championship
  { leagueId: 11, leagueName: 'Championship', country: 'GB', avgGoalMinute: 19.2, medianGoalMinute: 18.0, goalTimeStdDev: 14.0, earlyGoalRate: 0.22, lateGoalRate: 0.24, halftimeGoalRate: 0.13, matchCount: 0, lastUpdated: 0 },
  // Champions League — tactical, late
  { leagueId: 100, leagueName: 'Champions League', country: 'EU', avgGoalMinute: 23.5, medianGoalMinute: 22.0, goalTimeStdDev: 15.5, earlyGoalRate: 0.16, lateGoalRate: 0.26, halftimeGoalRate: 0.12, matchCount: 0, lastUpdated: 0 },
  // Europa League
  { leagueId: 101, leagueName: 'Europa League', country: 'EU', avgGoalMinute: 21.0, medianGoalMinute: 20.0, goalTimeStdDev: 14.8, earlyGoalRate: 0.20, lateGoalRate: 0.24, halftimeGoalRate: 0.13, matchCount: 0, lastUpdated: 0 },
];

const GLOBAL_DEFAULT: LeagueGoalProfile = {
  leagueId: 0, leagueName: 'Global Average', country: '*',
  avgGoalMinute: 20.0, medianGoalMinute: 18.5, goalTimeStdDev: 14.5,
  earlyGoalRate: 0.22, lateGoalRate: 0.23, halftimeGoalRate: 0.13,
  matchCount: 0, lastUpdated: 0,
};

// ════════════════════════════════════════════════════════════════
// DEFAULT CALIBRATION MODE
// ════════════════════════════════════════════════════════════════

const DEFAULT_MODE: CalibrationMode = {
  mode: 'auto',
  manualAvgGoalMinute: null,
  sensitivity: 0.7,
  oddsCompoundEnabled: true,
  minSampleSize: 20,
};

// ════════════════════════════════════════════════════════════════
// PERSISTENCE — PostgreSQL only (LeagueProfile + SystemConfig)
// ════════════════════════════════════════════════════════════════

const MODE_SYSTEM_KEY = 'smartCalibration.mode';
const MODE_CACHE_TTL_MS = 5 * 60 * 1000;

let modeCache: { value: CalibrationMode; at: number } | null = null;

function toProfile(row: {
  leagueId: number;
  leagueName: string;
  country: string;
  avgGoalMinute: number;
  medianGoalMinute: number;
  goalTimeStdDev: number;
  earlyGoalRate: number;
  lateGoalRate: number;
  halftimeGoalRate: number;
  matchCount: number;
  lastUpdatedAt: Date;
}): LeagueGoalProfile {
  return {
    leagueId: row.leagueId,
    leagueName: row.leagueName,
    country: row.country,
    avgGoalMinute: row.avgGoalMinute,
    medianGoalMinute: row.medianGoalMinute,
    goalTimeStdDev: row.goalTimeStdDev,
    earlyGoalRate: row.earlyGoalRate,
    lateGoalRate: row.lateGoalRate,
    halftimeGoalRate: row.halftimeGoalRate,
    matchCount: row.matchCount,
    lastUpdated: row.lastUpdatedAt.getTime(),
  };
}

async function loadLeagueProfiles(): Promise<Map<number, LeagueGoalProfile>> {
  const map = new Map<number, LeagueGoalProfile>();
  // Hardcoded defaults first — DB'de olmayan ligler için fallback.
  for (const p of LEAGUE_DEFAULTS) {
    map.set(p.leagueId, p);
  }
  try {
    const rows = await db.leagueProfile.findMany();
    for (const r of rows) map.set(r.leagueId, toProfile(r));
  } catch (e) {
    logError('smartCalibration', e);
  }
  return map;
}

/**
 * Sync default-only map. DB yüklemeleri yapmadan yalnızca LEAGUE_DEFAULTS
 * döner. calculateGoalProbability gibi sync hot-path'ler için kullanılır —
 * DB öğrenmesi async katmanda (calibrateF8 async / admin endpoints) olur.
 */
function loadLeagueProfilesSyncDefaults(): Map<number, LeagueGoalProfile> {
  const map = new Map<number, LeagueGoalProfile>();
  for (const p of LEAGUE_DEFAULTS) {
    map.set(p.leagueId, p);
  }
  return map;
}

async function saveLeagueProfile(profile: LeagueGoalProfile): Promise<void> {
  try {
    await db.leagueProfile.upsert({
      where: { leagueId: profile.leagueId },
      create: {
        leagueId: profile.leagueId,
        leagueName: profile.leagueName,
        country: profile.country,
        avgGoalMinute: profile.avgGoalMinute,
        medianGoalMinute: profile.medianGoalMinute,
        goalTimeStdDev: profile.goalTimeStdDev,
        earlyGoalRate: profile.earlyGoalRate,
        lateGoalRate: profile.lateGoalRate,
        halftimeGoalRate: profile.halftimeGoalRate,
        matchCount: profile.matchCount,
      },
      update: {
        leagueName: profile.leagueName,
        country: profile.country,
        avgGoalMinute: profile.avgGoalMinute,
        medianGoalMinute: profile.medianGoalMinute,
        goalTimeStdDev: profile.goalTimeStdDev,
        earlyGoalRate: profile.earlyGoalRate,
        lateGoalRate: profile.lateGoalRate,
        halftimeGoalRate: profile.halftimeGoalRate,
        matchCount: profile.matchCount,
      },
    });
  } catch (e) {
    logError('smartCalibration', e);
  }
}

export function loadCalibrationModeSync(): CalibrationMode {
  // In-memory cache'ten sync okuma. İlk hydrate'ı loadCalibrationMode()
  // (async) yapar; senkron hot-path'ler (calculateGoalProbability) buradan
  // beslenir.
  return modeCache?.value ?? { ...DEFAULT_MODE };
}

export async function loadCalibrationMode(): Promise<CalibrationMode> {
  const now = Date.now();
  if (modeCache && now - modeCache.at < MODE_CACHE_TTL_MS) {
    return modeCache.value;
  }
  try {
    const row = await db.systemConfig.findUnique({ where: { key: MODE_SYSTEM_KEY } });
    if (row && row.value && typeof row.value === 'object') {
      const parsed = row.value as Partial<CalibrationMode>;
      const value: CalibrationMode = {
        ...DEFAULT_MODE,
        ...parsed,
      };
      modeCache = { value, at: now };
      return value;
    }
  } catch (e) {
    logError('smartCalibration', e);
  }
  const def = { ...DEFAULT_MODE };
  modeCache = { value: def, at: now };
  return def;
}

export async function saveCalibrationMode(mode: CalibrationMode): Promise<void> {
  try {
    await db.systemConfig.upsert({
      where: { key: MODE_SYSTEM_KEY },
      create: {
        key: MODE_SYSTEM_KEY,
        value: mode as unknown as object,
        updatedBy: 'smartCalibration',
      },
      update: {
        value: mode as unknown as object,
        updatedBy: 'smartCalibration',
      },
    });
    modeCache = null;
  } catch (e) {
    logError('smartCalibration', e);
  }
}

// ════════════════════════════════════════════════════════════════
// CORE: CALIBRATE F8 BASED ON LEAGUE GOAL TIMING
// ════════════════════════════════════════════════════════════════
// The original F8 model:
//   - 0.85 dampener for minutes 1-5 and 46-50 (first 5 min of each half)
//   - 1.15 for minutes 35-45 (1H end surge)
//   - 1.10→1.20 for minutes 60-85 (gradual increase)
//   - 1.30 for minutes 86+ (peak danger zone)
//
// Smart calibration adjusts these based on avgGoalMinute:
//   - If avgGoalMinute < 18 (early goal league like Süper Lig 16.4):
//     → Reduce dampener (0.85 → 0.92): early goals mean early pressure is real
//     → Move danger zone earlier (86 → 83): goals come sooner
//     → Start halftime surge earlier (35 → 32)
//   - If avgGoalMinute > 23 (late goal league like Serie A 24.8):
//     → Increase dampener (0.85 → 0.78): early pressure is noise
//     → Move danger zone later (86 → 88): goals come later
//     → Increase late boost (1.30 → 1.38)
//   - Sensitivity parameter controls how aggressively we adjust

/**
 * Sync version of calibrateF8 — uses in-memory mode cache + hardcoded
 * league defaults. DB-yüklemeli async yol (loadLeagueProfiles / DB-backed
 * calibrateF8) route/admin pipeline'da çağrılır. Bu sync overload
 * calculateGoalProbability gibi hot-path'ler için korunur.
 */
export function calibrateF8Sync(
  leagueId: number | null,
  mode: CalibrationMode,
): F8CalibrationResult {
  if (mode.mode === 'off') {
    return {
      originalDampener: 0.85,
      calibratedDampener: 0.85,
      originalDangerBoost: 1.30,
      calibratedDangerBoost: 1.30,
      dangerZoneShift: 0,
      dampenerZoneShift: 0,
      halftimeSurgeShift: 0,
      source: 'default',
      leagueProfile: null,
      explanation: 'Akıllı kalibrasyon kapalı — varsayılan F8 değerleri kullanılıyor',
    };
  }

  let profile: LeagueGoalProfile | null = null;
  let source: 'auto' | 'manual' | 'default' = 'default';

  if (mode.mode === 'manual' && mode.manualAvgGoalMinute != null) {
    const userAvg = mode.manualAvgGoalMinute;
    profile = {
      leagueId: 0, leagueName: 'Kullanıcı Tanımlı', country: '*',
      avgGoalMinute: userAvg,
      medianGoalMinute: userAvg - 1.5,
      goalTimeStdDev: 14.0,
      earlyGoalRate: userAvg < 18 ? 0.30 : userAvg < 22 ? 0.22 : 0.15,
      lateGoalRate: userAvg > 23 ? 0.28 : userAvg > 20 ? 0.23 : 0.18,
      halftimeGoalRate: userAvg < 18 ? 0.17 : 0.13,
      matchCount: 0,
      lastUpdated: Date.now(),
    };
    source = 'manual';
  } else if (mode.mode === 'auto') {
    const profiles = loadLeagueProfilesSyncDefaults();
    if (leagueId && profiles.has(leagueId)) {
      profile = profiles.get(leagueId)!;
      source = 'auto';
    } else {
      profile = GLOBAL_DEFAULT;
      source = 'auto';
    }
  }

  if (!profile) {
    profile = GLOBAL_DEFAULT;
    source = 'default';
  }

  return computeF8Calibration(profile, mode, source);
}

function computeF8Calibration(
  profile: LeagueGoalProfile,
  currentMode: CalibrationMode,
  source: 'auto' | 'manual' | 'default',
): F8CalibrationResult {
  const REFERENCE_AVG = 20.0;
  const deviation = profile.avgGoalMinute - REFERENCE_AVG;
  const sensitivity = currentMode.sensitivity;

  const originalDampener = 0.85;
  const dampenerAdjustment = -deviation * 0.008 * sensitivity;
  const calibratedDampener = Math.max(0.70, Math.min(0.95, originalDampener + dampenerAdjustment));

  const originalDangerBoost = 1.30;
  const dangerBoostAdjustment = -deviation * 0.01 * sensitivity;
  const calibratedDangerBoost = Math.max(1.15, Math.min(1.45, originalDangerBoost + dangerBoostAdjustment));

  const dangerZoneShift = Math.max(-5, Math.min(5, Math.round(deviation * 0.5 * sensitivity)));
  const dampenerZoneShift = Math.max(-3, Math.min(3, Math.round(deviation * 0.3 * sensitivity)));
  const halftimeSurgeShift = Math.max(-4, Math.min(4, Math.round(deviation * 0.4 * sensitivity)));

  let explanation = '';
  const leagueLabel = profile.leagueName !== 'Global Average' ? profile.leagueName : 'Genel';
  if (Math.abs(deviation) <= 1) {
    explanation = `${leagueLabel}: Ortalama gol ${profile.avgGoalMinute.toFixed(1)} dk — ligin hedef zamanlaması ortalamaya yakın, minimal kalibrasyon`;
  } else if (deviation < 0) {
    explanation = `${leagueLabel}: Ortalama gol ${profile.avgGoalMinute.toFixed(1)} dk (erken!) — ` +
      `dampener azaltıldı (${calibratedDampener.toFixed(2)}), ` +
      `tehlike bölgesi ${dangerZoneShift < 0 ? Math.abs(dangerZoneShift) + ' dk erken' : 'aynı'}, ` +
      `devre arası yükselmesi ${halftimeSurgeShift < 0 ? Math.abs(halftimeSurgeShift) + ' dk erken' : 'aynı'}`;
  } else {
    explanation = `${leagueLabel}: Ortalama gol ${profile.avgGoalMinute.toFixed(1)} dk (geç) — ` +
      `dampener artırıldı (${calibratedDampener.toFixed(2)}), ` +
      `tehlike bölgesi ${dangerZoneShift > 0 ? dangerZoneShift + ' dk geç' : 'aynı'}, ` +
      `geç yükselme güçlendirildi (${calibratedDangerBoost.toFixed(2)})`;
  }

  return {
    originalDampener,
    calibratedDampener,
    originalDangerBoost,
    calibratedDangerBoost,
    dangerZoneShift,
    dampenerZoneShift,
    halftimeSurgeShift,
    source,
    leagueProfile: profile,
    explanation,
  };
}

export async function calibrateF8(
  leagueId: number | null,
  mode?: CalibrationMode,
): Promise<F8CalibrationResult> {
  const currentMode = mode ?? await loadCalibrationMode();

  // If calibration is OFF, return defaults
  if (currentMode.mode === 'off') {
    return {
      originalDampener: 0.85,
      calibratedDampener: 0.85,
      originalDangerBoost: 1.30,
      calibratedDangerBoost: 1.30,
      dangerZoneShift: 0,
      dampenerZoneShift: 0,
      halftimeSurgeShift: 0,
      source: 'default',
      leagueProfile: null,
      explanation: 'Akıllı kalibrasyon kapalı — varsayılan F8 değerleri kullanılıyor',
    };
  }

  // Determine which avgGoalMinute to use
  let profile: LeagueGoalProfile | null = null;
  let source: 'auto' | 'manual' | 'default' = 'default';

  if (currentMode.mode === 'manual' && currentMode.manualAvgGoalMinute != null) {
    const userAvg = currentMode.manualAvgGoalMinute;
    profile = {
      leagueId: 0, leagueName: 'Kullanıcı Tanımlı', country: '*',
      avgGoalMinute: userAvg,
      medianGoalMinute: userAvg - 1.5,
      goalTimeStdDev: 14.0,
      earlyGoalRate: userAvg < 18 ? 0.30 : userAvg < 22 ? 0.22 : 0.15,
      lateGoalRate: userAvg > 23 ? 0.28 : userAvg > 20 ? 0.23 : 0.18,
      halftimeGoalRate: userAvg < 18 ? 0.17 : 0.13,
      matchCount: 0,
      lastUpdated: Date.now(),
    };
    source = 'manual';
  } else if (currentMode.mode === 'auto') {
    const profiles = await loadLeagueProfiles();
    if (leagueId && profiles.has(leagueId)) {
      profile = profiles.get(leagueId)!;
      source = 'auto';
    } else {
      profile = GLOBAL_DEFAULT;
      source = 'auto';
    }
  }

  if (!profile) {
    profile = GLOBAL_DEFAULT;
    source = 'default';
  }

  return computeF8Calibration(profile, currentMode, source);
}

// ════════════════════════════════════════════════════════════════
// ODDS-F8 COMPOUND CALCULATION
// ════════════════════════════════════════════════════════════════
// When odds drop significantly AND match minute is in a high-danger
// zone, the compound effect should be stronger than either factor alone.
// This models the real-world phenomenon where market movement + timing
// alignment = disproportionately higher goal probability.
//
// Example: Over odds dropped 0.30 (critical) + minute 88 (peak danger)
//   → F8 multiplier 1.30 × odds significance multiplier 1.15 = 1.495
//   → This is NOT just additive (1.30 + 0.15), it's multiplicative

export interface OddsF8Compound {
  /** Compound multiplier for home side */
  homeCompoundMultiplier: number;
  /** Compound multiplier for away side */
  awayCompoundMultiplier: number;
  /** Extra points from compound effect (home) */
  homeCompoundPts: number;
  /** Extra points from compound effect (away) */
  awayCompoundPts: number;
  /** Explanation */
  explanation: string;
}

export function calculateOddsF8Compound(
  f8Result: F8CalibrationResult,
  oddsSignificance: 'none' | 'low' | 'medium' | 'high' | 'critical',
  currentMinute: number,
  homeOddsBoost: number,
  awayOddsBoost: number,
): OddsF8Compound {
  // Base: no compound effect
  let homeCompoundMultiplier = 1.0;
  let awayCompoundMultiplier = 1.0;

  // Only compound if odds movement is significant AND minute context is elevated
  if (oddsSignificance === 'none' || oddsSignificance === 'low') {
    return {
      homeCompoundMultiplier: 1.0,
      awayCompoundMultiplier: 1.0,
      homeCompoundPts: 0,
      awayCompoundPts: 0,
      explanation: 'Oran hareketi düşük — bileşik etki yok',
    };
  }

  // Determine if we're in a danger zone (elevated F8 region)
  const dangerStart = 86 + f8Result.dangerZoneShift;
  const halftimeSurgeStart = 35 + f8Result.halftimeSurgeShift;
  const isDangerZone = currentMinute >= dangerStart;
  const isHalftimeSurge = currentMinute >= halftimeSurgeStart && currentMinute <= 45;
  const isSecondHalfSurge = currentMinute >= 60;

  // Compound multiplier: odds significance × minute context
  // Only apply compound when both signals agree
  const oddsMultiplier: Record<string, number> = {
    'none': 1.0,
    'low': 1.0,
    'medium': 1.05,
    'high': 1.10,
    'critical': 1.15,
  };

  const oddsMult = oddsMultiplier[oddsSignificance] ?? 1.0;

  if (isDangerZone) {
    // PEAK COMPOUND: odds movement + late danger zone = strongest signal
    homeCompoundMultiplier = oddsMult * 1.10; // Additional 10% for danger zone alignment
    awayCompoundMultiplier = oddsMult * 1.10;
  } else if (isHalftimeSurge) {
    // HALFTIME COMPOUND: odds movement + halftime surge
    homeCompoundMultiplier = oddsMult * 1.05;
    awayCompoundMultiplier = oddsMult * 1.05;
  } else if (isSecondHalfSurge) {
    // 2ND HALF COMPOUND: moderate compound effect
    homeCompoundMultiplier = oddsMult;
    awayCompoundMultiplier = oddsMult;
  }

  // Apply compound to odds boost points
  const homeCompoundPts = Math.round(homeOddsBoost * (homeCompoundMultiplier - 1));
  const awayCompoundPts = Math.round(awayOddsBoost * (awayCompoundMultiplier - 1));

  let explanation = '';
  if (homeCompoundPts > 0 || awayCompoundPts > 0) {
    const zone = isDangerZone ? 'tehlike bölgesi' : isHalftimeSurge ? 'devre arası yükselmesi' : '2. yarı artış';
    explanation = `Oran+F8 bileşik: ${oddsSignificance} oran hareketi × ${zone} = ` +
      `ev +${homeCompoundPts} / dep +${awayCompoundPts}`;
  } else {
    explanation = 'Oran hareketi + dakika bağlamı bileşik etki yok';
  }

  return {
    homeCompoundMultiplier,
    awayCompoundMultiplier,
    homeCompoundPts,
    awayCompoundPts,
    explanation,
  };
}

// ════════════════════════════════════════════════════════════════
// LEAGUE PROFILE UPDATE FROM MATCH DATA
// ════════════════════════════════════════════════════════════════
// After each match completes, update the league's goal timing profile
// with actual data. This creates a self-improving calibration system.

interface GoalTimingRecord {
  leagueId: number;
  goalMinute: number;
  isHomeGoal: boolean;
  matchDate: string; // YYYY-MM-DD
}

export async function updateLeagueProfile(
  leagueId: number,
  leagueName: string,
  country: string,
  goalMinutes: number[],
): Promise<LeagueGoalProfile | null> {
  if (goalMinutes.length === 0) return null;

  const profiles = await loadLeagueProfiles();
  const existing = profiles.get(leagueId);

  // If we have an existing profile with enough data, blend new data in
  // Otherwise, compute from scratch
  const totalMatchCount = (existing?.matchCount ?? 0) + 1;
  // Faz 7 — EMA ilk-maç koruması: totalMatchCount < MIN_LEAGUE_SAMPLES iken
  // alpha 0.1 ile sınırlı (default profile'ı aşırı ezmeyi önler).
  const baseAlpha = Math.min(0.3, 1 / totalMatchCount);
  const alpha = totalMatchCount < MIN_LEAGUE_SAMPLES
    ? Math.min(baseAlpha, 0.1)
    : baseAlpha;

  const newAvg = goalMinutes.reduce((a, b) => a + b, 0) / goalMinutes.length;
  const newMedian = [...goalMinutes].sort((a, b) => a - b)[Math.floor(goalMinutes.length / 2)];
  const newStdDev = Math.sqrt(goalMinutes.reduce((s, m) => s + Math.pow(m - newAvg, 2), 0) / goalMinutes.length);
  const newEarlyRate = goalMinutes.filter(m => m <= 20).length / goalMinutes.length;
  const newLateRate = goalMinutes.filter(m => m >= 76).length / goalMinutes.length;
  const newHalftimeRate = goalMinutes.filter(m => m >= 35 && m <= 45).length / goalMinutes.length;

  let profile: LeagueGoalProfile;
  if (existing && existing.matchCount >= 10) {
    // Blend with EMA: new_value = old * (1-alpha) + new * alpha
    profile = {
      leagueId,
      leagueName: existing.leagueName || leagueName,
      country: existing.country || country,
      avgGoalMinute: existing.avgGoalMinute * (1 - alpha) + newAvg * alpha,
      medianGoalMinute: existing.medianGoalMinute * (1 - alpha) + newMedian * alpha,
      goalTimeStdDev: existing.goalTimeStdDev * (1 - alpha) + newStdDev * alpha,
      earlyGoalRate: existing.earlyGoalRate * (1 - alpha) + newEarlyRate * alpha,
      lateGoalRate: existing.lateGoalRate * (1 - alpha) + newLateRate * alpha,
      halftimeGoalRate: existing.halftimeGoalRate * (1 - alpha) + newHalftimeRate * alpha,
      matchCount: totalMatchCount,
      lastUpdated: Date.now(),
    };
  } else {
    // Not enough data yet: use new data (or default if very few goals)
    profile = {
      leagueId,
      leagueName,
      country,
      avgGoalMinute: goalMinutes.length >= 3 ? newAvg : (existing?.avgGoalMinute ?? GLOBAL_DEFAULT.avgGoalMinute),
      medianGoalMinute: goalMinutes.length >= 3 ? newMedian : (existing?.medianGoalMinute ?? GLOBAL_DEFAULT.medianGoalMinute),
      goalTimeStdDev: goalMinutes.length >= 3 ? newStdDev : (existing?.goalTimeStdDev ?? GLOBAL_DEFAULT.goalTimeStdDev),
      earlyGoalRate: goalMinutes.length >= 3 ? newEarlyRate : (existing?.earlyGoalRate ?? GLOBAL_DEFAULT.earlyGoalRate),
      lateGoalRate: goalMinutes.length >= 3 ? newLateRate : (existing?.lateGoalRate ?? GLOBAL_DEFAULT.lateGoalRate),
      halftimeGoalRate: goalMinutes.length >= 3 ? newHalftimeRate : (existing?.halftimeGoalRate ?? GLOBAL_DEFAULT.halftimeGoalRate),
      matchCount: totalMatchCount,
      lastUpdated: Date.now(),
    };
  }

  profiles.set(leagueId, profile);
  await saveLeagueProfile(profile);
  return profile;
}

// ════════════════════════════════════════════════════════════════
// GET ALL LEAGUE PROFILES (for UI display)
// ════════════════════════════════════════════════════════════════

export async function getAllLeagueProfiles(): Promise<LeagueGoalProfile[]> {
  const profiles = await loadLeagueProfiles();
  return Array.from(profiles.values()).sort((a, b) => a.avgGoalMinute - b.avgGoalMinute);
}

// ════════════════════════════════════════════════════════════════
// APPLY SMART CALIBRATION TO F8 IN calculateGoalProbability()
// ════════════════════════════════════════════════════════════════
// This function returns the adjusted minuteMultiplier and score
// adjustments that should replace the hardcoded F8 logic.

export interface F8AdjustedResult {
  /** Adjusted minute multiplier (replaces the hardcoded one) */
  minuteMultiplier: number;
  /** Additional score points for home */
  homeScoreAdj: number;
  /** Additional score points for away */
  awayScoreAdj: number;
  /** Factor description for UI */
  factorDescription: string;
  /** Calibration result for debugging/display */
  calibration: F8CalibrationResult;
}

export async function getSmartF8Adjustment(
  minute: number,
  leagueId: number | null,
  mode?: CalibrationMode,
): Promise<F8AdjustedResult> {
  const cal = await calibrateF8(leagueId, mode);
  const minNum = minute;
  let minuteMultiplier = 1.0;
  let homeScoreAdj = 0;
  let awayScoreAdj = 0;
  let factorDescription = '';

  // Apply calibrated dampener zone (first N min of each half)
  const dampenerEnd1H = 5 + cal.dampenerZoneShift; // default 5, can be 2-8
  const dampenerStart2H = 46;
  const dampenerEnd2H = 50 + cal.dampenerZoneShift;

  if ((minNum >= 1 && minNum <= dampenerEnd1H) || (minNum >= dampenerStart2H && minNum <= dampenerEnd2H)) {
    minuteMultiplier = cal.calibratedDampener;
    // 2H start wave (Klemp: RPS 0.16 for 46-50dk) — keep this regardless
    if (minNum >= 46 && minNum <= 50) {
      homeScoreAdj += 1;
      awayScoreAdj += 1;
      factorDescription = `2Y başlangıç dalgası (kalibre dampener: ${cal.calibratedDampener.toFixed(2)})`;
    } else {
      factorDescription = `Erken dakika dampener: ${cal.calibratedDampener.toFixed(2)} (orijinal: ${cal.originalDampener.toFixed(2)})`;
    }
  }
  // Halftime surge
  else if (minNum >= (35 + cal.halftimeSurgeShift) && minNum <= 45) {
    minuteMultiplier = 1.15;
    homeScoreAdj += 3;
    awayScoreAdj += 3;
    factorDescription = `1Y sonu gol dakikası (başlangıç: ${35 + cal.halftimeSurgeShift}')`;
  }
  // Mid-2H gradual increase
  else if (minNum >= 60 && minNum < (86 + cal.dangerZoneShift)) {
    minuteMultiplier = 1.10 + (minNum - 60) * 0.004;
    const pts = Math.min(3, Math.round((minNum - 59) * 0.15));
    homeScoreAdj += pts;
    awayScoreAdj += pts;
  }
  // Peak danger zone (calibrated start)
  else if (minNum >= (86 + cal.dangerZoneShift)) {
    minuteMultiplier = cal.calibratedDangerBoost;
    const pts = Math.min(5, Math.round((minNum - 84) * 0.35));
    homeScoreAdj += pts;
    awayScoreAdj += pts;
    factorDescription = `Maç sonu gol dakikası (boost: ${cal.calibratedDangerBoost.toFixed(2)}, başlangıç: ${86 + cal.dangerZoneShift}')`;
  }
  // Standard mid-match
  else {
    minuteMultiplier = 1.0;
  }

  return {
    minuteMultiplier,
    homeScoreAdj,
    awayScoreAdj,
    factorDescription,
	    calibration: cal,
	  };
	}
	
	// ════════════════════════════════════════════════════════════════
	// LEAGUE-AWARE xG COEFFICIENTS
	// ════════════════════════════════════════════════════════════════
	// Farklı liglerde şut kalitesi ve bitirme yüzdesi farklıdır.
	// Erken gol ligleri (Eredivisie): daha yüksek SOT→xG dönüşümü
	// Geç gol ligleri (Serie A): daha düşük SOT→xG dönüşümü
	
	export interface XgLeagueCoefficients {
	  onTarget: number;
	  offTarget: number;
	  blocked: number;
	  cornerFirstHalf: number;
	  cornerSecondHalf: number;
	}
	
	const XG_COEFF_DEFAULTS: XgLeagueCoefficients = {
	  onTarget: 0.085,
	  offTarget: 0.030,
	  blocked: 0.025,
	  cornerFirstHalf: 0.14,
	  cornerSecondHalf: 0.20,
	};
	
	export function getXgCoefficients(leagueId: number | null): XgLeagueCoefficients {
	  const profiles = loadLeagueProfilesSyncDefaults();
	  const profile = leagueId && profiles.has(leagueId) ? profiles.get(leagueId)! : null;
	  if (!profile) return { ...XG_COEFF_DEFAULTS };
	
	  const avgMin = profile.avgGoalMinute;
	  const deviationFromAvg = (20.0 - avgMin) / 5;
	  const adjustment = deviationFromAvg * 0.01;
	
	  return {
	    onTarget: Math.max(0.065, Math.min(0.105, XG_COEFF_DEFAULTS.onTarget + adjustment)),
	    offTarget: Math.max(0.020, Math.min(0.040, XG_COEFF_DEFAULTS.offTarget + adjustment * 0.3)),
	    blocked: Math.max(0.015, Math.min(0.035, XG_COEFF_DEFAULTS.blocked + adjustment * 0.2)),
	    cornerFirstHalf: XG_COEFF_DEFAULTS.cornerFirstHalf,
	    cornerSecondHalf: XG_COEFF_DEFAULTS.cornerSecondHalf,
	  };
	}
