#!/usr/bin/env python3
"""
Universal scraping bridge — bypasses Cloudflare/Akamai/etc. for all external sources.
Uses SCRAPING_ULTIMATE's ultimate_scrape() as primary, curl_cffi as fallback.

Usage:
  python scrape_bridge.py --url <URL> [--type html|json] [--referer <URL>] [--timeout <ms>]

Output:
  JSON to stdout: {"ok": true, "data": "..."} or {"ok": false, "error": "..."}
"""

import sys, json, argparse, asyncio, traceback

async def scrape(url: str, resp_type: str = "html", referer: str = "",
                 timeout_ms: int = 20000) -> dict:
    """Try ultimate_scrape first, then curl_cffi, then playwright."""
    # --- Strategy 1: SCRAPING_ULTIMATE ---
    try:
        sys.path.insert(0, r"C:\Users\erkan\.commandcode\skills\SCRAPING_ULTIMATE")
        from SCRAPING_ULTIMATE import ultimate_scrape
        result = await ultimate_scrape(url, options={
            "rate": 5, "max_retries": 2, "fingerprint": "chrome_120",
        })
        if result.get("success") and result.get("data"):
            return {"ok": True, "data": result["data"]}
    except Exception:
        pass

    # --- Strategy 2: curl_cffi (TLS fingerprint) ---
    try:
        from curl_cffi.requests import get as curl_get
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8",
            "Accept-Encoding": "gzip, deflate",
        }
        if referer:
            headers["Referer"] = referer
        if resp_type == "json":
            headers["Accept"] = "application/json, text/javascript, */*; q=0.01"
            headers["X-Requested-With"] = "XMLHttpRequest"
        else:
            headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"

        resp = curl_get(url, headers=headers, timeout=timeout_ms / 1000,
                                 impersonate="chrome")
        if resp.status_code == 200:
            data = resp.text
            if resp_type == "json":
                try:
                    json.loads(data)  # validate
                except json.JSONDecodeError:
                    return {"ok": False, "error": "curl_cffi: invalid JSON response"}
            return {"ok": True, "data": data}
        return {"ok": False, "error": f"curl_cffi HTTP {resp.status_code}"}
    except Exception as e:
        return {"ok": False, "error": f"curl_cffi: {e}"}

def main():
    parser = argparse.ArgumentParser(description="Universal scraping bridge")
    parser.add_argument("--url", required=True)
    parser.add_argument("--type", choices=["html", "json"], default="html")
    parser.add_argument("--referer", default="")
    parser.add_argument("--timeout", type=int, default=20000)
    args = parser.parse_args()

    result = asyncio.run(scrape(args.url, args.type, args.referer, args.timeout))
    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    main()
