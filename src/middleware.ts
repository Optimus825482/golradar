import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Middleware: force browser cache busting in dev mode + guard admin routes.
// DEV-ONLY cache rule; production serves versioned, immutable assets.
// Admin routes require an admin_token cookie — unauthenticated requests are
// redirected to /admin (which renders the in-page login modal).
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Admin auth guard ───────────────────────────────────────────
  // Skip guard for the login page itself; otherwise we'd redirect-loop.
  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    const token = request.cookies.get("admin_token")?.value;
    if (!token) {
      // Preserve the requested path so we could bounce back post-login.
      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
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
