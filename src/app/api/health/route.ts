// ── Health Check ────────────────────────────────────────────────
// Returns service status: uptime, DB connectivity, version.
// Used by load balancers, monitoring, and CI smoke tests.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

interface HealthStatus {
  status: "ok" | "degraded" | "down";
  uptime: number;
  timestamp: number;
  version: string;
  checks: {
    database: {
      ok: boolean;
      latencyMs?: number;
      error?: string;
    };
    memory: {
      heapUsedMB: number;
      heapTotalMB: number;
      rssMB: number;
    };
  };
}

const START_TIME = Date.now();
const VERSION = process.env.npm_package_version || "0.2.0";

export async function GET(): Promise<NextResponse<HealthStatus>> {
  const timestamp = Date.now();
  const uptime = Math.floor((timestamp - START_TIME) / 1000);

  // ── DB check ───────────────────────────────────────────────
  let dbOk = false;
  let dbLatency: number | undefined;
  let dbError: string | undefined;
  const dbStart = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
    dbLatency = Date.now() - dbStart;
  } catch (e: unknown) {
    dbError = e instanceof Error ? e.message : "unknown";
  }

  // ── Memory check ───────────────────────────────────────────
  const mem = process.memoryUsage();
  const memory = {
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
    rssMB: Math.round(mem.rss / 1024 / 1024),
  };

  const status: HealthStatus["status"] = !dbOk
    ? "down"
    : (dbLatency && dbLatency > 1000) || memory.rssMB > 1024
      ? "degraded"
      : "ok";

  const body: HealthStatus = {
    status,
    uptime,
    timestamp,
    version: VERSION,
    checks: {
      database: { ok: dbOk, latencyMs: dbLatency, error: dbError },
      memory,
    },
  };

  return NextResponse.json(body, {
    status: status === "down" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
