import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Middleware to force browser cache busting in dev mode
// Prevents stale Turbopack chunks from causing styled-jsx HMR errors.
// DEV-ONLY: production serves versioned, immutable assets.
export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  if (
    process.env.NODE_ENV !== "production" &&
    request.nextUrl.pathname.startsWith("/_next/static/chunks/")
  ) {
    response.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
  }

  return response;
}

export const config = {
  matcher: ["/_next/static/chunks/:path*"],
};
