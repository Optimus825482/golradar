import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Middleware: force browser cache busting in dev mode + guard admin routes.
// DEV-ONLY cache rule; production serves versioned, immutable assets.
//
// Admin gate model (two-tier):
//   1. Middleware (Edge): cookie presence + shape check. Fast reject for
//      missing tokens. Expired/malformed tokens get the cookie cleared
//      and the request redirected to login.
//   2. Server component / route handler (Node runtime): requireAdmin()
//      does the full PBKDF2/Db-backed session validation. This is the
//      real gate — middleware only optimizes the common case.
//
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
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/_next/static/chunks/:path*"],
};
