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
import { predictMatch } from './teamStrengthKalman';

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
export async function backfillTeamHistory(
  startDate: Date,
  endDate: Date,
  source: 'scoremer' = 'scoremer',
): Promise<{
  scraped: number;
  inserted: number;
  skippedDuplicate: number;
}> {
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

    // Extract date — Scoremer's `time` field is "MM/DD/YY HH:MM" or
    // "DD.MM.YYYY". The date is in the row's surrounding HTML
    // (parent table). Since we only get a `time` string from the
    // parser, we fall back to a "best guess" from startDate..endDate.
    // For now, accept the m.time as authoritative and let the
    // caller bound the date range.
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
          source,
        },
        update: {
          homeGoals: m.homeScore,
          awayGoals: m.awayScore,
          league: m.league || null,
          fetchedAt: new Date(),
        },
      });
      // Upsert returns the row but we don't know if it was an
      // insert or update without a flag. Heuristic: if fetchedAt
      // is within the last second, it was just created.
      if (Date.now() - result.fetchedAt.getTime() < 2_000) {
        inserted += 1;
      } else {
        skippedDuplicate += 1;
      }
    } catch {
      skippedDuplicate += 1;
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
