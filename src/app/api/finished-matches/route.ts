import { NextResponse } from "next/server";
import {
  UNLIVE_API,
  HEADERS,
  parseMatch,
  ParsedMatch,
} from "@/lib/nesine";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") || new Date().toISOString().slice(0, 10);

  try {
    const resp = await fetch(`${UNLIVE_API}?sportType=1&date=${date}`, {
      headers: HEADERS,
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      return NextResponse.json(
        { error: "API error", status: resp.status, matches: [], byLeague: {}, count: 0, date },
        { status: 200 } // Return 200 with empty data so client doesn't crash
      );
    }

    // Validate response is JSON, not an HTML error page
    const contentType = resp.headers.get("content-type") || "";
    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // Nesine API sometimes returns HTML error pages (500)
      return NextResponse.json(
        { matches: [], byLeague: {}, count: 0, date },
        { status: 200 }
      );
    }

    if (!data || data.sc !== 200) {
      return NextResponse.json(
        { matches: [], byLeague: {}, count: 0, date },
        { status: 200 }
      );
    }

    const rawMatches = data.d || [];
    const matches: ParsedMatch[] = [];

    for (const m of rawMatches) {
      const status = m.S || 0;
      // Only include finished matches (5=MS, 22=Uzt. Sonu, 24=Penaltı Sonu)
      if (status !== 5 && status !== 22 && status !== 24) continue;

      const parsed = parseMatch(m);
      matches.push(parsed);
    }

    // Sort by league, then by time
    matches.sort((a, b) => {
      const leagueCompare = a.league.localeCompare(b.league, "tr");
      if (leagueCompare !== 0) return leagueCompare;
      return a.time.localeCompare(b.time);
    });

    // Group by league
    const byLeague: Record<string, ParsedMatch[]> = {};
    for (const m of matches) {
      if (!byLeague[m.league]) byLeague[m.league] = [];
      byLeague[m.league].push(m);
    }

    return NextResponse.json({
      matches,
      byLeague,
      date,
      count: matches.length,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
