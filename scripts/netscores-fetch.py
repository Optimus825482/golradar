#!/usr/bin/env python3
"""
NetScores API fetcher using Scrapling (curl_cffi under the hood).
Bypasses Cloudflare protection that blocks direct Node.js fetch.

Usage:
  python3 netscores-fetch.py <url> [--timeout <ms>]

Output:
  JSON to stdout: {"ok": true, "data": {...}} or {"ok": false, "error": "..."}
  Debug/log output goes to stderr.
"""

import sys
import json
import argparse


def fetch_netscores(url: str, timeout_ms: int = 20000) -> dict:
    """Fetch a URL using Scrapling's Fetcher (curl_cffi-based, anti-fingerprinting)."""
    try:
        from scrapling import Fetcher
    except ImportError:
        return {"ok": False, "error": "Scrapling not installed"}

    try:
        fetcher = Fetcher()
        result = fetcher.get(
            url,
            headers={
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Accept-Language": "en-US,en;q=0.9",
                "Referer": "https://www.netscores.com/",
                "Origin": "https://www.netscores.com",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
            },
        )

        if result.status != 200:
            return {"ok": False, "error": f"HTTP {result.status}"}

        try:
            data = result.json()
            return {"ok": True, "data": data}
        except Exception:
            # Try parsing text manually
            text = result.text if hasattr(result, "text") else result.getall_text()
            if text and len(text) > 0 and len(text) < 500000:
                try:
                    data = json.loads(text)
                    return {"ok": True, "data": data}
                except json.JSONDecodeError as e:
                    return {"ok": False, "error": f"JSON parse error: {e}"}
            return {"ok": False, "error": f"No JSON data (text len={len(text) if text else 0})"}

    except Exception as e:
        return {"ok": False, "error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="Fetch NetScores API via Scrapling")
    parser.add_argument("url", help="URL to fetch")
    parser.add_argument("--timeout", type=int, default=20000, help="Timeout in milliseconds")
    args = parser.parse_args()

    result = fetch_netscores(args.url, args.timeout)
    # Output JSON to stdout (Node.js reads this)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
