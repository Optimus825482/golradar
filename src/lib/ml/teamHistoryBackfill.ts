// ── Team History Backfill + Kalman Fit ────────────────────────────
// Pulls historical finished matches from Scoremer (or other
// fetchers) and persists them to `TeamHistoryMatch`. Then fits
// the Kalman model and registers the result as a
// `ModelArtifact(name='team-strength')`.
//
// On-demand from the admin endpoint and nightly at 04:00 local
// via `trainingScheduler.ts` (auto-fit step after the daily export).

import { db } from '../db';
import {
  fitBatch,
  serializeTeamStrength,
  type ScoredMatch,
  type TeamStrengthModel,
  type KalmanConfig,
} from './teamStrengthKalman';
import { registerArtifact, loadTeamStrengthChampion } from './modelRouter';
import { getScoremerMatchesForDateRange, filterScoremerMatchesByStatus } from '../scoremer';
import { fetchFotMobMatches, fetchMatchDetails } from '../fotmob';
// sofascore.ts is server-only (uses child_process). Dynamic
// import inside backfillFromSofascore prevents Turbopack from
// tracing it into the client bundle via the admin page chain.
import { predictMatch } from './teamStrengthKalman';
// goaloo.ts is server-only (uses child_process / node:fs). Dynamic
// import here prevents Turbopack from tracing it into the client
// bundle via the teamHistoryBackfill -> ensemble -> page chain.

export interface BackfillResult {
  matchesScraped: number;
  matchesInserted: number;
  matchesSkippedDuplicate: number;
  teamsInModel: number;
  modelVersion: string;
  artifactPath: string;
  nMatchesFitted: number;
}

/**
 * Normalize a team name for storage and matching. Lowercase,
 * trim, collapse whitespace. Aggressive enough to dedupe
 * "FC Barcelona" / "barcelona" / "F. C. Barcelona" but
 * conservative enough to keep "Bayern München" distinct from
 * "Bayern Munich II" — those will be distinct Map keys.
 */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[ \s]+/g, ' ')
    .replace(/[^a-z0-9 çğıöşüâêîôûàèìòùáéíóúñäëïöüÿßœæÇĞIÖŞÜÂÊÎÔÛÀÈÌÒÙÁÉÍÓÚÑÄËÏÖÜŸ]+/g, '')
    .trim();
}

interface ScoremerMatchLite {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  time: string;
  league: string;
}

/**
 * Pull finished matches in a date range and upsert into
 * TeamHistoryMatch. Source: Scoremer.
 */
export type BackfillSource = 'scoremer' | 'goaloo' | 'fotmob' | 'sofascore';

export async function backfillTeamHistory(
  startDate: Date,
  endDate: Date,
  source: BackfillSource = 'goaloo',
): Promise<{
  scraped: number;
  inserted: number;
  skippedDuplicate: number;
}> {
  switch (source) {
    case 'goaloo':
      return backfillFromGoaloo(startDate, endDate);
    case 'scoremer':
      return backfillFromScoremer(startDate, endDate);
    case 'fotmob':
      return backfillFromFotmob(startDate, endDate);
    case 'sofascore':
      return backfillFromSofascore(startDate, endDate);
  }
}

async function backfillFromScoremer(
  startDate: Date,
  endDate: Date,
): Promise<{ scraped: number; inserted: number; skippedDuplicate: number }> {
  const raw = await getScoremerMatchesForDateRange(startDate, endDate);
  const finished = filterScoremerMatchesByStatus(raw, 'finished');
  let scraped = 0;
  let inserted = 0;
  let skippedDuplicate = 0;

  for (const m of finished as ScoremerMatchLite[]) {
    scraped += 1;
    const home = normalize(m.homeTeam);
    const away = normalize(m.awayTeam);
    if (!home || !away) continue;
    if (m.homeScore == null || m.awayScore == null) continue;
    if (Number.isNaN(m.homeScore) || Number.isNaN(m.awayScore)) continue;

    const dateStr = parseScoremerTimeToDate(m.time, startDate, endDate);
    if (!dateStr) continue;

    try {
      const result = await db.teamHistoryMatch.upsert({
        where: {
          matchDate_homeTeam_awayTeam: {
            matchDate: dateStr,
            homeTeam: home,
            awayTeam: away,
          },
        },
        create: {
          matchDate: dateStr,
          homeTeam: home,
          awayTeam: away,
          homeGoals: m.homeScore,
          awayGoals: m.awayScore,
          league: m.league || null,
          source: 'scoremer',
        },
        update: {
          homeGoals: m.homeScore,
          awayGoals: m.awayScore,
          league: m.league || null,
          fetchedAt: new Date(),
        },
      });
      if (Date.now() - result.fetchedAt.getTime() < 2_000) inserted += 1;
      else skippedDuplicate += 1;
    } catch {
      skippedDuplicate += 1;
    }
  }
  return { scraped, inserted, skippedDuplicate };
}

// Top leagues covered by Goaloo season JSON endpoint.
// League IDs are Goaloo's internal ball_id. Each adds ~3-5s per
// season call — keep the list small. IDs verified by inspecting
// the B[] array of a SoccerAjax type=6 response; adjust if Goaloo
// renumbers.
const GOALOO_BACKFILL_LEAGUES = [
  { id: 1, name: 'Premier League' },
  { id: 2, name: 'La Liga' },
  { id: 3, name: 'Bundesliga' },
  { id: 4, name: 'Serie A' },
  { id: 5, name: 'Ligue 1' },
  { id: 75, name: 'Süper Lig' },
  { id: 7, name: 'Champions League' },
  { id: 8, name: 'Europa League' },
];

function getSeasonsForRange(start: Date, end: Date): string[] {
  // Typical football season: Aug–May. Season 2025-2026 covers Aug 2025 → Jun 2026.
  const seasons = new Set<string>();
  for (let y = start.getFullYear() - 1; y <= end.getFullYear(); y++) {
    seasons.add(`${y}-${y + 1}`);
  }
  return [...seasons].sort();
}

async function backfillFromGoaloo(
  startDate: Date,
  endDate: Date,
): Promise<{ scraped: number; inserted: number; skippedDuplicate: number }> {
  // Dynamic import — goaloo.ts uses child_process and is server-only.
  // Use fetchGoalooSeasonMatches (entire-season JSON) instead of
  // fetchGoalooMatchesByDate (SoccerAjax type=6) which is limited to
  // 7-day results history and returns 0 matches for older dates.
  const { fetchGoalooSeasonMatches } = await import('../goaloo');
  let scraped = 0;
  let inserted = 0;
  let skippedDuplicate = 0;

  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);
  const seasons = getSeasonsForRange(startDate, endDate);

  for (const league of GOALOO_BACKFILL_LEAGUES) {
    for (const season of seasons) {
      try {
        const matches = await fetchGoalooSeasonMatches(league.id, season);

        // Client-side date filter — only keep finished matches in range
        const filtered = matches.filter((m: { state: number; date: string; score: string }) => {
          if (m.state !== -1) return false;
          const matchDate = m.date.split(' ')[0];
          return matchDate >= startStr && matchDate <= endStr;
        });

        for (const m of filtered) {
          scraped += 1;
          const home = normalize(m.homeTeam);
          const away = normalize(m.awayTeam);
          if (!home || !away) continue;

          const matchDate = m.date.split(' ')[0];
          const [homeGoals, awayGoals] = m.score.split('-').map(Number);
          if (isNaN(homeGoals) || isNaN(awayGoals)) continue;

          try {
            const result = await db.teamHistoryMatch.upsert({
              where: {
                matchDate_homeTeam_awayTeam: {
                  matchDate,
                  homeTeam: home,
                  awayTeam: away,
                },
              },
              create: {
                matchDate,
                homeTeam: home,
                awayTeam: away,
                homeGoals,
                awayGoals,
                league: league.name,
                source: 'goaloo',
              },
              update: {
                homeGoals,
                awayGoals,
                league: league.name,
                fetchedAt: new Date(),
              },
            });
            if (Date.now() - result.fetchedAt.getTime() < 2_000) inserted += 1;
            else skippedDuplicate += 1;
          } catch {
            skippedDuplicate += 1;
          }
        }
      } catch {
        // Season not available or parse error — skip silently
      }
    }
  }

  return { scraped, inserted, skippedDuplicate };
}

async function backfillFromGoalooLegacy(
  startDate: Date,
  endDate: Date,
): Promise<{ scraped: number; inserted: number; skippedDuplicate: number }> {
  // Legacy: fetchGoalooMatchesByDate (SoccerAjax type=6) — 7-day limit.
  // Kept for backward compatibility; new callers should use backfillFromGoaloo.
  const { fetchGoalooMatchesByDate } = await import('../goaloo');
  let scraped = 0;
  let inserted = 0;
  let skippedDuplicate = 0;
  const MAX_DAYS_BUDGET = 365; // cap to stay within Next.js route timeout
  const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / 86_400_000);
  const daysToFetch = Math.min(totalDays, MAX_DAYS_BUDGET);

  for (let d = 0; d < daysToFetch; d++) {
    const day = new Date(startDate.getTime() + d * 86_400_000);
    const dateStr = day.toISOString().slice(0, 10);

    const matches = await fetchGoalooMatchesByDate(dateStr);
    const finished = matches.filter((m: { state: number; homeScore: number; awayScore: number }) => m.state === -1);

    for (const m of finished) {
      scraped += 1;
      const home = normalize(m.homeTeam);
      const away = normalize(m.awayTeam);
      if (!home || !away) continue;
      if (m.homeScore == null || m.awayScore == null) continue;
      if (m.homeScore < 0 || m.awayScore < 0) continue; // placeholder for live games

      try {
        const result = await db.teamHistoryMatch.upsert({
          where: {
            matchDate_homeTeam_awayTeam: {
              matchDate: dateStr,
              homeTeam: home,
              awayTeam: away,
            },
          },
          create: {
            matchDate: dateStr,
            homeTeam: home,
            awayTeam: away,
            homeGoals: m.homeScore,
            awayGoals: m.awayScore,
            league: m.leagueName || m.leagueShortName || null,
            source: 'goaloo',
          },
          update: {
            homeGoals: m.homeScore,
            awayGoals: m.awayScore,
            league: m.leagueName || m.leagueShortName || null,
            fetchedAt: new Date(),
          },
        });
        if (Date.now() - result.fetchedAt.getTime() < 2_000) inserted += 1;
        else skippedDuplicate += 1;
      } catch {
        skippedDuplicate += 1;
      }
    }

    // Sequential 300ms delay between days to avoid Goaloo anti-bot bans
    if (d < daysToFetch - 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  return { scraped, inserted, skippedDuplicate };
}

/**
 * Pull finished matches from FotMob for the given date range and
 * upsert into TeamHistoryMatch. Same day-by-day shape as
 * `backfillFromGoaloo` but FotMob is a public API — 100ms delay is
 * enough to stay polite. Capped to 365 days to fit Next.js route
 * budget.
 */
/**
 * Sum a match's xG from FotMob shotmap (expectedGoals per shot).
 * Returns null if no shot data is available or the fetch fails.
 */
async function fetchMatchXG(fotmobId: number): Promise<{ homeXG: number; awayXG: number } | null> {
  try {
    const details = await fetchMatchDetails(fotmobId);
    if (!details?.shotmap || details.shotmap.length === 0) return null;
    let homeXG = 0;
    let awayXG = 0;
    for (const shot of details.shotmap) {
      const xg = shot.expectedGoals || 0;
      if (shot.teamId === details.homeTeam?.id) homeXG += xg;
      else if (shot.teamId === details.awayTeam?.id) awayXG += xg;
    }
    return { homeXG, awayXG };
  } catch {
    return null;
  }
}

async function backfillFromFotmob(
  startDate: Date,
  endDate: Date,
): Promise<{ scraped: number; inserted: number; skippedDuplicate: number }> {
  let scraped = 0;
  let inserted = 0;
  let skippedDuplicate = 0;
  const MAX_DAYS_BUDGET = 365;
  const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / 86_400_000);
  const daysToFetch = Math.min(totalDays, MAX_DAYS_BUDGET);

  for (let d = 0; d < daysToFetch; d++) {
    const day = new Date(startDate.getTime() + d * 86_400_000);
    const dateStr = day.toISOString().slice(0, 10);

    const matches = await fetchFotMobMatches(dateStr);
    // Batch-fetch xG for all matches on this day in parallel.
    const xgMap = new Map<number, { homeXG: number; awayXG: number }>();
    await Promise.all(matches.map(async (m) => {
      const xg = await fetchMatchXG(m.id);
      if (xg) xgMap.set(m.id, xg);
    }));
    const finished = matches.filter(
      (m) => m.status.finished && m.home.score != null && m.away.score != null,
    );

    for (const m of finished) {
      scraped += 1;
      const xg = xgMap.get(m.id);
      const home = normalize(m.home.name);
      const away = normalize(m.away.name);
      if (!home || !away) continue;
      if (m.home.score == null || m.away.score == null) continue;
      if (m.home.score < 0 || m.away.score < 0) continue;

      const leagueName =
        m.leagueId != null ? `fotmob-${m.leagueId}` : null;

      try {
        const result = await db.teamHistoryMatch.upsert({
          where: {
            matchDate_homeTeam_awayTeam: {
              matchDate: dateStr,
              homeTeam: home,
              awayTeam: away,
            },
          },
          create: {
            matchDate: dateStr,
            homeTeam: home,
            awayTeam: away,
            homeGoals: m.home.score,
            awayGoals: m.away.score,
            homeXG: xg?.homeXG ?? null,
            awayXG: xg?.awayXG ?? null,
            league: leagueName,
            source: 'fotmob',
          },
          update: {
            homeGoals: m.home.score,
            awayGoals: m.away.score,
            homeXG: xg?.homeXG ?? null,
            awayXG: xg?.awayXG ?? null,
            league: leagueName,
            fetchedAt: new Date(),
          },
        });
        if (Date.now() - result.fetchedAt.getTime() < 2_000) inserted += 1;
        else skippedDuplicate += 1;
      } catch {
        skippedDuplicate += 1;
      }
    }

    if (d < daysToFetch - 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return { scraped, inserted, skippedDuplicate };
}

/**
 * Pull finished matches from Sofascore (via Python bridge) for the
 * given date range and upsert into TeamHistoryMatch. Sofascore's
 * bridge is heavier than FotMob (child_process per call) so we
 * parallelize up to 5 days at a time.
 */
async function backfillFromSofascore(
  startDate: Date,
  endDate: Date,
): Promise<{ scraped: number; inserted: number; skippedDuplicate: number }> {
  let scraped = 0;
  let inserted = 0;
  let skippedDuplicate = 0;
  const MAX_DAYS_BUDGET = 365;
  const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / 86_400_000);
  const daysToFetch = Math.min(totalDays, MAX_DAYS_BUDGET);
  const PARALLEL = 5;

  const dateList: string[] = [];
  for (let d = 0; d < daysToFetch; d++) {
    const day = new Date(startDate.getTime() + d * 86_400_000);
    dateList.push(day.toISOString().slice(0, 10));
  }

  const { fetchSofascoreMatchesByDate } = await import('../sofascore');

  for (let i = 0; i < dateList.length; i += PARALLEL) {
    const chunk = dateList.slice(i, i + PARALLEL);
    const chunkResults = await Promise.all(
      chunk.map(async (dateStr) => {
        try {
          const matches = await fetchSofascoreMatchesByDate(dateStr);
          return { dateStr, matches };
        } catch {
          return { dateStr, matches: [] };
        }
      }),
    );

    for (const { dateStr, matches } of chunkResults) {
      const finished = matches.filter(
        (m) =>
          m.status_type === 'finished' &&
          m.home_score != null &&
          m.away_score != null,
      );

      for (const m of finished) {
        scraped += 1;
        const home = normalize(m.home_team);
        const away = normalize(m.away_team);
        if (!home || !away) continue;
        if (m.home_score == null || m.away_score == null) continue;
        if (m.home_score < 0 || m.away_score < 0) continue;

        const leagueName = m.tournament_name || null;

        try {
          const result = await db.teamHistoryMatch.upsert({
            where: {
              matchDate_homeTeam_awayTeam: {
                matchDate: dateStr,
                homeTeam: home,
                awayTeam: away,
              },
            },
            create: {
              matchDate: dateStr,
              homeTeam: home,
              awayTeam: away,
              homeGoals: m.home_score,
              awayGoals: m.away_score,
              league: leagueName,
              source: 'sofascore',
            },
            update: {
              homeGoals: m.home_score,
              awayGoals: m.away_score,
              league: leagueName,
              fetchedAt: new Date(),
            },
          });
          if (Date.now() - result.fetchedAt.getTime() < 2_000) inserted += 1;
          else skippedDuplicate += 1;
        } catch {
          skippedDuplicate += 1;
        }
      }
    }
  }
  return { scraped, inserted, skippedDuplicate };
}

/**
 * Pull a date out of a Scoremer time string. The parser is best-
 * effort — if the string doesn't match we just skip that match.
 * Falls back to a date inside [start, end].
 */
function parseScoremerTimeToDate(time: string, start: Date, end: Date): string | null {
  // Pattern: "12/06/26 19:00" (DD/MM/YY HH:MM) — Turkish sites
  const m = time.match(/(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);
  if (m) {
    const dd = m[1];
    const mm = m[2];
    const yy = m[3];
    const year = parseInt(yy, 10) > 50 ? `19${yy}` : `20${yy}`;
    return `${year}-${mm}-${dd}`;
  }
  // Otherwise use the first date in the search window
  void start;
  void end;
  return null;
}

/**
 * Fit a fresh Kalman model from all rows in `TeamHistoryMatch`
 * and persist it as a `team-strength` artifact. Returns the
 * full backfill result so the admin endpoint can report counts.
 */
export async function fitAndRegisterTeamStrength(
  options: {
    minMatches?: number;
    configOverrides?: Partial<KalmanConfig>;
    version?: string;
    notes?: string;
  } = {},
): Promise<BackfillResult> {
  const { configOverrides, version, notes } = options;
  const minMatches = options.minMatches ?? 5;
  const all = await db.teamHistoryMatch.findMany({
    orderBy: { matchDate: 'asc' },
  });
  // Filter out rows whose home/away teams appear < minMatches times
  // in total — Kalman needs at least minMatches appearances per
  // team for stable params.
  const counts = new Map<string, number>();
  for (const row of all) {
    counts.set(row.homeTeam, (counts.get(row.homeTeam) ?? 0) + 1);
    counts.set(row.awayTeam, (counts.get(row.awayTeam) ?? 0) + 1);
  }
  const fitRows: ScoredMatch[] = [];
  for (const row of all) {
    if (
      (counts.get(row.homeTeam) ?? 0) >= minMatches &&
      (counts.get(row.awayTeam) ?? 0) >= minMatches
    ) {
      fitRows.push({
        date: row.matchDate,
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        homeGoals: row.homeGoals,
        awayGoals: row.awayGoals,
      });
    }
  }

  if (fitRows.length === 0) {
    return {
      matchesScraped: 0,
      matchesInserted: 0,
      matchesSkippedDuplicate: 0,
      teamsInModel: 0,
      modelVersion: 'no-data',
      artifactPath: '',
      nMatchesFitted: 0,
    };
  }

  const model = fitBatch(fitRows, configOverrides);
  const serialized = serializeTeamStrength(model);
  // Persist alongside other ML artifacts. Path follows the
  // existing convention: data/ml-models/<name>-v<version>.json
  // The fs helpers live in a dedicated server-only module so the
  // client bundle never traces through node:fs.
  const modelVersion = version ?? `ts-${model.fittedAt}`;
  const { writeModelArtifact } = await import('./persistArtifact');
  const filePath = await writeModelArtifact('team-strength', modelVersion, serialized);

  // Compute Brier on a held-out 20% as a sanity metric
  const shuffled = [...fitRows].sort(() => Math.random() - 0.5);
  const splitIdx = Math.floor(shuffled.length * 0.8);
  const testSet = shuffled.slice(splitIdx);
  let brierSum = 0;
  for (const m of testSet) {
    const p = predict1x2BrierFromModel(model, m.homeTeam, m.awayTeam);
    brierSum += (p - (m.homeGoals > m.awayGoals ? 1 : 0)) ** 2;
  }
  const brier = testSet.length > 0 ? brierSum / testSet.length : 0;

  await registerArtifact({
    name: 'team-strength',
    version: modelVersion,
    artifactPath: filePath,
    metrics: {
      brier,
      logLoss: 0,
      accuracy: 0,
      calibrationError: 0,
      n: fitRows.length,
      trainRows: splitIdx,
      testRows: testSet.length,
    },
    sha256: await sha256(serialized),
    notes: notes ?? `Kalman fit on ${fitRows.length} matches, ${model.nTeams} teams`,
  });

  return {
    matchesScraped: all.length,
    matchesInserted: fitRows.length,
    matchesSkippedDuplicate: all.length - fitRows.length,
    teamsInModel: model.nTeams,
    modelVersion,
    artifactPath: filePath,
    nMatchesFitted: fitRows.length,
  };
}

/**
 * Returns the predicted home-win probability for a match using
 * the current team-strength model. Used by `fitAndRegisterTeamStrength`
 * for in-sample Brier computation; not the public inference path.
 */
function predict1x2BrierFromModel(
  model: TeamStrengthModel,
  home: string,
  away: string,
): number {
  return predictMatch(model, home, away).homeWinP;
}

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Read the latest team-strength artifact (if any) and return
 * the in-memory TeamStrengthModel. Falls back to the in-process
 * default when no artifact is registered. The router does the
 * same — this is a thin re-export for callers that want a
 * `TeamStrengthModel` directly without going through the
 * champion registry.
 */
export async function loadLatestTeamStrength(): Promise<TeamStrengthModel> {
  const champion = await loadTeamStrengthChampion();
  if (!champion) {
    // No artifact AND no in-process default — extremely unlikely
    // (loadTeamStrengthChampion always returns a model built from
    // loadTeamStrength() default), but fall back to default anyway
    // for type safety.
    const { loadTeamStrength } = await import('./teamStrengthKalman');
    return loadTeamStrength();
  }
  return champion.model;
}
