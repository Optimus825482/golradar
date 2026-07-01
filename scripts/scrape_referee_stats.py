"""Transfermarkt hakem istatistikleri scraper.

Kullanım:
  python3 scripts/scrape_referee_stats.py <referee_url>
  python3 scripts/scrape_referee_stats.py --batch urls.txt

Referee URL formatı (Transfermarkt):
  https://www.transfermarkt.com/clement-turpin/profil/schiedsrichter/1
  https://www.transfermarkt.com/<slug>/profil/schiedsrichter/<id>

Çıktı: JSON object (stdout) — DB'ye yazmak için refereeStats.ts
tarafından parse edilir.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any

try:
    from curl_cffi import requests
except ImportError:  # graceful fallback for local dev
    import requests  # type: ignore[no-redef]

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


def fetch_html(url: str) -> str | None:
    """Sayfa HTML'ini çek. 200 değilse None döndür."""
    try:
        if hasattr(requests, "get") and "impersonate" in requests.get.__code__.co_varnames:
            result = requests.get(  # type: ignore[call-arg]
                url,
                impersonate="chrome124",
                timeout=15,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept-Language": "en-US,en;q=0.9",
                },
            )
        else:
            result = requests.get(  # type: ignore[call-arg]
                url,
                timeout=15,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept-Language": "en-US,en;q=0.9",
                },
            )
        if result.status_code != 200:
            return None
        return result.text
    except Exception as exc:  # network errors, timeout, etc.
        return f"__error__:{type(exc).__name__}:{exc}"


def _to_int(s: str | None) -> int:
    if not s:
        return 0
    m = re.search(r"\d+", s)
    return int(m.group(0)) if m else 0


def _to_float(s: str | None) -> float:
    if not s:
        return 0.0
    m = re.search(r"\d+(?:\.\d+)?", s)
    return float(m.group(0)) if m else 0.0


def parse_stats_html(html: str, referee_url: str) -> dict[str, Any]:
    """Transfermarkt referee sayfasından stats çıkar.

    Transfermarkt formatı sık sık değiştiği için birden çok regex
    pattern dene ve ilk eşleşmeyi al. Hata durumunda tüm alanlar
    0 olarak döner.
    """
    matches = _to_int(re.search(r"(\d+)\s*matches", html, re.IGNORECASE))
    yellow = _to_int(re.search(r"(\d+)\s*yellow\s*cards?", html, re.IGNORECASE))
    red = _to_int(re.search(r"(\d+)\s*red\s*cards?", html, re.IGNORECASE))
    fouls = _to_float(re.search(r"([\d.]+)\s*fouls\s*per\s*match", html, re.IGNORECASE))
    penalties = _to_int(re.search(r"(\d+)\s*penalt", html, re.IGNORECASE))

    # Slug → insan-okunabilir isim
    slug = referee_url.rstrip("/").split("/")[-1] or "unknown-referee"
    referee_name = slug.replace("-", " ").title()

    if matches <= 0:
        return {
            "ok": False,
            "refereeName": referee_name,
            "error": "no matches count found in HTML",
            "matchesCount": 0,
            "avgYellowCards": 0.0,
            "avgRedCards": 0.0,
            "avgFouls": 0.0,
            "avgPenalties": 0.0,
            "penaltyRate": 0.0,
            "cardRate": 0.0,
        }

    return {
        "ok": True,
        "refereeName": referee_name,
        "matchesCount": matches,
        "avgYellowCards": yellow / matches,
        "avgRedCards": red / matches,
        "avgFouls": fouls,
        "avgPenalties": penalties / matches,
        "penaltyRate": penalties / matches,
        "cardRate": (yellow + red) / matches,
    }


def scrape_referee(referee_url: str) -> dict[str, Any]:
    """Tek hakem için scrape et, JSON dict döndür."""
    html = fetch_html(referee_url)
    if html is None:
        return {
            "ok": False,
            "refereeName": referee_url.rstrip("/").split("/")[-1].replace("-", " ").title(),
            "error": "HTTP request failed",
        }
    if html.startswith("__error__:"):
        return {
            "ok": False,
            "refereeName": referee_url.rstrip("/").split("/")[-1].replace("-", " ").title(),
            "error": html,
        }
    return parse_stats_html(html, referee_url)


def main() -> int:
    parser = argparse.ArgumentParser(description="Transfermarkt referee stats scraper")
    parser.add_argument("url", nargs="?", help="Single referee URL")
    parser.add_argument("--batch", metavar="FILE", help="File with one URL per line")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON")
    args = parser.parse_args()

    if not args.url and not args.batch:
        parser.error("Provide either a URL or --batch <file>")

    indent = 2 if args.pretty else None
    if args.batch:
        try:
            with open(args.batch, encoding="utf-8") as f:
                urls = [line.strip() for line in f if line.strip()]
        except OSError as exc:
            print(json.dumps({"ok": False, "error": f"Cannot read {args.batch}: {exc}"}))
            return 1
        results = [scrape_referee(u) for u in urls]
        print(json.dumps(results, indent=indent, ensure_ascii=False))
        return 0

    result = scrape_referee(args.url)
    print(json.dumps(result, indent=indent, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
