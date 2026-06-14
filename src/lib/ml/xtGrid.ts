// ── xT (Expected Threat) Grid ────────────────────────────────────

export interface XtGrid {
  grid: number[];
  movProbs: number[][];
  shotProbs: number[];
  source: string;
  trainedAt: string;
  version: string;
  cols: number;
  rows: number;
}

function getServerFs() {
  if (typeof window !== 'undefined') return null;
  try {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    return { fs, path };
  } catch { return null; }
}

const sXt = getServerFs();
const GRID_DIR = sXt ? sXt.path.join(process.cwd(), 'data', 'ml-models') : '';

const DEFAULT_GRID: XtGrid = {
  grid: new Array(12 * 8).fill(0.05),
  movProbs: [],
  shotProbs: new Array(12 * 8).fill(0.05),
  source: 'fallback-flat',
  trainedAt: new Date(0).toISOString(),
  version: '0.0.0-default',
  cols: 12,
  rows: 8,
};

let cachedGrid: XtGrid | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000;

function findGridFile(version?: string): string | null {
  const s2 = getServerFs();
  if (!s2) return null;
  if (!s2.fs.existsSync(GRID_DIR)) return null;
  try {
    const prefix = version ? `xt-grid-v${version}` : 'xt-grid-v';
    const files = s2.fs.readdirSync(GRID_DIR)
      .filter((f: string) => f.startsWith(prefix) && f.endsWith('.json'))
      .sort();
    return files.length > 0 ? s2.path.join(GRID_DIR, files[files.length - 1]) : null;
  } catch {
    return null;
  }
}

function parseGridFile(path: string): XtGrid | null {
  const s2 = getServerFs();
  if (!s2) return null;
  try {
    const raw = s2.fs.readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as XtGrid;
    if (!parsed.grid || parsed.grid.length === 0) return null;
    if (!parsed.cols || !parsed.rows) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function loadXtGrid(version?: string): XtGrid {
  if (cachedGrid && Date.now() - cachedAt < CACHE_TTL_MS) return cachedGrid;
  const path = findGridFile(version);
  if (!path) { cachedGrid = DEFAULT_GRID; cachedAt = Date.now(); return cachedGrid; }
  const parsed = parseGridFile(path);
  if (!parsed) { cachedGrid = DEFAULT_GRID; cachedAt = Date.now(); return cachedGrid; }
  cachedGrid = parsed;
  cachedAt = Date.now();
  return cachedGrid;
}

export function invalidateXtGridCache(): void {
  cachedGrid = null;
  cachedAt = 0;
}

export function xtGridDiagnostics(version?: string): {
  path: string | null;
  sizeBytes: number | null;
  version: string;
  source: string;
} {
  const grid = loadXtGrid(version);
  const path = findGridFile();
  let size: number | null = null;
  const s2 = getServerFs();
  if (path && s2) {
    try { size = s2.fs.statSync(path).size; } catch { size = null; }
  }
  return { path, sizeBytes: size, version: grid.version, source: grid.source };
}

// ── Coordinate transforms ────────────────────────────────────────
// Pitch 0-100 percent → 12x8 grid cell. xT grids span the attacking
// direction, so x=0 is the defending goal line and x=100 is the
// opponent's goal line. Y is the touchline axis, 0-100.
//
// For "home" we treat x as 0→100. For "away" we mirror so both
// sides feed the same grid in attacking coordinates.
export function pitch100ToGrid(
  xPct: number,
  yPct: number,
  grid: XtGrid,
  mirror = false,
): { col: number; row: number } {
  const x = mirror ? 100 - xPct : xPct;
  const y = yPct;
  const col = Math.max(0, Math.min(grid.cols - 1, Math.floor((x / 100) * grid.cols)));
  const row = Math.max(0, Math.min(grid.rows - 1, Math.floor((y / 100) * grid.rows)));
  return { col, row };
}

// ── xT delta for a pass between two grid cells ───────────────────
// We approximate the value of reaching the target cell as the
// precomputed grid value, and the cost of leaving the source as the
// source value. movProbs (sparse 96x96) is consulted when present to
// scale by the probability of actually moving from src to dst in one
// action; when absent we use 1.0 (raw positional delta).
export function xtDeltaForPass(
  grid: XtGrid,
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
): number {
  const idx = (c: number, r: number) => r * grid.cols + c;
  const fromV = grid.grid[idx(fromCol, fromRow)] ?? 0;
  const toV = grid.grid[idx(toCol, toRow)] ?? 0;
  if (grid.movProbs && grid.movProbs.length === grid.cols * grid.rows) {
    const row = grid.movProbs[idx(fromCol, fromRow)];
    const p = row?.[idx(toCol, toRow)] ?? 0;
    // Expected value = toV * P(reach) - fromV * (1 - P(stay)) approximation
    return toV * p - fromV * Math.max(0, 1 - p);
  }
  return toV - fromV;
}
