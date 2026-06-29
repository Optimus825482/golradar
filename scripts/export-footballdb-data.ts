#!/usr/bin/env bun
/**
 * FootballdbClub + TeamRating.elo verilerini JSON'a export et.
 *
 * Cikti: data/footballdb-export.json (~2MB)
 *   {
 *     clubs: FootballdbClub[],
 *     teamRatings: { teamName, elo }[]
 *   }
 *
 * Kullanim:
 *   bun scripts/export-footballdb-data.ts
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { db } from '../src/lib/db';

async function run() {
  const clubs = await db.footballdbClub.findMany({
    select: { slug: true, name: true, country: true, countryIso: true, points: true, continent: true },
  });

  const teamRatings = await db.teamRating.findMany({
    where: { elo: { not: 1500 } },
    select: { teamName: true, elo: true },
  });

  const out = { clubs, teamRatings, exportedAt: new Date().toISOString() };
  const path = join(process.cwd(), 'data', 'footballdb-export.json');
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.error(`✅ Exported ${clubs.length} clubs + ${teamRatings.length} ratings`);
  console.log(JSON.stringify({ ok: true, path, clubs: clubs.length, ratings: teamRatings.length }));
}

run().catch((e) => {
  console.error(JSON.stringify({ error: String(e) }));
  process.exit(1);
});
