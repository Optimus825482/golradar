// ── Pressure History Singleton ───────────────────────────────────
// Shared between the /api/matches endpoint (writer) and the
// /api/cron/poll endpoint (reader). Both run in the same
// serverless instance and need access to in-memory snapshots.
//
// NOTE on Vercel serverless: `globalThis` is per-instance, so this
// singleton is shared between route handlers only when they execute
// on the same warm instance. Cross-instance consistency requires
// DB-read fallback (already handled by MatchSnapshot table).
//
// Hydration from DB is idempotent via HYDRATED_MATCHES set.

import type {
  MatchStats,
  PressureSnapshot,
} from "@/lib/advancedAnalytics";

const HALFTIME_STATUSES = new Set([3, 28]);
const MAX_SNAPSHOTS_PER_MATCH = 540;

const g = globalThis as unknown as {
  __pressureHistory?: Map<number, MatchPressureHistory>;
  __pressureHydrated?: Set<number>;
};

function getMap(): Map<number, MatchPressureHistory> {
  if (!g.__pressureHistory) g.__pressureHistory = new Map();
  return g.__pressureHistory;
}

function getHydratedSet(): Set<number> {
  if (!g.__pressureHydrated) g.__pressureHydrated = new Set();
  return g.__pressureHydrated;
}

export interface MatchPressureHistory {
  homeTeam: string;
  awayTeam: string;
  league: string;
  country: string;
  snapshots: PressureSnapshot[];
}

export interface MatchMeta {
  homeTeam: string;
  awayTeam: string;
  league: string;
  country: string;
}

export function getHistory(): Map<number, MatchPressureHistory> {
  return getMap();
}

export function isHydrated(matchCode: number): boolean {
  return getHydratedSet().has(matchCode);
}

export function markHydrated(matchCode: number): void {
  getHydratedSet().add(matchCode);
}

export function isHalftime(status: number): boolean {
  return HALFTIME_STATUSES.has(status);
}

export function ensureMatch(
  matchCode: number,
  meta?: MatchMeta,
): MatchPressureHistory {
  const m = getMap();
  let h = m.get(matchCode);
  if (!h) {
    h = {
      homeTeam: meta?.homeTeam ?? "",
      awayTeam: meta?.awayTeam ?? "",
      league: meta?.league ?? "",
      country: meta?.country ?? "",
      snapshots: [],
    };
    m.set(matchCode, h);
  } else if (meta) {
    // Backfill missing meta fields without overwriting populated ones
    if (!h.homeTeam) h.homeTeam = meta.homeTeam;
    if (!h.awayTeam) h.awayTeam = meta.awayTeam;
    if (!h.league) h.league = meta.league;
    if (!h.country) h.country = meta.country;
  }
  return h;
}

export function addSnapshot(
  matchCode: number,
  minute: string,
  homePressure: number,
  awayPressure: number,
  stats: MatchStats,
  homeGoals: number,
  awayGoals: number,
): PressureSnapshot | null {
  const h = getMap().get(matchCode);
  if (!h) return null;
  const snap: PressureSnapshot = {
    minute,
    timestamp: Date.now(),
    homePressure,
    awayPressure,
    stats: { ...stats },
    homeGoals,
    awayGoals,
  };
  h.snapshots.push(snap);
  if (h.snapshots.length > MAX_SNAPSHOTS_PER_MATCH) {
    h.snapshots = h.snapshots.slice(-MAX_SNAPSHOTS_PER_MATCH);
  }
  return snap;
}

export function getSnapshots(matchCode: number): PressureSnapshot[] {
  return getMap().get(matchCode)?.snapshots ?? [];
}

export function getHistoryForMatch(matchCode: number): MatchPressureHistory | undefined {
  return getMap().get(matchCode);
}

export function pruneStale(maxAgeMs: number): number {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const [code, h] of getMap()) {
    const last = h.snapshots[h.snapshots.length - 1];
    if (!last || last.timestamp < cutoff) {
      getMap().delete(code);
      getHydratedSet().delete(code);
      removed++;
    }
  }
  return removed;
}
