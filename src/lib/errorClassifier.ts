// ── Structured Error Classification ───────────────────────────────
export type ErrorType = 'timeout' | 'http_4xx' | 'http_5xx' | 'dns' | 'parse' | 'network' | 'unknown';

export interface ClassifiedError {
  source: string;
  errorType: ErrorType;
  message: string;
  statusCode?: number;
}

export function classifyError(source: string, err: unknown, httpStatus?: number): ClassifiedError {
  const msg = err instanceof Error ? err.message : String(err);

  if (httpStatus) {
    if (httpStatus >= 400 && httpStatus < 500) return { source, errorType: 'http_4xx', message: msg, statusCode: httpStatus };
    if (httpStatus >= 500) return { source, errorType: 'http_5xx', message: msg, statusCode: httpStatus };
  }

  const lc = msg.toLowerCase();
  if (lc.includes('timeout') || lc.includes('abort') || lc.includes('timed out')) return { source, errorType: 'timeout', message: msg };
  if (lc.includes('dns') || lc.includes('enotfound') || lc.includes('econnrefused')) return { source, errorType: 'dns', message: msg };
  if (lc.includes('parse') || lc.includes('json') || lc.includes('syntax') || lc.includes('unexpected token')) return { source, errorType: 'parse', message: msg };
  if (lc.includes('network') || lc.includes('fetch') || lc.includes('socket')) return { source, errorType: 'network', message: msg };

  return { source, errorType: 'unknown', message: msg };
}
