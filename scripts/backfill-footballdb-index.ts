#!/usr/bin/env bun
/**
 * footballdatabase.com TUM klub indeksini cek + periyodik kaydet.
 *
 * Her 500 kulüpte bir JSON + DB'ye auto-save yapar.
 * Yarıda kalsa bile veri kaybolmaz.
 *
 * Kullanım:
 *   bun scripts/backfill-footballdb-index.ts           # JSON'a kaydeder
 *   bun scripts/backfill-footballdb-index.ts --persist # JSON + DB
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Tek dunya siralamasi: /ranking/world/1 ... /ranking/world/62 (3100 klub)
const TOTAL_WORLD_PAGES = 62;
const CONTINENTS: Record<string, string> = { world: 'World' };

interface ClubEntry { name: string; slug: string; country: string; countryIso: string; points: number; continent: string; }

/** Sayfadaki pagination'dan son sayfa numarasini bul, yoksa null */
function getMaxPage(html: string): number | null {
  const links: number[] = [];
  const re = /<a href="\/ranking\/[^/]+\/(\d+)"[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    links.push(parseInt(m[1], 10));
  }
  return links.length > 0 ? Math.max(...links) : null;
}

/** Sayfa gecerli mi? (50 klub normal, son sayfalar 19'a kadar duser) */
function isValidPage(clubs: ClubEntry[]): boolean {
  // 19'dan az = reklam/redirect sayfasi
  return clubs.length >= 15;
}

async function scrapePage(continent: string, page: number): Promise<{ clubs: ClubEntry[] }> {
  const url = `https://www.footballdatabase.com/ranking/${continent}/${page}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return { clubs: [] };
    const html = await resp.text();
    const clubs: ClubEntry[] = [];
    const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/g;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const rh = rowMatch[0];
      const link = rh.match(/\/clubs-ranking\/([a-z0-9-]+)/);
      if (!link) continue;
      const pts = rh.match(/<td class="rank">(\d{3,4})<\/td>/);
      if (!pts) continue;
      const title = rh.match(/title="([^"]+)"/);
      if (!title) continue;
      const iso = rh.match(/flags\/16\/([^.]+)\./);
      const t = title[1].replace(/&#(\d+);/g, (_, c: string) => String.fromCharCode(parseInt(c)));
      const cm = t.match(/\(([^)]+)\)$/);
      clubs.push({
        name: t.replace(/\([^)]+\)$/, '').trim(),
        slug: link[1],
        country: cm ? cm[1] : '',
        countryIso: iso ? iso[1] : '',
        points: parseInt(pts[1], 10),
        continent,
      });
    }
    // Sayfa gecersizse (reklam/redirect) clubs'i bos gonder
    if (!isValidPage(clubs)) return { clubs: [] };
    return { clubs };
  } catch {
    return { clubs: [] };
  }
}

async function persistBatch(db: any, clubs: ClubEntry[]): Promise<void> {
  let done = 0;
  for (const c of clubs) {
    try {
      await db.footballdbClub.upsert({
        where: { slug: c.slug },
        create: { ...c },
        update: { ...c },
      });
      done++;
    } catch {}
  }
}

async function run() {
  const PERSIST = process.argv.includes('--persist');
  const allClubs: ClubEntry[] = [];
  const dataDir = join(process.cwd(), 'data');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const jsonPath = join(dataDir, 'footballdb-clubs.json');
  const SAVE_EVERY = 500;
  let db: any = null;
  if (PERSIST) {
    const m = await import('../src/lib/db');
    db = m.db;
  }

  for (const [ckey, clabel] of Object.entries(CONTINENTS)) {
    console.error(`Scraping ${clabel}...`);
    // Dunya siralamasi 62 sayfa, maxPage'i bulmaya gerek yok
    let page = 1, total = 0;
    while (page <= TOTAL_WORLD_PAGES) {
      const { clubs } = await scrapePage(ckey, page, TOTAL_WORLD_PAGES);
      if (clubs.length === 0) break;
      allClubs.push(...clubs);
      total += clubs.length;
      console.error(`  Page ${page}: ${clubs.length} clubs (total: ${total})`);

      // Auto-save every SAVE_EVERY clubs
      const prevTotal = allClubs.length - clubs.length;
      if (Math.floor(prevTotal / SAVE_EVERY) < Math.floor(allClubs.length / SAVE_EVERY)) {
        writeFileSync(jsonPath, JSON.stringify(allClubs, null, 2));
        if (db) await persistBatch(db, allClubs.slice(-SAVE_EVERY));
        console.error(`  [AutoSave] ${allClubs.length} clubs`);
      }
      page++;
      await new Promise((r) => setTimeout(r, 200 + Math.random() * 150));
    }
    console.error(`  ${clabel}: ${total} clubs`);
  }

  // Final save
  writeFileSync(jsonPath, JSON.stringify(allClubs, null, 2));
  console.error(`\nSaved ${allClubs.length} clubs to ${jsonPath}`);
  if (db && allClubs.length > 0) {
    await persistBatch(db, allClubs);
    console.error(`Persisted ${allClubs.length} clubs to DB`);
  }
  console.log(JSON.stringify({ ok: true, totalClubs: allClubs.length, persisted: !!PERSIST }));
}

run().catch((e) => {
  console.error(JSON.stringify({ error: String(e) }));
  process.exit(1);
});
