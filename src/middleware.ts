import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Middleware: security headers + admin auth guard + dev cache busting.

// ── Security headers ──────────────────────────────────────────────
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-DNS-Prefetch-Control": "off",
};

function applySecurityHeaders(response: NextResponse): void {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
}

// ── Admin auth guard ──────────────────────────────────────────────
// Edge runtime cannot run Prisma, so cookie contents are validated by
// shape (length, hex charset) here and by DB lookup inside route handlers.
const TOKEN_MIN_LEN = 64; // crypto.randomBytes(32).toString("hex") == 64 chars
const TOKEN_MAX_LEN = 256; // generous upper bound, defends against header injection
const TOKEN_RE = /^[a-f0-9]+$/i;

function isPlausibleToken(value: string): boolean {
  if (value.length < TOKEN_MIN_LEN || value.length > TOKEN_MAX_LEN) return false;
  return TOKEN_RE.test(value);
}

// Routes that do NOT require the admin_token cookie. The login page must
// be reachable without a session, otherwise we redirect-loop.
const ADMIN_PUBLIC_PATHS = new Set<string>([
  "/admin/login",
  "/admin/change-password",
]);

function isAdminPublic(pathname: string): boolean {
  if (ADMIN_PUBLIC_PATHS.has(pathname)) return true;
  // Allow static asset segments under /admin/* (none today, defensive).
  return false;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Admin auth guard ───────────────────────────────────────────
  if (pathname.startsWith("/admin") && !isAdminPublic(pathname)) {
    const token = request.cookies.get("admin_token")?.value;

    // Missing OR malformed token: redirect to login and clear the bad cookie.
    if (!token || !isPlausibleToken(token)) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("next", pathname);
      const response = NextResponse.redirect(url);
      if (token) {
        // Stale or attacker-controlled cookie — instruct the browser to drop it.
        response.cookies.set("admin_token", "", {
          path: "/",
          maxAge: 0,
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
        });
      }
      applySecurityHeaders(response);
      return response;
    }

    // Plausible shape — proceed. The route's requireAdmin() will run the
    // DB-backed check; expired sessions get a 401 from the API and the
    // client-side auth check redirects back to login.
  }

  // ── Dev-only cache busting for HMR chunks ──────────────────────
  if (
    process.env.NODE_ENV !== "production" &&
    pathname.startsWith("/_next/static/chunks/")
  ) {
    const response = NextResponse.next();
    response.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
    applySecurityHeaders(response);
    return response;
  }

  const response = NextResponse.next();
  applySecurityHeaders(response);
  return response;
}

export const config = {
  matcher: [
    // Security headers on all responses
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api/cron).*)",
  ],
};
