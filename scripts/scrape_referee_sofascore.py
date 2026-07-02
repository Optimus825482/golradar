#!/usr/bin/env python3
"""Sofascore referee stats scraper (JSON API, no JS required).

Endpoints:
  - Search: GET /api/v1/search/referees?q=<name>
  - Detail: GET /api/v1/referee/<id>

Returns aggregate stats suitable for ML features:
  - matchesCount, avgYellowCards, avgRedCards, avgYellowRedCards

Used by src/lib/refereeStats.ts via child_process (no JS runtime
needed in the Node side — pure HTTP).

Output JSON shape (compatible with scrape_referee_sahadan.py):
  {
    "ok": true,
    "refereeName": "Cuneyt Cakir",
    "uuid": "52444",                  # Sofascore numeric ID
    "nationality": "TR",
    "matchesCount": 389,
    "avgYellowCards": 4.10,
    "avgRedCards": 0.11,
    "avgYellowRedCards": 0.13,
    "cardRate": 4.10,                  # alias for DB column
    "penaltyRate": 0.0,                # Sofascore doesn't expose
    "totalYellow": 1594,
    "totalRed": 44,
    "totalPenalty": 0
  }
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from typing import Any, Dict, Optional

try:
    from curl_cffi import requests
except ImportError:
    import requests  # type: ignore[no-redef]

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

API_BASE = "https://api.sofascore.com/api/v1"


def search_referee(name: str) -> Optional[Dict[str, Any]]:
    """Search a referee by name. Returns best match (highest score)."""
    try:
        r = requests.get(
            f"{API_BASE}/search/referees",
            params={"q": name},
            impersonate="chrome124",
            timeout=10,
            headers={"User-Agent": USER_AGENT},
        )
    except Exception:
        return None
    if r.status_code != 200:
        return None
    try:
        data = json.loads(r.text)
    except Exception:
        return None
    results = data.get("results", [])
    if not results:
        return None
    # Best match = first by score (API returns sorted)
    # Prefer exact name match over partial
    name_lc = name.lower().strip()
    for entry in results:
        ent = entry.get("entity", {})
        if ent.get("name", "").lower().strip() == name_lc:
            return ent
    return results[0].get("entity")


def get_referee(referee_id: int | str) -> Optional[Dict[str, Any]]:
    """Fetch full referee detail (id, name, country, career stats)."""
    try:
        r = requests.get(
            f"{API_BASE}/referee/{referee_id}",
            impersonate="chrome124",
            timeout=10,
            headers={"User-Agent": USER_AGENT},
        )
    except Exception:
        return None
    if r.status_code != 200:
        return None
    try:
        return json.loads(r.text).get("referee")
    except Exception:
        return None


def get_referee_statistics(referee_id: int | str) -> Optional[list]:
    """Per-tournament stats including penalty count.

    Endpoint: GET /api/v1/referee/<id>/statistics
    Returns: list of {uniqueTournament, appearances, yellowCards,
                       yellowRedCards, redCards, penalty}
    Sofascore aggregates per tournament; we sum for career totals.
    """
    try:
        r = requests.get(
            f"{API_BASE}/referee/{referee_id}/statistics",
            impersonate="chrome124",
            timeout=10,
            headers={"User-Agent": USER_AGENT},
        )
    except Exception:
        return None
    if r.status_code != 200:
        return None
    try:
        return json.loads(r.text).get("statistics") or []
    except Exception:
        return None


def scrape_referee(name: str) -> Dict[str, Any]:
    """Resolve name → ID → stats (detail + per-tournament).
    Returns normalized JSON dict with penalty data.
    """
    entity = search_referee(name)
    if not entity:
        return {"ok": False, "refereeName": name, "error": "no search results"}
    ref_id = entity.get("id")
    if not ref_id:
        return {"ok": False, "refereeName": name, "error": "no id in search result"}
    detail = get_referee(ref_id)
    if not detail:
        return {"ok": False, "refereeName": name, "error": f"detail fetch failed (id={ref_id})"}
    # Per-tournament statistics — adds penalty and per-tournament breakdown
    stats_list = get_referee_statistics(ref_id)
    return _normalize(detail, stats_list, searched_name=name)


def _normalize(
    ref: Dict[str, Any],
    stats_list: Optional[list] = None,
    searched_name: str = "",
) -> Dict[str, Any]:
    """Sofascore payload → normalized JSON for downstream DB/feature use."""
    name = ref.get("name") or searched_name
    games = int(ref.get("games") or 0)
    yellow = int(ref.get("yellowCards") or 0)
    red = int(ref.get("redCards") or 0)
    y2r = int(ref.get("yellowRedCards") or 0)
    if games == 0:
        return {
            "ok": False,
            "refereeName": name,
            "error": "no games played",
        }
    country = ref.get("country", {}) or {}

    # Sum per-tournament stats (penalty ekle)
    total_penalty = 0
    tournament_breakdown = []
    if stats_list:
        for s in stats_list:
            if not isinstance(s, dict):
                continue
            pen = int(s.get("penalty") or 0)
            total_penalty += pen
            t = s.get("uniqueTournament", {}) or {}
            tournament_breakdown.append({
                "name": t.get("name", ""),
                "appearances": s.get("appearances", 0),
                "yellowCards": s.get("yellowCards", 0),
                "redCards": s.get("redCards", 0),
                "yellowRedCards": s.get("yellowRedCards", 0),
                "penalty": pen,
            })

    return {
        "ok": True,
        "refereeName": name,
        "uuid": str(ref.get("id")),
        "nationality": country.get("alpha2", ""),
        "matchesCount": games,
        "avgYellowCards": round(yellow / games, 3),
        "avgRedCards": round(red / games, 3),
        "avgYellowRedCards": round(y2r / games, 3),
        "cardRate": round(yellow / games, 3),
        "penaltyRate": round(total_penalty / games, 3) if games > 0 else 0.0,
        "totalYellow": yellow,
        "totalRed": red,
        "totalPenalty": total_penalty,
        "tournaments": tournament_breakdown,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Sofascore referee stats scraper")
    parser.add_argument("name", nargs="?", help="Referee name (e.g. 'Cuneyt Cakir')")
    parser.add_argument("--id", help="Direct referee ID (skip search)")
    parser.add_argument("--batch", metavar="FILE", help="File with one name per line")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON")
    args = parser.parse_args()

    if not args.name and not args.id and not args.batch:
        parser.error("Provide name, --id, or --batch")

    indent = 2 if args.pretty else None
    if args.batch:
        try:
            with open(args.batch, encoding="utf-8") as f:
                lines = [line.strip() for line in f if line.strip()]
        except OSError as exc:
            print(json.dumps({"ok": False, "error": str(exc)}))
            return 1
        results = []
        for n in lines:
            results.append(scrape_referee(n))
            time.sleep(0.3)
        print(json.dumps(results, indent=indent, ensure_ascii=False))
        ok = sum(1 for r in results if r.get("ok"))
        print(f"\n# {ok}/{len(results)} succeeded", file=sys.stderr)
        return 0 if ok == len(results) else 1

    if args.id:
        ref = get_referee(args.id)
        if not ref:
            print(json.dumps({"ok": False, "id": args.id, "error": "not found"}))
            return 1
        result = _normalize(ref)
    else:
        result = scrape_referee(args.name)
    print(json.dumps(result, indent=indent, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
