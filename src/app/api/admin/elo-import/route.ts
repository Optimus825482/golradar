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
import { db } from "@/lib/db";
import { startEloImport, getJobProgress } from "@/lib/eloImportJob";

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

// Top 5 European leagues + European regulars
const EUROPEAN_TEAMS = [
  // Premier League
  "ManCity",
  "Liverpool",
  "Arsenal",
  "Chelsea",
  "ManUnited",
  "Tottenham",
  "Newcastle",
  "AstonVilla",
  "Brighton",
  "WestHam",
  "CrystalPalace",
  "Everton",
  "Fulham",
  "Brentford",
  "Wolves",
  "Nottingham",
  "Bournemouth",
  "Leicester",
  "Southampton",
  "Ipswich",
  // La Liga
  "RealMadrid",
  "Barcelona",
  "Atletico",
  "Athletic",
  "RealSociedad",
  "Villarreal",
  "Betis",
  "Girona",
  "Valencia",
  "Sevilla",
  "Osasuna",
  "Getafe",
  "Celta",
  "Mallorca",
  "LasPalmas",
  "Rayo",
  "Alaves",
  "Leganes",
  "Espanyol",
  "Valladolid",
  // Bundesliga
  "Bayern",
  "Dortmund",
  "Leipzig",
  "Leverkusen",
  "Frankfurt",
  "Freiburg",
  "Hoffenheim",
  "Wolfsburg",
  "Mainz",
  "Bremen",
  "Augsburg",
  "Heidenheim",
  "Bochum",
  "UnionBerlin",
  "StPauli",
  "Kiel",
  "Stuttgart",
  // Serie A
  "Juventus",
  "Inter",
  "Milan",
  "Napoli",
  "Roma",
  "Lazio",
  "Atalanta",
  "Fiorentina",
  "Torino",
  "Bologna",
  "Genoa",
  "Monza",
  "Verona",
  "Lecce",
  "Empoli",
  "Cagliari",
  "Udinese",
  "Parma",
  "Como",
  "Venezia",
  // Ligue 1
  "PSG",
  "Marseille",
  "Lyon",
  "Monaco",
  "Lille",
  "Lens",
  "Rennes",
  "Nice",
  "Reims",
  "Toulouse",
  "Strasbourg",
  "Brest",
  "Montpellier",
  "Nantes",
  "Auxerre",
  "StEtienne",
  "LeHavre",
  "Angers",
  // Rest of Europe
  "Ajax",
  "PSV",
  "Feyenoord",
  "Benfica",
  "Porto",
  "Sporting",
  "Celtic",
  "Rangers",
  "Salzburg",
  "Shakhtar",
  "DinamoZagreb",
  "Olympiakos",
  "PAOK",
  "Panathinaikos",
  "Kobenhavn",
  "Midtjylland",
  "Brugge",
  "Anderlecht",
  "Genk",
  "YoungBoys",
  "CrvenaZvezda",
  "SpartaPraha",
  "SlaviaPraha",
  "Ferencvaros",
  "Ludogorets",
];

export const dynamic = 'force-dynamic';

// GET: sadece durum sorgulama
export async function GET() {
  return NextResponse.json({ ok: true, jobs: [] });
}

export const POST = adminRoute(async (request: Request) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const action = body.action;

  // Fetch from elofootball.com by country
  if (action === "fetch-elo-football") {
    const { fetchEloRatings, EUROPEAN_COUNTRIES } = await import('@/lib/eloFootball');
    const countryIso = body.countryIso || 'TUR';
    const season = body.season || '2025-2026';
    const ratings = await fetchEloRatings(countryIso, season);
    const countryName = EUROPEAN_COUNTRIES[countryIso] || countryIso;

    if (ratings.length === 0) {
      return NextResponse.json({ ok: false, error: `No data for ${countryName} (${countryIso})` });
    }

    // Import into Elo rating table
    let imported = 0;
    for (const r of ratings) {
      try {
        await db.teamMapping.updateMany({
          where: {
            OR: [
              { canonicalName: { contains: r.team, mode: 'insensitive' } },
              { nesineName: { contains: r.team, mode: 'insensitive' } },
            ],
          },
          data: { eloRating: r.elo, eloSource: 'elofootball' },
        });
        imported++;
      } catch { /* team not found in DB */ }
    }

    return NextResponse.json({
      ok: true,
      source: 'elofootball.com',
      country: countryName,
      countryIso,
      season,
      teamsFound: ratings.length,
      imported,
      ratings: ratings.slice(0, 20), // top 20 in response
    });
  }

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

    // Also write Elo ratings to TeamMapping table
    for (const r of results) {
      await db.teamMapping
        .upsert({
          where: { canonicalName: r.team },
          create: {
            canonicalName: r.team,
            eloRating: r.rating,
            eloSource: r.source,
          },
          update: { eloRating: r.rating, eloSource: r.source },
        })
        .catch((e) => { console.error('[elo-import] teamMapping update error:', e); }); // ignore if team not in mapping
    }

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
    // Also write to TeamMapping
    for (const r of results) {
      await db.teamMapping
        .upsert({
          where: { canonicalName: r.team },
          create: {
            canonicalName: r.team,
            eloRating: r.rating,
            eloSource: r.source,
          },
          update: { eloRating: r.rating, eloSource: r.source },
        })
        .catch((e) => { console.error('[elo-import] teamMapping upsert error:', e); });
    }
    return NextResponse.json({ ok: true, country, imported, failed, results });
  }

  // Fetch ALL teams from TeamMapping as background job
  if (action === "fetch-all-mappings") {
    const mappings = await db.teamMapping.findMany({
      select: { canonicalName: true },
    });
    const teams = mappings.map((m) => m.canonicalName);

    const job = await db.eloImportJob.create({
      data: { status: "running", totalTeams: teams.length },
    });
    void startEloImport(teams, job.id);

    return NextResponse.json({ ok: true, jobId: job.id, total: teams.length });
  }

  // Poll job progress
  if (action === "job-progress") {
    const jobId = body.jobId;
    if (!jobId)
      return NextResponse.json({ error: "jobId required" }, { status: 400 });
    const job = await getJobProgress(jobId);
    if (!job)
      return NextResponse.json({ error: "job not found" }, { status: 404 });
    return NextResponse.json(job);
  }

  return NextResponse.json(
    {
      error:
        "Unknown action. Use: fetch, manual, fetch-league, fetch-all-mappings",
    },
    { status: 400 },
  );
});
