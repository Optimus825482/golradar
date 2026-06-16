// ── Elo Import Background Job ──────────────────────────────────────
// Runs in a separate async context. Writes progress to EloImportJob
// table so the admin panel can poll for updates. Survives page close
// because it's a server-side long-running task, not a request-bound one.

import { db } from "./db";
import { fetchTeamRating } from "./eloFetcher";
import { bulkSetRatings } from "./eloRating";

export async function startEloImport(
  teams: string[],
  jobId: string,
): Promise<void> {
  // Mark job as running
  await db.eloImportJob.update({
    where: { id: jobId },
    data: { status: "running", totalTeams: teams.length },
  });

  let fetched = 0;
  let failed = 0;
  const results: Array<{ team: string; rating: number; source: string }> = [];

  // Process in batches of 5 with 500ms delay
  for (let i = 0; i < teams.length; i += 5) {
    const batch = teams.slice(i, i + 5);
    const promises = batch.map(async (team) => {
      const result = await fetchTeamRating(team);
      if (result) {
        results.push(result);
        fetched++;
      } else {
        failed++;
      }
      return result;
    });
    await Promise.all(promises);

    // Update progress
    const done = i + 5 > teams.length ? teams.length : i + 5;
    const progressPct = Math.round((done / teams.length) * 100);
    await db.eloImportJob
      .update({
        where: { id: jobId },
        data: {
          fetchedTeams: fetched,
          failedTeams: failed,
          currentTeam: batch[0] ?? null,
          progressPct,
        },
      })
      .catch(() => {}); // Don't fail if DB is slow

    if (i + 5 < teams.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Save ratings
  if (results.length > 0) {
    bulkSetRatings(results.map((r) => ({ team: r.team, rating: r.rating })));
  }

  // Write to TeamMapping
  for (const r of results) {
    await db.teamMapping
      .update({
        where: { canonicalName: r.team },
        data: { eloRating: r.rating, eloSource: r.source },
      })
      .catch(() => {});
  }

  // Mark job done
  await db.eloImportJob
    .update({
      where: { id: jobId },
      data: {
        status: "done",
        fetchedTeams: fetched,
        failedTeams: failed,
        currentTeam: null,
        progressPct: 100,
        resultJson: JSON.stringify({
          fetched,
          failed,
          teams: results
            .slice(0, 50)
            .map((r) => ({ team: r.team, rating: r.rating, source: r.source })),
        }),
        finishedAt: new Date(),
      },
    })
    .catch(() => {});
}

export async function getJobProgress(jobId: string) {
  return db.eloImportJob.findUnique({ where: { id: jobId } });
}
