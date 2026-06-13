// ── Canonical Event Type Map ──────────────────────────────────
// Shared between mini-services/nesine-live (Socket.IO) and src/lib/nesine (Next.js API)
// ET (EventType) codes from Nesine API
// DO NOT DUPLICATE — update this file, import from here in both consumers

export const ET_MAP: Record<number, string> = {
  0: "undefined",
  1: "corners",
  2: "free_kicks",
  3: "yellow_cards",
  4: "red_cards",
  5: "two_yellow_red",
  6: "shots_on_target",
  7: "shots_off_target",
  8: "dangerous_attacks",
  9: "offsides",
  10: "goal_kicks",
  11: "possession",
  12: "throw_ins",
  13: "fouls",
  14: "corners_1h",
  15: "corners_2h",
  116: "saves",
  117: "pass_accuracy",
  118: "pass_accuracy_alt",
  119: "shots_total",
  120: "shots_blocked",
  121: "xg",
  122: "rcs",
};

function parseStats(seArray: any[]): Record<string, { home: number | null; away: number | null }> {
  const stats: Record<string, { home: number | null; away: number | null }> = {};
  for (const e of seArray || []) {
    const et = e.ET as number;
    const key = ET_MAP[et];
    if (!key) continue;
    const h = e.H != null && e.H !== "-" ? Number(e.H) : null;
    const a = e.A != null && e.A !== "-" ? Number(e.A) : null;
    stats[key] = { home: h, away: a };
  }
  return stats;
}
