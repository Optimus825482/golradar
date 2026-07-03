#!/usr/bin/env python3
"""
Football-Data.co.uk — tarihsel maç verisi toplayıcı.
Ücretsiz CSV dosyalarından 2005-2025 arası 30+ ligde maç verisi çeker.

Veri yapısı:
  - Div, Date, HomeTeam, AwayTeam, FTHG, FTAG, FTR
  - HTHG, HTAG, HTR (devre arası)
  - HS, AS (şut), HST, AST (isabetli şut)
  - HC, AC (korner), HF, AF (faul)
  - HY, AY (sarı), HR, AR (kırmızı)
  - PSxG (varsa)
  - B365H/D/A, Pinnacle odds, Closing odds

Kullanım:
  python3 scripts/football-data-fetch.py --action list-leagues
  python3 scripts/football-data-fetch.py --action fetch-csv --league E0 --season 2024-2025
  python3 scripts/football-data-fetch.py --action backfill --output data/ml-training/football-data.jsonl

Lig kodları:
  E0  = Premier League      E1  = Championship
  E2  = League 1            E3  = League 2
  EC  = Conference          SC0 = Scottish Premiership
  D1  = Bundesliga 1        D2  = Bundesliga 2
  I1  = Serie A             I2  = Serie B
  SP1 = La Liga             SP2 = La Liga 2
  F1  = Ligue 1             F2  = Ligue 2
  N1  = Eredivisie          B1  = Jupiler Pro
  P1  = Primeira Liga        T1  = Süper Lig
  G1  = Greek Super League

CSV format detayı: https://www.football-data.co.uk/notes.txt
"""

import json
import sys
import argparse
import csv
import os
import time
import io
import re
from typing import Any
from urllib.request import urlopen, Request
from urllib.parse import urlparse

FOOTBALL_DATA_BASE = "https://www.football-data.co.uk"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}

# Mevcut tüm ligler ve kodları
AVAILABLE_LEAGUES = {
    # İngiltere
    "E0": "Premier League",
    "E1": "Championship",
    "E2": "League 1",
    "E3": "League 2",
    "EC": "Conference",
    # İskoçya
    "SC0": "Scottish Premiership",
    # Almanya
    "D1": "Bundesliga 1",
    "D2": "Bundesliga 2",
    "D3": "3. Liga",
    # İtalya
    "I1": "Serie A",
    "I2": "Serie B",
    # İspanya
    "SP1": "La Liga",
    "SP2": "La Liga 2",
    # Fransa
    "F1": "Ligue 1",
    "F2": "Ligue 2",
    # Hollanda
    "N1": "Eredivisie",
    # Belçika
    "B1": "Jupiler Pro League",
    # Portekiz
    "P1": "Primeira Liga",
    # Türkiye
    "T1": "Süper Lig",
    # Yunanistan
    "G1": "Super League Greece",
}

# Feature vektörüne eşlenecek CSV kolonları
FIELD_MAP = {
    "FTHG": "home_goals",
    "FTAG": "away_goals",
    "HTHG": "home_goals_ht",
    "HTAG": "away_goals_ht",
    "HS": "home_shots",
    "AS": "away_shots",
    "HST": "home_shots_on_target",
    "AST": "away_shots_on_target",
    "HC": "home_corners",
    "AC": "away_corners",
    "HF": "home_fouls",
    "AF": "away_fouls",
    "HY": "home_yellow",
    "AY": "away_yellow",
    "HR": "home_red",
    "AR": "away_red",
    # xG (varsa — son sezonlarda eklenmiştir)
    "PSxG": "home_psxg",  # Post-shot xG
}


def _fetch_bytes(url: str) -> bytes:
    """HTTP GET with headers."""
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=60) as resp:
        return resp.read()


def list_leagues() -> list[dict]:
    """Kullanılabilir ligleri listele."""
    result = []
    for code, name in AVAILABLE_LEAGUES.items():
        result.append({"code": code, "name": name})
    return result


def get_seasons_for_league(league_code: str) -> list[str]:
    """Bir lig için mevcut sezon listesini döndür."""
    if league_code not in AVAILABLE_LEAGUES:
        return []

    current_year = 2025
    seasons = []
    for y in range(2005, current_year + 1):
        seasons.append(f"{y}-{y + 1}")
    return seasons


def fetch_csv(league_code: str, season: str) -> list[dict]:
    """Bir lig+sezon için CSV verisini çeker.

    URL formatı: https://www.football-data.co.uk/mmz4281/{y1}{y2}/{league}.csv
    """
    if league_code not in AVAILABLE_LEAGUES:
        return [{"error": f"Unknown league: {league_code}"}]

    # Season format: "2024-2025" → "2425"
    m = re.match(r"(\d{4})-(\d{4})", season)
    if not m:
        return [{"error": f"Invalid season format: {season}. Use YYYY-YYYY"}]
    y1, y2 = m.group(1)[2:], m.group(2)[2:]  # "2024-2025" → "24", "25"
    season_code = f"{y1}{y2}"

    url = f"{FOOTBALL_DATA_BASE}/mmz4281/{season_code}/{league_code}.csv"

    try:
        raw = _fetch_bytes(url)
        content = raw.decode("utf-8-sig")  # BOM handling
        reader = csv.DictReader(io.StringIO(content))

        matches = []
        for row in reader:
            match = {
                "league_code": league_code,
                "league_name": AVAILABLE_LEAGUES[league_code],
                "season": season,
                "date": row.get("Date", ""),
                "home_team": row.get("HomeTeam", ""),
                "away_team": row.get("AwayTeam", ""),
                "full_time_result": row.get("FTR", ""),  # H/D/A
                "half_time_result": row.get("HTR", ""),
            }

            # İstatistik alanlarını eşle
            for csv_col, our_field in FIELD_MAP.items():
                val = row.get(csv_col, "").strip()
                if val:
                    try:
                        match[our_field] = float(val)
                    except ValueError:
                        match[our_field] = val
                else:
                    match[our_field] = None

            # Oranlar (closing odds)
            for prefix in ["B365", "BW", "IW", "PS", "WH", "PP", "VC"]:
                home_key = f"{prefix}H"
                draw_key = f"{prefix}D"
                away_key = f"{prefix}A"
                if home_key in row:
                    match[f"odds_home"] = _float_or_none(row.get(home_key))
                    match[f"odds_draw"] = _float_or_none(row.get(draw_key))
                    match[f"odds_away"] = _float_or_none(row.get(away_key))
                    break  # İlk bulunan bookmaker'ı al

            # Pinnacle closing odds (en güvenilir)
            if "PSC" in row or "PSCH" in row:
                match["psc_home"] = _float_or_none(row.get("PSCH") or row.get("PSC"))
                match["psc_draw"] = _float_or_none(row.get("PSCD"))
                match["psc_away"] = _float_or_none(row.get("PSCA"))

            # Max odds & avg odds (bazı sezonlarda var)
            match["maxH"] = _float_or_none(row.get("MaxH"))
            match["avgH"] = _float_or_none(row.get("AvgH"))
            match["maxD"] = _float_or_none(row.get("MaxD"))
            match["maxA"] = _float_or_none(row.get("MaxA"))

            # Over/Under odds
            match["over25"] = _float_or_none(row.get("BbAv>2.5"))
            match["under25"] = _float_or_none(row.get("BbAv<2.5"))

            # xG (varsa)
            match["home_xg"] = _float_or_none(row.get("PSxG"))
            match["away_xg"] = _float_or_none(row.get("PSxGA"))

            matches.append(match)

        return matches

    except Exception as e:
        return [{"error": f"Failed to fetch {league_code} {season}: {e}"}]


def _float_or_none(val: Any) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def backfill(output_path: str = "data/ml-training/football-data.jsonl",
             leagues: list[str] | None = None,
             start_season: str = "2015-2016",
             end_season: str = "2024-2025") -> dict:
    """Tüm liglerden tarihsel maç verilerini toplar ve JSONL yazar.

    Rate-limit: her istek arası 1 sn
    """
    if leagues is None:
        leagues = sorted(AVAILABLE_LEAGUES.keys())

    # Sezonları parse et
    start_year = int(start_season.split("-")[0])
    end_year = int(end_season.split("-")[0])

    total_matches = 0
    skipped = 0

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        for league_code in leagues:
            if league_code not in AVAILABLE_LEAGUES:
                print(f"[Football-Data] Skipping unknown league: {league_code}", file=sys.stderr)
                continue

            league_name = AVAILABLE_LEAGUES[league_code]

            for season_year in range(start_year, end_year + 1):
                season = f"{season_year}-{season_year + 1}"
                print(f"[Football-Data] {league_name} ({league_code}) {season}...", file=sys.stderr)

                matches = fetch_csv(league_code, season)

                # Hata kontrolü
                if matches and "error" in matches[0]:
                    err = matches[0]["error"]
                    if "404" in err or "403" in err:
                        print(f"  -> No data for {season}", file=sys.stderr)
                        skipped += 1
                        continue
                    print(f"  -> Error: {err}", file=sys.stderr)
                    skipped += 1
                    continue

                # Veriyi yaz
                for m in matches:
                    f.write(json.dumps(m, ensure_ascii=False) + "\n")

                total_matches += len(matches)
                print(f"  -> {len(matches)} matches (total: {total_matches})", file=sys.stderr)

                time.sleep(1.0)  # rate-limit

    return {
        "total_matches": total_matches,
        "leagues_processed": len(leagues),
        "seasons_range": f"{start_season} to {end_season}",
        "skipped": skipped,
        "output_path": output_path,
    }


def main():
    parser = argparse.ArgumentParser(description="Football-Data.co.uk scraper")
    parser.add_argument("--action", required=True,
                        choices=["list-leagues", "fetch-csv", "backfill"])
    parser.add_argument("--league", help="League code (e.g. E0, D1, I1, SP1)")
    parser.add_argument("--season", default="2024-2025", help="Season (e.g. 2024-2025)")
    parser.add_argument("--output", default="data/ml-training/football-data.jsonl",
                        help="Output path for backfill")
    parser.add_argument("--start-season", default="2015-2016",
                        help="Start season for backfill")
    parser.add_argument("--end-season", default="2024-2025",
                        help="End season for backfill")
    parser.add_argument("--leagues", nargs="+",
                        help="League codes for backfill (default: all)")

    args = parser.parse_args()

    try:
        if args.action == "list-leagues":
            data = list_leagues()

        elif args.action == "fetch-csv":
            if not args.league:
                raise ValueError("--league required for fetch-csv")
            data = fetch_csv(args.league, args.season)

        elif args.action == "backfill":
            data = backfill(
                output_path=args.output,
                leagues=args.leagues,
                start_season=args.start_season,
                end_season=args.end_season,
            )

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
