// ── FotMob Match Intelligence Module ───────────────────────────────
// Enriches goal probability predictions with FotMob data:
//   - Weather conditions → goal probability adjustment
//   - Squad/lineup quality → team strength adjustment
//   - Form data → momentum prior
//   - H2H history → baseline goal expectation
//   - Missing players → xG reduction
//   - Red cards → numerical advantage
//
// This module acts as a bridge between FotMob raw data and the
// ensemble prediction system.

import type { FotMobMatchDetails, FotMobWeather, FotMobFormEntry, FotMobH2HMatch, FotMobLineupPlayer } from './fotmob';
import { calculateWeatherImpact, calculateSquadImpact, calculateH2HImpact } from './ensemble';

// ── Types ──────────────────────────────────────────────────────────

export interface MatchIntelligence {
  // Weather
  weather: {
    temperature: number;
    windSpeed: number;
    precipitation: number;
    description: string;
  } | null;
  weatherImpact: {
    multiplier: number;
    factors: string[];
  };

  // Squad
  squad: {
    homeFormation: string | null;
    awayFormation: string | null;
    homeAvgRating: number | null;
    awayAvgRating: number | null;
    homeMissingPlayers: number;
    awayMissingPlayers: number;
    homeKeyPlayersMissing: string[];
    awayKeyPlayersMissing: string[];
  } | null;
  squadImpact: {
    homeAdj: number;
    awayAdj: number;
    factors: string[];
  };

  // Form
  form: {
    home: FormSummary;
    away: FormSummary;
  } | null;

  // H2H
  h2h: {
    homeWins: number;
    draws: number;
    awayWins: number;
    avgGoals: number;
    recentMatches: number;
  } | null;
  h2hImpact: {
    goalPAdjust: number;
    factors: string[];
  };

  // Combined adjustment
  totalGoalPAdjust: number;   // Net adjustment to goal probability (-0.3 to +0.3)
  allFactors: string[];       // All active factors
}

export interface FormSummary {
  last5: ('W' | 'D' | 'L')[];
  goalsForAvg: number;       // Average goals scored per match
  goalsAgainstAvg: number;   // Average goals conceded per match
  pointsPerGame: number;     // 3*W + 1*D / total
  cleanSheets: number;       // Out of last 5
  winStreak: number;         // Current consecutive wins
  loseStreak: number;        // Current consecutive losses
}

// ── Main Intelligence Extraction ───────────────────────────────────

export function extractMatchIntelligence(
  fotmobData: FotMobMatchDetails | null
): MatchIntelligence {
  if (!fotmobData) {
    return emptyIntelligence();
  }

  // ── Weather ──
  const weatherData = fotmobData.weather ? {
    temperature: fotmobData.weather.temperature ?? 20,
    windSpeed: fotmobData.weather.windSpeed ?? 0,
    precipitation: fotmobData.weather.precipitation ?? 0,
    description: fotmobData.weather.description ?? '',
  } : null;
  const weatherImpact = calculateWeatherImpact(weatherData);

  // ── Squad / Lineup ──
  let squadData: MatchIntelligence['squad'] = null;
  let squadImpact = { homeAdj: 0, awayAdj: 0, factors: [] as string[] };

  if (fotmobData.homeTeam || fotmobData.awayTeam) {
    const homeRating = calculateAvgRating(fotmobData.homeTeam?.starters ?? []);
    const awayRating = calculateAvgRating(fotmobData.awayTeam?.starters ?? []);

    // Estimate missing players from substitutes count vs typical squad size
    const homeMissingPlayers = estimateMissingPlayers(
      fotmobData.homeTeam?.starters ?? [],
      fotmobData.homeTeam?.substitutes ?? [],
    );
    const awayMissingPlayers = estimateMissingPlayers(
      fotmobData.awayTeam?.starters ?? [],
      fotmobData.awayTeam?.substitutes ?? [],
    );

    squadData = {
      homeFormation: fotmobData.homeTeam?.formation ?? null,
      awayFormation: fotmobData.awayTeam?.formation ?? null,
      homeAvgRating: homeRating,
      awayAvgRating: awayRating,
      homeMissingPlayers,
      awayMissingPlayers,
      homeKeyPlayersMissing: [], // Would need injury data
      awayKeyPlayersMissing: [],
    };

    squadImpact = calculateSquadImpact({
      homeMissingPlayers,
      awayMissingPlayers,
      homeRating: homeRating ?? undefined,
      awayRating: awayRating ?? undefined,
    });
  }

  // ── Form ──
  let formData: MatchIntelligence['form'] = null;
  if (fotmobData.homeForm?.length > 0 || fotmobData.awayForm?.length > 0) {
    formData = {
      home: summarizeForm(fotmobData.homeForm ?? []),
      away: summarizeForm(fotmobData.awayForm ?? []),
    };
  }

  // ── H2H ──
  let h2hData: MatchIntelligence['h2h'] = null;
  let h2hImpact = { goalPAdjust: 0, factors: [] as string[] };

  if (fotmobData.h2h && fotmobData.h2h.matches.length >= 3) {
    const summary = fotmobData.h2h.summary; // [homeWins, draws, awayWins]
    const matches = fotmobData.h2h.matches;
    const totalGoals = matches.reduce((sum, m) => {
      return sum + (m.home.score ?? 0) + (m.away.score ?? 0);
    }, 0);

    h2hData = {
      homeWins: summary[0] ?? 0,
      draws: summary[1] ?? 0,
      awayWins: summary[2] ?? 0,
      avgGoals: matches.length > 0 ? totalGoals / matches.length : 0,
      recentMatches: matches.length,
    };

    h2hImpact = calculateH2HImpact(h2hData);
  }

  // ── Combine all adjustments ──
  const allFactors: string[] = [
    ...weatherImpact.factors,
    ...squadImpact.factors,
    ...h2hImpact.factors,
  ];

  const totalGoalPAdjust = (weatherImpact.multiplier - 1.0) +
    squadImpact.homeAdj + squadImpact.awayAdj +
    h2hImpact.goalPAdjust;

  return {
    weather: weatherData,
    weatherImpact,
    squad: squadData,
    squadImpact,
    form: formData,
    h2h: h2hData,
    h2hImpact,
    totalGoalPAdjust: Math.max(-0.3, Math.min(0.3, totalGoalPAdjust)),
    allFactors,
  };
}

// ── Helper Functions ───────────────────────────────────────────────

function emptyIntelligence(): MatchIntelligence {
  return {
    weather: null,
    weatherImpact: { multiplier: 1.0, factors: [] },
    squad: null,
    squadImpact: { homeAdj: 0, awayAdj: 0, factors: [] },
    form: null,
    h2h: null,
    h2hImpact: { goalPAdjust: 0, factors: [] },
    totalGoalPAdjust: 0,
    allFactors: [],
  };
}

function calculateAvgRating(players: FotMobLineupPlayer[]): number | null {
  if (!players || players.length === 0) return null;
  const ratedPlayers = players.filter(p => p.rating != null && p.rating > 0);
  if (ratedPlayers.length === 0) return null;
  return ratedPlayers.reduce((sum, p) => sum + p.rating!, 0) / ratedPlayers.length;
}

function estimateMissingPlayers(
  starters: FotMobLineupPlayer[],
  substitutes: FotMobLineupPlayer[],
): number {
  // A full starting XI has 11 players. If fewer, some are missing.
  // Also, fewer than 5 substitutes might indicate limited squad.
  const missingStarters = Math.max(0, 11 - starters.length);
  // Limited bench (fewer than 7 subs) might indicate injuries
  const limitedBench = substitutes.length < 5 ? 1 : 0;
  return missingStarters + limitedBench;
}

function summarizeForm(formEntries: FotMobFormEntry[]): FormSummary {
  if (formEntries.length === 0) {
    return {
      last5: [],
      goalsForAvg: 0,
      goalsAgainstAvg: 0,
      pointsPerGame: 0,
      cleanSheets: 0,
      winStreak: 0,
      loseStreak: 0,
    };
  }

  const last5 = formEntries.slice(0, 5).map(e => e.result);
  const totalMatches = formEntries.length;

  const goalsForAvg = formEntries.reduce((s, e) => s + e.goalsFor, 0) / totalMatches;
  const goalsAgainstAvg = formEntries.reduce((s, e) => s + e.goalsAgainst, 0) / totalMatches;

  const wins = formEntries.filter(e => e.result === 'W').length;
  const draws = formEntries.filter(e => e.result === 'D').length;
  const pointsPerGame = (wins * 3 + draws * 1) / totalMatches;

  const cleanSheets = formEntries.filter(e => e.goalsAgainst === 0).length;

  // Calculate streaks
  let winStreak = 0;
  for (const e of formEntries) {
    if (e.result === 'W') winStreak++;
    else break;
  }
  let loseStreak = 0;
  for (const e of formEntries) {
    if (e.result === 'L') loseStreak++;
    else break;
  }

  return {
    last5,
    goalsForAvg: Math.round(goalsForAvg * 100) / 100,
    goalsAgainstAvg: Math.round(goalsAgainstAvg * 100) / 100,
    pointsPerGame: Math.round(pointsPerGame * 100) / 100,
    cleanSheets,
    winStreak,
    loseStreak,
  };
}

// ── Form-to-Elo Integration ────────────────────────────────────────
// Combines FotMob form data with our Elo ratings for a richer
// team strength signal.

function combinedFormIndex(
  eloFormIndex: number,     // From getFormIndex() in eloRating.ts (0-1)
  fotmobForm: FormSummary | null,
): number {
  if (!fotmobForm || fotmobForm.last5.length === 0) {
    return eloFormIndex; // Fall back to Elo form
  }

  // FotMob form score: weighted combination
  const ppgScore = fotmobForm.pointsPerGame / 3;  // Normalize to 0-1
  const goalScore = Math.min(1, fotmobForm.goalsForAvg / 2.5); // Normalize: 2.5 goals/game = 1.0
  const streakBonus = fotmobForm.winStreak >= 3 ? 0.1 : fotmobForm.loseStreak >= 3 ? -0.1 : 0;

  const fotmobFormScore = Math.max(0, Math.min(1,
    ppgScore * 0.5 + goalScore * 0.3 + (fotmobForm.cleanSheets / 5) * 0.1 + streakBonus + 0.1
  ));

  // Blend: 60% Elo, 40% FotMob form (Elo is more robust long-term)
  return eloFormIndex * 0.6 + fotmobFormScore * 0.4;
}

// ── Formation Impact ───────────────────────────────────────────────
// Certain formations are more attacking/defensive
// This affects baseline goal expectation

function formationGoalMultiplier(formation: string | null): {
  attackMult: number;
  defenseMult: number;
  description: string;
} {
  if (!formation) return { attackMult: 1.0, defenseMult: 1.0, description: '' };

  const f = formation.replace(/\s/g, '');

  // Attacking formations
  if (f === '4-3-3' || f === '3-4-3') {
    return { attackMult: 1.08, defenseMult: 0.95, description: 'Hücum formasyonu' };
  }
  if (f === '4-2-3-1') {
    return { attackMult: 1.04, defenseMult: 0.98, description: 'Dengeli hücum' };
  }
  if (f === '4-4-2') {
    return { attackMult: 1.02, defenseMult: 1.0, description: 'Klasik dengeli' };
  }

  // Defensive formations
  if (f === '5-3-2' || f === '5-4-1') {
    return { attackMult: 0.90, defenseMult: 1.08, description: 'Savunma formasyonu' };
  }
  if (f === '4-5-1') {
    return { attackMult: 0.93, defenseMult: 1.05, description: 'Defansif orta saha' };
  }

  // Default
  return { attackMult: 1.0, defenseMult: 1.0, description: '' };
}
