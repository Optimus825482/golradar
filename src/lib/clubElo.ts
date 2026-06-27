// ── ClubElo API Integration ──────────────────────────────────
// Fetches team strength ratings from clubelo.com.
// Provides an independent team strength signal for the ensemble.
//
// ClubElo ratings are computed daily from match results using
// a modified Elo system (Glicko-like). Free, no API key needed.
// 
// API: http://clubelo.com/API/GetClubElo/{team}
// Returns: { Club: string, Elo: number, From: string, To: string }

import { logError } from '@/lib/devLog';

export interface ClubEloRating {
  club: string;
  elo: number;
  from: string;  // date
  to: string;    // date
}

// In-memory cache (hourly refresh)
let cachedRatings: Map<string, ClubEloRating> = new Map();
let lastFetch = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 saat

/**
 * Bir takımın ClubElo rating'ini getir.
 * @param teamName Takım adı (URL için slugify edilir)
 * @returns ClubEloRating | null
 */
export async function getClubElo(teamName: string): Promise<ClubEloRating | null> {
  if (!teamName) return null;

  const cacheKey = teamName.toLowerCase().trim();
  const cached = cachedRatings.get(cacheKey);
  if (cached && Date.now() - lastFetch < CACHE_TTL) {
    return cached;
  }

  try {
    const slug = teamName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');

    const url = `http://clubelo.com/API/GetClubElo/${encodeURIComponent(slug)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

    if (!res.ok) return null;

    const data = await res.json();
    if (!data || !data.Club) return null;

    const rating: ClubEloRating = {
      club: data.Club,
      elo: data.Elo ?? 1500,
      from: data.From ?? '',
      to: data.To ?? '',
    };

    cachedRatings.set(cacheKey, rating);
    lastFetch = Date.now();

    // Sadece development'da log
    if (process.env.NODE_ENV === 'development') {
      console.log(`[ClubElo] ${teamName}: ${rating.elo}`);
    }

    return rating;
  } catch {
    // Sessiz geç — Elo yoksa sistem devam eder
    return null;
  }
}

/**
 * İki takım arasındaki Elo farkından maç kazanma olasılığı.
 * @returns home win probability (0-1)
 */
export function eloToWinProbability(homeElo: number, awayElo: number): number {
  const expected = 1 / (1 + Math.pow(10, (awayElo - homeElo) / 400));
  return Math.round(expected * 1000) / 1000;
}

/**
 * Cache'i temizle (manuel refresh için)
 */
export function clearClubEloCache(): void {
  cachedRatings.clear();
  lastFetch = 0;
}
