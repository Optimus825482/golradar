// ── ML Trainer HTTP Client ─────────────────────────────────────────
// Lightweight wrapper around the FastAPI trainer sidecar. All
// requests have a 30s default timeout — training jobs run for up
// to 60s, so the timeout here is for the kickoff, not the job.
//
// When `ML_TRAINER_URL` is empty, the client no-ops (returns null)
// and the caller falls back to the shipped JSON artifact. This is
// the production default — the sidecar is dev/CI only.

const TRAINER_URL = process.env.ML_TRAINER_URL ?? '';
const DEFAULT_TIMEOUT_MS = 30_000;

export interface TrainRequest {
  name: 'gbdt' | 'xgb' | 'inplay';
  version: string;
  horizon_min: number;
  dataset_path: string;
  n_estimators?: number;
  max_depth?: number;
  learning_rate?: number;
  early_stopping_rounds?: number;
}

export interface JobHandle {
  jobId: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  name: string;
  version: string;
  horizonMin: number;
  artifactPath: string | null;
  metrics: Record<string, number>;
  error: string | null;
  startedAt: number;
  finishedAt: number;
}

async function trainerFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!TRAINER_URL) {
    throw new Error('ML_TRAINER_URL not set; trainer sidecar disabled');
  }
  const url = `${TRAINER_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`trainer ${path} ${resp.status}: ${body.slice(0, 200)}`);
    }
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Trainer liveness. Returns null if the sidecar is disabled. */
export async function checkTrainerHealth(): Promise<{
  ok: boolean;
  uptimeSec: number;
  queuedJobs: number;
  runningJobs: number;
} | null> {
  if (!TRAINER_URL) return null;
  try {
    return await trainerFetch<{
      ok: boolean;
      uptimeSec: number;
      queuedJobs: number;
      runningJobs: number;
    }>('/healthz');
  } catch {
    return null;
  }
}

/** Kick off a training job. Returns the job handle immediately. */
export async function startTraining(req: TrainRequest): Promise<JobHandle | null> {
  if (!TRAINER_URL) return null;
  return trainerFetch<JobHandle>('/train', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

/** Poll a job until it terminates or the deadline elapses. */
export async function pollJob(
  jobId: string,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<JobHandle | null> {
  if (!TRAINER_URL) return null;
  const { timeoutMs = 120_000, pollMs = 2_000 } = opts;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await trainerFetch<JobHandle>(`/jobs/${jobId}`);
    if (job.status === 'success' || job.status === 'failed') return job;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}

/**
 * Mark an artifact file as ready for promotion. The actual
 * DB `isChampion=true` flip happens TS-side in `modelRouter.ts`.
 */
export async function markArtifactReady(
  name: string,
  version: string,
  notes?: string,
): Promise<boolean> {
  if (!TRAINER_URL) return false;
  try {
    await trainerFetch('/promote', {
      method: 'POST',
      body: JSON.stringify({ name, version, notes }),
    });
    return true;
  } catch {
    return false;
  }
}

export const ML_TRAINER_ENABLED = !!TRAINER_URL;
