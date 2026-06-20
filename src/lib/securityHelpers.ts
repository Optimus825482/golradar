// ── Security Helpers ──────────────────────────────────────────────
// Same-origin check (CSRF guard) + IP extraction + admin auth.
// Used by presence, goal-signals, and other write endpoints.

import { validateSession } from "./auth";

const ALLOWED_HOSTS: Set<string> = new Set([
  "localhost:3000",
  "localhost:3001",
  "localhost:3028",
  "golradari.com",
  "www.golradari.com",
  ...((process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean)),
]);

/**
 * Validate that the request originates from the same application.
 * Checks both `origin` and `referer` headers against ALLOWED_HOSTS.
 * Returns false when no origin info is present (external / curl requests).
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  if (!origin && !referer) return false;
  const checkUrl = (url: string) => {
    try {
      const u = new URL(url);
      if (ALLOWED_HOSTS.has(u.host)) return true;
      return Array.from(ALLOWED_HOSTS).some(h => u.host.endsWith("." + h));
    } catch { return false; }
  };
  if (origin && checkUrl(origin)) return true;
  if (referer && checkUrl(referer)) return true;
  return false;
}

/**
 * Extract client IP from proxy headers.
 */
export function getClientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") || "unknown";
}

/**
 * Require a valid admin session token via Authorization header.
 */
export async function requireAdmin(
  request: Request,
): Promise<{ ok: boolean; reason?: string }> {
  const auth = request.headers.get("authorization");
  if (!auth) return { ok: false, reason: "no auth header" };
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, reason: "malformed auth header" };
  return validateSession(m[1]!.trim());
}
