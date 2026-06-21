/**
 * Universal scraper utility — calls Python scrape_bridge.py to bypass anti-bot.
 * All external data sources (Scoremer, Goaloo, FotMob, NetScores) use this.
 */

interface ScrapeResult {
  ok: boolean;
  data?: any;
  error?: string;
}

let _PYTHON: string | null | undefined;
async function getPython(): Promise<string | null> {
  if (_PYTHON !== undefined) return _PYTHON || null;
  if (typeof window !== 'undefined') { _PYTHON = null; return null; }
  try {
    const { existsSync } = await import('fs');
    const { join } = await import('path');
    const python = process.env.PYTHON_PATH || 'python3';
    const bridge = join(process.cwd(), 'scripts', 'scrape_bridge.py');
    if (!existsSync(bridge)) { _PYTHON = null; return null; }
    _PYTHON = python;
    return python;
  } catch { _PYTHON = null; return null; }
}

async function getBridgePath(): Promise<string | null> {
  if (typeof window !== 'undefined') return null;
  try {
    const { join } = await import('path');
    return join(process.cwd(), 'scripts', 'scrape_bridge.py');
  } catch { return null; }
}

async function getNetScoresScript(): Promise<string | null> {
  if (typeof window !== 'undefined') return null;
  try {
    const { join } = await import('path');
    return join(process.cwd(), 'scripts', 'netscores-fetch.py');
  } catch { return null; }
}

/**
 * Fetch a URL using the Python scraping bridge.
 */
export async function scrapeUrl(url: string, options?: {
  type?: 'html' | 'json';
  referer?: string;
  timeout?: number;
}): Promise<ScrapeResult> {
  const execFile = typeof window === 'undefined' ? require('child_process').execFile : null;
  const python = await getPython();
  const bridge = await getBridgePath();
  if (!python || !bridge) return { ok: false, error: 'Python not available' };
  if (typeof window !== 'undefined') return { ok: false, error: 'scrapeUrl is server-only' };

  const { type = 'html', referer = '', timeout = 20000 } = options || {};

  return new Promise((resolve) => {
    try {
      const args = [bridge, '--url', url, '--type', type, '--timeout', String(timeout)];
      if (referer) args.push('--referer', referer);
      execFile(python, args, {
        encoding: 'utf-8',
        timeout,
        maxBuffer: 10 * 1024 * 1024,
      }, (err: any, stdout: string) => {
        if (err) { resolve({ ok: false, error: err.message?.substring(0, 200) || String(err) }); return; }
        try { resolve(JSON.parse(stdout)); }
        catch { resolve({ ok: false, error: 'invalid JSON from scraper' }); }
      });
    } catch (err: any) { resolve({ ok: false, error: err.message?.substring(0, 200) || String(err) }); }
  });
}

/**
 * NetScores-specific fetch using the existing Scrapling script (curl_cffi).
 */
async function fetchNetScoresViaPython(url: string, timeoutMs = 20000): Promise<ScrapeResult> {
  const execFile = typeof window === 'undefined' ? require('child_process').execFile : null;
  const python = await getPython();
  const script = await getNetScoresScript();
  if (!python || !script) return { ok: false, error: 'netscores-fetch.py not found' };
  if (typeof window !== 'undefined') return { ok: false, error: 'fetchNetScoresViaPython is server-only' };

  return new Promise((resolve) => {
    try {
      execFile(python, [script, url, '--timeout', String(timeoutMs)], {
        encoding: 'utf-8',
        timeout: timeoutMs,
        maxBuffer: 5 * 1024 * 1024,
      }, (err: any, stdout: string) => {
        if (err) { resolve({ ok: false, error: err.message?.substring(0, 200) || String(err) }); return; }
        try { resolve(JSON.parse(stdout)); }
        catch { resolve({ ok: false, error: 'invalid JSON from netscores scraper' }); }
      });
    } catch (err: any) { resolve({ ok: false, error: err.message?.substring(0, 200) || String(err) }); }
  });
}
