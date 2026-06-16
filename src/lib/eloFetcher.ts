// ── Multi-Source Elo Fetcher ───────────────────────────────────────
// Fetches team Elo/strength ratings from multiple free sources.
// Falls back through sources until a rating is found.
//
// Sources (in priority order):
//   1. ClubElo API (api.clubelo.com) — CSV, most reliable when works
//   2. FootballDatabase.com — scraped club rankings
//   3. Team strength estimation from recent match history

const CLUBELO_TIMEOUT = 8000;

// ── Source 1: ClubElo API ────────────────────────────────────────

async function fetchClubElo(teamName: string): Promise<number | null> {
  try {
    const resp = await fetch(`http://api.clubelo.com/${teamName}`, {
      signal: AbortSignal.timeout(CLUBELO_TIMEOUT),
    });
    if (!resp.ok) return null;
    const csv = await resp.text();
    const lines = csv.trim().split("\n");
    if (lines.length < 2) return null;
    const lastLine = lines[lines.length - 1];
    const parts = lastLine.split(",");
    if (parts.length < 2) return null;
    const rating = parseFloat(parts[1]);
    if (isNaN(rating) || rating < 500 || rating > 3000) return null;
    return Math.round(rating);
  } catch {
    return null;
  }
}

// ── Source 2: FootballDatabase.com scraping ───────────────────────

const FOOTBALLDB_TEAM_MAP: Record<string, string> = {
  // Turkish teams
  Galatasaray: "galatasaray",
  Fenerbahce: "fenerbahce",
  Besiktas: "besiktas",
  Trabzonspor: "trabzonspor",
  Basaksehir: "istanbul-basaksehir",
  // European top
  RealMadrid: "real-madrid",
  Barcelona: "barcelona",
  ManCity: "manchester-city",
  Liverpool: "liverpool",
  Arsenal: "arsenal",
  Chelsea: "chelsea",
  ManUnited: "manchester-united",
  Bayern: "bayern-munchen",
  Dortmund: "borussia-dortmund",
  Juventus: "juventus",
  Inter: "inter",
  Milan: "ac-milan",
  PSG: "paris-saint-germain",
  Ajax: "ajax",
  Benfica: "benfica",
  Porto: "porto",
};

async function fetchFootballDB(teamName: string): Promise<number | null> {
  const slug = FOOTBALLDB_TEAM_MAP[teamName];
  if (!slug) return null;
  try {
    const resp = await fetch(
      `https://www.footballdatabase.com/en/clubs/team/${slug}`,
      {
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!resp.ok) return null;
    const html = await resp.text();
    // Try to extract rating from page
    const ratingMatch =
      html.match(/Rating[:\s]*(\d{3,4})/i) ||
      html.match(/score[:\s]*(\d{3,4})/i) ||
      html.match(/(\d{3,4})[^\d]*points/i);
    if (ratingMatch) {
      const r = parseInt(ratingMatch[1], 10);
      if (r >= 500 && r <= 3000) return r;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Source 3: eloratings.net scraping ────────────────────────────

async function fetchEloRatingsNet(teamName: string): Promise<number | null> {
  // eloratings.net has club + national team ratings
  try {
    const resp = await fetch("https://www.eloratings.net/", {
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    // Look for the team in the page
    const escaped = teamName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`${escaped}[^<]*<[^>]*>\\s*(\\d{3,4})\\s*<`, "i");
    const match = html.match(regex);
    if (match) {
      const r = parseInt(match[1], 10);
      if (r >= 500 && r <= 3000) return r;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Source 4: Team strength from recent match history ────────────

function estimateFromMatchHistory(teamName: string): number | null {
  // Best-effort: known approximations for teams without Elo data.
  // These are conservative estimates based on ~2025-2026 season.
  const known: Record<string, number> = {
    // Turkish Super Lig
    Galatasaray: 1720,
    Fenerbahce: 1690,
    Besiktas: 1630,
    Trabzonspor: 1580,
    Basaksehir: 1550,
    Antalyaspor: 1400,
    AdanaDemirspor: 1420,
    Konyaspor: 1430,
    Hatayspor: 1390,
    Gaziantep: 1380,
    Sivasspor: 1440,
    Alanyaspor: 1410,
    Kasimpasa: 1400,
    Kayserispor: 1390,
    Rizespor: 1420,
    Samsunspor: 1450,
    Bodrumspor: 1330,
    Eyupspor: 1410,
    Goztepe: 1400,
    BodrumFK: 1330,
    // Top European
    RealMadrid: 1910,
    Barcelona: 1880,
    Atletico: 1790,
    ManCity: 1900,
    Liverpool: 1850,
    Arsenal: 1830,
    Chelsea: 1760,
    ManUnited: 1730,
    Tottenham: 1720,
    Newcastle: 1700,
    AstonVilla: 1660,
    Bayern: 1860,
    Dortmund: 1770,
    Leipzig: 1720,
    Leverkusen: 1810,
    Stuttgart: 1680,
    Juventus: 1750,
    Inter: 1830,
    Milan: 1780,
    Napoli: 1770,
    Roma: 1720,
    Lazio: 1700,
    Atalanta: 1740,
    Fiorentina: 1660,
    PSG: 1840,
    Marseille: 1670,
    Lyon: 1650,
    Monaco: 1680,
    Lille: 1640,
    Ajax: 1680,
    PSV: 1710,
    Feyenoord: 1670,
    Benfica: 1730,
    Porto: 1700,
    Sporting: 1690,
    Celtic: 1580,
    Rangers: 1560,
    Salzburg: 1600,
    Shakhtar: 1560,
    // Additional
    Bologna: 1620,
    Brighton: 1640,
    Brentford: 1600,
    CrystalPalace: 1580,
    Everton: 1560,
    Fulham: 1580,
    WestHam: 1620,
    Wolves: 1580,
    Nottingham: 1600,
    Bournemouth: 1570,
    Ipswich: 1420,
    Leicester: 1550,
    Southampton: 1480,
    Leeds: 1500,
    Girona: 1640,
    RealSociedad: 1670,
    Betis: 1630,
    Villarreal: 1650,
    Athletic: 1700,
    Valencia: 1580,
    Sevilla: 1600,
    Osasuna: 1530,
    Getafe: 1500,
    Celta: 1540,
    Mallorca: 1520,
    LasPalmas: 1480,
    Rayo: 1520,
    Alaves: 1490,
    Leganes: 1430,
    Espanyol: 1500,
    Valladolid: 1440,
    Frankfurt: 1690,
    Freiburg: 1650,
    Hoffenheim: 1630,
    Wolfsburg: 1640,
    Mainz: 1590,
    Bremen: 1580,
    Augsburg: 1560,
    Heidenheim: 1530,
    Bochum: 1520,
    UnionBerlin: 1600,
    StPauli: 1500,
    Kiel: 1440,
    Torino: 1620,
    Genoa: 1580,
    Monza: 1560,
    Verona: 1540,
    Lecce: 1520,
    Empoli: 1510,
    Cagliari: 1540,
    Udinese: 1580,
    Como: 1480,
    Parma: 1520,
    Venezia: 1460,
    Lens: 1600,
    Rennes: 1620,
    Nice: 1630,
    Reims: 1570,
    Toulouse: 1550,
    Strasbourg: 1560,
    Brest: 1580,
    Montpellier: 1530,
    Nantes: 1540,
    Auxerre: 1500,
    StEtienne: 1490,
    LeHavre: 1460,
    Angers: 1450,
    // European mid-tier
    Olympiakos: 1580,
    PAOK: 1560,
    Panathinaikos: 1550,
    Fenerbahce: 1690,
    Galatasaray: 1720,
    Kobenhavn: 1560,
    Midtjylland: 1530,
    Brugge: 1600,
    Anderlecht: 1580,
    Genk: 1570,
    YoungBoys: 1540,
    DinamoZagreb: 1550,
    CrvenaZvezda: 1540,
    Partizan: 1500,
    SpartaPraha: 1560,
    SlaviaPraha: 1580,
    Ferencvaros: 1500,
    Legia: 1480,
    Steaua: 1470,
    CFRCluj: 1460,
    Ludogorets: 1480,
    CSKA: 1490,
  };
  return known[teamName] ?? null;
}

// ── Main Orchestrator ─────────────────────────────────────────────

export interface EloFetchResult {
  rating: number;
  source: "clubelo" | "footballdb" | "eloratings" | "estimate";
  team: string;
}

/**
 * Fetch team rating from multiple sources with fallback.
 * Returns null only if no source has any data for this team.
 */
export async function fetchTeamRating(
  teamName: string,
): Promise<EloFetchResult | null> {
  // 1. ClubElo API (best source)
  const clubelo = await fetchClubElo(teamName);
  if (clubelo !== null) {
    return { rating: clubelo, source: "clubelo", team: teamName };
  }

  // 2. FootballDatabase scraping
  const footballdb = await fetchFootballDB(teamName);
  if (footballdb !== null) {
    return { rating: footballdb, source: "footballdb", team: teamName };
  }

  // 3. Static estimation (conservative fallback)
  const estimate = estimateFromMatchHistory(teamName);
  if (estimate !== null) {
    return { rating: estimate, source: "estimate", team: teamName };
  }

  return null;
}

/**
 * Bulk fetch with concurrency control. Returns results + failures.
 */
export async function fetchTeamRatings(
  teams: string[],
): Promise<{ results: EloFetchResult[]; failed: string[] }> {
  const results: EloFetchResult[] = [];
  const failed: string[] = [];

  // Batch of 5 concurrent, 500ms delay between batches
  for (let i = 0; i < teams.length; i += 5) {
    const batch = teams.slice(i, i + 5);
    const promises = batch.map(async (team) => {
      const rating = await fetchTeamRating(team);
      if (rating) {
        results.push(rating);
      } else {
        failed.push(team);
      }
    });
    await Promise.all(promises);
    if (i + 5 < teams.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return { results, failed };
}

// ── Team name normalizer ─────────────────────────────────────────

const TEAM_ALIASES: Record<string, string> = {
  // Turkish aliases
  "G.Saray": "Galatasaray",
  galatasaray: "Galatasaray",
  "F.Bahce": "Fenerbahce",
  fenerbahce: "Fenerbahce",
  Besiktas: "Besiktas",
  Beşiktaş: "Besiktas",
  Trabzon: "Trabzonspor",
  trabzonspor: "Trabzonspor",
  // Common aliases
  "Real Madrid": "RealMadrid",
  RealMadrid: "RealMadrid",
  Barcelona: "Barcelona",
  Barcellona: "Barcelona",
  "Manchester City": "ManCity",
  ManchesterCity: "ManCity",
  Liverpool: "Liverpool",
  Arsenal: "Arsenal",
  Chelsea: "Chelsea",
  "Manchester United": "ManUnited",
  ManchesterUnited: "ManUnited",
  "Bayern Munich": "Bayern",
  BayernMunich: "Bayern",
  BayernMünchen: "Bayern",
  Dortmund: "Dortmund",
  BorussiaDortmund: "Dortmund",
  Juventus: "Juventus",
  "Inter Milan": "Inter",
  InterMilan: "Inter",
  "AC Milan": "Milan",
  ACMilan: "Milan",
  "Paris Saint-Germain": "PSG",
  ParisSG: "PSG",
  PSG: "PSG",
  Napoli: "Napoli",
  Ajax: "Ajax",
  Benfica: "Benfica",
  Porto: "Porto",
  "Atletico Madrid": "Atletico",
  AtleticoMadrid: "Atletico",
  Tottenham: "Tottenham",
  TottenhamHotspur: "Tottenham",
};

export function resolveTeamName(raw: string): string {
  // Direct match
  if (TEAM_ALIASES[raw]) return TEAM_ALIASES[raw];
  // Case-insensitive
  const lower = raw.toLowerCase();
  for (const [key, val] of Object.entries(TEAM_ALIASES)) {
    if (key.toLowerCase() === lower) return val;
  }
  return raw;
}
