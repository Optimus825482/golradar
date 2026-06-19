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
