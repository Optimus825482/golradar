#!/usr/bin/env bun
/**
 * footballdatabase.com TUM kulüp indeksini çek.
 *
 * Kaynak: /ranking/europe/{page}, /ranking/south-america/{page}, ...
 * Her sayfada 50 kulüp: adı, slug'ı, ülkesi ve puanı (Elo).
 *
 * Çıktı: data/footballdb-clubs.json (tüm kulüpler + slug + puan)
 *   + --persist ile TeamFootballdbIndex tablosuna yaz (opsiyonel)
 *
 * Kullanım:
 *   bun scripts/backfill-footballdb-index.ts                    # dry-run (sadece JSON)
 *   bun scripts/backfill-footballdb-index.ts --persist          # DB'ye de yaz
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const CONTINENTS: Record<string, string> = {
  europe: 'Europe',
  'south-america': 'South America',
  'north-america': 'North America',
  asia: 'Asia',
  africa: 'Africa',
  oceania: 'Oceania',
};

interface ClubEntry {
  name: string;
  slug: string;
  country: string;
  countryIso: string;
  points: number;
  continent: string;
}

async function scrapePage(continent: string, page: number): Promise<ClubEntry[]> {
  const url = `https://www.footballdatabase.com/ranking/${continent}/${page}`;
  const clubs: ClubEntry[] = [];

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return clubs;
    const html = await resp.text();

    // Her <tr> satirini ayri isle — reklam satirlarini otomatik atlar
    const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/g;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const rowHtml = rowMatch[0];

      // Club linki var mi?
      const link = rowHtml.match(/\/clubs-ranking\/([a-z0-9-]+)/);
      if (!link) continue;

      // Puan
      const pts = rowHtml.match(/<td class="rank">(\d{3,4})<\/td>/);
      if (!pts) continue;

      // Baslik: "Bayern München (Germany)"
      const title = rowHtml.match(/title="([^"]+)"/);
      if (!title) continue;

      // Ulke ISO kodu: flags/16/GER.png
      const iso = rowHtml.match(/flags\/16\/([^.]+)\./);

      const titleStr = title[1].replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c)); // HTML entities coz
      const countryMatch = titleStr.match(/\(([^)]+)\)$/);
      const country = countryMatch ? countryMatch[1] : '';
      const name = titleStr.replace(/\([^)]+\)$/, '').trim();

      clubs.push({
        name,
        slug: link[1],
        country,
        countryIso: iso ? iso[1] : '',
        points: parseInt(pts[1], 10),
        continent,
      });
    }
  } catch (e) {
    // sayfa yok veya timeout
  }

  return clubs;
}

async function run() {
  const PERSIST = process.argv.includes('--persist');
  const allClubs: ClubEntry[] = [];

  for (const [continentKey, continentLabel] of Object.entries(CONTINENTS)) {
    console.error(`Scraping ${continentLabel}...`);
    let page = 1;
    let totalOnContinent = 0;
    while (true) {
      const clubs = await scrapePage(continentKey, page);
      if (clubs.length === 0) break; // sayfa bitti
      allClubs.push(...clubs);
      totalOnContinent += clubs.length;
      console.error(`  Page ${page}: ${clubs.length} clubs (total: ${totalOnContinent})`);
      page++;
      // Rate limit korumasi
      await new Promise((r) => setTimeout(r, 500 + Math.random() * 300));
    }
    console.error(`  ${continentLabel}: ${totalOnContinent} clubs total`);
  }

  // JSON olarak kaydet
  const dataDir = join(process.cwd(), 'data');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const jsonPath = join(dataDir, 'footballdb-clubs.json');
  writeFileSync(jsonPath, JSON.stringify(allClubs, null, 2));
  console.error(`\nSaved ${allClubs.length} clubs to ${jsonPath}`);

  // --persist ile DB'ye de yaz
  if (PERSIST) {
    const { db } = await import('../src/lib/db');
    let inserted = 0;
    for (const club of allClubs) {
      await db.footballdbClub.upsert({
        where: { slug: club.slug },
        create: {
          slug: club.slug,
          name: club.name,
          country: club.country,
          countryIso: club.countryIso,
          points: club.points,
          continent: club.continent,
        },
        update: {
          name: club.name,
          country: club.country,
          countryIso: club.countryIso,
          points: club.points,
          continent: club.continent,
        },
      }).catch(() => {});
      inserted++;
      if (inserted % 500 === 0) console.error(`  DB: ${inserted}/${allClubs.length}`);
    }
    console.error(`✅ DB: ${inserted} clubs upserted.`);
  }

  console.log(JSON.stringify({
    ok: true,
    totalClubs: allClubs.length,
    continents: Object.keys(CONTINENTS).length,
    persisted: PERSIST,
    jsonPath,
  }));
}

run().catch((e) => {
  console.error(JSON.stringify({ error: String(e) }));
  process.exit(1);
});
