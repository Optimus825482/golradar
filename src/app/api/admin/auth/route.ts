// ── Admin Auth API ────────────────────────────────────────────────
// POST /api/admin/auth — login, logout, change-password, check

import { NextResponse } from "next/server";
import {
  createSession,
  destroySession,
  hashPassword,
  seedDefaultAdmin,
  validateSession,
  verifyPassword,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// GET /api/admin/auth?action=check — validate current session
// POST /api/admin/auth — { action, username, password, newPassword }
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "check";

  if (action === "check") {
    const token = extractToken(request);
    if (!token)
      return NextResponse.json(
        { ok: false, reason: "no token" },
        { status: 401 },
      );

    const result = await validateSession(token);
    if (!result.ok)
      return NextResponse.json(
        { ok: false, reason: result.reason },
        { status: 401 },
      );

    return NextResponse.json({ ok: true, mustChange: result.mustChange });
  }

  return NextResponse.json(
    { ok: false, reason: "unknown action" },
    { status: 400 },
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, username, password, newPassword } = body;

    // ── Login ────────────────────────────────────────────────
    if (action === "login") {
      // FIX: Brute force korumasi — IP bazli 5 deneme / 60sn
      const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
      const rlKey = `login:${clientIp}`;
      if (!rateLimit(rlKey, { windowMs: 60000, maxRequests: 5 }).allowed) {
        return NextResponse.json(
          { ok: false, reason: "too many attempts, try again in 60s" },
          { status: 429 },
        );
      }

      if (!username || !password) {
        return NextResponse.json(
          { ok: false, reason: "username and password required" },
          { status: 400 },
        );
      }

      const user = await db.user.findUnique({ where: { username } });
      if (!user) {
        return NextResponse.json(
          { ok: false, reason: "invalid credentials" },
          { status: 401 },
        );
      }

      if (!(await verifyPassword(password, user.passwordHash, user.passwordSalt))) {
        return NextResponse.json(
          { ok: false, reason: "invalid credentials" },
          { status: 401 },
        );
      }

      const token = await createSession(user.id);
      return NextResponse.json({
        ok: true,
        token,
        mustChange: user.mustChangePassword,
      });
    }

    // ── Logout ────────────────────────────────────────────────
    if (action === "logout") {
      const token = extractToken(request);
      if (token) await destroySession(token);
      return NextResponse.json({ ok: true });
    }

    // ── Change Password ──────────────────────────────────────
    if (action === "change-password") {
      const token = extractToken(request);
      if (!token)
        return NextResponse.json(
          { ok: false, reason: "no token" },
          { status: 401 },
        );

      const session = await validateSession(token);
      if (!session.ok)
        return NextResponse.json(
          { ok: false, reason: session.reason },
          { status: 401 },
        );

      if (!password || !newPassword) {
        return NextResponse.json(
          { ok: false, reason: "current password and new password required" },
          { status: 400 },
        );
      }

      if (newPassword.length < 6) {
        return NextResponse.json(
          { ok: false, reason: "new password must be at least 6 characters" },
          { status: 400 },
        );
      }

      const user = await db.user.findUnique({ where: { id: session.userId } });
      if (!user)
        return NextResponse.json(
          { ok: false, reason: "user not found" },
          { status: 401 },
        );

      if (!(await verifyPassword(password, user.passwordHash, user.passwordSalt))) {
        return NextResponse.json(
          { ok: false, reason: "current password is incorrect" },
          { status: 401 },
        );
      }

      const { hash, salt } = await hashPassword(newPassword);
      await db.user.update({
        where: { id: user.id },
        data: {
          passwordHash: hash,
          passwordSalt: salt,
          mustChangePassword: false,
        },
      });

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { ok: false, reason: "unknown action" },
      { status: 400 },
    );
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid request" },
      { status: 400 },
    );
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function extractToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  // Also check cookie
  const cookie = request.headers.get("cookie");
  if (cookie) {
    const m = cookie.match(/admin_token=([^;]+)/);
    if (m) return m[1].trim();
  }
  return null;
}
