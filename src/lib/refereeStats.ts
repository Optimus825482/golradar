// ── Referee Statistics Module ──────────────────────────────────────
// Sofascore API-backed per-referee aggregates (card rate, yellowRed rate).
// In-memory TTL cache (5min) for hot referees. Soft-fail: returns null
// on any error so the feature pipeline falls back to neutral defaults
// (0.5/0.1/0.5) instead of crashing the request.
//
// Data flow:
//   getRefereeFeatures(name) → cache hit   → return cached
//                           → cache miss  → fetch from Sofascore API
//                                          → store in cache → return
//
// Sofascore endpoints used (no auth, no JS):
//   - Search: GET api.sofascore.com/api/v1/search/referees?q=<name>
//   - Detail: GET api.sofascore.com/api/v1/referee/<id>
//
// RefereeStats table is OPTIONAL: used only for snapshot/audit when
// admin runs a batch backfill. Production feature path doesn't touch DB.

import { db } from './db';
import { logError, logWarn } from './devLog';

export interface RefereeStatsData {
  refereeName: string;
  matchesCount: number;
  avgYellowCards: number;
  avgRedCards: number;
  avgFouls: number;        // 0.0 — Sofascore doesn't expose fouls
  avgPenalties: number;    // 0.0 — Sofascore doesn't expose penalties
  penaltyRate: number;
  cardRate: number;
  /** Sofascore referee ID (numeric). Cached alongside stats for
   *  faster repeat lookups. */
  sofascoreId?: number;
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
 * Hakem stats çek. Önce in-memory cache, sonra Sofascore API.
 * Hiçbir koşulda exception fırlatmaz — feature pipeline sessizce
 * null döner ve caller default'a (0.5/0.1/0.5) düşer.
 */
export async function getRefereeStats(
  refereeName: string,
): Promise<RefereeStatsData | null> {
  if (!refereeName || refereeName.trim().length === 0) return null;
  const normalized = refereeName.trim();

  // In-memory TTL cache. SSE / 5s poll → her maç için 1 cache check.
  // Aktif hakem seti küçük (~50 top-flight), cache küçük kalır.
  const cached = _refereeCache.get(normalized);
  if (cached && cached.expires > Date.now()) {
    return cached.value;
  }

  // Cache miss → Sofascore'dan çek
  const value = await _fetchFromSofascore(normalized);
  _setRefereeCache(normalized, value);
  return value;
}

async function _fetchFromSofascore(
  name: string,
): Promise<RefereeStatsData | null> {
  const SOFASCORE = "https://api.sofascore.com/api/v1";
  try {
    // 1) Search → referee ID
    const searchUrl = `${SOFASCORE}/search/referees?q=${encodeURIComponent(name)}`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json",
      },
      // Server Component'tan çağrılabilmesi için next cache'e girme
      cache: "no-store",
    });
    if (!searchRes.ok) {
      logWarn('refereeStats', `sofascore search ${searchRes.status} for "${name}"`);
      return null;
    }
    const searchData = await searchRes.json();
    const results: any[] = searchData?.results || [];
    if (results.length === 0) {
      logWarn('refereeStats', `no sofascore results for "${name}"`);
      return null;
    }
    // Best match: exact name > first by score
    const nameLc = name.toLowerCase().trim();
    const best =
      results.find((r: any) =>
        (r.entity?.name || "").toLowerCase().trim() === nameLc,
      ) || results[0];
    const entity = best.entity;
    const refId = entity?.id;
    if (!refId) {
      logWarn('refereeStats', `no id in sofascore result for "${name}"`);
      return null;
    }

    // 2) Detail → stats
    const detailRes = await fetch(`${SOFASCORE}/referee/${refId}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!detailRes.ok) {
      logWarn('refereeStats', `sofascore detail ${detailRes.status} (id=${refId})`);
      return null;
    }
    const detailData = await detailRes.json();
    const ref = detailData?.referee;
    if (!ref) return null;

    const games = Number(ref.games) || 0;
    if (games === 0) return null;
    const yellow = Number(ref.yellowCards) || 0;
    const red = Number(ref.redCards) || 0;
    return {
      refereeName: ref.name || name,
      matchesCount: games,
      avgYellowCards: Math.round((yellow / games) * 1000) / 1000,
      avgRedCards: Math.round((red / games) * 1000) / 1000,
      avgFouls: 0,    // Sofascore doesn't expose fouls
      avgPenalties: 0, // Sofascore doesn't expose penalties
      penaltyRate: 0,
      cardRate: Math.round((yellow / games) * 1000) / 1000,
      sofascoreId: refId,
    };
  } catch (e) {
    logError('refereeStats', e);
    return null;
  }
}

// ── In-memory TTL cache ─────────────────────────────────────────────
// Bounded by referee count (top-flight leagues have ~50 active refs).
// 5-min TTL — Transfermarkt data updates slowly. upsertRefereeStats
// invalidates the entry on write.
const _CACHE_MAX = 256;
interface RefereeCacheEntry {
  value: RefereeStatsData | null;
  expires: number;
}
const _refereeCache: Map<string, RefereeCacheEntry> = new Map();
function _setRefereeCache(key: string, value: RefereeStatsData | null) {
  _refereeCache.set(key, { value, expires: Date.now() + 5 * 60_000 });
  if (_refereeCache.size > _CACHE_MAX) {
    // Drop oldest 32 entries when full — insertion order is fine
    // here because TTL is short (5 min) and turnover is high.
    const it = _refereeCache.keys();
    for (let i = 0; i < 32; i++) {
      const k = it.next().value;
      if (k === undefined) break;
      _refereeCache.delete(k);
    }
  }
}

/** Test helper — wipe the in-memory cache. Not for production use. */
export function _resetRefereeCacheForTests(): void {
  _refereeCache.clear();
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
    // Invalidate cache entry so the next read picks up the fresh row.
    _refereeCache.delete(scraped.refereeName);
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
