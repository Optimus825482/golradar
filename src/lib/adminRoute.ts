// ── Admin Route Wrapper ──────────────────────────────────────────────
// Tiny helper to wrap an /api/admin/* handler so the auth check
// is the first thing it does. Saves 4 lines per endpoint:
//
//   export const POST = adminRoute(async (request) => {
//     // ... handler body, already auth-checked ...
//   });
//
// The handler receives the original Request plus the auth result
// (mostly for logging the callerId).

import { NextResponse } from 'next/server';
import { adminUnauthorized, requireAdmin, type AdminAuthResult } from './adminAuth';

export type AdminHandler = (
  request: Request,
  auth: AdminAuthResult,
) => Promise<NextResponse> | NextResponse;

export function adminRoute(handler: AdminHandler) {
  return async (request: Request): Promise<NextResponse> => {
    const auth = await requireAdmin(request);
    if (!auth.ok) return adminUnauthorized(auth.reason ?? 'unauthorized');
    return handler(request, auth);
  };
}
