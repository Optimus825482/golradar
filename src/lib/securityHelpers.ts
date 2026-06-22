// ── Security Helpers ──────────────────────────────────────────────
// Same-origin check (CSRF guard) + IP extraction + admin auth.
// Used by presence, goal-signals, and other write endpoints.

import { validateSession } from "./auth";

interface HostRule {
  /** Exact host match, e.g. "api.example.com". */
  exact: string;
  /** If true, accept any subdomain of `exact`. Explicit opt-in only. */
  allowSubdomains: boolean;
}

// Hosts the app trusts as same-origin for write requests. A wildcard
// `*.golradari.com` entry is ONLY created when the rule explicitly
// opts in via `allowSubdomains: true`. Bare entries do NOT match
// subdomains — closing the subdomain-takeover CSRF bypass.
const ALLOWED_HOSTS: HostRule[] = parseAllowedHosts();

function parseAllowedHosts(): HostRule[] {
  const seeds: Array<[string, boolean]> = [
    ["localhost:3000", false],
    ["localhost:3001", false],
    ["localhost:3028", false],
    ["golradari.com", false],
    ["www.golradari.com", false],
    // Wildcard: opt-in. `*.golradari.com` is accepted but NOT bare
    // `golradari.com` (already covered above). Opt-in flag prevents
    // accidental subdomain takeover.
    ["golradari.com", true],
  ];
  const env = process.env.ALLOWED_ORIGINS || "";
  for (const raw of env.split(",")) {
    const s = raw.trim();
    if (!s) continue;
    if (s.startsWith("*.")) {
      seeds.push([s.slice(2), true]);
    } else {
      seeds.push([s, false]);
    }
  }
  // Dedupe by `exact|allowSubdomains`.
  const seen = new Set<string>();
  const out: HostRule[] = [];
  for (const [exact, allowSubdomains] of seeds) {
    const key = `${exact}|${allowSubdomains ? "1" : "0"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ exact, allowSubdomains });
  }
  return out;
}

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
      // Port-less comparisons: a request for "https://x.com" must NOT
      // match a rule for "x.com:443". Use full host (with port) always.
      return ALLOWED_HOSTS.some(rule => {
        if (u.host === rule.exact) return true;
        if (rule.allowSubdomains && u.host.endsWith("." + rule.exact)) return true;
        return false;
      });
    } catch {
      return false;
    }
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
