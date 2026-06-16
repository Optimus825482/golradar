// ── Admin Auth Guard ────────────────────────────────────────────────
// Session-token-based auth via /api/admin/auth.
// Replaces the old ADMIN_API_TOKEN env-var pattern.

import { NextResponse } from 'next/server';
import { validateSession } from "./auth";

export interface AdminAuthResult {
  ok: boolean;
  reason?: string;
  userId?: string;
}

/**
 * Extract the admin session token from the request.
 */
function extractToken(request: Request): string | null {
  const auth = request.headers.get('authorization');
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  const cookie = request.headers.get("cookie");
  if (cookie) {
    const m = cookie.match(/admin_token=([^;]+)/);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * Verify a request has admin auth. Use at the top of every
 * /api/admin/* route handler via adminRoute().
 */
export async function requireAdmin(request: Request): Promise<AdminAuthResult> {
  const token = extractToken(request);
  if (!token) {
    return { ok: false, reason: "missing admin session token" };
  }

  const result = await validateSession(token);
  if (!result.ok) {
    return { ok: false, reason: result.reason ?? "invalid session" };
  }

  // Allow password-change endpoint even if mustChangePassword is true
  const url = new URL(request.url);
  if (result.mustChange && !url.pathname.endsWith("/api/admin/auth")) {
    return {
      ok: false,
      reason: "password change required",
      userId: result.userId,
    };
  }

  return { ok: true, userId: result.userId };
}

export function adminUnauthorized(reason: string, status = 401): NextResponse {
  return NextResponse.json({ ok: false, reason }, { status });
}
