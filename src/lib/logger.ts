// ── Logger ───────────────────────────────────────────────────────
// Structured logger with pino (Node) and console fallback (Edge).
// pino v10 uses its own TS types — no separate @types/pino needed.
// Backward-compatible with devLog.ts so existing call sites keep
// working until migrated.
//
// Usage:
//   import { logger, logError } from "@/lib/logger";
//   logger.info({ matchCode: 42 }, "signal recorded");
//   logger.error({ err }, "reportGoal failed");
//   logError("Cron", err);  // legacy API, still works
//
// For request-scoped structured logging:
//   const log = logger.child({ reqId: "abc" });
//   log.info({ matchCode: 42 }, "signal recorded");

type LogFn = (obj: Record<string, unknown>, msg?: string) => void;

export interface Logger {
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  debug: LogFn;
  child: (bindings: Record<string, unknown>) => Logger;
}

// ── Edge detection ───────────────────────────────────────────────

declare global {
  // Edge runtime exposes a global EdgeRuntime symbol; Node does not.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  var EdgeRuntime: string | undefined;
}

function isEdgeRuntime(): boolean {
  return typeof EdgeRuntime !== "undefined";
}

// ── Console fallback (Edge or until pino loads) ──────────────────

function createConsoleLogger(): Logger {
  const isDev = process.env.NODE_ENV !== "production";
  const fmt =
    (level: "info" | "warn" | "error" | "debug") =>
    (obj: Record<string, unknown>, msg?: string) => {
      const text = msg ?? "";
      if (isDev) {
        const meta =
          Object.keys(obj).length > 0 ? " " + JSON.stringify(obj) : "";
        // eslint-disable-next-line no-console
        (level === "error"
          ? console.error
          : level === "warn"
            ? console.warn
            : console.log)(`${text}${meta}`);
      } else {
        // Prod structured JSON for log search (Loki/Logtail)
        // eslint-disable-next-line no-console
        (level === "error"
          ? console.error
          : level === "warn"
            ? console.warn
            : console.log)(JSON.stringify({ level, msg: text, ...obj }));
      }
    };
  const base: Logger = {
    info: fmt("info"),
    warn: fmt("warn"),
    error: fmt("error"),
    debug: fmt("debug"),
    child: () => base,
  };
  return base;
}

// ── Pino → Logger adapter ───────────────────────────────────────

function wrapPino(pinoInstance: import("pino").Logger): Logger {
  const wrap =
    (level: "info" | "warn" | "error" | "debug"): LogFn =>
    (obj, msg) => {
      if (msg !== undefined) pinoInstance[level](obj, msg);
      else pinoInstance[level](obj);
    };
  return {
    info: wrap("info"),
    warn: wrap("warn"),
    error: wrap("error"),
    debug: wrap("debug"),
    child: (bindings) => wrapPino(pinoInstance.child(bindings)),
  };
}

// ── Pino singleton (lazy, async) ────────────────────────────────

let pinoPromise: Promise<import("pino").Logger | null> | null = null;

async function loadPino(): Promise<import("pino").Logger | null> {
  if (isEdgeRuntime()) return null;
  try {
    const pino = (await import("pino")).default;
    const isDev = process.env.NODE_ENV !== "production";
    return pino({
      level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
      // No pino-pretty: Alpine/Coolify image lacks glibc.
      base: { service: "golradar" },
      // pino v10: timestamp is false | (time: number) => string
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
    });
  } catch {
    return null;
  }
}

export async function getLogger(): Promise<Logger> {
  if (!pinoPromise) pinoPromise = loadPino();
  const pino = await pinoPromise;
  return pino ? wrapPino(pino) : createConsoleLogger();
}

// ── Sync proxy — routes through console until pino loads ─────────
//
// After the first async init, a background swap routes through pino.
// No per-call latency after warmup.

let cachedLogger: Logger = createConsoleLogger();

export const logger: Logger = {
  info: (obj, msg) => cachedLogger.info(obj, msg),
  warn: (obj, msg) => cachedLogger.warn(obj, msg),
  error: (obj, msg) => cachedLogger.error(obj, msg),
  debug: (obj, msg) => cachedLogger.debug(obj, msg),
  child: (bindings) => cachedLogger.child(bindings),
};

// Background promotion: console → pino after first async load.
if (typeof window === "undefined" && !pinoPromise) {
  pinoPromise = loadPino().then((p) => {
    if (p) cachedLogger = wrapPino(p);
    return p;
  });
}

// ── Legacy compat (backward-compatible re-exports) ─────────────
//
// devLog.ts still works as before. New code should prefer logger.*.
// 12+ existing files import logError/logWarn/logInfo — these
// helpers preserve the (context, ...args) signature so nothing
// else needs to change during this sprint.

export {
  logInfo,
  logWarn,
  logError,
  devLog,
  devWarn,
  devError,
} from "./devLog";
