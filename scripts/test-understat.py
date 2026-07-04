#!/usr/bin/env python3
"""Understat parser fixed - extract match data from HTML."""
import urllib.request
import json
import re
import ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def extract_json_var(html, var_name):
    """Extract JavaScript variable from HTML."""
    # Try different patterns
    patterns = [
        rf'{var_name}\s*=\s*JSON\.parse\((\'.+?\'|".+?")\)',
        rf'{var_name}\s*=\s*(\[.+?\])\s*;',
        rf'{var_name}\s*=\s*(\{{.+?\}})\s*;',
    ]
    for pat in patterns:
        m = re.search(pat, html, re.DOTALL)
        if m:
            raw = m.group(1)
            if raw.startswith("'") or raw.startswith('"'):
                raw = json.loads(raw)
            try:
                return json.loads(raw) if isinstance(raw, str) else raw
            except:
                continue
    return None

# Test with EPL 2024/25
url = "https://understat.com/league/EPL/2024"
req = urllib.request.Request(url, headers={
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
})
r = urllib.request.urlopen(req, timeout=20, context=ctx)
html = r.read().decode("utf-8")

# Try to extract datesData, teamsData, playersData
for var in ["datesData", "teamsData", "playersData"]:
    data = extract_json_var(html, var)
    if data:
        if isinstance(data, list):
            print(f"[OK] {var}: {len(data)} items")
            if data and len(data) > 0:
                print(f"  First item keys: {list(data[0].keys())[:10]}")
                print(f"  Sample: {json.dumps(data[0], ensure_ascii=False)[:200]}")
        elif isinstance(data, dict):
            print(f"[OK] {var}: {len(data)} keys")
            first_key = list(data.keys())[0] if data else None
            if first_key:
                print(f"  First key: {first_key}")
                print(f"  Sample: {json.dumps(data[first_key], ensure_ascii=False)[:200]}")
    else:
        print(f"[FAIL] {var}: Not found")
