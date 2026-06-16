// ── Admin: Elo Rating Import ──────────────────────────────────────
// Fetches club Elo ratings from multiple free sources with fallback.
//
// Sources (in priority order):
//   1. ClubElo API (api.clubelo.com)
//   2. FootballDatabase.com scraping
//   3. Static estimation from known seasonal data
//
// POST body:
//   { action: "fetch", teams: ["Galatasaray", "Fenerbahce", ...] }
//   { action: "manual", entries: [{ team: "Galatasaray", rating: 1750 }, ...] }
//   { action: "fetch-league", country: "TUR" }

import { NextResponse } from 'next/server';
import { adminRoute } from '@/lib/adminRoute';
import { bulkSetRatings } from "@/lib/eloRating";
import { fetchTeamRating, fetchTeamRatings } from "@/lib/eloFetcher";

// Well-known Turkish Super Lig teams
const TURKISH_TEAMS = [
  "Galatasaray",
  "Fenerbahce",
  "Besiktas",
  "Trabzonspor",
  "Basaksehir",
  "Antalyaspor",
  "AdanaDemirspor",
  "Konyaspor",
  "Hatayspor",
  "Gaziantep",
  "Sivasspor",
  "Alanyaspor",
  "Kasimpasa",
  "Kayserispor",
  "Rizespor",
  "Samsunspor",
  "Bodrumspor",
  "Eyupspor",
  "Goztepe",
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

export const dynamic = 'force-dynamic';

export const POST = adminRoute(async (request: Request) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const action = body.action;

  // Fetch from multiple sources by team names
  if (action === "fetch") {
    const teams = body.teams;
    if (!Array.isArray(teams) || teams.length === 0) {
      return NextResponse.json(
        { error: "teams array required" },
        { status: 400 },
      );
    }
    if (teams.length > 100) {
      return NextResponse.json(
        { error: "max 100 teams per request" },
        { status: 400 },
      );
    }
    const { results, failed } = await fetchTeamRatings(teams);
    const imported = bulkSetRatings(
      results.map((r) => ({ team: r.team, rating: r.rating })),
    );
    return NextResponse.json({ ok: true, imported, failed, results });
  }

  // Manual entry
  if (action === "manual") {
    const entries = body.entries;
    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json(
        { error: "entries array required" },
        { status: 400 },
      );
    }
    const valid = entries.filter(
      (e: any) =>
        e.team &&
        typeof e.rating === "number" &&
        e.rating >= 500 &&
        e.rating <= 3000,
    );
    const imported = bulkSetRatings(valid);
    return NextResponse.json({ ok: true, imported, total: entries.length });
  }

  // Fetch by league preset
  if (action === "fetch-league") {
    const country = body.country || "TUR";
    let teams: string[];
    switch (country) {
      case "TUR":
        teams = TURKISH_TEAMS;
        break;
      case "EUR":
        teams = EUROPEAN_TEAMS;
        break;
      case "ALL":
        teams = [...TURKISH_TEAMS, ...EUROPEAN_TEAMS];
        break;
      default:
        return NextResponse.json(
          { error: "Unknown country. Use: TUR, EUR, ALL" },
          { status: 400 },
        );
    }
    const { results, failed } = await fetchTeamRatings(teams);
    const imported = bulkSetRatings(
      results.map((r) => ({ team: r.team, rating: r.rating })),
    );
    return NextResponse.json({ ok: true, country, imported, failed, results });
  }

  return NextResponse.json(
    { error: "Unknown action. Use: fetch, manual, fetch-league" },
    { status: 400 },
  );
};);
