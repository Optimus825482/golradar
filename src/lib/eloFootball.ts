// ── elofootball.com Scraper ────────────────────────────────
// Fetches club-level Elo ratings from elofootball.com by country + season.
// Free, no API key needed. Returns per-team current Elo, peak Elo, recent form.
//
// Usage:
//   const ratings = await fetchEloRatings('TUR', '2025-2026');
//   // → [{ team: "Galatasaray", elo: 1996, peak: 2101, ... }]

import { logError } from '@/lib/devLog';

export interface EloFootballRating {
  rank: number;
  team: string;
  elo: number;        // current Elo rating
  peakElo: number;    // season peak
  form: string;       // last 6 results (W/D/L)
  change: number;     // recent change
  league: string;     // league name
}

const COUNTRY_BASE = 'https://elofootball.com/country.php';

/**
 * Bir ülke için Elo rating'lerini getir.
 */
export async function fetchEloRatings(
  countryIso: string,
  season: string = '2025-2026',
): Promise<EloFootballRating[]> {
  try {
    const url = `${COUNTRY_BASE}?countryiso=${countryIso}&season=${season}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; golradar2/1.0)' },
    });
    if (!res.ok) return [];

    const html = await res.text();
    return parseEloTable(html, countryIso);
  } catch (err) {
    logError('eloFootball', `Failed for ${countryIso}:`, err);
    return [];
  }
}

/**
 * Birden çok ülke için toplu çekim.
 */
export async function fetchMultiCountry(
  countries: string[],
  season: string = '2025-2026',
): Promise<Map<string, EloFootballRating[]>> {
  const results = new Map<string, EloFootballRating[]>();
  const promises = countries.map(async (iso) => {
    const ratings = await fetchEloRatings(iso, season);
    if (ratings.length > 0) results.set(iso, ratings);
  });
  await Promise.all(promises);
  return results;
}

/**
 * HTML'den takım Elo tablosunu parse et.
 */
function parseEloTable(html: string, countryIso: string): EloFootballRating[] {
  // Find the team table (third table on the page, contains 50 rows)
  const tables = html.match(/<table[^>]*>[\s\S]*?<\/table>/g);
  if (!tables || tables.length < 3) return [];

  const teamTable = tables[2]; // third table = team ratings
  const rows = teamTable.match(/<tr>[\s\S]*?<\/tr>/g);
  if (!rows) return [];

  const ratings: EloFootballRating[] = [];

  for (const row of rows) {
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g);
    if (!cells || cells.length < 7) continue;

    const clean = cells.map((c) =>
      c.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim()
    );

    // Format: rank | team | form1 | form2 | form3 | form4 | form5 | form6 | elo | peak | ...
    // Col 0: rank, Col 1: team, Col 8: current elo, Col 9: peak elo
    const rank = parseInt(clean[0], 10);
    const team = clean[1]?.replace(/^\d+\s*/, '').trim(); // remove leading number if any
    const elo = parseInt(clean[8], 10);
    const peakElo = parseInt(clean[9], 10);

    // Form: columns 2-7 are last 6 results (W=Win, D=Draw, L=Loss)
    const formResults = clean.slice(2, 8).filter(f => /^[WDL]/.test(f));
    const form = formResults.join(' ');

    if (team && !isNaN(elo)) {
      ratings.push({
        rank,
        team,
        elo,
        peakElo: isNaN(peakElo) ? elo : peakElo,
        form,
        change: elo - peakElo,
        league: countryIso,
      });
    }
  }

  return ratings;
}

/**
 * Tüm Avrupa ülkeleri ISO kodları.
 */
export const EUROPEAN_COUNTRIES: Record<string, string> = {
  TUR: 'Turkey', ENG: 'England', ESP: 'Spain', DEU: 'Germany',
  ITA: 'Italy', FRA: 'France', NLD: 'Netherlands', PRT: 'Portugal',
  BEL: 'Belgium', AUT: 'Austria', CHE: 'Switzerland', GRC: 'Greece',
  RUS: 'Russia', UKR: 'Ukraine', POL: 'Poland', ROU: 'Romania',
  CZE: 'Czech Republic', HRV: 'Croatia', SRB: 'Serbia', BGR: 'Bulgaria',
  HUN: 'Hungary', SVK: 'Slovakia', SVN: 'Slovenia', BIH: 'Bosnia',
  SCO: 'Scotland', NOR: 'Norway', SWE: 'Sweden', DNK: 'Denmark',
  FIN: 'Finland', ISL: 'Iceland', IRL: 'Ireland', NIR: 'Northern Ireland',
  WLS: 'Wales', ISR: 'Israel', KAZ: 'Kazakhstan', AZE: 'Azerbaijan',
  GEO: 'Georgia', ARM: 'Armenia', ALB: 'Albania', MKD: 'North Macedonia',
  MNE: 'Montenegro', KOS: 'Kosovo', LVA: 'Latvia', LTU: 'Lithuania',
  EST: 'Estonia', MDA: 'Moldova', MLT: 'Malta', LUX: 'Luxembourg',
  CYP: 'Cyprus', FRO: 'Faroe Islands', GIB: 'Gibraltar', AND: 'Andorra',
  SMR: 'San Marino', BLR: 'Belarus',
};

/**
 * Ülke kodunu takım ismine göre bul (fuzzy match).
 */
export function guessCountryFromTeam(teamName: string): string | null {
  // Bu fonksiyon TeamMapping'deki ülke bilgisine göre doldurulabilir
  return null;
}
