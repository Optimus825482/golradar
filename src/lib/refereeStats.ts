// ── Referee Statistics Module ──────────────────────────────────────
// DB-backed per-referee aggregates (card rate, penalty rate, fouls).
// Scraped from Transfermarkt by scripts/scrape_referee_stats.py,
// then upserted into the RefereeStats table.
//
// Used as control features in the ML pipeline (Faz E Task E5).
// High cardRate → more set-pieces → more goal opportunities.
// High penaltyRate → higher expected goals.

import { db } from './db';
import { logError } from './devLog';

export interface RefereeStatsData {
  refereeName: string;
  matchesCount: number;
  avgYellowCards: number;
  avgRedCards: number;
  avgFouls: number;
  avgPenalties: number;
  penaltyRate: number;
  cardRate: number;
}

export interface RefereeFeatures {
  /** Card rate (yellow + red) per match, normalized [0,1]. */
  ref_card_rate: number;
  /** Penalty rate per match, normalized [0,1]. */
  ref_penalty_rate: number;
  /** Average fouls per match, normalized [0,1]. */
  ref_foul_rate: number;
}

const NEUTRAL: RefereeFeatures = {
  ref_card_rate: 0.5,    // League average ~4 cards/match
  ref_penalty_rate: 0.1, // League average ~0.2 penalties/match
  ref_foul_rate: 0.5,    // League average ~25 fouls/match
};

/**
 * DB'den hakem stats çek. Yoksa null döndür (caller default'a
 * düşer). Hiçbir koşulda exception fırlatmaz — feature pipeline
 * sessizce nötr değerlere düşer.
 */
export async function getRefereeStats(
  refereeName: string,
): Promise<RefereeStatsData | null> {
  if (!refereeName || refereeName.trim().length === 0) return null;
  const normalized = refereeName.trim();
  try {
    const row = await db.refereeStats.findUnique({
      where: { refereeName: normalized },
    });
    if (!row) return null;
    return {
      refereeName: row.refereeName,
      matchesCount: row.matchesCount,
      avgYellowCards: row.avgYellowCards,
      avgRedCards: row.avgRedCards,
      avgFouls: row.avgFouls,
      avgPenalties: row.avgPenalties,
      penaltyRate: row.penaltyRate,
      cardRate: row.cardRate,
    };
  } catch (e) {
    logError('refereeStats', e);
    return null;
  }
}

/**
 * Hakem stats'ını feature'lara dönüştür. Yoksa nötr değerler.
 */
export function refereeStatsToFeatures(
  stats: RefereeStatsData | null,
): RefereeFeatures {
  if (!stats) return { ...NEUTRAL };

  const normLinear = (v: number, min: number, max: number) =>
    Math.max(0, Math.min(1, (v - min) / (max - min)));

  return {
    ref_card_rate: normLinear(stats.cardRate, 0, 8),
    ref_penalty_rate: normLinear(stats.penaltyRate, 0, 0.5),
    ref_foul_rate: normLinear(stats.avgFouls, 15, 35),
  };
}

/**
 * Convenience wrapper: hakem ismini al, hem DB'den çek hem feature'a
 * dönüştür. Hiçbir koşulda exception fırlatmaz.
 */
export async function getRefereeFeatures(
  refereeName: string | null | undefined,
): Promise<RefereeFeatures> {
  if (!refereeName) return { ...NEUTRAL };
  const stats = await getRefereeStats(refereeName);
  return refereeStatsToFeatures(stats);
}

/**
 * Python scraper çıktısını alıp RefereeStats tablosuna yaz.
 * `upsert` semantiği: aynı isimde referee varsa üzerine yaz.
 */
export interface RefereeStatsScraped {
  ok: boolean;
  refereeName: string;
  matchesCount?: number;
  avgYellowCards?: number;
  avgRedCards?: number;
  avgFouls?: number;
  avgPenalties?: number;
  penaltyRate?: number;
  cardRate?: number;
}

export async function upsertRefereeStats(
  scraped: RefereeStatsScraped,
): Promise<boolean> {
  if (!scraped.ok || !scraped.refereeName) return false;
  try {
    await db.refereeStats.upsert({
      where: { refereeName: scraped.refereeName },
      create: {
        refereeName: scraped.refereeName,
        matchesCount: scraped.matchesCount ?? 0,
        avgYellowCards: scraped.avgYellowCards ?? 0,
        avgRedCards: scraped.avgRedCards ?? 0,
        avgFouls: scraped.avgFouls ?? 0,
        avgPenalties: scraped.avgPenalties ?? 0,
        penaltyRate: scraped.penaltyRate ?? 0,
        cardRate: scraped.cardRate ?? 0,
      },
      update: {
        matchesCount: scraped.matchesCount ?? 0,
        avgYellowCards: scraped.avgYellowCards ?? 0,
        avgRedCards: scraped.avgRedCards ?? 0,
        avgFouls: scraped.avgFouls ?? 0,
        avgPenalties: scraped.avgPenalties ?? 0,
        penaltyRate: scraped.penaltyRate ?? 0,
        cardRate: scraped.cardRate ?? 0,
      },
    });
    return true;
  } catch (e) {
    logError('refereeStats', e);
    return false;
  }
}
