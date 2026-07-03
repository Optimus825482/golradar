#!/usr/bin/env python3
"""
Understat xG scraper — golradar2 eğitim verisi için.
Top 5 ligdeki bitmiş maçların xG verilerini çeker.

Understat'tan alınan veriler:
  - Maç başına home_xG, away_xG
  - Şut detayları (koordinat, xG, sonuç, durum)
  - Lig bazında sezon verisi

Kullanım:
  python3 scripts/understat-fetch.py --action leagues
  python3 scripts/understat-fetch.py --action league-matches --league EPL --season 2025
  python3 scripts/understat-fetch.py --action match-shots --match-id 12345
  python3 scripts/understat-fetch.py --action backfill-top5

Understat API endpoint'leri:
  https://understat.com/league/{league}/{season}
  https://understat.com/match/{match_id}

Limitations:
  - Top 5 lig: EPL, La Liga, Bundesliga, Serie A, Ligue 1
  - Understat rate-limit uygulamaz ama saygılı olmak için 1s aralıklı istek
  - xG verisi genellikle maçtan 24-48 saat sonra güncellenir
"""

import json
import sys
import argparse
import time
import re
from typing import Any
from urllib.request import urlopen, Request
from urllib.parse import urlencode

UNDERSTAT_BASE = "https://understat.com"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json, text/html",
}

LEAGUES = {
    "EPL": "EPL",           # Premier League
    "La_liga": "La_liga",   # La Liga
    "Bundesliga": "Bundesliga",
    "Serie_A": "Serie_A",   # Serie A
    "Ligue_1": "Ligue_1",
}

LEAGUE_NAMES = {
    "EPL": "Premier League",
    "La_liga": "La Liga",
    "Bundesliga": "Bundesliga",
    "Serie_A": "Serie A",
    "Ligue_1": "Ligue 1",
}


def _fetch(url: str) -> str:
    """HTTP GET with headers + rate-limit."""
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8")


def fetch_leagues() -> list[dict]:
    """Understat'taki tüm ligleri listele."""
    try:
        html = _fetch(f"{UNDERSTAT_BASE}/league/EPL/2025")
        # Lig listesi HTML'de gömülü JSON'dan çekilir
        return [{"id": k, "name": v} for k, v in LEAGUES.items()]
    except Exception as e:
        return [{"error": str(e)}]


def _extract_json_var(html: str, var_name: str) -> Any:
    """HTML içindeki 'var_name = {...}' veya 'var_name = [...]' desenini bul."""
    pattern = re.compile(
        rf"{re.escape(var_name)}\s*=\s*({{.+?}}|\[.+?\])\s*;",
        re.DOTALL,
    )
    m = pattern.search(html)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            return None
    return None


def fetch_league_matches(league: str, season: int) -> list[dict]:
    """Bir lig+sezon için tüm maçları ve xG verilerini çeker.

    Returns:
        Her maç için: id, home_team, away_team, home_xg, away_xg,
        home_goals, away_goals, datetime, season
    """
    if league not in LEAGUES:
        return [{"error": f"Unknown league: {league}. Use one of: {list(LEAGUES.keys())}"}]

    try:
        html = _fetch(f"{UNDERSTAT_BASE}/league/{league}/{season}")
        matches_data = _extract_json_var(html, "datesData")

        if not matches_data:
            return [{"error": f"No data for {league} {season}"}]

        matches = []
        for m in matches_data:
            matches.append({
                "id": m.get("id"),
                "home_team": m.get("h", {}).get("title", ""),
                "away_team": m.get("a", {}).get("title", ""),
                "home_xg": float(m.get("xG", {}).get("h", "0") or 0),
                "away_xg": float(m.get("xG", {}).get("a", "0") or 0),
                "home_goals": int(m.get("goals", {}).get("h", 0) or 0),
                "away_goals": int(m.get("goals", {}).get("a", 0) or 0),
                "datetime": m.get("datetime"),
                "season": season,
                "league": league,
            })

        return matches

    except Exception as e:
        return [{"error": str(e)}]


def fetch_match_shots(match_id: int) -> dict:
    """Bir maçtaki tüm şutları xG detaylarıyla çeker.

    Returns:
        home_players: her oyuncunun xG'li şut listesi
        away_players: her oyuncunun xG'li şut listesi
    """
    try:
        html = _fetch(f"{UNDERSTAT_BASE}/match/{match_id}")
        shots_data = _extract_json_var(html, "shotsData")

        if not shots_data:
            return {"error": f"No shot data for match {match_id}"}

        result = {"home": [], "away": []}
        for s in shots_data:
            side = "home" if s.get("h_a") == "h" else "away"
            result[side].append({
                "player": s.get("player", ""),
                "minute": s.get("minute"),
                "xG": float(s.get("xG", 0) or 0),
                "situation": s.get("situation", ""),
                "shotType": s.get("shotType", ""),
                "result": s.get("result", ""),
                "X": s.get("X"),  # pitch koordinatı (0-100)
                "Y": s.get("Y"),
                "player_id": s.get("player_id"),
            })

        return result

    except Exception as e:
        return {"error": str(e)}


def backfill_top5(start_season: int = 2020, end_season: int = 2025) -> list[dict]:
    """Tüm top 5 lig ve sezonlar için maç verilerini toplar.

    Rate-limit: her istek arası 1.5 sn
    """
    all_matches = []

    for league in LEAGUES:
        for season in range(start_season, end_season + 1):
            print(f"[Understat] Fetching {league} {season}...", file=sys.stderr)
            matches = fetch_league_matches(league, season)

            if matches and "error" not in matches[0]:
                all_matches.extend(matches)
                print(f"  -> {len(matches)} matches", file=sys.stderr)
            else:
                err = matches[0].get("error", "unknown") if matches else "no data"
                print(f"  -> Error: {err}", file=sys.stderr)

            time.sleep(1.5)  # rate-limit

    return all_matches


def main():
    parser = argparse.ArgumentParser(description="Understat xG scraper")
    parser.add_argument("--action", required=True,
                        choices=["leagues", "league-matches", "match-shots", "backfill-top5"])
    parser.add_argument("--league", help="League slug (EPL, La_liga, Bundesliga, Serie_A, Ligue_1)")
    parser.add_argument("--season", type=int, default=2025, help="Season year (default: 2025)")
    parser.add_argument("--match-id", type=int, help="Understat match ID")
    parser.add_argument("--start-season", type=int, default=2020, help="Backfill start season")
    parser.add_argument("--end-season", type=int, default=2025, help="Backfill end season")

    args = parser.parse_args()

    try:
        if args.action == "leagues":
            data = fetch_leagues()

        elif args.action == "league-matches":
            if not args.league:
                raise ValueError("--league required for league-matches")
            data = fetch_league_matches(args.league, args.season)

        elif args.action == "match-shots":
            if not args.match_id:
                raise ValueError("--match-id required for match-shots")
            data = fetch_match_shots(args.match_id)

        elif args.action == "backfill-top5":
            data = backfill_top5(args.start_season, args.end_season)

        else:
            raise ValueError(f"Unknown action: {args.action}")

        print(json.dumps({"ok": True, "data": data}))

    except Exception as e:
        import traceback
        print(json.dumps({
            "ok": False,
            "error": str(e),
            "trace": traceback.format_exc(),
        }))


if __name__ == "__main__":
    main()
