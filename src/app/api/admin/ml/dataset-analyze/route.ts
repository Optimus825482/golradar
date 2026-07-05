import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/securityHelpers";
import { logError } from '@/lib/devLog';

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    // Read dataset metadata from DB
    const ds = await db.trainingDataset.findUnique({ where: { id } });
    if (!ds) return NextResponse.json({ error: "dataset not found" }, { status: 404 });

    // Read JSONL file and compute label distribution
    let positives = 0;
    let negatives = 0;
    const byMinuteRange: Record<string, { total: number; goals: number }> = {
      '0-15': { total: 0, goals: 0 },
      '16-30': { total: 0, goals: 0 },
      '31-45': { total: 0, goals: 0 },
      '46-60': { total: 0, goals: 0 },
      '61-75': { total: 0, goals: 0 },
      '76-90+': { total: 0, goals: 0 },
    };

    try {
      const content = await readFile(ds.path, 'utf-8');
      const lines = content.trim().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          const label = row.label ?? 0;
          if (label === 1) positives++;
          else negatives++;

          const m = row.minute ?? row.context?.minute ?? 45;
          let range = '76-90+';
          if (m <= 15) range = '0-15';
          else if (m <= 30) range = '16-30';
          else if (m <= 45) range = '31-45';
          else if (m <= 60) range = '46-60';
          else if (m <= 75) range = '61-75';

          if (range in byMinuteRange) {
            byMinuteRange[range].total++;
            if (label === 1) byMinuteRange[range].goals++;
          }
        } catch { /* skip malformed lines */ }
      }
    } catch (fileErr) {
      logError('dataset-analyze', `Failed to read ${ds.path}:`, fileErr);
      return NextResponse.json({ error: "File read error — dataset may be stale" }, { status: 500 });
    }

    const total = positives + negatives;
    const labelDist = {
      positives,
      negatives,
      posPct: total > 0 ? (positives / total) * 100 : 0,
      byMinuteRange,
    };

    return NextResponse.json({ ok: true, labelDist, path: ds.path });
  } catch (err) {
    logError('dataset-analyze', err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
