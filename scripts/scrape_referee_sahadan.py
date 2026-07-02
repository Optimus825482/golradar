#!/usr/bin/env python3
"""Sahadan.com (Nuxt 3 SSR) hakem istatistikleri scraper.

URL formatı: https://www.sahadan.com/hakem/a-cajas/<UUID>

Nuxt 3 sayfa yapısı:
  - <script id="__NUXT_DATA__"> içinde tree-walked JSON array
  - data[7] = referee root (id, name, nationality, matches, ...)
  - data[7]['matches'] = int ref → maç ref listesi
  - Her maç = {i, u, dt, ai, ci, si, fa, fb, a, b}
  - a/b (takım objesi) = {ti, yc, rc, f, p}
    - ti = team id ref
    - yc = yellow card count ref
    - rc = red card count ref
    - f  = foul count ref
    - p  = penalty count ref

Bu scraper tüm maçları toplar, hakem için aggregate istatistikleri hesaplar.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any, Dict, List, Optional

try:
    from curl_cffi import requests
except ImportError:
    import requests  # type: ignore[no-redef]

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


def fetch_nuxt_data(url: str, timeout: int = 15) -> Optional[List[Any]]:
    """Sahadan.com sayfasını çek, __NUXT_DATA__ JSON'unu parse et."""
    try:
        r = requests.get(
            url,
            impersonate="chrome124",
            timeout=timeout,
            headers={"User-Agent": USER_AGENT, "Accept-Language": "tr-TR,tr;q=0.9"},
        )
    except Exception as exc:
        return None
    if r.status_code != 200:
        return None
    m = re.search(r'<script[^>]*id="__NUXT_DATA__"[^>]*>([^<]+)</script>', r.text)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except Exception:
        return None


def _resolve(data: List[Any], ref: Any) -> Any:
    """Nuxt 3 ref resolution: int ref → data[int]."""
    if isinstance(ref, int) and 0 <= ref < len(data):
        return data[ref]
    return ref


def _sum_match_stats(data: List[Any], match_ref: int) -> Dict[str, int]:
    """Bir maçtan kart/foul/penaltı toplamı çıkar.

    Sahadan'da her takımın {ti, yc, rc, f, p} objesi var. Refs array'inde
    sayılar gizli. Toplamı için iki takımı birleştiriyoruz (hakem istatistiği
    takım başına değil, maç başınadır).
    """
    match = _resolve(data, match_ref)
    if not isinstance(match, dict):
        return {"yc": 0, "rc": 0, "f": 0, "p": 0}

    total = {"yc": 0, "rc": 0, "f": 0, "p": 0}
    for side_key in ("a", "b"):
        side = _resolve(data, match.get(side_key))
        if not isinstance(side, dict):
            continue
        for k, default in (("yc", 0), ("rc", 0), ("f", 0), ("p", 0)):
            v = _resolve(data, side.get(k))
            # v ya int (refs array'inde sayı) ya nested ref
            if isinstance(v, (int, float)):
                total[k] += int(v)
            elif isinstance(v, dict):
                # Nested: sayı içeren objenin içindeki tek int field
                for vv in v.values():
                    if isinstance(vv, (int, float)):
                        total[k] += int(vv)
                        break
    return total


def parse_referee(uuid: str, data: List[Any]) -> Optional[Dict[str, Any]]:
    """Nuxt tree'den referee aggregate istatistikleri çıkar."""
    # data[7] = referee root. UUID'yi doğrula
    if len(data) <= 7:
        return None
    ref_root = data[7]
    if not isinstance(ref_root, dict):
        return None
    expected_uuid = _resolve(data, ref_root.get("id"))
    if not isinstance(expected_uuid, str):
        return None
    # Sanity check: istek URL'si ile sayfanın UUID'si eşleşmeli (path/redirect guard)
    if isinstance(uuid, str) and isinstance(expected_uuid, str) and uuid != expected_uuid:
        return None

    name_obj = _resolve(data, ref_root.get("name"))
    nat_obj = _resolve(data, ref_root.get("nationality"))
    if isinstance(name_obj, dict) and "value" in name_obj:
        name_obj = name_obj["value"]
    if isinstance(nat_obj, dict) and "value" in nat_obj:
        nat_obj = nat_obj["value"]

    matches_ref = ref_root.get("matches")
    matches_list = _resolve(data, matches_ref)
    if not isinstance(matches_list, list):
        return None

    # Tüm maçlardan toplam
    total_yc = 0
    total_rc = 0
    total_f = 0
    total_p = 0
    for match_ref in matches_list:
        stats = _sum_match_stats(data, match_ref)
        total_yc += stats["yc"]
        total_rc += stats["rc"]
        total_f += stats["f"]
        total_p += stats["p"]
    n = len(matches_list)
    if n == 0:
        return None

    # Sahadan'da foul sayısı takım başına mı maç başına mı belirsiz.
    # Çoğu veri kaynağında maç başına toplam iki takımın foul'udur.
    # Bu scraper'ın çıktısı iki takımın toplamı olarak işlenir.
    return {
        "ok": True,
        "refereeName": name_obj if isinstance(name_obj, str) else str(expected_uuid),
        "nationality": nat_obj if isinstance(nat_obj, str) else None,
        "uuid": expected_uuid,
        "matchesCount": n,
        "avgYellowCards": round(total_yc / n, 3),
        "avgRedCards": round(total_rc / n, 3),
        "avgFouls": round(total_f / n, 1),
        "avgPenalties": round(total_p / n, 3),
        # DB uyumlu alanlar (avg * matches = total)
        "cardRate": round(total_yc / n, 3),
        "penaltyRate": round(total_p / n, 3),
        "totalYellow": total_yc,
        "totalRed": total_rc,
        "totalFouls": total_f,
        "totalPenalties": total_p,
    }


def scrape_referee(url_or_uuid: str) -> Dict[str, Any]:
    """Tek hakem için scrape et, JSON dict döndür.

    Kabul edilen input formatları:
      - https://www.sahadan.com/hakem/a-cajas/<UUID>
      - <UUID> (bare)
    """
    # URL'den UUID çıkar
    m = re.search(
        r"/hakem/a-cajas/([0-9a-f-]{36})",
        url_or_uuid,
        re.IGNORECASE,
    )
    if m:
        uuid = m.group(1)
        url = url_or_uuid
    elif re.match(r"^[0-9a-f-]{36}$", url_or_uuid, re.IGNORECASE):
        uuid = url_or_uuid
        url = f"https://www.sahadan.com/hakem/a-cajas/{uuid}"
    else:
        return {"ok": False, "error": "Invalid URL or UUID"}

    data = fetch_nuxt_data(url)
    if data is None:
        return {"ok": False, "uuid": uuid, "error": "Failed to fetch or parse __NUXT_DATA__"}

    result = parse_referee(uuid, data)
    if result is None:
        return {"ok": False, "uuid": uuid, "error": "Could not parse referee tree"}
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Sahadan.com referee stats scraper")
    parser.add_argument("target", nargs="?", help="Single URL or UUID")
    parser.add_argument("--batch", metavar="FILE", help="File with one URL/UUID per line")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON")
    args = parser.parse_args()

    if not args.target and not args.batch:
        parser.error("Provide either a URL/UUID or --batch <file>")

    indent = 2 if args.pretty else None
    if args.batch:
        try:
            with open(args.batch, encoding="utf-8") as f:
                lines = [line.strip() for line in f if line.strip()]
        except OSError as exc:
            print(json.dumps({"ok": False, "error": f"Cannot read {args.batch}: {exc}"}))
            return 1
        results = [scrape_referee(t) for t in lines]
        print(json.dumps(results, indent=indent, ensure_ascii=False))
        ok = sum(1 for r in results if r.get("ok"))
        print(f"\n# {ok}/{len(results)} succeeded", file=sys.stderr)
        return 0 if ok == len(results) else 1

    result = scrape_referee(args.target)
    print(json.dumps(result, indent=indent, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
