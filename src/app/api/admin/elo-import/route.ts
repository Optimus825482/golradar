// ── Admin: Elo Rating Import ──────────────────────────────────────
// Fetches club Elo ratings from external sources and writes them
// to the local file-based rating system.
//
// Sources:
//   1. ClubElo.com API (api.clubelo.com/{Team}) — CSV format
//   2. Manual entry — direct {team, rating} pairs
//   3. Bulk team list — fetches from ClubElo for each team
//
// POST body:
//   { action: "fetch", teams: ["Galatasaray", "Fenerbahce", ...] }
//   { action: "manual", entries: [{ team: "Galatasaray", rating: 1750 }, ...] }
//   { action: "fetch-league", country: "TUR" }

import { NextResponse } from 'next/server';
import { adminRoute } from '@/lib/adminRoute';
import { setRating, bulkSetRatings } from '@/lib/eloRating';

// Well-known Turkish Süper Lig teams with their ClubElo names
const TURKISH_TEAMS = [
  'Galatasaray', 'Fenerbahce', 'Besiktas', 'Trabzonspor', 'Basaksehir',
  'Antalyaspor', 'AdanaDemirspor', 'Konyaspor', 'Hatayspor', 'Gaziantep',
  'Sivasspor', 'Alanyaspor', 'Kasimpasa', 'Kayserispor', 'Rizespor',
  'Samsunspor', 'Bodrumspor', 'Eyupspor', 'Goztepe', 'BodrumFK',
];

// Top European teams
const EUROPEAN_TEAMS = [
  'RealMadrid', 'Barcelona', 'Atletico', 'ManCity', 'Liverpool', 'Arsenal',
  'Chelsea', 'ManUnited', 'Tottenham', 'Newcastle',
  'Bayern', 'Dortmund', 'Leipzig', 'Leverkusen',
  'Juventus', 'Inter', 'Milan', 'Napoli', 'Roma', 'Lazio',
  'PSG', 'Marseille', 'Lyon', 'Monaco',
  'Ajax', 'PSV', 'Benfica', 'Porto', 'Sporting',
  'Celtic', 'Rangers', 'Salzburg', 'Shakhtar',
];

async function fetchClubElo(teamName: string): Promise<{ team: string; rating: number } | null> {
  try {
    const resp = await fetch(`http://api.clubelo.com/${teamName}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;
    const csv = await resp.text();
    // CSV format: Club,Elo,From,To,Country,Level
    // Take the last row (most recent rating)
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return null;
    const lastLine = lines[lines.length - 1];
    const parts = lastLine.split(',');
    if (parts.length < 2) return null;
    const rating = parseFloat(parts[1]);
    if (isNaN(rating) || rating < 500 || rating > 3000) return null;
    return { team: teamName, rating };
  } catch {
    return null;
  }
}

async function fetchBatch(teams: string[]): Promise<{ imported: number; failed: string[]; results: Array<{ team: string; rating: number }> }> {
  const results: Array<{ team: string; rating: number }> = [];
  const failed: string[] = [];

  // Fetch in batches of 5 with delay to avoid rate limiting
  for (let i = 0; i < teams.length; i += 5) {
    const batch = teams.slice(i, i + 5);
    const promises = batch.map(async (team) => {
      const result = await fetchClubElo(team);
      if (result) {
        results.push(result);
      } else {
        failed.push(team);
      }
    });
    await Promise.all(promises);
    if (i + 5 < teams.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  const imported = bulkSetRatings(results.map(r => ({ team: r.team, rating: r.rating })));
  return { imported, failed, results };
}

export const dynamic = 'force-dynamic';

export const POST = adminRoute(async (request: Request) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const action = body.action;

  // Fetch from ClubElo by team names
  if (action === 'fetch') {
    const teams = body.teams;
    if (!Array.isArray(teams) || teams.length === 0) {
      return NextResponse.json({ error: 'teams array required' }, { status: 400 });
    }
    if (teams.length > 100) {
      return NextResponse.json({ error: 'max 100 teams per request' }, { status: 400 });
    }
    const result = await fetchBatch(teams);
    return NextResponse.json({ ok: true, ...result });
  }

  // Manual entry
  if (action === 'manual') {
    const entries = body.entries;
    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json({ error: 'entries array required' }, { status: 400 });
    }
    const valid = entries.filter((e: any) => e.team && typeof e.rating === 'number' && e.rating >= 500 && e.rating <= 3000);
    const imported = bulkSetRatings(valid);
    return NextResponse.json({ ok: true, imported, total: entries.length });
  }

  // Fetch by league preset
  if (action === 'fetch-league') {
    const country = body.country || 'TUR';
    let teams: string[];
    switch (country) {
      case 'TUR': teams = TURKISH_TEAMS; break;
      case 'EUR': teams = EUROPEAN_TEAMS; break;
      case 'ALL': teams = [...TURKISH_TEAMS, ...EUROPEAN_TEAMS]; break;
      default:
        return NextResponse.json({ error: 'Unknown country. Use: TUR, EUR, ALL' }, { status: 400 });
    }
    const result = await fetchBatch(teams);
    return NextResponse.json({ ok: true, country, ...result });
  }

  return NextResponse.json({ error: 'Unknown action. Use: fetch, manual, fetch-league' }, { status: 400 });
});
