import { NextResponse } from "next/server";
import {
  calculateSignalStats,
  getSignalRecordsForDate,
  getSignalForMatch,
  getAvailableDates,
  checkAndRecordSignal,
  finalizeMatchSignals,
  cleanupStaleSignals,
  expireSignalsForHalftime,
  checkPendingSignals,
  startExpiryChecker,
} from "@/lib/goalSignalTracker";

// Start background expiry checker for pending signals
startExpiryChecker();

export const dynamic = "force-dynamic";

// ── Naive rate limiter (per-process, per-IP, per-bucket) ───────
const RATE_LIMIT_WINDOW_MS = 60_000;
const WRITE_LIMIT_MAX = 600; // 600 writes / minute / IP — live pollers + backtest
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkWriteRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= WRITE_LIMIT_MAX) return false;
  bucket.count++;
  return true;
}

function getClientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") || "unknown";
}

// ── Lightweight validators (no zod dep) ────────────────────────
const SIGNAL_SIDES = new Set(["home", "away"]);
const SIGNAL_LEVELS = new Set(["low", "medium", "high", "critical"]);

type ValidationOk<T> = { ok: true; value: T };
type ValidationErr = { ok: false; error: string };
type Validation<T> = ValidationOk<T> | ValidationErr;

function fail(msg: string): ValidationErr {
  return { ok: false, error: msg };
}

function asInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^-?\d+$/.test(v)) return parseInt(v, 10);
  return null;
}

function asFloat(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(v: unknown, max = 256): string | null {
  if (typeof v !== "string") return null;
  if (v.length === 0 || v.length > max) return null;
  return v;
}

function asNumberArray(v: unknown, max = 2000): number[] | null {
  if (!Array.isArray(v)) return null;
  if (v.length > max) return null;
  const out: number[] = [];
  for (const item of v) {
    const n = asInt(item);
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

function validateRecordBody(body: unknown): Validation<{
  matchCode: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchTime: string;
  minute: string;
  score: number;
  side: "home" | "away";
  level: "low" | "medium" | "high" | "critical";
  factors: string[];
  calibratedP: number;
  poissonP: number;
  homeScore: number;
  awayScore: number;
  homeGoals: number;
  awayGoals: number;
} | null> {
  if (!body || typeof body !== "object") return fail("body must be an object");
  const b = body as Record<string, unknown>;

  const matchCode = asInt(b.matchCode);
  if (matchCode === null || matchCode <= 0) return fail("matchCode required (positive int)");

  // side: accept 'home' | 'away' for recording. 'both' / null / missing
  // are valid probability outputs (no dominant side) — signal is dropped
  // server-side. Anything else is malformed.
  const sideRaw = b.side;
  if (sideRaw === null || sideRaw === undefined || sideRaw === "both") {
    return { ok: true, value: null };
  }
  const side = asString(sideRaw, 16);
  if (!side || !SIGNAL_SIDES.has(side)) return fail("side must be 'home' or 'away'");

  const score = asInt(b.score);
  if (score === null || score < 0 || score > 100) return fail("score must be int 0-100");

  const minute = asString(b.minute, 16);
  if (!minute) return fail("minute required");

  const levelRaw = asString(b.level ?? "medium", 16);
  const level = (levelRaw && SIGNAL_LEVELS.has(levelRaw) ? levelRaw : "medium") as
    | "low" | "medium" | "high" | "critical";

  const factorsRaw = Array.isArray(b.factors) ? b.factors : [];
  const factors: string[] = [];
  for (const f of factorsRaw.slice(0, 32)) {
    const s = asString(f, 128);
    if (s) factors.push(s);
  }

  const calibratedP = asFloat(b.calibratedP) ?? 0;
  const poissonP = asFloat(b.poissonP) ?? 0;
  const homeScore = asInt(b.homeScore) ?? 0;
  const awayScore = asInt(b.awayScore) ?? 0;
  const homeGoals = asInt(b.homeGoals) ?? 0;
  const awayGoals = asInt(b.awayGoals) ?? 0;

  return {
    ok: true,
    value: {
      matchCode,
      homeTeam: asString(b.homeTeam, 128) ?? "?",
      awayTeam: asString(b.awayTeam, 128) ?? "?",
      league: asString(b.league, 128) ?? "?",
      matchTime: asString(b.matchTime, 64) ?? "",
      minute,
      score,
      side: side as "home" | "away",
      level,
      factors,
      calibratedP,
      poissonP,
      homeScore,
      awayScore,
      homeGoals,
      awayGoals,
    },
  };
}

function validateExpireHalftime(body: unknown): Validation<number[]> {
  if (!body || typeof body !== "object") return fail("body must be an object");
  const codes = asNumberArray((body as Record<string, unknown>).matchCodes);
  if (!codes) return fail("matchCodes must be array of ints");
  return { ok: true, value: codes };
}

function validateCleanup(body: unknown): Validation<number[]> {
  if (!body || typeof body !== "object") return fail("body must be an object");
  const codes = asNumberArray((body as Record<string, unknown>).activeCodes);
  if (!codes) return fail("activeCodes must be array of ints");
  return { ok: true, value: codes };
}

// ── Auth gate ──────────────────────────────────────────────────
// Removed: API is open by design (internal/local service, runs behind
// reverse proxy / Caddy in this stack). Rate limit + input validation
// provide the practical protection layer.


// GET /api/goal-signals?action=stats|records|match|dates&date=...&matchCode=...&days=...
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "stats";

  try {
    if (action === "stats") {
      const daysRaw = asInt(searchParams.get("days"));
      const days = daysRaw && daysRaw > 0 && daysRaw <= 365 ? daysRaw : 30;
      const stats = await calculateSignalStats(days);
      return NextResponse.json(stats);
    }

    if (action === "records") {
      const date = searchParams.get("date") || new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
      }
      const records = await getSignalRecordsForDate(date);
      return NextResponse.json({ date, count: records.length, records });
    }

    if (action === "match") {
      const matchCode = asInt(searchParams.get("matchCode"));
      if (!matchCode) {
        return NextResponse.json({ error: "matchCode required" }, { status: 400 });
      }
      const records = await getSignalForMatch(matchCode);
      return NextResponse.json({ matchCode, count: records.length, records });
    }

    if (action === "dates") {
      const dates = await getAvailableDates();
      return NextResponse.json({ dates });
    }

    if (action === "finalize") {
      const matchCode = asInt(searchParams.get("matchCode"));
      if (!matchCode) {
        return NextResponse.json({ error: "matchCode required" }, { status: 400 });
      }
      const homeScore = asInt(searchParams.get("homeScore"));
      const awayScore = asInt(searchParams.get("awayScore"));
      if (homeScore === null || awayScore === null) {
        return NextResponse.json({ error: "homeScore and awayScore required" }, { status: 400 });
      }
      await finalizeMatchSignals(matchCode, homeScore, awayScore);
      return NextResponse.json({ ok: true, matchCode });
    }

    return NextResponse.json({ error: "Unknown action. Use: stats, records, match, dates, finalize" }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "internal_error";
    console.error("[GoalSignals API] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/goal-signals — Record a new signal, expire halftime signals, or cleanup
export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!checkWriteRateLimit(ip)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    if (body && typeof body === "object" && (body as Record<string, unknown>).action) {
      const action = (body as Record<string, unknown>).action;

      if (action === "expireHalftime") {
        const v = validateExpireHalftime(body);
        if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
        const expired = await expireSignalsForHalftime(new Set(v.value));
        return NextResponse.json({ ok: true, expired });
      }

      if (action === "cleanup") {
        const v = validateCleanup(body);
        if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
        await cleanupStaleSignals(v.value);
        return NextResponse.json({ ok: true });
      }

      if (action === "checkPending") {
        const result = await checkPendingSignals();
        return NextResponse.json({ ok: true, ...result });
      }
    }

    const v = validateRecordBody(body);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    if (v.value === null) {
      // side was 'both' / null / missing — valid probability output but not
      // recordable. Drop silently so the poller isn't punished for it.
      return NextResponse.json({ ok: false, dropped: "side" });
    }
    const data = v.value;

    const result = await checkAndRecordSignal(
      data.matchCode,
      data.homeTeam,
      data.awayTeam,
      data.league,
      data.matchTime,
      data.minute,
      {
        score: data.score,
        homeScore: data.homeScore,
        awayScore: data.awayScore,
        side: data.side,
        level: data.level,
        factors: data.factors,
        calibratedP: data.calibratedP,
        poissonP: data.poissonP,
      },
      data.homeGoals,
      data.awayGoals,
    );

    if (result) {
      return NextResponse.json({ ok: true, signal: result });
    }

    return NextResponse.json({ ok: false, message: "Signal below threshold or cooldown" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "internal_error";
    console.error("[GoalSignals API] POST Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
