// ── Admin: National Team Elo Ratings API ─────────────────────────
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Country code → name mapping (from scripts/import-national-elo.ts)
const COUNTRY_NAMES: Record<string, string> = {
  AR: 'Argentina', ES: 'Spain', FR: 'France', EN: 'England', BR: 'Brazil',
  CO: 'Colombia', PT: 'Portugal', NL: 'Netherlands', NO: 'Norway', CH: 'Switzerland',
  MX: 'Mexico', DE: 'Germany', HR: 'Croatia', EC: 'Ecuador', JP: 'Japan',
  BE: 'Belgium', MA: 'Morocco', DK: 'Denmark', IT: 'Italy', TR: 'Turkey',
  SN: 'Senegal', UY: 'Uruguay', AT: 'Austria', PY: 'Paraguay', AU: 'Australia',
  DZ: 'Algeria', US: 'United States', UA: 'Ukraine', RU: 'Russia', NG: 'Nigeria',
  IR: 'Iran', CA: 'Canada', SQ: 'Scotland', GR: 'Greece', CI: "Cote d'Ivoire",
  SE: 'Sweden', EG: 'Egypt', RS: 'Serbia', VE: 'Venezuela', KR: 'South Korea',
  KO: 'Kosovo', CD: 'DR Congo', HU: 'Hungary', PL: 'Poland', PE: 'Peru',
  IE: 'Ireland', WA: 'Wales', SI: 'Slovenia', CZ: 'Czech Republic', SK: 'Slovakia',
  PA: 'Panama', GE: 'Georgia', IL: 'Israel', RO: 'Romania', UZ: 'Uzbekistan',
  JO: 'Jordan', BA: 'Bosnia', CV: 'Cape Verde', BO: 'Bolivia', AL: 'Albania',
  CM: 'Cameroon', CR: 'Costa Rica', EI: 'Northern Ireland', SA: 'Saudi Arabia',
  NM: 'Namibia', ML: 'Mali', GH: 'Ghana', HN: 'Honduras', IS: 'Iceland',
  TN: 'Tunisia', IQ: 'Iraq', ZA: 'South Africa', AO: 'Angola', AE: 'UAE',
  FI: 'Finland', NZ: 'New Zealand', BF: 'Burkina Faso', JM: 'Jamaica',
  BY: 'Belarus', HT: 'Haiti', GT: 'Guatemala', OM: 'Oman', SY: 'Syria',
  PS: 'Palestine', GN: 'Guinea', ME: 'Montenegro', BG: 'Bulgaria', LU: 'Luxembourg',
  KZ: 'Kazakhstan', CN: 'China', LY: 'Libya', GM: 'Gambia', BH: 'Bahrain',
  QA: 'Qatar', BJ: 'Benin', GA: 'Gabon', UG: 'Uganda', TT: 'Trinidad',
  FO: 'Faroe Islands', NE: 'Niger', MG: 'Madagascar', GQ: 'Equatorial Guinea',
  TG: 'Togo', TH: 'Thailand', ZW: 'Zimbabwe', ID: 'Indonesia',
  ZM: 'Zambia', KE: 'Kenya', EE: 'Estonia', VN: 'Vietnam', SD: 'Sudan',
  SV: 'El Salvador', MZ: 'Mozambique', SL: 'Sierra Leone', RW: 'Rwanda',
  NI: 'Nicaragua', MR: 'Mauritania', AZ: 'Azerbaijan', CY: 'Cyprus',
  TZ: 'Tanzania', LR: 'Liberia', KG: 'Kyrgyzstan', MY: 'Malaysia',
  GY: 'Guyana', LB: 'Lebanon', LV: 'Latvia', ET: 'Ethiopia', TJ: 'Tajikistan',
  BI: 'Burundi', DO: 'Dominican Republic', LT: 'Lithuania', MD: 'Moldova',
  BW: 'Botswana', MT: 'Malta', GW: 'Guinea-Bissau', CU: 'Cuba', MW: 'Malawi',
  CF: 'Central African Republic', CG: 'Congo', ER: 'Eritrea', LS: 'Lesotho',
  YE: 'Yemen', PH: 'Philippines', PG: 'Papua New Guinea',
  SG: 'Singapore', IN: 'India', BM: 'Bermuda', VU: 'Vanuatu',
  SS: 'South Sudan', FJ: 'Fiji', HK: 'Hong Kong', MU: 'Mauritius',
  TD: 'Chad', BZ: 'Belize', SB: 'Solomon Islands',
  KN: 'St Kitts', LC: 'St Lucia', MM: 'Myanmar',
  SO: 'Somalia', AF: 'Afghanistan', PK: 'Pakistan',
  NP: 'Nepal', KH: 'Cambodia', LK: 'Sri Lanka', SM: 'San Marino',
  MV: 'Maldives', LA: 'Laos', TL: 'East Timor', MN: 'Mongolia',
  BS: 'Bahamas', BT: 'Bhutan', BN: 'Brunei',
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit = Math.min(200, parseInt(searchParams.get('limit') ?? '50'));
  const search = searchParams.get('search') ?? '';

  const where = search
    ? { OR: [
        { countryName: { contains: search, mode: 'insensitive' as const } },
        { countryCode: { contains: search, mode: 'insensitive' as const } },
      ]}
    : {};

  const [total, rows] = await Promise.all([
    db.nationalTeamElo.count({ where }),
    db.nationalTeamElo.findMany({
      where,
      orderBy: { rank: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return NextResponse.json({ rows, total, page, totalPages: Math.ceil(total / limit) });
}

export async function POST() {
  try {
    const resp = await fetch('https://www.eloratings.net/World.tsv', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) {
      return NextResponse.json({ ok: false, error: `HTTP ${resp.status}` }, { status: 502 });
    }
    const text = await resp.text();
    const lines = text.trim().split('\n');
    let imported = 0, skipped = 0;

    for (const line of lines) {
      const cols = line.split('\t');
      if (cols.length < 4) continue;
      const rank = parseInt(cols[0], 10);
      const code = cols[2]?.trim();
      const elo = parseInt(cols[3], 10);
      if (!code || isNaN(rank) || isNaN(elo)) { skipped++; continue; }

      const name = COUNTRY_NAMES[code];
      if (!name) { skipped++; continue; }

      await db.nationalTeamElo.upsert({
        where: { countryCode: code },
        create: { countryCode: code, countryName: name, elo, rank },
        update: { elo, rank, lastUpdated: new Date() },
      });
      imported++;
    }

    return NextResponse.json({ ok: true, imported, skipped, total: lines.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
