// ── Unified Team Name Normalizer ────────────────────────────────
// Extracted from fotmob.ts, netscores.ts, scoremer.ts to eliminate
// ~500 lines of triplicated code.

/** Normalize a team name: lowercase, remove diacritics, strip punctuation */
export function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[áàâä]/g, "a")
    .replace(/[éèêë]/g, "e")
    .replace(/[íìîï]/g, "i")
    .replace(/[óòôö]/g, "o")
    .replace(/[úùûü]/g, "u")
    .replace(/[çč]/g, "c")
    .replace(/[š]/g, "s")
    .replace(/[ž]/g, "z")
    .replace(/[ñ]/g, "n")
    .replace(/[ğ]/g, "g")
    .replace(/[ı]/g, "i")
    .replace(/[ö]/g, "o")
    .replace(/[ü]/g, "u")
    .replace(/[ş]/g, "s")
    .replace(/[ç]/g, "c")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Turkish → English name translations (countries + clubs)
const TEAM_NAME_MAP: Record<string, string> = {
  "türkiye": "turkey",
  "almanya": "germany",
  "ingiltere": "england",
  "fransa": "france",
  "ispanya": "spain",
  "italya": "italy",
  "brezilya": "brazil",
  "arjantin": "argentina",
  "portekiz": "portugal",
  "hollanda": "netherlands",
  "belçika": "belgium",
  "hirvatistan": "croatia",
  "sırbistan": "serbia",
  "karadağ": "montenegro",
  "makedonya": "macedonia",
  "bosna": "bosnia",
  "arnavutluk": "albania",
  "yunanistan": "greece",
  "rusya": "russia",
  "ukrayna": "ukraine",
  "polonya": "poland",
  "çekya": "czech republic",
  "avusturya": "austria",
  "isviçre": "switzerland",
  "danimarka": "denmark",
  "isveç": "sweden",
  "norveç": "norway",
  "finlandiya": "finland",
  "irlanda": "ireland",
  "galler": "wales",
  "iskoçya": "scotland",
  "kuzey irlanda": "northern ireland",
  "güney kore": "south korea",
  "japonya": "japan",
  "çin": "china",
  "avustralya": "australia",
  "meksika": "mexico",
  "kolombiya": "colombia",
  "şili": "chile",
  "peru": "peru",
  "ekvador": "ecuador",
  "uruguay": "uruguay",
  "paraguay": "paraguay",
  "venezuela": "venezuela",
  "nijerya": "nigeria",
  "gana": "ghana",
  "kamerun": "cameroon",
  "fas": "morocco",
  "mısır": "egypt",
  "tunus": "tunisia",
  "cezayir": "algeria",
  "güney afrika": "south africa",
  "iran": "iran",
  "irak": "iraq",
  "suudi arabistan": "saudi arabia",
  "katar": "qatar",
  "b.a.e": "united arab emirates",
  "abd": "united states",
  "kanada": "canada",
  "kosta rika": "costa rica",
  "jamaika": "jamaica",
  "panama": "panama",
  "honduras": "honduras",
  "küba": "cuba",
  "izlanda": "iceland",
  "lüksenburg": "luxembourg",
  "türkmenistan": "turkmenistan",
  "özbekistan": "uzbekistan",
  "kırgızistan": "kyrgyzstan",
  "kazakistan": "kazakhstan",
  "azerbaycan": "azerbaijan",
  "gürcistan": "georgia",
  "ermeni̇stan": "armenia",
  "kıbrıs": "cyprus",
  "lübnan": "lebanon",
  "ürdün": "jordan",
  "suriye": "syria",
  "filistin": "palestine",
  // Turkish club name mappings
  "galatasaray": "galatasaray",
  "fenerbahçe": "fenerbahce",
  "beşiktaş": "besiktas",
  "trabzonspor": "trabzonspor",
  "başakşehir": "basaksehir",
  "kasımpaşa": "kasimpasa",
  "konyaspor": "konyaspor",
  "sivasspor": "sivasspor",
  "antalyaspor": "antalyaspor",
  "kayserispor": "kayserispor",
  "adanademirspor": "adanademirspor",
  "hatayspor": "hatayspor",
  "gaziantep fk": "gaziantep fk",
  "pendikspor": "pendikspor",
  "istanbulspor": "istanbulspor",
  "karagümrük": "karagumruk",
  "altyaspor": "altayspor",
  "özgür medya": "ozgur medya",
};

/** Translate Turkish team name to English, normalizing first */
function translateTeamName(name: string): string {
  const normalized = normalizeTeamName(name);
  return TEAM_NAME_MAP[normalized] || normalized;
}

/** Jaccard similarity for team name matching */
export function nameSimilarity(a: string, b: string): number {
  const na = translateTeamName(a);
  const nb = normalizeTeamName(b);

  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.85;

  const wordsA = new Set(na.split(" "));
  const wordsB = new Set(nb.split(" "));
  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}
