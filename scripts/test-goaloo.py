#!/usr/bin/env python3
"""Test Goaloo JSON endpoints."""
import urllib.request, json, ssl, ssl

ctx = ssl.create_default_context()
ctx.check_hostname=False
ctx.verify_mode=ssl.CERT_NONE

urls = [
    "https://football.goaloo.com/jsData/matchResult/json/2024-2025/s36_en.json",
    "https://football.goaloo.com/jsData/matchResult/json/2024-2025/s34_en.json",
    "https://football.goaloo.com/jsData/matchResult/json/2024-2025/s8_en.json",
    "https://football.goaloo.com/jsData/matchResult/json/2025-2026/s36_en.json",
    "https://www.football.goaloo.com/jsData/matchResult/json/2024-2025/s36_en.json",
]

for url in urls:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        r = urllib.request.urlopen(req, timeout=15, context=ctx)
        data = json.loads(r.read())
        if isinstance(data, list):
            print(f"[OK] {url.split('/')[-1]}: list({len(data)})")
            if data:
                print(f"  Keys: {list(data[0].keys())[:10]}")
                print(f"  Sample: {str(data[0])[:200]}")
        elif isinstance(data, dict):
            lists = {k: len(v) for k, v in data.items() if isinstance(v, list)}
            print(f"[OK] {url.split('/')[-1]}: dict(keys={list(data.keys())[:5]}, lists={lists})")
        else:
            print(f"[?] {url.split('/')[-1]}: {type(data)}")
    except Exception as e:
        print(f"[FAIL] {url.split('/')[-1]}: {e}")
