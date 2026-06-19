// ── Universal Logger ───────────────────────────────────────────────
// Logger that works in ALL environments (dev + production).
// - devLog / devWarn / devError: gated to NODE_ENV === 'development' (original behavior)
// - logError: ALWAYS logs to console.error (production-safe)
// - logWarn: ALWAYS logs to console.warn
// - logInfo: ALWAYS logs to console.log
//
// Future: swap console.* with a structured logger (pino, winston)
// or Sentry/Logtail for production observability.

export const devLog = (...args: unknown[]) => {
  if (process.env.NODE_ENV === 'development') console.log(...args);
};

export const devWarn = (...args: unknown[]) => {
  if (process.env.NODE_ENV === 'development') console.warn(...args);
};

export const devError = (...args: unknown[]) => {
  if (process.env.NODE_ENV === 'development') console.error(...args);
};

/**
 * Production-safe error logger.
 * Always logs to console.error regardless of NODE_ENV.
 * Use this in ALL catch blocks instead of empty catches.
 */
export function logError(context: string, ...args: unknown[]) {
  const prefix = `[${context}]`;
  console.error(prefix, ...args);
}

/**
 * Production-safe warning logger.
 */
export function logWarn(context: string, ...args: unknown[]) {
  const prefix = `[${context}]`;
  console.warn(prefix, ...args);
}

/**
 * Production-safe info logger.
 */
export function logInfo(context: string, ...args: unknown[]) {
  const prefix = `[${context}]`;
  console.log(prefix, ...args);
}
