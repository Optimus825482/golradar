// ── FotMob Team Import ─────────────────────────────────────────────
// Reads docs/fotmob_teams.csv and upserts into TeamMapping.
// Also assigns canonical names using a heuristic name-normalizer.
// Run: npx tsx scripts/import-fotmob-teams.ts

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const db = new PrismaClient();

interface CsvRow {
  fotmobId: number;
  name: string;
  slug: string;
  logoUrl: string;
  country: string;
}

function parseCsv(filePath: string): CsvRow[] {
  const raw = fs.readFileSync(filePath, "utf-8");
  const lines = raw.trim().split("\n");
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // CSV fields: "id","name","slug","url",country,"created_at"
    // Country may be unquoted (empty)
    const match = line.match(
      /"(\d+)","([^"]*)","([^"]*)","([^"]*)",([^,]*),"([^"]*)"/,
    );
    if (!match) continue;
    rows.push({
      fotmobId: parseInt(match[1], 10),
      name: match[2],
      slug: match[3],
      logoUrl: match[4],
      country: match[5].replace(/"/g, ""),
    });
  }
  return rows;
}

// ── Team Name Normalizer ──────────────────────────────────────────

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[àáâãäå]/g, "a")
    .replace(/[èéêë]/g, "e")
    .replace(/[ìíîï]/g, "i")
    .replace(/[òóôõö]/g, "o")
    .replace(/[ùúûü]/g, "u")
    .replace(/ç/g, "c")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Map FotMob names → our canonical key
const CANONICAL_MAP: Record<string, string> = {
  // Turkish
  galatasaray: "Galatasaray",
  fenerbahce: "Fenerbahce",
  besiktas: "Besiktas",
  trabzonspor: "Trabzonspor",
  "istanbul basaksehir": "Basaksehir",
  antalyaspor: "Antalyaspor",
  "adana demirspor": "AdanaDemirspor",
  konyaspor: "Konyaspor",
  hatayspor: "Hatayspor",
  "gaziantep fk": "Gaziantep",
  sivasspor: "Sivasspor",
  alanyaspor: "Alanyaspor",
  kasimpasa: "Kasimpasa",
  kayserispor: "Kayserispor",
  "caykur rizespor": "Rizespor",
  samsunspor: "Samsunspor",
  "bodrum fk": "Bodrumspor",
  eyupspor: "Eyupspor",
  goztepe: "Goztepe",
  // Premier League
  "manchester city": "ManCity",
  liverpool: "Liverpool",
  arsenal: "Arsenal",
  chelsea: "Chelsea",
  "manchester united": "ManUnited",
  "tottenham hotspur": "Tottenham",
  "newcastle united": "Newcastle",
  "aston villa": "AstonVilla",
  "brighton & hove albion": "Brighton",
  "west ham united": "WestHam",
  "crystal palace": "CrystalPalace",
  everton: "Everton",
  fulham: "Fulham",
  brentford: "Brentford",
  "wolverhampton wanderers": "Wolves",
  "nottingham forest": "Nottingham",
  "afc bournemouth": "Bournemouth",
  "leicester city": "Leicester",
  southampton: "Southampton",
  "ipswich town": "Ipswich",
  "leeds united": "Leeds",
  burnley: "Burnley",
  "sheffield united": "SheffUtd",
  // La Liga
  "real madrid": "RealMadrid",
  barcelona: "Barcelona",
  "atletico madrid": "Atletico",
  "athletic club": "Athletic",
  "real sociedad": "RealSociedad",
  villarreal: "Villarreal",
  "real betis": "Betis",
  girona: "Girona",
  valencia: "Valencia",
  sevilla: "Sevilla",
  osasuna: "Osasuna",
  getafe: "Getafe",
  "celta vigo": "Celta",
  mallorca: "Mallorca",
  "las palmas": "LasPalmas",
  "rayo vallecano": "Rayo",
  alaves: "Alaves",
  leganes: "Leganes",
  espanyol: "Espanyol",
  "real valladolid": "Valladolid",
  // Bundesliga
  "bayern munchen": "Bayern",
  "borussia dortmund": "Dortmund",
  "rb leipzig": "Leipzig",
  "bayer leverkusen": "Leverkusen",
  "eintracht frankfurt": "Frankfurt",
  "sc freiburg": "Freiburg",
  "tsg hoffenheim": "Hoffenheim",
  "vfl wolfsburg": "Wolfsburg",
  "fsv mainz 05": "Mainz",
  "werder bremen": "Bremen",
  "fc augsburg": "Augsburg",
  "1 fc heidenheim": "Heidenheim",
  "vfl bochum": "Bochum",
  "union berlin": "UnionBerlin",
  "fc st pauli": "StPauli",
  "holstein kiel": "Kiel",
  "vfb stuttgart": "Stuttgart",
  // Serie A
  juventus: "Juventus",
  inter: "Inter",
  "ac milan": "Milan",
  napoli: "Napoli",
  roma: "Roma",
  lazio: "Lazio",
  atalanta: "Atalanta",
  fiorentina: "Fiorentina",
  torino: "Torino",
  bologna: "Bologna",
  genoa: "Genoa",
  monza: "Monza",
  "hellas verona": "Verona",
  lecce: "Lecce",
  empoli: "Empoli",
  cagliari: "Cagliari",
  udinese: "Udinese",
  parma: "Parma",
  como: "Como",
  venezia: "Venezia",
  // Ligue 1
  "paris saint germain": "PSG",
  marseille: "Marseille",
  lyon: "Lyon",
  monaco: "Monaco",
  lille: "Lille",
  lens: "Lens",
  rennes: "Rennes",
  nice: "Nice",
  reims: "Reims",
  toulouse: "Toulouse",
  strasbourg: "Strasbourg",
  brest: "Brest",
  montpellier: "Montpellier",
  nantes: "Nantes",
  auxerre: "Auxerre",
  "saint etienne": "StEtienne",
  "le havre": "LeHavre",
  angers: "Angers",
  // Other European
  ajax: "Ajax",
  psv: "PSV",
  feyenoord: "Feyenoord",
  benfica: "Benfica",
  porto: "Porto",
  "sporting cp": "Sporting",
  celtic: "Celtic",
  rangers: "Rangers",
  salzburg: "Salzburg",
  "shakhtar donetsk": "Shakhtar",
  "dinamo zagreb": "DinamoZagreb",
  olympiakos: "Olympiakos",
  paok: "PAOK",
  panathinaikos: "Panathinaikos",
  "fc kobenhavn": "Kobenhavn",
  "fc midtjylland": "Midtjylland",
  "club brugge": "Brugge",
  anderlecht: "Anderlecht",
  genk: "Genk",
  "young boys": "YoungBoys",
  "crvena zvezda": "CrvenaZvezda",
  "sparta praha": "SpartaPraha",
  "slavia praha": "SlaviaPraha",
  ferencvaros: "Ferencvaros",
  ludogorets: "Ludogorets",
  steaua: "Steaua",
  "cfr cluj": "CFRCluj",
  legia: "Legia",
};

function toCanonical(fotmobName: string): string {
  const norm = normalize(fotmobName);
  // Direct match
  if (CANONICAL_MAP[norm]) return CANONICAL_MAP[norm];
  // Fallback: same normalized name
  for (const [key, val] of Object.entries(CANONICAL_MAP)) {
    if (key === norm || normalize(val) === norm) return val;
  }
  // For unknown teams: generate a canonical name from FotMob name
  // e.g. "Wolfsberger AC" → "WolfsbergerAc", "FC Inter Turku" → "FcInterTurku"
  return fotmobName
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const csvPath = path.join(process.cwd(), "docs", "fotmob_teams.csv");
  console.log(`[Import] Reading ${csvPath}...`);
  const rows = parseCsv(csvPath);
  console.log(`[Import] Parsed ${rows.length} teams from CSV`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const canonical = toCanonical(row.name);
    if (!canonical) {
      // Team not in our target set — skip (we don't need all 5000+ teams)
      skipped++;
      continue;
    }

    try {
      const existing = await db.teamMapping.findUnique({
        where: { canonicalName: canonical },
      });

      if (existing) {
        // Update with FotMob data
        await db.teamMapping.update({
          where: { canonicalName: canonical },
          data: {
            fotmobId: row.fotmobId,
            fotmobName: row.name,
            fotmobSlug: row.slug,
            fotmobLogoUrl: row.logoUrl,
            country: row.country || undefined,
          },
        });
        updated++;
      } else {
        // New entry
        await db.teamMapping.create({
          data: {
            canonicalName: canonical,
            fotmobId: row.fotmobId,
            fotmobName: row.name,
            fotmobSlug: row.slug,
            fotmobLogoUrl: row.logoUrl,
            country: row.country || undefined,
          },
        });
        inserted++;
      }
    } catch (err: any) {
      console.error(`[Import] Error on ${canonical}: ${err.message}`);
    }
  }

  console.log(
    `[Import] Done. Inserted: ${inserted}, Updated: ${updated}, Skipped: ${skipped}`,
  );
  await db.$disconnect();
}

main().catch((err) => {
  console.error("[Import] Fatal:", err);
  process.exit(1);
});
