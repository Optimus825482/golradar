#!/usr/bin/env python3
"""Sahadan.com — iddaa programı + maç detay full scraper.

Nuxt 3 tree yapısı:
  data[0]   = kaynak string ("dn")
  data[1]   = root state {data, state, once, _errors, serverRendered, path}
  data[2]   = ?
  data[3]   = state ref'leri (deferred)
  data[4]   = root data ref (int → başka node)
  data[5]   = asıl data objesi (theme + markets + soccer)
  data[5]['soccer'] → ref (örn. 57)
  data[57]  = list of "slot" objeleri (her biri bir gün/lig dilimi)
  slot = {area_id, title, c_id, c_uuid, time, matches}
  slot.matches → ref (örn. 64)
  data[64]  = list of "match" objeleri
  match = {id, uuid, status, period, ft_A, ft_B, team_A, team_B,
           e, markets, time, c_uuid, competition, fts_A, fts_B, ...}
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

try:
    from curl_cffi import requests
except ImportError:
    import requests  # type: ignore[no-redef]

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


# ── HTTP + Nuxt tree yardımcıları ────────────────────────────────

def _resolve(data: List[Any], ref: Any) -> Any:
    if isinstance(ref, int) and 0 <= ref < len(data):
        return data[ref]
    return ref


def fetch_nuxt_data(url: str, timeout: int = 15) -> Optional[Tuple[List[Any], str]]:
    try:
        r = requests.get(
            url, impersonate="chrome124", timeout=timeout,
            headers={"User-Agent": USER_AGENT, "Accept-Language": "tr-TR,tr;q=0.9"},
        )
    except Exception:
        return None
    if r.status_code != 200 or len(r.text) < 1000:
        return None
    m = re.search(r'<script[^>]*id="__NUXT_DATA__"[^>]*>([^<]+)</script>', r.text)
    if not m:
        return None
    try:
        return json.loads(m.group(1)), r.text
    except Exception:
        return None


# ── /iddaa-programi parse ────────────────────────────────────────

def fetch_iddaa_matches(date: Optional[str] = None) -> List[Dict[str, Any]]:
    """Bir günün maçlarını çek (today, yesterday, tomorrow)."""
    url = "https://www.sahadan.com/iddaa-programi"
    if date:
        url += f"?date={date}"
    fetched = fetch_nuxt_data(url)
    if not fetched:
        return []
    return _parse_iddaa_tree(fetched[0])


def _parse_iddaa_tree(data: List[Any]) -> List[Dict[str, Any]]:
    """data[5]['soccer'] yolundan maçları parse et."""
    if len(data) < 6:
        return []
    root = data[5]
    if not isinstance(root, dict) or 'soccer' not in root:
        return []
    soccer_ref = root['soccer']
    if not isinstance(soccer_ref, int) or soccer_ref >= len(data):
        return []
    slots = data[soccer_ref]
    if not isinstance(slots, list):
        return []

    matches: List[Dict[str, Any]] = []
    for slot_ref in slots:
        slot = _resolve(data, slot_ref)
        if not isinstance(slot, dict) or 'matches' not in slot:
            continue
        m_ref = slot['matches']
        m_list = _resolve(data, m_ref)
        if not isinstance(m_list, list):
            continue
        # Slot meta
        slot_title = _resolve(data, slot.get('title'))
        slot_time = _resolve(data, slot.get('time'))
        slot_competition = _resolve(data, slot.get('c_uuid'))
        slot_area_id = _resolve(data, slot.get('area_id'))
        for match_ref in m_list:
            match = _resolve(data, match_ref)
            if not isinstance(match, dict):
                continue
            matches.append(_normalize_match(data, match, {
                'slotTitle': slot_title,
                'slotTime': slot_time,
                'slotCompetition': slot_competition,
                'slotAreaId': slot_area_id,
            }))
    return matches


def _normalize_match(
    data: List[Any],
    match: Dict[str, Any],
    slot_meta: Dict[str, Any],
) -> Dict[str, Any]:
    """Nuxt maç objesini düz JSON'a çevir."""
    mid = _resolve(data, match.get('id'))
    uuid = _resolve(data, match.get('uuid'))
    status = _resolve(data, match.get('status'))
    period = _resolve(data, match.get('period'))
    ft_a = _resolve(data, match.get('ft_A'))
    ft_b = _resolve(data, match.get('ft_B'))
    fts_a = _resolve(data, match.get('fts_A'))
    fts_b = _resolve(data, match.get('fts_B'))
    time = _resolve(data, match.get('time'))
    competition = _resolve(data, match.get('competition'))
    team_a = _resolve_team(data, match.get('team_A'))
    team_b = _resolve_team(data, match.get('team_B'))

    # Competition: {uuid, name} → name
    comp_name = None
    comp_uuid = None
    if isinstance(competition, dict):
        comp_uuid = _resolve(data, competition.get('uuid'))
        comp_name = _resolve(data, competition.get('name'))
    elif isinstance(competition, str):
        comp_name = competition

    return {
        'matchId': mid if isinstance(mid, (int, str)) else None,
        'uuid': uuid if isinstance(uuid, str) else None,
        'status': status,
        'period': period,
        'fullTimeScore': [ft_a, ft_b] if ft_a is not None else None,
        'halfTimeScore': [fts_a, fts_b] if fts_a is not None else None,
        'time': time,
        'competitionName': comp_name,
        'competitionUuid': comp_uuid,
        'teamA': team_a,
        'teamB': team_b,
        'slot': slot_meta,
    }


def _resolve_team(data: List[Any], team_ref: Any) -> Optional[Dict[str, Any]]:
    """Sahadan.com'da team_A doğrudan bir string name'e resolve olabiliyor.

    Ref → int → data[ref] = "Team Name" (string). Bu durumda name="Team Name",
    id=None. Dict olabiliyorsa id+name ayrı field'lardan gelir.
    """
    team = _resolve(data, team_ref)
    if isinstance(team, str):
        return {'id': None, 'name': team if team else None}
    if not isinstance(team, dict):
        return None
    team_id = _resolve(data, team.get('id'))
    team_name = _resolve(data, team.get('n'))
    if team_name is None and isinstance(team.get('name'), str):
        team_name = team.get('name')
    return {
        'id': team_id if isinstance(team_id, (int, str)) else None,
        'name': team_name if isinstance(team_name, str) else None,
    }


# ── /mac/<slug>/<UUID>: referee + sakatlıklar ───────────────────

def fetch_match_detail(uuid: str) -> Optional[Dict[str, Any]]:
    """Maç detay sayfasını çek. /mac/<slug>/<UUID> ve /mac-detay/<UUID> dene."""
    for path in (f"/mac-detay/{uuid}", f"/mac/{uuid}"):
        url = f"https://www.sahadan.com{path}"
        fetched = fetch_nuxt_data(url)
        if fetched:
            return _parse_match_detail(uuid, fetched[0])
    return None


def _parse_match_detail(uuid: str, data: List[Any]) -> Dict[str, Any]:
    """Maç detayından referee + eksik oyuncuları çıkar."""
    referee = _find_referee_in_tree(data)
    injured, suspended = _find_players_in_tree(data)
    return {
        'uuid': uuid,
        'referee': referee,
        'injured': injured,
        'suspended': suspended,
    }


def _find_referee_in_tree(data: List[Any]) -> Optional[Dict[str, Any]]:
    """Nuxt tree'de referee objesi bul.

    Sahadan'da referee node {i, n, s, ...} veya {id, n, slug} ile temsil edilir.
    """
    for idx, node in enumerate(data):
        if not isinstance(node, dict):
            continue
        # Tip 1: {r: ref, ...} (maç objesi içinde referee alanı)
        if 'r' in node and isinstance(node['r'], int) and 'rb_id' not in node:
            # Bu bir maç olabilir; içindeki 'r' referee'a ref olabilir
            # Ama bunu ayırt etmek zor; atla.
            pass
        # Tip 2: {id, n, s} — name + slug var
        keys = set(node.keys())
        if {'id', 'n', 's'}.issubset(keys):
            slug = _resolve(data, node.get('s'))
            if isinstance(slug, str) and 'referee' in slug.lower():
                ref_id = _resolve(data, node.get('id'))
                name = _resolve(data, node.get('n'))
                if isinstance(ref_id, str) and isinstance(name, str):
                    return {
                        'uuid': ref_id,
                        'name': name,
                        'slug': slug,
                    }
        # Tip 3: {i, n, s, ...} → ref-aware
        if {'i', 'n', 's'}.issubset(keys):
            slug = _resolve(data, node.get('s'))
            if isinstance(slug, str) and 'referee' in slug.lower():
                ref_id = _resolve(data, node.get('i'))
                name = _resolve(data, node.get('n'))
                if isinstance(ref_id, (int, str)) and isinstance(name, str):
                    return {
                        'uuid': ref_id if isinstance(ref_id, str) else str(ref_id),
                        'name': name,
                        'slug': slug,
                    }
    return None


def _find_players_in_tree(
    data: List[Any],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Sakatlık ve ceza listelerini bul (heuristic)."""
    injured: List[Dict[str, Any]] = []
    suspended: List[Dict[str, Any]] = []
    for idx, node in enumerate(data):
        if isinstance(node, list) and 0 < len(node) < 50:
            if all(isinstance(x, int) and 0 <= x < len(data) for x in node):
                items = [_resolve(data, x) for x in node]
                if items and isinstance(items[0], dict):
                    first = items[0]
                    if 'n' in first:
                        # reason field varsa, kategori belirle
                        reason = first.get('r') or first.get('rsn') or first.get('reason')
                        reason_str = _resolve(data, reason) if isinstance(reason, int) else reason
                        target = injured
                        if isinstance(reason_str, str):
                            low = reason_str.lower()
                            if 'sakat' in low or 'injury' in low or 'injured' in low:
                                target = injured
                            elif 'ceza' in low or 'kart' in low or 'suspension' in low:
                                target = suspended
                        for it in items:
                            if isinstance(it, dict):
                                nm = _resolve(data, it.get('n'))
                                if isinstance(nm, str):
                                    target.append({
                                        'name': nm,
                                        'reason': reason_str if isinstance(reason_str, str) else None,
                                    })
    return injured, suspended


# ── CLI ──────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sahadan.com iddaa programı + maç detay full scraper"
    )
    parser.add_argument("--date", help="YYYY-MM-DD (default: today)")
    parser.add_argument("--limit", type=int, default=10,
                        help="Maks. maç detay sayısı (rate limit)")
    parser.add_argument("--out", default="sahadan_full.json",
                        help="Çıktı JSON dosyası")
    parser.add_argument("--delay", type=float, default=0.3,
                        help="Maç detay istekleri arası bekleme (saniye)")
    parser.add_argument("--skip-details", action="store_true", default=True,
                        help="Sadece maç listesi, detay çekme (default: true)")
    parser.add_argument("--with-details", dest="skip_details", action="store_false",
                        help="Maç detayı da çek (referee, sakatlık)")
    args = parser.parse_args()

    print(f"📥 Iddaa programı çekiliyor: {args.date or 'bugün'}", file=sys.stderr)
    matches = fetch_iddaa_matches(args.date)
    print(f"   {len(matches)} maç bulundu", file=sys.stderr)

    if not matches:
        print("⚠️  Maç bulunamadı", file=sys.stderr)
        return 1

    if not args.skip_details and args.limit > 0:
        print(f"🔎 İlk {args.limit} maç için detay çekiliyor...", file=sys.stderr)
        for i, m in enumerate(matches[: args.limit]):
            if i % 5 == 0:
                print(f"   [{i}/{min(args.limit, len(matches))}]", file=sys.stderr)
            uuid = m.get('uuid')
            if not uuid:
                continue
            detail = fetch_match_detail(uuid)
            if detail:
                m['detail'] = detail
                m['referee'] = detail.get('referee')
                m['injured'] = detail.get('injured', [])
                m['suspended'] = detail.get('suspended', [])
            time.sleep(args.delay)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({
            'date': args.date,
            'matchCount': len(matches),
            'detailFetched': sum(1 for m in matches if m.get('detail')),
            'matches': matches,
        }, f, ensure_ascii=False, indent=2)

    print(f"✅ {args.out} yazıldı ({len(matches)} maç)", file=sys.stderr)
    referees = [m for m in matches if m.get('referee')]
    print(f"   {len(referees)}/{len(matches)} maçta referee bulundu", file=sys.stderr)
    if matches:
        sample = matches[0]
        print(f"   Örnek: {sample.get('teamA', {}).get('name')} vs "
              f"{sample.get('teamB', {}).get('name')} @ {sample.get('time', '?')}",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
