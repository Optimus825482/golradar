#!/usr/bin/env bun
/**
 * Export edilmis footballdb verilerini sunucuda import et.
 *
 * Kaynak: data/footballdb-export.json
 * Hedef: FootballdbClub tablosu + TeamRating.elo
 *
 * Kullanim:
 *   bun scripts/import-footballdb-data.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { db } from '../src/lib/db';

async function run() {
  const path = join(process.cwd(), 'data', 'footballdb-export.json');
  const raw = readFileSync(path, 'utf-8');
  const data = JSON.parse(raw);

  // FootballdbClub upsert
  let cDone = 0;
  for (const club of data.clubs) {
    try {
      await db.footballdbClub.upsert({
        where: { slug: club.slug },
        create: club,
        update: club,
      });
      cDone++;
      if (cDone % 500 === 0) console.error(`  Clubs: ${cDone}/${data.clubs.length}`);
    } catch {}
  }
  console.error(`✅ FootballdbClub: ${cDone}/${data.clubs.length}`);

  // TeamRating.elo guncelle
  let rDone = 0;
  for (const r of data.teamRatings) {
    try {
      await db.teamRating.updateMany({
        where: { teamName: r.teamName },
        data: { elo: r.elo },
      });
      rDone++;
      if (rDone % 500 === 0) console.error(`  Ratings: ${rDone}/${data.teamRatings.length}`);
    } catch {}
  }
  console.error(`✅ TeamRating.elo: ${rDone}/${data.teamRatings.length}`);

  console.log(JSON.stringify({ ok: true, clubs: cDone, ratings: rDone }));
}

run().catch((e) => {
  console.error(JSON.stringify({ error: String(e) }));
  process.exit(1);
});
