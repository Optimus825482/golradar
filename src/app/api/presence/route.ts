// ── Presence API ─────────────────────────────────────────────────
// POST { action: "ping"|"leave"|"join", sessionId?: string }
//   → { ok: true, activeUsers: number, tier: "LITE"|"MID"|"FULL" }
// GET → { activeUsers, tier }
//
// SessionId üretmek client'ın sorumluluğu; POST'a gelmezse 400.
// Same-origin check write endpoint'lerde (CSRF guard).

import { NextResponse } from "next/server";
import { presencePing, presenceLeave, activeUserCount } from "@/lib/presence";
import { resolveTier } from "@/lib/tier";
import { isSameOrigin } from "@/lib/securityHelpers";
import { logError } from "@/lib/devLog";

export const dynamic = "force-dynamic";

function asString(v: unknown, max = 128): string | null {
  if (typeof v !== "string") return null;
  if (v.length === 0 || v.length > max) return null;
  return v;
}

function buildResponse(activeUsers: number) {
  return NextResponse.json({
    ok: true,
    activeUsers,
    tier: resolveTier(activeUsers),
  });
}

export async function GET() {
  try {
    const count = activeUserCount();
    return NextResponse.json({
      activeUsers: count,
      tier: resolveTier(count),
    });
  } catch (err: unknown) {
    logError("Presence API", "GET error:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "body_required" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const action = asString(b.action, 16);
  const sessionId = asString(b.sessionId, 128);

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId_required" }, { status: 400 });
  }

  try {
    let count: number;
    if (action === "ping" || action === "join") {
      count = presencePing(sessionId);
    } else if (action === "leave") {
      count = presenceLeave(sessionId);
    } else {
      return NextResponse.json({ error: "invalid_action" }, { status: 400 });
    }
    return buildResponse(count);
  } catch (err: unknown) {
    logError("Presence API", "POST error:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
