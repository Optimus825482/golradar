#!/usr/bin/env python3
"""Test access to various football data sources."""
import urllib.request
import ssl

# Disable SSL verification for testing
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

sources = [
    ("Football-Data.co.uk homepage", "https://www.football-data.co.uk/"),
    ("Football-Data CSV (E0 23-24)", "https://www.football-data.co.uk/mmz4281/2324/E0.csv"),
    ("Football-Data CSV (E0 22-23)", "https://www.football-data.co.uk/mmz4281/2223/E0.csv"),
    ("Understat", "https://understat.com/league/EPL/2025"),
    ("Footiqo", "https://footiqo.com/"),
]

for name, url in sources:
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/json,*/*",
    })
    try:
        r = urllib.request.urlopen(req, timeout=15, context=ctx)
        data = r.read()
        print(f"[OK] {name}: HTTP {r.status}, {len(data)} bytes")
        if name.startswith("Football-Data CSV"):
            lines = data.decode("utf-8-sig").strip().split("\n")
            print(f"     {len(lines)} rows, headers: {lines[0][:100]}")
    except Exception as e:
        print(f"[FAIL] {name}: {e}")
