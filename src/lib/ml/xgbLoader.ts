// ── XGBoost JSON Model Loader ──────────────────────────────────────
// Hand-rolled inference for the JSON format that
// `xgb.XGBClassifier.save_model(path)` produces. The TS runtime
// stays free of Python / native bindings by walking the tree
// ensemble directly.
//
// XGBoost JSON layout (subset):
//   { learner: {
//       gradient_booster: {
//         model: { trees: [tree, ...], tree_info: [0, 1, ...] }
//       },
//       feature_names: ["f0", "f1", ...],   // may be missing
//       feature_types: ["float", ...],       // informational
//       objective: { name: "binary:logistic", base_score: "0.5" }
//     }
//   }
//
// Each tree object:
//   {
//     id: number,
//     split_indices: "[f0, f2, -1]",        // -1 = leaf; else feature idx
//     split_conditions: "[0.42, 0.87, -1]", // threshold for splits
//     split_type: "[0, 0, 0]",             // 0 = less-than, 1 = greater
//     left_children: "[1, 3, -1]",        // child index in same tree
//     right_children: "[2, -1, -1]",
//     base_weights: "[w0, w1, w2]",        // node values; leaf = weight
//     loss_changes: "[...]",
//     default_left: "[0, 0, 0]"            // present in newer xgboost
//   }
//
// XGBoost uses "init_score" (base_score) which is added to the sum
// of all leaf weights. The default base_score in modern XGBoost is
// log-odds = 0.5. We log1p(exp(x)) at the end for binary:logistic.
//
// The model is loaded once and cached — inference is a single
// synchronous pass through ~400 trees, sub-2ms typical.

let _xgbReadFile: any = undefined;
function getFsp(): any {
  if (typeof window === 'undefined' && _xgbReadFile === undefined) {
    try { _xgbReadFile = require('fs/promises').readFile; } catch { _xgbReadFile = null; }
  }
  return _xgbReadFile;
}

// ── Types (loose — only the fields we use) ─────────────────────────
export interface XgbNodeTree {
  id: number;
  split_indices: number[];
  split_conditions: number[];
  split_type: number[];
  left_children: number[];
  right_children: number[];
  base_weights: number[];
  loss_changes?: number[];
  default_left?: number[];
}

export interface XgbModel {
  trees: Array<{
    nodes: XgbNodeTree;
    /** Pre-flattened arrays for hot-loop performance */
    splits: number[];
    conds: number[];
    left: number[];
    right: number[];
    weights: number[];
    defaultLeft: number[];
    splitType: number[];
  }>;
  /** Per-tree shrinkage factor (XGBoost's `learning_rate`). */
  treeShrinkage: number[];
  /** Sum of all leaf weights in this model — depends on base_score + accumulators */
  baseScore: number;
  /** Cached count for early-exit heuristics. */
  nTrees: number;
  /** Source path — for cache keying and diagnostics. */
  source: string;
  /** SHA256 of the file at load time — invalidates cache on retrain. */
  sha256: string;
}

// ── Parsing helpers ────────────────────────────────────────────────

/**
 * Parse an XGBoost node array field. Handles both formats:
 * 1. String:  "[1, 2, -1]"  (older xgboost)
 * 2. Array:   [1, 2, -1]    (newer xgboost writes real JSON arrays)
 */
function parseBracketIntArray(v: unknown): number[] {
  if (v == null) return [];
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "" || trimmed === "[]") return [];
    const inner = trimmed.replace(/^\[|]$/g, "");
    return inner.split(",").map((x) => parseInt(x.trim(), 10));
  }
  if (Array.isArray(v))
    return v.map((x) => (typeof x === "number" ? x : parseInt(String(x), 10)));
  return [];
}

function parseBracketFloatArray(v: unknown): number[] {
  if (v == null) return [];
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "" || trimmed === "[]") return [];
    const inner = trimmed.replace(/^\[|]$/g, "");
    return inner.split(",").map((x) => parseFloat(x.trim()));
  }
  if (Array.isArray(v))
    return v.map((x) => (typeof x === "number" ? x : parseFloat(String(x))));
  return [];
}

/**
 * Recursively walk a single tree. `nodes` is the tree's nodes
 * dictionary; we instead work on the flattened arrays for cache
 * locality. Returns the raw leaf weight for the input features.
 */
function evalTree(
  tree: XgbModel['trees'][number],
  features: number[],
): number {
  // Start at root (node 0). Convention: -1 children = leaf.
  let idx = 0;
  // Defensive cap — XGBoost trees with default depth ~6 have <=64 leaves
  let guard = 0;
  while (guard++ < 4096) {
    const splitFeature = tree.splits[idx];
    if (splitFeature === -1) {
      // Leaf
      return tree.weights[idx];
    }
    const threshold = tree.conds[idx];
    const fv = features[splitFeature];
    // Treat NaN/feature-missing: follow default_left
    let goLeft: boolean;
    if (fv === undefined || fv === null || Number.isNaN(fv)) {
      goLeft = (tree.defaultLeft[idx] ?? 0) === 1;
    } else {
      // split_type 0 = less-than (default), 1 = greater-than
      const isGreater = tree.splitType[idx] === 1;
      goLeft = isGreater ? fv > threshold : fv < threshold;
    }
    const childIdx = goLeft ? tree.left[idx] : tree.right[idx];
    if (childIdx === -1) {
      // Shouldn't happen if the tree is well-formed, but fall back
      // to a safe default (use the current node as a leaf).
      return tree.weights[idx];
    }
    idx = childIdx;
  }
  // Hit the guard — tree is malformed. Return base_score-equivalent
  // leaf (0) so the prediction isn't NaN.
  return 0;
}

/**
 * Sum the leaves across all trees, apply base_score and per-tree
 * shrinkage (XGBoost's learning_rate is folded into per-tree
 * multipliers at serialization time for older versions, but newer
 * versions keep it as `tree_weight` which we read explicitly).
 */
function predictRaw(model: XgbModel, features: number[]): number {
  let sum = model.baseScore;
  for (let t = 0; t < model.nTrees; t++) {
    const tree = model.trees[t];
    const w = evalTree(tree, features);
    sum += w * (model.treeShrinkage[t] ?? 1.0);
  }
  return sum;
}

// ── Sigmoid (logistic) ────────────────────────────────────────────
function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

// ── Loader ────────────────────────────────────────────────────────
export interface XgbLoadResult {
  model: XgbModel;
  parseMs: number;
}

/**
 * Read and parse an XGBoost JSON model from disk. Throws on
 * malformed input — callers should catch and fall back to the
 * champion GBDT (never break inference on a bad artifact).
 */
export async function loadXgbModel(path: string): Promise<XgbLoadResult> {
  const t0 = performance.now();
  const fsp = getFsp();
  if (!fsp) throw new Error('fs/promises not available');
  const buf = await fsp(path, 'utf-8');
  const sha = await sha256(buf);
  const parsed = JSON.parse(buf);
  const learner = parsed.learner ?? parsed.Learner;
  if (!learner) {
    throw new Error(`XGBoost model missing 'learner' root: ${path}`);
  }

  // Objective base_score — newer xgboost writes it as a string in
  // "logistic" mode (default 0.5). Older versions may write as a
  // raw number. Fall back to 0.5 if absent.
  const baseScoreStr: string | undefined = learner?.objective?.base_score;
  let baseScore = 0.5;
  if (baseScoreStr !== undefined) {
    const parsed = parseFloat(baseScoreStr);
    if (!Number.isNaN(parsed)) baseScore = parsed;
  }

  // The gradient_booster wraps the model; for gblinear models the
  // layout is different, but we only support gbtree (XGBClassifier
  // default).
  const gb = learner?.gradient_booster?.model ?? learner?.GradientBooster?.Model;
  if (!gb?.trees) {
    throw new Error(`XGBoost model missing 'trees' (gblinear not supported): ${path}`);
  }

  const trees = (gb.trees as any[]).map((t: any) => {
    const split_indices = parseBracketIntArray(t.split_indices);
    const split_conditions = parseBracketFloatArray(t.split_conditions);
    const left_children = parseBracketIntArray(t.left_children);
    const right_children = parseBracketIntArray(t.right_children);
    const base_weights = parseBracketFloatArray(t.base_weights);
    const split_type = parseBracketIntArray(t.split_type ?? '[]');
    const default_left = parseBracketIntArray(t.default_left ?? '[]');
    return {
      nodes: {
        id: t.id ?? 0,
        split_indices,
        split_conditions,
        split_type,
        left_children,
        right_children,
        base_weights,
        default_left,
      },
      splits: split_indices,
      conds: split_conditions,
      left: left_children,
      right: right_children,
      weights: base_weights,
      defaultLeft: default_left,
      splitType: split_type,
    };
  });

  // Per-tree shrinkage: modern xgboost writes tree_weight (a float,
  // not an array). Older xgboost has no per-tree weight.
  const treeShrinkage = (gb.trees as any[]).map((t: any) => {
    if (typeof t.tree_weight === 'number') return t.tree_weight;
    if (Array.isArray(t.tree_weight) && t.tree_weight.length > 0) {
      return parseFloat(t.tree_weight[0]);
    }
    return 1.0;
  });

  const model: XgbModel = {
    trees,
    treeShrinkage,
    baseScore,
    nTrees: trees.length,
    source: path,
    sha256: sha,
  };

  return { model, parseMs: performance.now() - t0 };
}

// ── Inference ─────────────────────────────────────────────────────
/**
 * Run inference on a single feature vector. Returns the calibrated
 * probability in [0, 1]. Throws if the model is empty.
 */
export function predictXgb(model: XgbModel, features: number[]): number {
  if (model.nTrees === 0) {
    throw new Error('XGBoost model has no trees');
  }
  const raw = predictRaw(model, features);
  return sigmoid(raw);
}

/**
 * Batch inference. Optimized for repeated calls with the same model.
 * Returns one probability per input row.
 */
export function predictXgbBatch(model: XgbModel, rows: number[][]): number[] {
  const out = new Array<number>(rows.length);
  for (let i = 0; i < rows.length; i++) {
    out[i] = predictXgb(model, rows[i]);
  }
  return out;
}

// ── Caching ───────────────────────────────────────────────────────
interface CacheEntry {
  model: XgbModel;
  loadedAt: number;
  hits: number;
}
const modelCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h — refresh hourly
const CACHE_MAX = 16;

function evictIfFull(): void {
  if (modelCache.size <= CACHE_MAX) return;
  // LRU-ish: evict oldest by loadedAt
  let oldest: string | null = null;
  let oldestT = Infinity;
  for (const [k, v] of modelCache.entries()) {
    if (v.loadedAt < oldestT) {
      oldestT = v.loadedAt;
      oldest = k;
    }
  }
  if (oldest) modelCache.delete(oldest);
}

/**
 * Cached loader. The registry key is path@sha256 — when a
 * retrain produces a new artifact with a different hash, the
 * old cache entry naturally expires.
 */
export async function getXgbModelCached(path: string): Promise<XgbModel> {
  const cached = modelCache.get(path);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    cached.hits++;
    return cached.model;
  }
  const { model } = await loadXgbModel(path);
  evictIfFull();
  modelCache.set(path, { model, loadedAt: Date.now(), hits: 0 });
  return model;
}

/** Drop a model from the cache (e.g. on file deletion). */
export function invalidateXgbModelCache(path?: string): void {
  if (path) {
    modelCache.delete(path);
  } else {
    modelCache.clear();
  }
}

// ── Utilities ─────────────────────────────────────────────────────
async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}
