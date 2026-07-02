#!/usr/bin/env python3
"""scrape_referee_sahadan JSON → SQL UPSERT statement dönüşümü.

Tek satırlı psql komutu üretir. stdin'den JSON obje/liste okur, stdout'a
COPY-friendly INSERT ... ON CONFLICT çıktısı verir.

Kullanım:
  python3 scrape_referee_sahadan.py <UUID> | python3 json_to_sql.py > upsert.sql
  psql -U postgres -d golradar_db -f upsert.sql
"""
import json
import sys
from typing import Any, Dict, List, Optional


def esc(s: Any) -> str:
    """SQL string escape (tek tırnak, ters slash)."""
    if s is None:
        return "NULL"
    if not isinstance(s, str):
        s = str(s)
    return "'" + s.replace("\\", "\\\\").replace("'", "''") + "'"


def row_sql(scraped: Dict[str, Any]) -> Optional[str]:
    if not scraped.get("ok") or not scraped.get("refereeName"):
        return None
    fields = [
        "refereeName",
        "matchesCount",
        "avgYellowCards",
        "avgRedCards",
        "avgFouls",
        "avgPenalties",
        "penaltyRate",
        "cardRate",
    ]
    values = [
        esc(scraped["refereeName"]),
        int(scraped.get("matchesCount", 0)),
        float(scraped.get("avgYellowCards", 0.0)),
        float(scraped.get("avgRedCards", 0.0)),
        float(scraped.get("avgFouls", 0.0)),
        float(scraped.get("avgPenalties", 0.0)),
        float(scraped.get("penaltyRate", 0.0)),
        float(scraped.get("cardRate", 0.0)),
    ]
    placeholders = ", ".join(["%s"] * len(values))
    column_list = ", ".join(f'"{f}"' for f in fields)
    update_set = ", ".join(
        f'"{f}" = EXCLUDED."{f}"' for f in fields if f != "refereeName"
    )
    return (
        f"INSERT INTO \"RefereeStats\" ({column_list}) VALUES ({placeholders})\n"
        f"ON CONFLICT (\"refereeName\") DO UPDATE SET {update_set};"
    ) % tuple(values)


def main() -> int:
    raw = sys.stdin.read().strip()
    if not raw:
        return 1
    data = json.loads(raw)
    if isinstance(data, dict):
        data = [data]
    elif not isinstance(data, list):
        return 1
    out: List[str] = ["BEGIN;"]
    ok = 0
    for entry in data:
        sql = row_sql(entry)
        if sql:
            out.append(sql)
            ok += 1
    out.append("COMMIT;")
    sys.stdout.write("\n".join(out) + "\n")
    sys.stderr.write(f"{ok}/{len(data)} SQL satırı üretildi\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
