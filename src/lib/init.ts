// ── App Initialization ─────────────────────────────────────────────
// Runs once per server process start.
// Imports are side-effect-free; the seedDefaultAdmin call is
// idempotent (skips if admin user already exists).

import { seedDefaultAdmin } from "./auth";
import { logInfo, logError } from "./devLog";

// Guard: only run on the server, once per process start
if (typeof window === "undefined") {
  let retriesLeft = 3;
  const RETRY_DELAY_MS = 2000;

  async function initWithRetry(): Promise<void> {
    for (let attempt = 1; attempt <= retriesLeft; attempt++) {
      try {
        await seedDefaultAdmin();
        // P2: Pre-load Elo ratings cache from DB
        const { initEloCache: initElo } = await import("./eloRating");
        await initElo().catch((e: unknown) => {
          logError("Init", "initEloCache failed:", e);
        });
        // P3: Seed calibration defaults to SystemConfig on first boot
        const { hydrateCalibrationFromDB } = await import("./calibration");
        await hydrateCalibrationFromDB().catch((e: unknown) => {
          logError("Init", "hydrateCalibrationFromDB failed:", e);
        });
        // Dynamic import — build'ta Prisma tetiklenmesin
        const { refreshProfileCache } = await import("./smartCalibration");
        await refreshProfileCache().catch(() => {});
        logInfo("Init", "App initialization complete");
        return;
      } catch (err) {
        logError("Init", `seedDefaultAdmin failed (attempt ${attempt}/${retriesLeft}):`, err);
        if (attempt < retriesLeft) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
        }
      }
    }
  }

  // Defer to next tick so DB connection is established first
  Promise.resolve().then(() => initWithRetry());
}
