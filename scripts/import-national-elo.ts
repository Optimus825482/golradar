#!/usr/bin/env bun
/**
 * Eloratings.net'ten milli takim Elo ratinglerini ceker.
 * Kaynak: https://www.eloratings.net/World.tsv
 *
 * Kullanim:
 *   bun scripts/import-national-elo.ts
 *
 * TSV format (tab-separated, no header):
 *   Col 1: display_rank
 *   Col 2: actual_rank
 *   Col 3: country_code (2-letter ISO)
 *   Col 4: current_elo
 *   ... (historical data)
 */

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
  NS: 'Nassau', CW: 'Curacao', SR: 'Suriname', KZ: 'Kazakhstan', CN: 'China',
  KD: 'Kurdistan', LY: 'Libya', GM: 'Gambia', BH: 'Bahrain', QA: 'Qatar',
  BJ: 'Benin', GA: 'Gabon', UG: 'Uganda', TT: 'Trinidad', FO: 'Faroe Islands',
  NE: 'Niger', MG: 'Madagascar', GQ: 'Equatorial Guinea', TG: 'Togo', TH: 'Thailand',
  KP: 'North Korea', KM: 'Comoros', AM: 'Armenia', ZW: 'Zimbabwe', ID: 'Indonesia',
  ZM: 'Zambia', KE: 'Kenya', EE: 'Estonia', VN: 'Vietnam', SD: 'Sudan',
  RE: 'Reunion', SV: 'El Salvador', MZ: 'Mozambique', SL: 'Sierra Leone',
  GP: 'Guadeloupe', RW: 'Rwanda', NI: 'Nicaragua', KW: 'Kuwait', MR: 'Mauritania',
  AZ: 'Azerbaijan', ZN: 'Zanzibar', CY: 'Cyprus', TZ: 'Tanzania', MQ: 'Martinique',
  LR: 'Liberia', NA: 'Namibia', KG: 'Kyrgyzstan', MY: 'Malaysia', GY: 'Guyana',
  LB: 'Lebanon', LV: 'Latvia', ET: 'Ethiopia', NC: 'New Caledonia', TJ: 'Tajikistan',
  BI: 'Burundi', DO: 'Dominican Republic', LT: 'Lithuania', MD: 'Moldova',
  BW: 'Botswana', MT: 'Malta', GW: 'Guinea-Bissau', CU: 'Cuba', MW: 'Malawi',
  CF: 'Central African Republic', GF: 'French Guiana', YT: 'Mayotte', TM: 'Turkmenistan',
  CG: 'Congo', ER: 'Eritrea', LS: 'Lesotho', YE: 'Yemen', PH: 'Philippines',
  TI: 'Tibet', SW: 'Swaziland', VC: 'St Vincent', PG: 'Papua New Guinea',
  PR: 'Puerto Rico', SG: 'Singapore', IN: 'India', BM: 'Bermuda', VU: 'Vanuatu',
  SS: 'South Sudan', FJ: 'Fiji', HK: 'Hong Kong', GD: 'Grenada', AD: 'Andorra',
  MU: 'Mauritius', TD: 'Chad', BZ: 'Belize', SB: 'Solomon Islands',
  MF: 'St Martin', ST: 'Sao Tome', KN: 'St Kitts', GI: 'Gibraltar',
  JS: 'Jersey', LC: 'St Lucia', EH: 'Western Sahara', MM: 'Myanmar',
  SO: 'Somalia', AW: 'Aruba', SX: 'Sint Maarten', MS: 'Montserrat',
  AF: 'Afghanistan', GL: 'Greenland', BD: 'Bangladesh', DJ: 'Djibouti',
  DM: 'Dominica', PK: 'Pakistan', MC: 'Monaco', BB: 'Barbados', AG: 'Antigua',
  LI: 'Liechtenstein', NP: 'Nepal', KH: 'Cambodia', SC: 'Seychelles',
  LK: 'Sri Lanka', SM: 'San Marino', TW: 'Taiwan', BQ: 'Bonaire',
  MV: 'Maldives', KY: 'Cayman Islands', HG: 'HG', TV: 'Tuvalu', VG: 'British Virgin Islands',
  EU: 'Europe', LA: 'Laos', TL: 'East Timor', WS: 'Samoa', MN: 'Mongolia',
  BL: 'St Barthelemy', GU: 'Guam', WF: 'Wallis and Futuna', VA: 'Vatican',
  AB: 'Abkhazia', BS: 'Bahamas', PM: 'St Pierre', TC: 'Turks and Caicos',
  AI: 'Anguilla', TE: 'TE', VI: 'US Virgin Islands', BT: 'Bhutan',
  CK: 'Cook Islands', MO: 'Macau', CX: 'Christmas Island', BN: 'Brunei',
  FK: 'Falkland Islands', FM: 'Micronesia', MH: 'Marshall Islands', KI: 'Kiribati',
  TO: 'Tonga', NU: 'Niue', MP: 'Northern Mariana Islands', CC: 'Cocos Islands',
  PW: 'Palau', AS: 'American Samoa',
};

import { db } from '../src/lib/db';

async function run() {
  console.error('Fetching World.tsv from eloratings.net...');
  const resp = await fetch('https://www.eloratings.net/World.tsv', { cache: 'no-store' });
  if (!resp.ok) { console.error(JSON.stringify({ error: `HTTP ${resp.status}` })); process.exit(1); }

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

  console.log(JSON.stringify({ ok: true, imported, skipped, total: lines.length }));
}

run().catch((e) => {
  console.error(JSON.stringify({ error: String(e) }));
  process.exit(1);
});
