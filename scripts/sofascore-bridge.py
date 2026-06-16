#!/usr/bin/env python3
"""
Sofascore bridge — wraps datafc functions for the Next.js app.
Called via execFile from sofascore.ts.

Usage:
  python3 scripts/sofascore-bridge.py --action matches-by-date --date YYYY-MM-DD
  python3 scripts/sofascore-bridge.py --action match-detail --game-id 12345
  python3 scripts/sofascore-bridge.py --action search --query "Galatasaray"

Output:
  JSON to stdout. Debug/log goes to stderr.
"""

import json
import sys
import argparse
import traceback
from typing import Any

# ── Monkey-patch SofascoreClient BEFORE datafc imports ─────────
# Sofascore tightened their API protection — 403 on direct calls.
# Fix: chrome131 impersonate + cookie warm-up from www.sofascore.com
import datafc.utils._config as _cfg
import datafc.utils._client as _client_mod
from curl_cffi import requests as _cf_req

# Route through api.sofascore.com (api.sofavpn.com is blocked)
_cfg.API_URLS["sofavpn"] = "https://api.sofascore.com"
_cfg.API_URLS["sofascore"] = "https://api.sofascore.com"


# Replace SofascoreClient.__init__ with cookie-warming version
def _patched_client_init(self, rate_limit=2.0, timeout=30, retries=3, cache=None):
    self._min_interval = 1.0 / rate_limit if rate_limit > 0 else 0.0
    self._timeout = timeout
    self._retries = retries
    self._cache = cache if cache is not None else _client_mod.get_default_cache()
    self._session = _cf_req.Session(impersonate="chrome131")
    self._session.headers.update(_cfg.SOFASCORE_HEADERS)
    # Warm cookies from main site — required post-2026 protection update
    try:
        self._session.get("https://www.sofascore.com/", timeout=15)
    except Exception:
        pass


_client_mod.SofascoreClient.__init__ = _patched_client_init

# ── datafc imports ─────────────────────────────────────────────
sys.path.insert(0, "docs/datafc")
from datafc.utils._client import SofascoreClient  # noqa: E402
from datafc.utils._config import API_URLS  # noqa: E402

from datafc import (  # noqa: E402
    match_stats_data,
    incidents_data,
    momentum_data,
    shots_data,
    match_data,
    search_data,
)
import pandas as pd  # noqa: E402


def fetch_matches_by_date(date: str) -> list[dict]:
    """Fetch scheduled/finished matches for a given date."""
    url = f"{API_URLS['sofavpn']}/api/v1/sport/football/scheduled-events/{date}"
    with SofascoreClient(rate_limit=1.5) as client:
        data = client.get(url)

    matches = []
    for ev in data.get("events", []):
        home = ev.get("homeTeam", {}) or {}
        away = ev.get("awayTeam", {}) or {}
        t = ev.get("tournament", {}) or {}
        status = ev.get("status", {}) or {}
        home_score = ev.get("homeScore", {}) or {}
        away_score = ev.get("awayScore", {}) or {}
        unique_t = t.get("uniqueTournament", {}) or {}
        season = ev.get("season", {}) or {}

        matches.append({
            "game_id": ev.get("id"),
            "home_team": home.get("name", ""),
            "away_team": away.get("name", ""),
            "home_team_id": home.get("id"),
            "away_team_id": away.get("id"),
            "home_team_slug": home.get("slug", ""),
            "away_team_slug": away.get("slug", ""),
            "tournament_id": unique_t.get("id"),
            "tournament_name": t.get("name", ""),
            "season_id": season.get("id"),
            "start_timestamp": ev.get("startTimestamp", 0),
            "status_code": status.get("code", 0),
            "status_type": status.get("type", ""),
            "status_desc": status.get("description", ""),
            "home_score": home_score.get("current"),
            "away_score": away_score.get("current"),
            "home_score_ht": home_score.get("period1"),
            "away_score_ht": away_score.get("period1"),
            "round": (ev.get("roundInfo", {}) or {}).get("round"),
        })
    return matches


def fetch_live_matches() -> list[dict]:
    """Fetch all currently live football matches."""
    url = f"{API_URLS['sofavpn']}/api/v1/sport/football/events/live"
    with SofascoreClient(rate_limit=1.5) as client:
        data = client.get(url)

    matches = []
    for ev in data.get("events", []):
        home = ev.get("homeTeam", {}) or {}
        away = ev.get("awayTeam", {}) or {}
        t = ev.get("tournament", {}) or {}
        status = ev.get("status", {}) or {}
        home_score = ev.get("homeScore", {}) or {}
        away_score = ev.get("awayScore", {}) or {}
        status_time = ev.get("statusTime", {}) or {}
        time_obj = ev.get("time", {}) or {}

        # Calculate live minute
        minute = None
        initial = status_time.get("initial")
        sc = status.get("code", 0)
        period_len = int(time_obj.get("periodLength", 2700) or 2700) // 60
        if sc in (6, 7, 8, 9, 10) and initial is not None:
            minute = int(initial) // 60
            if sc in (7,):
                minute += period_len
            elif sc in (8, 9, 10):
                minute += period_len * 2

        matches.append({
            "game_id": ev.get("id"),
            "home_team": home.get("name", ""),
            "away_team": away.get("name", ""),
            "tournament_name": t.get("name", ""),
            "home_score": home_score.get("current", 0),
            "away_score": away_score.get("current", 0),
            "minute": minute,
            "status_code": sc,
            "status_desc": status.get("description", ""),
            "start_timestamp": ev.get("startTimestamp", 0),
        })
    return matches


def fetch_match_detail(game_id: int) -> dict:
    """Fetch full match detail: incidents, stats, momentum, shots, details."""
    import math

    base = f"{API_URLS['sofavpn']}/api/v1/event/{game_id}"
    result: dict[str, Any] = {}

    with SofascoreClient(rate_limit=1.5) as client:
        # ── Match info ──
        try:
            event_data = client.get(base)
            event = event_data.get("event", {}) or event_data
            home_team = event.get("homeTeam", {}) or {}
            away_team = event.get("awayTeam", {}) or {}
            home_score = event.get("homeScore", {}) or {}
            away_score = event.get("awayScore", {}) or {}
            t = event.get("tournament", {}) or {}
            status = event.get("status", {}) or {}

            result["match_info"] = {
                "home_team": home_team.get("name", ""),
                "away_team": away_team.get("name", ""),
                "home_team_id": home_team.get("id"),
                "away_team_id": away_team.get("id"),
                "tournament_name": t.get("name", ""),
                "status_code": status.get("code"),
                "status_type": status.get("type"),
                "home_score": home_score.get("current"),
                "away_score": away_score.get("current"),
                "home_score_ht": home_score.get("period1"),
                "away_score_ht": away_score.get("period1"),
                "home_score_ft": home_score.get("normaltime"),
                "away_score_ft": away_score.get("normaltime"),
                "start_timestamp": event.get("startTimestamp"),
                "venue": (event.get("venue", {}) or {}).get("name"),
                "referee": (event.get("referee", {}) or {}).get("name"),
            }
        except Exception as e:
            result["match_info"] = {"error": str(e)}

        # ── Incidents (goals, cards, subs with exact minutes) ──
        try:
            inc_data = client.get(f"{base}/incidents")
            incidents = []
            for inc in inc_data.get("incidents", []):
                p = inc.get("player", {}) or {}
                incidents.append({
                    "incident_type": inc.get("incidentType"),
                    "incident_class": inc.get("incidentClass"),
                    "time": inc.get("time"),
                    "is_home": inc.get("isHome"),
                    "player_name": p.get("name", ""),
                    "player_id": p.get("id"),
                    "home_score": inc.get("homeScore"),
                    "away_score": inc.get("awayScore"),
                    "text": inc.get("text"),
                })
            result["incidents"] = incidents
        except Exception:
            result["incidents"] = []

        # ── Statistics ──
        try:
            stat_data = client.get(f"{base}/statistics")
            stats = []
            for period in stat_data.get("statistics", []):
                for group in period.get("groups", []):
                    gn = group.get("groupName", "")
                    for item in group.get("statisticsItems", []):
                        h = item.get("home")
                        a = item.get("away")
                        if isinstance(h, float) and math.isnan(h):
                            h = None
                        if isinstance(a, float) and math.isnan(a):
                            a = None
                        stats.append({
                            "period": period.get("period"),
                            "group_name": gn,
                            "stat_name": item.get("name"),
                            "home": h,
                            "away": a,
                        })
            result["statistics"] = stats
        except Exception:
            result["statistics"] = []

        # ── Momentum (per-minute attack intensity) ──
        try:
            mom_data = client.get(f"{base}/graph")
            result["momentum"] = [
                {"minute": p.get("minute"), "value": p.get("value")}
                for p in mom_data.get("graphPoints", [])
            ]
        except Exception:
            result["momentum"] = []

        # ── Shot map ──
        try:
            shot_data = client.get(f"{base}/shotmap")
            shots = []
            for s in shot_data.get("shotmap", []):
                player = s.get("player", {}) or {}
                shots.append({
                    "minute": s.get("minute"),
                    "x": s.get("x"),
                    "y": s.get("y"),
                    "expected_goal": s.get("expectedGoal"),
                    "expected_goal_on_target": s.get("expectedGoalOnTarget"),
                    "player_name": player.get("name", ""),
                    "situation": s.get("situation"),
                    "shot_type": s.get("shotType"),
                    "body_part": s.get("bodyPart"),
                    "is_home": s.get("isHome"),
                    "is_blocked": s.get("isBlocked"),
                    "is_goal": s.get("isGoal"),
                    "is_on_target": s.get("isOnTarget"),
                    "is_saved": s.get("isSaved"),
                })
            result["shots"] = shots
        except Exception:
            result["shots"] = []

    return result


def search_teams(query: str) -> list[dict]:
    """Search for teams by name."""
    try:
        df = search_data(query, entity_type="team", data_source="sofavpn")
        results = []
        for _, r in df.head(20).iterrows():
            results.append({
                "id": int(r.get("entity_id", 0)),
                "name": str(r.get("entity_name", "")),
                "slug": str(r.get("entity_slug", "")),
            })
        return results
    except Exception:
        return []


def main():
    parser = argparse.ArgumentParser(description="Sofascore data bridge")
    parser.add_argument(
        "--action",
        required=True,
        choices=[
            "matches-by-date",
            "live-matches",
            "match-detail",
            "search",
            "match-stats",
            "match-incidents",
            "match-momentum",
            "match-shots",
        ],
    )
    parser.add_argument("--date", help="Date in YYYY-MM-DD format")
    parser.add_argument("--game-id", type=int, help="Sofascore game/match ID")
    parser.add_argument("--query", help="Search query")

    args = parser.parse_args()

    try:
        if args.action == "matches-by-date":
            if not args.date:
                raise ValueError("--date required for matches-by-date")
            data = fetch_matches_by_date(args.date)

        elif args.action == "live-matches":
            data = fetch_live_matches()

        elif args.action == "match-detail":
            if not args.game_id:
                raise ValueError("--game-id required for match-detail")
            data = fetch_match_detail(args.game_id)

        elif args.action == "search":
            if not args.query:
                raise ValueError("--query required for search")
            data = search_teams(args.query)

        elif args.action in (
            "match-stats",
            "match-incidents",
            "match-momentum",
            "match-shots",
        ):
            if not args.game_id:
                raise ValueError("--game-id required")
            detail = fetch_match_detail(args.game_id)
            key = {
                "match-stats": "statistics",
                "match-incidents": "incidents",
                "match-momentum": "momentum",
                "match-shots": "shots",
            }[args.action]
            data = detail.get(key, [])

        else:
            raise ValueError(f"Unknown action: {args.action}")

        print(json.dumps({"ok": True, "data": data}))

    except Exception as e:
        print(
            json.dumps({"ok": False, "error": str(e), "trace": traceback.format_exc()}),
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
