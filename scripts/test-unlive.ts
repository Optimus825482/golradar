import {
  UNLIVE_API,
  HEADERS,
  FINISHED_STATUSES,
  parseMatch,
} from "../src/lib/nesine";

async function main() {
  console.log("Fetching Unlive matches...");
  const resp = await fetch(`${UNLIVE_API}?sportType=1`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(15000),
  });
  const data = await resp.json();
  console.log("Status:", data.sc);
  console.log("Raw matches:", data.d?.length ?? 0);

  if (data.d?.length > 0) {
    const m = data.d[0];
    console.log("\nFirst match raw:");
    console.log("  HT:", m.HT, "AT:", m.AT);
    console.log("  S (status):", m.S);
    console.log("  ES:", JSON.stringify(m.ES));
    console.log("  SE length:", m.SE?.length ?? 0);

    // Try parseMatch
    const parsed = parseMatch(m);
    console.log("\nParsed match:");
    console.log("  home:", parsed.home, "away:", parsed.away);
    console.log("  homeGoals:", parsed.homeGoals);
    console.log("  hasStats:", parsed.hasStats);
    console.log("  isFinished:", parsed.isFinished);

    // Filter like backfill does
    const filtered = data.d
      .filter((m: any) => FINISHED_STATUSES.has(m.S))
      .map((m: any) => parseMatch(m))
      .filter((m: any) => m.hasStats && m.homeGoals !== undefined);
    console.log(
      `\nAfter backfill filtering: ${filtered.length}/${data.d.length}`,
    );
  }
  process.exit(0);
}
main();
