// ── Elo Import Checkpoint ────────────────────────────────────────
import { db } from './db';

const CHECKPOINT_INTERVAL = 100; // save progress every N teams

let checkpointCounter = 0;
let lastCheckpointTeam = '';

export function shouldCheckpoint(): boolean {
  checkpointCounter++;
  return checkpointCounter >= CHECKPOINT_INTERVAL;
}

export function resetCheckpoint(): void {
  checkpointCounter = 0;
  lastCheckpointTeam = '';
}

export async function saveCheckpoint(jobId: string, team: string, fetched: number, failed: number, total: number): Promise<void> {
  if (!shouldCheckpoint()) return;
  checkpointCounter = 0;
  lastCheckpointTeam = team;
  await db.eloImportJob
    .update({
      where: { id: jobId },
      data: {
        fetchedTeams: fetched,
        failedTeams: failed,
        currentTeam: team,
        progressPct: Math.round((fetched / total) * 100),
      },
    })
    .catch(() => {}); // best-effort
}

export function getLastCheckpointTeam(): string {
  return lastCheckpointTeam;
}
