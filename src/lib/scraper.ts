/**
 * Universal scraper utility — calls Python scrape_bridge.py to bypass anti-bot.
 * All external data sources (Scoremer, Goaloo, FotMob, NetScores) use this.
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const PYTHON = process.env.PYTHON_PATH || 'C:\\Python313\\python.exe';
const BRIDGE = join(process.cwd(), 'scripts', 'scrape_bridge.py');
const NETSCORES_SCRIPT = join(process.cwd(), 'scripts', 'netscores-fetch.py');

interface ScrapeResult {
  ok: boolean;
  data?: any;
  error?: string;
}

/**
 * Fetch a URL using the Python scraping bridge.
 * Tries SCRAPING_ULTIMATE → curl_cffi → playwright automatically.
 */
export function scrapeUrl(url: string, options?: {
  type?: 'html' | 'json';
  referer?: string;
  timeout?: number;
}): ScrapeResult {
  if (!existsSync(PYTHON)) {
    return { ok: false, error: `Python not found at ${PYTHON}. Set PYTHON_PATH env.` };
  }

  const { type = 'html', referer = '', timeout = 20000 } = options || {};

  try {
    const args = [BRIDGE, '--url', url, '--type', type, '--timeout', String(timeout)];
    if (referer) args.push('--referer', referer);

    const stdout = execFileSync(PYTHON, args, {
      encoding: 'utf-8',
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });

    return JSON.parse(stdout);
  } catch (err: any) {
    return { ok: false, error: err.message?.substring(0, 200) || String(err) };
  }
}

/**
 * NetScores-specific fetch using the existing Scrapling script (curl_cffi).
 */
function fetchNetScoresViaPython(url: string, timeoutMs = 20000): ScrapeResult {
  if (!existsSync(NETSCORES_SCRIPT)) {
    return { ok: false, error: 'netscores-fetch.py not found' };
  }

  try {
    const stdout = execFileSync(PYTHON, [NETSCORES_SCRIPT, url, '--timeout', String(timeoutMs)], {
      encoding: 'utf-8',
      timeout: timeoutMs,
      maxBuffer: 5 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (err: any) {
    return { ok: false, error: err.message?.substring(0, 200) || String(err) };
  }
}
