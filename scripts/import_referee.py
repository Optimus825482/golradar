#!/usr/bin/env python3
"""Sahadan scrape_referee_sahadan çıktısını RefereeStats DB'ye yaz.

Standalone script: scrape_referee_sahadan.py'den JSON alır, Prisma
upsert formatında RefereeStats tablosuna ekler. Container içinde
çalıştırılır (DATABASE_URL env'den okunur).

Kullanım:
  python3 scripts/scrape_referee_sahadan.py <UUID> > ref.json
  python3 scripts/import_referee.py < ref.json
"""
import sys
import json
import asyncio
from pathlib import Path

# Prisma client — app'in kullandığı schema'yı import et
sys.path.insert(0, str(Path(__file__).parent.parent))
from prisma import Prisma


async def upsert_one(db: Prisma, scraped: dict) -> bool:
    if not scraped.get("ok") or not scraped.get("refereeName"):
        return False
    n = scraped["refereeName"]
    try:
        await db.refereestats.upsert(
            where={"refereeName": n},
            data={
                "create": {
                    "refereeName": n,
                    "matchesCount": scraped.get("matchesCount", 0),
                    "avgYellowCards": scraped.get("avgYellowCards", 0.0),
                    "avgRedCards": scraped.get("avgRedCards", 0.0),
                    "avgFouls": scraped.get("avgFouls", 0.0),
                    "avgPenalties": scraped.get("avgPenalties", 0.0),
                    "penaltyRate": scraped.get("penaltyRate", 0.0),
                    "cardRate": scraped.get("cardRate", 0.0),
                },
                "update": {
                    "matchesCount": scraped.get("matchesCount", 0),
                    "avgYellowCards": scraped.get("avgYellowCards", 0.0),
                    "avgRedCards": scraped.get("avgRedCards", 0.0),
                    "avgFouls": scraped.get("avgFouls", 0.0),
                    "avgPenalties": scraped.get("avgPenalties", 0.0),
                    "penaltyRate": scraped.get("penaltyRate", 0.0),
                    "cardRate": scraped.get("cardRate", 0.0),
                },
            },
        )
        print(f"  ✓ {n}: {scraped.get('matchesCount')} maç, "
              f"avgYC={scraped.get('avgYellowCards')}, "
              f"avgFouls={scraped.get('avgFouls')}")
        return True
    except Exception as e:
        print(f"  ✗ {n}: {e}", file=sys.stderr)
        return False


async def main() -> int:
    # stdin'den JSON oku (tek obje veya liste)
    raw = sys.stdin.read().strip()
    if not raw:
        print("Boş input", file=sys.stderr)
        return 1
    data = json.loads(raw)
    if isinstance(data, dict):
        data = [data]
    elif not isinstance(data, list):
        print("JSON bekleniyor (obje veya liste)", file=sys.stderr)
        return 1

    db = Prisma()
    await db.connect()
    try:
        ok = 0
        for entry in data:
            if await upsert_one(db, entry):
                ok += 1
        print(f"\n{ok}/{len(data)} yazıldı")
        return 0 if ok > 0 else 1
    finally:
        await db.disconnect()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
