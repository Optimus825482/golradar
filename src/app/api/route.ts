import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, string> = { status: 'ok' };
  let healthy = true;

  // DB connectivity check
  try {
    await db.$queryRaw`SELECT 1`;
    checks.db = 'ok';
  } catch {
    checks.db = 'error';
    healthy = false;
  }

  return NextResponse.json(
    { ...checks, uptime: process.uptime() | 0, timestamp: new Date().toISOString() },
    { status: healthy ? 200 : 503 },
  );
}