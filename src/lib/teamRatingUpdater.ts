// ── TeamRating Periodik Güncelleyici ─────────────────────────────
// MLScheduler tarafindan periyodik olarak cagrilir.
// TeamHistoryMatch'teki yeni maclarla TeamRating tablosunu gunceller.
//
// 2 mod:
//   1. Tam (full) — tum takimlari yeniden hesapla (gunluk 03:00)
//   2. Fixture (fixture) — yarinin macindaki takimlari guncelle (6 saatte bir)

import { db } from '@/lib/db';
import { updatePiRating, resetPiState } from '@/lib/piRating';
import { logInfo, logError } from '@/lib/devLog';
import { fitBatch } from '@/lib/ml/teamStrengthKalman';
import type { TeamStrengthModel } from '@/lib/ml/teamStrengthKalman';

let lastFullUpdate = '';
let lastFixtureUpdate = '';

/**
 * Tam backfill: tum takimlari TeamHistoryMatch'ten yeniden hesapla.
 * Gunluk 03:00'te cagrilir.
 */
export async function runFullTeamRatingUpdate(): Promise<{ teams: number }> {
  const today = new Date().toISOString().slice(0, 10);
  if (lastFullUpdate === today) return { teams: 0 };
  lastFullUpdate = today;

  logInfo('teamRating', `Full update started...`);

  // Son 1 gunluk yeni maclari getir
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const newMatches = await db.teamHistoryMatch.findMany({
    where: { matchDate: { gte: yesterday } },
    orderBy: { matchDate: 'asc' },
  });

  if (newMatches.length === 0) {
    logInfo('teamRating', 'No new matches found.');
    return { teams: 0 };
  }

  // Pi-Rating sequential replay (sadece yeni maclar)
  for (const r of newMatches) {
    updatePiRating(r.homeTeam, r.awayTeam, r.homeGoals, r.awayGoals);
  }

  // TeamRating'i guncelle (etkilenen takimlar icin)
  const affectedTeams = new Set<string>();
  for (const r of newMatches) {
    affectedTeams.add(r.homeTeam);
    affectedTeams.add(r.awayTeam);
  }

  let updated = 0;
  for (const teamName of affectedTeams) {
    const stats = await aggregateTeamStats(teamName);
    if (!stats) continue;
    const eloRating = await getEloForTeam(teamName);
    await db.teamRating.upsert({
      where: { teamName },
      create: { teamName, ...stats, elo: eloRating ?? 1500 },
      update: { ...stats, elo: eloRating ?? 1500 },
    });
    updated++;
  }

  logInfo('teamRating', `Updated ${updated} teams (${newMatches.length} new matches).`);
  return { teams: updated };
}

/**
 * Fixture bazli guncelleme: yarinin macindaki takimlarin
 * rating'lerini son verilerle guncelle. 6 saatte bir cagrilir.
 */
export async function runFixtureTeamRatingUpdate(): Promise<{ teams: number }> {
  // Yarinin tarihini hesapla
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const todayKey = new Date().toISOString().slice(0, 10);
  if (lastFixtureUpdate === todayKey) return { teams: 0 };
  lastFixtureUpdate = todayKey;

  // TeamHistoryMatch'te yarinin maci yok, o yuzden son 30 gunluk
  // maclardan etkilenen takimlari guncelle
  const last30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const recentMatches = await db.teamHistoryMatch.findMany({
    where: { matchDate: { gte: last30 } },
    orderBy: { matchDate: 'asc' },
  });

  if (recentMatches.length === 0) return { teams: 0 };

  for (const r of recentMatches) {
    updatePiRating(r.homeTeam, r.awayTeam, r.homeGoals, r.awayGoals);
  }

  const affected = new Set<string>();
  for (const r of recentMatches) {
    affected.add(r.homeTeam);
    affected.add(r.awayTeam);
  }

  let updated = 0;
  for (const teamName of affected) {
    const stats = await aggregateTeamStats(teamName);
    if (!stats) continue;
    await db.teamRating.updateMany({
      where: { teamName },
      data: { ...stats },
    });
    updated++;
  }

  logInfo('teamRating', `Fixture update: ${updated} teams (${recentMatches.length} matches).`);
  return { teams: updated };
}

async function aggregateTeamStats(teamName: string) {
  const rows = await db.teamHistoryMatch.findMany({
    where: {
      OR: [{ homeTeam: teamName }, { awayTeam: teamName }],
    },
    orderBy: { matchDate: 'asc' },
  });
  if (rows.length === 0) return null;

  let wins = 0, draws = 0, losses = 0;
  let goalsFor = 0, goalsAgainst = 0;
  let xgFor = 0, xgAgainst = 0;
  const formResults: string[] = [];

  for (const r of rows) {
    const isHome = r.homeTeam === teamName;
    const gf = isHome ? r.homeGoals : r.awayGoals;
    const ga = isHome ? r.awayGoals : r.homeGoals;
    goalsFor += gf;
    goalsAgainst += ga;
    if (gf > ga) wins++; else if (gf < ga) losses++; else draws++;
    formResults.push(gf > ga ? 'W' : gf < ga ? 'L' : 'D');
    if (r.homeXG != null) xgFor += isHome ? r.homeXG : (r.awayXG ?? 0);
    if (r.awayXG != null) xgAgainst += isHome ? r.awayXG : (r.homeXG ?? 0);
  }

  return {
    matchesPlayed: rows.length,
    wins, draws, losses,
    goalsFor, goalsAgainst,
    xgFor: Math.round(xgFor * 100) / 100,
    xgAgainst: Math.round(xgAgainst * 100) / 100,
    formJson: JSON.stringify(formResults.slice(-10)),
  };
}

async function getEloForTeam(teamName: string): Promise<number | null> {
  try {
    const { getRating } = await import('@/lib/eloRating');
    const elo = getRating(teamName);
    return elo?.rating ?? null;
  } catch { return null; }
}
