// ── Sofascore API Client ──────────────────────────────────────────
// Bridges to the datafc Python library via sofascore-bridge.py.
// Provides match lists, detailed stats, incidents, momentum, shots.
//
// The bridge is called via child_process.execFile and returns JSON.
// Falls back gracefully if Python / datafc is unavailable.
//
// IMPORTANT: child_process is loaded via require() inside runBridge,
// not `await import()`. Turbopack statically resolves `await import`
// at build time and fails the bundle. require() defers resolution to
// runtime, matching the goaloo.ts pattern.

import { devLog, devWarn, devError } from "./devLog";

// ── Types ────────────────────────────────────────────────────────

export interface SofascoreMatch {
  game_id: number;
  home_team: string;
  away_team: string;
  home_team_id: number;
  away_team_id: number;
  tournament_id?: number;
  tournament_name: string;
  season_id?: number;
  start_timestamp: number;
  status_code: number;
  status_type: string;
  status_desc: string;
  home_score: number | null;
  away_score: number | null;
  home_score_ht: number | null;
  away_score_ht: number | null;
  round?: number;
}

export interface SofascoreIncident {
  incident_type: number;
  incident_class: string;
  time: number;
  is_home: boolean;
  player_name: string;
  player_id: number;
  home_score: number;
  away_score: number;
  text: string;
}

export interface SofascoreStatItem {
  period: string;
  group_name: string;
  stat_name: string;
  home: number | null;
  away: number | null;
}

export interface SofascoreMomentumPoint {
  minute: number;
  value: number;
}

export interface SofascoreShot {
  minute: number;
  x: number;
  y: number;
  expected_goal: number | null;
  expected_goal_on_target: number | null;
  player_name: string;
  situation: string;
  shot_type: string;
  body_part: string;
  is_home: boolean;
  is_goal: boolean;
  is_on_target: boolean;
  is_blocked: boolean;
  is_saved: boolean;
}

export interface SofascoreMatchDetail {
  match_info: {
    home_team: string;
    away_team: string;
    home_team_id: number;
    away_team_id: number;
    tournament_name: string;
    status_code: number;
    status_type: string;
    home_score: number | null;
    away_score: number | null;
    home_score_ht: number | null;
    away_score_ht: number | null;
    home_score_ft: number | null;
    away_score_ft: number | null;
    start_timestamp: number;
    venue: string | null;
    referee: string | null;
  };
  incidents: SofascoreIncident[];
  statistics: SofascoreStatItem[];
  momentum: SofascoreMomentumPoint[];
  shots: SofascoreShot[];
}

// ── Python bridge resolver ───────────────────────────────────────

let _pythonPath: string | undefined | null;
function resolvePython(): string | null {
  if (_pythonPath !== undefined) return _pythonPath;
  const candidates: string[] = [];

  if (process.env.PYTHON_PATH) candidates.push(process.env.PYTHON_PATH);
  if (process.platform === "win32") {
    candidates.push("C:\\Python313\\python.exe", "python", "python3", "py");
  } else {
    candidates.push("python3", "python");
  }

  // We can't test sync here, just return the most likely candidate
  _pythonPath = candidates[0] || null;
  return _pythonPath;
}

async function getBridgeScriptPath(): Promise<string | null> {
  try {
    const { join } = await import("path");
    return join(process.cwd(), "scripts", "sofascore-bridge.py");
  } catch {
    return null;
  }
}

interface BridgeResult {
  ok: boolean;
  data?: any;
  error?: string;
}

async function runBridge(args: string[], timeoutMs = 30000): Promise<BridgeResult> {
  // Use require() instead of `await import("child_process")` — Turbopack
  // statically resolves `await import` at build time and fails the bundle
  // (Module not found: Can't resolve 'child_process'). require() defers
  // resolution to runtime, matching the goaloo.ts pattern.
  const execFile =
    typeof window === "undefined"
      ? require("child_process").execFile
      : null;
  if (!execFile) {
    return { ok: false, error: "child_process unavailable (browser context)" };
  }
  const python = resolvePython();
  const script = await getBridgeScriptPath();
  if (!python || !script) {
    return { ok: false, error: "Python or bridge script not found" };
  }

  return new Promise((resolve) => {
    execFile(
      python,
      [script, ...args],
      {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      },
      (err, stdout, stderr) => {
        if (err) {
          const msg = stderr?.toString()?.substring(0, 500) || err.message;
          devWarn(`[Sofascore] Bridge error: ${msg}`);
          resolve({ ok: false, error: msg });
          return;
        }
        try {
          const result = JSON.parse(stdout.toString());
          resolve(result);
        } catch {
          resolve({ ok: false, error: "Failed to parse bridge output" });
        }
      },
    );
  });
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Fetch matches for a specific date.
 * Returns finished + upcoming matches with scores, HT scores, tournament info.
 */
export async function fetchSofascoreMatchesByDate(
  date: string,
): Promise<SofascoreMatch[]> {
  const result = await runBridge([
    "--action",
    "matches-by-date",
    "--date",
    date,
  ]);
  return result.ok ? (result.data ?? []) : [];
}

/**
 * Fetch currently live matches.
 */
export async function fetchSofascoreLiveMatches(): Promise<any[]> {
  const result = await runBridge(["--action", "live-matches"]);
  return result.ok ? (result.data ?? []) : [];
}

/**
 * Fetch full match detail: info, incidents, stats, momentum, shots.
 */
export async function fetchSofascoreMatchDetail(
  gameId: number,
): Promise<SofascoreMatchDetail | null> {
  const result = await runBridge([
    "--action",
    "match-detail",
    "--game-id",
    String(gameId),
  ]);
  if (!result.ok || !result.data) return null;
  return result.data as SofascoreMatchDetail;
}

/**
 * Fetch only match statistics.
 */
export async function fetchSofascoreMatchStats(
  gameId: number,
): Promise<SofascoreStatItem[]> {
  const result = await runBridge([
    "--action",
    "match-stats",
    "--game-id",
    String(gameId),
  ]);
  return result.ok ? (result.data ?? []) : [];
}

/**
 * Fetch only match incidents (goals, cards, subs).
 */
export async function fetchSofascoreMatchIncidents(
  gameId: number,
): Promise<SofascoreIncident[]> {
  const result = await runBridge([
    "--action",
    "match-incidents",
    "--game-id",
    String(gameId),
  ]);
  return result.ok ? (result.data ?? []) : [];
}

/**
 * Fetch only match momentum (per-minute intensity).
 */
export async function fetchSofascoreMomentum(
  gameId: number,
): Promise<SofascoreMomentumPoint[]> {
  const result = await runBridge([
    "--action",
    "match-momentum",
    "--game-id",
    String(gameId),
  ]);
  return result.ok ? (result.data ?? []) : [];
}

/**
 * Fetch only shot map.
 */
export async function fetchSofascoreShots(
  gameId: number,
): Promise<SofascoreShot[]> {
  const result = await runBridge([
    "--action",
    "match-shots",
    "--game-id",
    String(gameId),
  ]);
  return result.ok ? (result.data ?? []) : [];
}

/**
 * Check if the Sofascore bridge is available.
 */
export async function isSofascoreAvailable(): Promise<boolean> {
  const result = await runBridge(
    [
      "--action",
      "matches-by-date",
      "--date",
      new Date().toISOString().slice(0, 10),
    ],
    10000,
  );
  return result.ok;
}
