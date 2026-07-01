// ── Cron: Single Writer for /api/matches ───────────────────────────
// Goal: collapse 1000 polling clients into a single periodic fetch.
//
// Architecture (post-2026-07-01 refactor):
//   - One writer (this endpoint, called every 5s by the cron) fetches
//     /api/matches, parses the JSON, writes it to the in-memory
//     cache, and publishes a "snapshot" event for SSE subscribers.
//   - 1000+ public readers hit /api/matches — but get served from
//     the cache 99.9% of the time (5s TTL).
//   - /api/matches/stream (SSE) subscribers get push notifications
//     within ~100ms of a writer refresh.
//
// Triggers (any of):
//   1. Node cron in /api/cron (preferred) — every 5s
//   2. ML scheduler — kicks the writer when matches change
//   3. Manual curl during incidents (admin override)
//
// Response format: small JSON ack so the cron can log success/failure
// without us having to parse a 50KB payload.

import { NextResponse } from "next/server";
import { setMatchesCache, getMatchesCache } from "@/lib/server/matchesCache";
import { publishMatchEvent } from "@/lib/server/matchEvents";
import { logError, logInfo } from "@/lib/devLog";

export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 5_000;
const TIMEOUT_MS = 8_000;

// Concurrency lock: only one writer can be in flight at a time.
// If a second writer is triggered while the first is still running,
// it returns immediately with "skipped" status. This protects
// against a runaway cron (e.g. clock drift on multiple replicas).
let inFlight = false;
let lastSuccessAt = 0;

export async function POST(request: Request) {
  const startedAt = Date.now();

  if (inFlight) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "writer_already_in_flight",
      lastSuccessAt,
    });
  }
  inFlight = true;

  try {
    // Compute the base URL from the request. The cron lives in
    // the same container so a loopback fetch is fine.
    const url = new URL(request.url);
    const target = `${url.protocol}//${url.host}/api/matches?v=writer-${startedAt}`;

    const resp = await fetch(target, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!resp.ok) {
      return NextResponse.json(
        { ok: false, error: "upstream_failed", status: resp.status },
        { status: 502 }
      );
    }

    const body = await resp.json();
    // Override whatever the route's "fallback" write did — mark this
    // as the authoritative "writer" entry so readers know it's fresh.
    setMatchesCache(`matches:v=writer-${startedAt}`, body, "writer");
    // Re-publish with a stable key (writer-prefixed). The /api/matches
    // route's cache key is `matches:v=${v}` — for the writer's
    // synthetic version we mirror the same key.
    publishMatchEvent({
      type: "snapshot",
      timestamp: startedAt,
      data: body,
    });

    lastSuccessAt = startedAt;
    logInfo(
      "cron-poll-matches",
      `Writer refresh OK: ${(body as { count?: number }).count ?? "?"} matches in ${Date.now() - startedAt}ms`,
    );

    return NextResponse.json({
      ok: true,
      skipped: false,
      matches: (body as { count?: number }).count ?? 0,
      durationMs: Date.now() - startedAt,
      intervalMs: POLL_INTERVAL_MS,
      lastSuccessAt,
    });
  } catch (e) {
    logError("cron-poll-matches", "Writer refresh failed:", e);
    return NextResponse.json(
      { ok: false, error: "writer_failed", message: String(e) },
      { status: 500 }
    );
  } finally {
    inFlight = false;
  }
}

// GET exposes the writer's status for /healthz. Safe to call from
// anywhere (no external side effects, no rate limit).
export async function GET() {
  return NextResponse.json({
    inFlight,
    lastSuccessAt,
    cacheSize: getMatchesCache("matches:v=test") != null ? "≥1" : "0",
    intervalMs: POLL_INTERVAL_MS,
  });
}
