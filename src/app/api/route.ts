import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, string> = { status: 'ok' };
  let healthy = true;

  // DB connectivity check
  try {
    const { PrismaClient } = await import('@prisma/client');
    const db = new PrismaClient();
    await db.$queryRaw`SELECT 1`;
    await db.$disconnect();
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