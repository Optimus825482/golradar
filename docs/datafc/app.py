"""datafc Flask Test UI.

Single-file Flask app exposing datafc functions as REST endpoints.
Server keeps a per-session dict of last-fetched DataFrames so chained
calls (squad_data needs standings_df, etc.) can reuse them.
"""
from __future__ import annotations

import traceback
from pathlib import Path
from typing import Any, Callable

import pandas as pd
from flask import Flask, jsonify, render_template, request, send_file

from datafc import (
    incidents_data,
    league_player_stats_data,
    match_data,
    match_details_data,
    match_h2h_data,
    match_odds_data,
    match_stats_data,
    momentum_data,
    save_parquet,
    search_data,
    seasons_data,
    shots_data,
    squad_data,
    standings_data,
)
from datafc.utils._tournament_info import resolve_tournament_season
from datafc.utils._client import SofascoreClient
from datafc.utils._config import API_URLS

app = Flask(__name__)

# In-memory store of last-fetched DataFrames per function name.
# Keyed by function name; last result wins. Sufficient for single-user
# local testing; replace with disk cache if multi-session needed.
DF_STORE: dict[str, pd.DataFrame] = {}

EXPORT_DIR = Path("datafc_exports")
EXPORT_DIR.mkdir(exist_ok=True)

FOOTBALL_COUNTRIES = [
    "Turkey", "England", "Spain", "Italy", "Germany", "France",
    "Netherlands", "Portugal", "Belgium", "Scotland", "Austria",
    "Switzerland", "Greece", "Ukraine", "Russia", "Poland",
    "Croatia", "Serbia", "Czech Republic", "Denmark", "Sweden",
    "Norway", "Brazil", "Argentina", "Uruguay", "Colombia",
    "Chile", "Mexico", "USA", "Saudi Arabia", "Japan",
    "South Korea", "Australia", "Egypt", "Morocco", "South Africa",
]

POPULAR_TOURNAMENTS = [
    {"id": 52, "name": "Süper Lig", "country": "Turkey"},
    {"id": 17, "name": "Premier League", "country": "England"},
    {"id": 8, "name": "LaLiga", "country": "Spain"},
    {"id": 23, "name": "Serie A", "country": "Italy"},
    {"id": 35, "name": "Bundesliga", "country": "Germany"},
    {"id": 34, "name": "Ligue 1", "country": "France"},
    {"id": 37, "name": "Eredivisie", "country": "Netherlands"},
    {"id": 238, "name": "Primeira Liga", "country": "Portugal"},
    {"id": 7, "name": "UEFA Champions League", "country": "Europe"},
    {"id": 679, "name": "UEFA Europa League", "country": "Europe"},
    {"id": 155, "name": "Süper Lig (women)", "country": "Turkey"},
    {"id": 325, "name": "TFF 1. Lig", "country": "Turkey"},
    {"id": 383, "name": "Saudi Pro League", "country": "Saudi Arabia"},
    {"id": 955, "name": "MLS", "country": "USA"},
]


def _df_to_records(df: pd.DataFrame, max_rows: int = 200) -> dict[str, Any]:
    """Truncate + serialize DataFrame for JSON response."""
    if df is None or df.empty:
        return {"columns": [], "rows": [], "total_rows": 0, "truncated": False}
    head = df.head(max_rows)
    return {
        "columns": list(head.columns),
        "rows": head.where(pd.notnull(head), None).values.tolist(),
        "total_rows": int(len(df)),
        "truncated": len(df) > max_rows,
    }


def _call(func: Callable[..., pd.DataFrame], **kwargs: Any) -> dict[str, Any]:
    """Run datafc function, store result, return serialized payload."""
    try:
        df = func(**kwargs)
    except Exception as exc:  # surface datafc errors with context
        return {"error": str(exc), "trace": traceback.format_exc()}

    DF_STORE[func.__name__] = df
    return {
        "function": func.__name__,
        "preview": _df_to_records(df),
    }


@app.route("/")
def index() -> str:
    return render_template("index.html")


@app.route("/match/<int:game_id>")
def match_page(game_id: int) -> Any:
    """Render full match detail page."""
    return render_template("match.html", game_id=game_id)


@app.route("/api/tournament_info", methods=["POST"])
def api_tournament_info() -> Any:
    p = request.get_json(force=True)
    try:
        country, tournament, season = resolve_tournament_season(
            int(p["tournament_id"]),
            int(p["season_id"]),
            data_source="sofavpn",
        )
        return jsonify({"country": country, "tournament": tournament, "season": season})
    except Exception:
        return jsonify({"country": "", "tournament": "", "season": ""})


@app.route("/api/countries")
def api_countries() -> Any:
    return jsonify({"countries": FOOTBALL_COUNTRIES})


@app.route("/api/tournaments_by_country", methods=["POST"])
def api_tournaments_by_country() -> Any:
    p = request.get_json(force=True)
    country = (p.get("country") or "").strip()
    if not country:
        return jsonify({"tournaments": []})
    # First check local cache
    local = [t for t in POPULAR_TOURNAMENTS if t["country"].lower() == country.lower()]
    if local:
        return jsonify({"tournaments": local})
    # Search via API
    try:
        df = search_data(country, entity_type="tournament", data_source="sofavpn")
        results = [{"id": int(r["entity_id"]), "name": str(r["entity_name"]), "country": country}
                   for _, r in df.head(20).iterrows()]
        return jsonify({"tournaments": results})
    except Exception:
        return jsonify({"tournaments": []})


@app.route("/api/scheduled_events", methods=["POST"])
def api_scheduled_events() -> Any:
    p = request.get_json(force=True)
    date_str = (p.get("date") or "").strip()
    if not date_str:
        return jsonify({"error": "date parameter required (YYYY-MM-DD)"}), 400

    try:
        url = f"{API_URLS['sofavpn']}/api/v1/sport/football/scheduled-events/{date_str}"
        with SofascoreClient(rate_limit=1.0) as client:
            data = client.get(url)

        matches = []
        for ev in data.get("events", []):
            home = ev.get("homeTeam", {})
            away = ev.get("awayTeam", {})
            t = ev.get("tournament", {})
            status = ev.get("status", {})
            home_score = ev.get("homeScore", {})
            away_score = ev.get("awayScore", {})
            ts = ev.get("startTimestamp", 0)
            start_time = pd.Timestamp.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M") if ts else ""

            matches.append({
                "game_id": ev.get("id"),
                "home_team": home.get("name", ""),
                "away_team": away.get("name", ""),
                "home_team_id": home.get("id"),
                "away_team_id": away.get("id"),
                "home_team_slug": home.get("slug", ""),
                "away_team_slug": away.get("slug", ""),
                "tournament_name": t.get("name", ""),
                "tournament_slug": t.get("slug", ""),
                "tournament_id": t.get("uniqueTournament", {}).get("id"),
                "season_id": ev.get("season", {}).get("id"),
                "start_time": start_time,
                "status_code": status.get("code", 0),
                "status_desc": status.get("description", ""),
                "status_type": status.get("type", ""),
                "home_score": home_score.get("current") if home_score else None,
                "away_score": away_score.get("current") if away_score else None,
                "round": ev.get("roundInfo", {}).get("round") if ev.get("roundInfo") else None,
            })

        return jsonify({"matches": matches, "total": len(matches)})

    except Exception as exc:
        return jsonify({"error": str(exc), "trace": traceback.format_exc()}), 500


@app.route("/api/live_matches")
def api_live_matches() -> Any:
    """Fetch all currently live football matches."""
    try:
        url = f"{API_URLS['sofavpn']}/api/v1/sport/football/events/live"
        with SofascoreClient(rate_limit=1.0) as client:
            data = client.get(url)

        matches = []
        for ev in data.get("events", []):
            home = ev.get("homeTeam", {})
            away = ev.get("awayTeam", {})
            t = ev.get("tournament", {})
            status = ev.get("status", {})
            home_score = ev.get("homeScore", {})
            away_score = ev.get("awayScore", {})
            ts = ev.get("startTimestamp", 0) or 0
            start_time = pd.Timestamp.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M") if ts else ""
            status_time = ev.get("statusTime") or {}
            period = ev.get("lastPeriod", "")
            status_code = status.get("code", 0)

            # Compute live minute. initial = seconds into current period.
            minute = None
            initial = status_time.get("initial")
            time_obj = ev.get("time") or {}
            period_len = int(time_obj.get("periodLength", 2700) or 2700) // 60  # default 45'

            if status_code in (6, 7, 8, 9, 10, 41, 42) and initial is not None:
                minute = int(initial) // 60
                if status_code in (7, 42):  # 2nd half
                    minute += period_len
                elif status_code in (8, 9, 10):  # extra time / penalties
                    minute += period_len * 2

            matches.append({
                "game_id": ev.get("id"),
                "home_team": home.get("name", ""),
                "away_team": away.get("name", ""),
                "home_team_slug": home.get("slug", ""),
                "away_team_slug": away.get("slug", ""),
                "tournament_name": t.get("name", ""),
                "start_time": start_time,
                "status_code": status_code,
                "status_desc": status.get("description", ""),
                "status_type": status.get("type", ""),
                "home_score": home_score.get("current") if home_score else 0,
                "away_score": away_score.get("current") if away_score else 0,
                "home_score_normaltime": home_score.get("normaltime") if home_score else 0,
                "away_score_normaltime": away_score.get("normaltime") if away_score else 0,
                "period": period,
                "status_minute": minute,
                "status_extra": None,
            })

        # Exclude matches with no detail data: no team names, or status code 20 (Started/basladi ama veri yok)
        matches = [m for m in matches
                   if m["home_team"] and m["away_team"] and m.get("status_code", 0) not in (1, 20)]

        # Sort: by tournament name alphabetically, then by start time
        matches.sort(key=lambda m: (m["tournament_name"] or "zzz", m["start_time"] or ""))

        return jsonify({"matches": matches, "total": len(matches)})

    except Exception as exc:
        return jsonify({"error": str(exc), "trace": traceback.format_exc()}), 500


@app.route("/api/live_match_detail/<int:game_id>")
def api_live_match_detail(game_id: int) -> Any:
    """Fetch live match details: incidents + statistics + momentum."""
    import math
    base = f"{API_URLS['sofavpn']}/api/v1/event/{game_id}"
    results = {}

    try:
        with SofascoreClient(rate_limit=1.0) as client:
            # Incidents
            try:
                inc_data = client.get(f"{base}/incidents")
                incidents = inc_data.get("incidents", [])
                results["incidents"] = []
                for inc in incidents:
                    p = inc.get("player", {}) or {}
                    results["incidents"].append({
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

            except Exception:
                results["incidents"] = []

            # Statistics
            try:
                stat_data = client.get(f"{base}/statistics")
                stats = stat_data.get("statistics", [])
                results["stats"] = []
                ho = str(stat_data.get("homeTeam", {}).get("name", ""))
                aw = str(stat_data.get("awayTeam", {}).get("name", ""))
                for period in stats:
                    for group in period.get("groups", []):
                        gn = group.get("groupName", "")
                        for item in group.get("statisticsItems", []):
                            results["stats"].append({
                                "period": period.get("period", ""),
                                "group_name": gn,
                                "stat_name": item.get("name", ""),
                                "home_team_stat": item.get("home") if item.get("home") is not None and not (isinstance(item.get("home"), float) and math.isnan(item.get("home"))) else None,
                                "away_team_stat": item.get("away") if item.get("away") is not None and not (isinstance(item.get("away"), float) and math.isnan(item.get("away"))) else None,
                                "home_team": ho,
                                "away_team": aw,
                            })
            except Exception:
                results["stats"] = []

            # Momentum
            try:
                mom_data = client.get(f"{base}/graph")
                pts = mom_data.get("graphPoints", [])
                results["momentum"] = [{"minute": p.get("minute"), "value": p.get("value")}
                                        for p in pts]
            except Exception:
                results["momentum"] = []

        return jsonify(results)

    except Exception as exc:
        return jsonify({"error": str(exc), "trace": traceback.format_exc()}), 500


@app.route("/api/match_detail/<int:game_id>")
def api_match_detail(game_id: int) -> Any:
    detail_type = request.args.get("type", "all")

    def _sanitize(records):
        """Replace NaN with None for valid JSON."""
        import math
        for rec in records:
            for k, v in rec.items():
                if isinstance(v, float) and math.isnan(v):
                    rec[k] = None
        return records

    def _get_detail(match_df_row):
        results = {}
        try:
            if detail_type in ("all", "details"):
                details = match_details_data(match_df_row, data_source="sofavpn")
                results["details"] = _sanitize(details.to_dict(orient="records")) if not details.empty else []
            if detail_type in ("all", "stats"):
                stats = match_stats_data(match_df_row, data_source="sofavpn")
                results["stats"] = _sanitize(stats.to_dict(orient="records")) if not stats.empty else []
            if detail_type in ("all", "incidents"):
                inc = incidents_data(match_df_row, data_source="sofavpn")
                results["incidents"] = _sanitize(inc.to_dict(orient="records")) if not inc.empty else []
            if detail_type in ("all", "h2h"):
                h2h = match_h2h_data(match_df_row, data_source="sofavpn")
                results["h2h"] = _sanitize(h2h.to_dict(orient="records")) if not h2h.empty else []
            if detail_type in ("all", "odds"):
                odds = match_odds_data(match_df_row, data_source="sofavpn")
                results["odds"] = _sanitize(odds.to_dict(orient="records")) if not odds.empty else []
            if detail_type in ("all", "shots"):
                shots = shots_data(match_df_row, data_source="sofavpn")
                results["shots"] = _sanitize(shots.to_dict(orient="records")) if not shots.empty else []
            if detail_type in ("all", "momentum"):
                momentum = momentum_data(match_df_row, data_source="sofavpn")
                results["momentum"] = _sanitize(momentum.to_dict(orient="records")) if not momentum.empty else []
        except Exception as exc:
            results["error"] = str(exc)
        return results

    # Re-fetch match_info to build the correct row
    # We need tournament_id, season_id, week — but we only have game_id.
    # Build a minimal single-row DataFrame.
    match_row = pd.DataFrame([{
        "country": "", "tournament": "", "season": "", "week": 0,
        "game_id": game_id, "home_team": "", "home_team_id": 0,
        "away_team": "", "away_team_id": 0, "injury_time_1": 0,
        "injury_time_2": 0, "start_timestamp": 0, "status": "",
        "home_score_current": 0, "home_score_display": 0,
        "home_score_period1": 0, "home_score_period2": 0,
        "home_score_normaltime": 0, "away_score_current": 0,
        "away_score_display": 0, "away_score_period1": 0,
        "away_score_period2": 0, "away_score_normaltime": 0,
    }])

    try:
        result = _get_detail(match_row)
        return jsonify(result)
    except Exception as exc:
        return jsonify({"error": str(exc), "trace": traceback.format_exc()}), 500


@app.route("/api/seasons", methods=["POST"])
def api_seasons() -> Any:
    p = request.get_json(force=True)
    try:
        df = seasons_data(int(p["tournament_id"]), data_source="sofavpn")
        seasons = [{"id": int(r["season_id"]), "name": str(r["season_name"]), "year": str(r["season_year"])}
                   for _, r in df.iterrows()]
        return jsonify({"seasons": seasons})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/standings", methods=["POST"])
def api_standings() -> Any:
    p = request.get_json(force=True)
    return jsonify(_call(
        standings_data,
        tournament_id=int(p["tournament_id"]),
        season_id=int(p["season_id"]),
        data_source="sofavpn",
    ))


@app.route("/api/match", methods=["POST"])
def api_match() -> Any:
    p = request.get_json(force=True)
    df = match_data(
        tournament_id=int(p["tournament_id"]),
        season_id=int(p["season_id"]),
        week_number=int(p["week_number"]),
        data_source="sofavpn",
    )
    DF_STORE["match_data"] = df
    return jsonify({"function": "match_data", "preview": _df_to_records(df)})


@app.route("/api/shots", methods=["POST"])
def api_shots() -> Any:
    match_df = DF_STORE.get("match_data")
    if match_df is None:
        return jsonify({"error": "Fetch match_data first (Match tab)."}), 400
    return jsonify(_call(shots_data, match_df=match_df, data_source="sofavpn"))


@app.route("/api/squad", methods=["POST"])
def api_squad() -> Any:
    standings_df = DF_STORE.get("standings_data")
    if standings_df is None:
        return jsonify({"error": "Fetch standings_data first (Standings tab)."}), 400
    return jsonify(_call(squad_data, standings_df=standings_df, data_source="sofavpn"))


@app.route("/api/league_player_stats", methods=["POST"])
def api_league_player_stats() -> Any:
    p = request.get_json(force=True)
    fields_raw = (p.get("fields") or "").strip()
    fields = [f.strip() for f in fields_raw.split(",") if f.strip()] or None
    return jsonify(_call(
        league_player_stats_data,
        tournament_id=int(p["tournament_id"]),
        season_id=int(p["season_id"]),
        order=p.get("order", "-rating"),
        accumulation=p.get("accumulation", "total"),
        position=p.get("position") or None,
        fields=fields,
        max_players=int(p.get("max_players", 50)),
        data_source="sofavpn",
    ))


@app.route("/api/save_parquet", methods=["POST"])
def api_save_parquet() -> Any:
    p = request.get_json(force=True)
    func_name = p["function"]
    df = DF_STORE.get(func_name)
    if df is None:
        return jsonify({"error": f"No cached DataFrame for {func_name}."}), 400
    base = p.get("base_name") or func_name
    out_dir = Path(p.get("output_dir", "datafc_exports/parquet"))
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{base}.parquet"
    save_parquet(
        data=df,
        fn_name=func_name,
        data_source="sofascore",
        country=p.get("country", "Unknown"),
        tournament=p.get("tournament", "Unknown"),
        season=p.get("season", "Unknown"),
        output_dir=str(out_dir),
    )
    return jsonify({"path": str(path), "rows": int(len(df))})


@app.route("/api/download/<func_name>")
def api_download(func_name: str) -> Any:
    df = DF_STORE.get(func_name)
    if df is None:
        return jsonify({"error": f"No cached DataFrame for {func_name}."}), 404
    fmt = request.args.get("format", "json")
    if fmt == "json":
        tmp = EXPORT_DIR / f"{func_name}.json"
        df.to_json(tmp, orient="records", force_ascii=False)
        return send_file(
            str(tmp),
            mimetype="application/json",
            as_attachment=True,
            download_name=f"{func_name}.json",
        )
    if fmt == "csv":
        tmp = EXPORT_DIR / f"{func_name}.csv"
        df.to_csv(tmp, index=False)
        return send_file(
            str(tmp),
            mimetype="text/csv",
            as_attachment=True,
            download_name=f"{func_name}.csv",
        )
    if fmt == "excel":
        tmp = EXPORT_DIR / f"{func_name}.xlsx"
        with pd.ExcelWriter(tmp, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name=func_name[:31])
        return send_file(
            str(tmp),
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            as_attachment=True,
            download_name=f"{func_name}.xlsx",
        )
    return jsonify({"error": f"Unsupported format: {fmt}"}), 400


if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)
