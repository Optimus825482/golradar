// ── Admin Auth Guard ────────────────────────────────────────────────
// Lightweight, pluggable admin auth for the /api/admin/* routes.
// v1: token-based via the ADMIN_API_TOKEN env var. Set to a
// strong secret in production and rotate quarterly. The token is
// checked via:
//   1. `Authorization: Bearer <token>` header (preferred)
//   2. `?token=<token>` query string (dev / curl convenience)
//
// If ADMIN_API_TOKEN is unset, the guard is permissive in dev
// (NODE_ENV !== 'production') and strict in production (refuses
// all callers with 401). This lets local dev "just work" while
// prod is fail-closed.

import { NextResponse } from 'next/server';

export interface AdminAuthResult {
  ok: boolean;
  reason?: string;
  callerId?: string;
}

export function getAdminToken(): string | null {
  const t = process.env.ADMIN_API_TOKEN;
  if (!t || t.length < 16) return null;
  return t;
}

function extractToken(request: Request): string | null {
  const auth = request.headers.get('authorization');
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  const url = new URL(request.url);
  const q = url.searchParams.get('token');
  if (q) return q.trim();
  return null;
}

/**
 * Verify a request has admin auth. Use at the top of every
 * /api/admin/* route handler. Returns `{ok: true}` on success
 * or `{ok: false, reason}` with a 401 response.
 */
export async function requireAdmin(request: Request): Promise<AdminAuthResult> {
  const token = getAdminToken();
  const isProd = process.env.NODE_ENV === 'production';

  // No token configured
  if (!token) {
    if (isProd) {
      return {
        ok: false,
        reason:
          'ADMIN_API_TOKEN is not configured; admin endpoints are disabled in production. ' +
          'Set ADMIN_API_TOKEN to a strong 32+ char secret.',
      };
    }
    // Dev: permissive
    return { ok: true, callerId: 'dev-unauth' };
  }

  const provided = extractToken(request);
  if (!provided) {
    return { ok: false, reason: 'missing admin token' };
  }
  // Constant-time compare (length-equalize the strings to avoid
  // timing-side-channel info).
  if (provided.length !== token.length) {
    return { ok: false, reason: 'invalid admin token' };
  }
  let match = 0;
  for (let i = 0; i < provided.length; i++) {
    match |= provided.charCodeAt(i) ^ token.charCodeAt(i);
  }
  if (match !== 0) {
    return { ok: false, reason: 'invalid admin token' };
  }
  // Token is at most 8 chars of fingerprint (no full token logged)
  return { ok: true, callerId: `token-${provided.slice(0, 8)}…` };
}

/**
 * Return a 401 response with a sanitized error message. Use as:
 *   const auth = await requireAdmin(request);
 *   if (!auth.ok) return adminUnauthorized(auth.reason!);
 */
export function adminUnauthorized(reason: string): NextResponse {
  return NextResponse.json(
    { error: 'unauthorized', reason },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="admin"' } },
  );
}
