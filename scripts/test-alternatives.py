#!/usr/bin/env python3
"""
Try alternative historical match data sources.
Football-Data.co.uk is blocked from this network.
Testing alternatives:
  1. OpenLigaDB (German football, free API)
  2. Understat match list (top 5 leagues, free)
"""
import urllib.request
import json
import ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

# 1. OpenLigaDB - free, no API key needed
try:
    url = "https://api.openligadb.de/getmatchdata/bl1/2024"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    r = urllib.request.urlopen(req, timeout=15, context=ctx)
    data = json.loads(r.read())
    print(f"[OK] OpenLigaDB Bundesliga 2024: {len(data)} matches")
    if data:
        m = data[0]
        print(f"     Example: {m.get('Team1',{}).get('TeamName')} vs {m.get('Team2',{}).get('TeamName')}")
        print(f"     Score: {m.get('MatchResults', [{}])[0].get('PointsTeam1')}-{m.get('MatchResults', [{}])[0].get('PointsTeam2')}")
except Exception as e:
    print(f"[FAIL] OpenLigaDB: {e}")

# 2. Understat - test xG data
try:
    url = "https://understat.com/league/EPL/2024"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    r = urllib.request.urlopen(req, timeout=15, context=ctx)
    html = r.read().decode("utf-8")
    # Find JSON data in script vars
    import re
    m = re.search(r"datesData\s*=\s*(\[.+?\])\s*;", html, re.DOTALL)
    if m:
        matches = json.loads(m.group(1))
        print(f"[OK] Understat EPL 2024: {len(matches)} matches")
        if matches:
            print(f"     Example: {matches[0].get('h',{}).get('title')} vs {matches[0].get('a',{}).get('title')}")
            print(f"     xG: {matches[0].get('xG',{}).get('h')} - {matches[0].get('xG',{}).get('a')}")
    else:
        print("[FAIL] Understat: Could not parse datesData")
except Exception as e:
    print(f"[FAIL] Understat: {e}")

# 3. Try alternative football-data URL pattern
try:
    # Try IP or mirror
    url = "https://www.football-data.co.uk/mmz4281/2324/E0.csv"
    import socket
    ip = socket.gethostbyname("www.football-data.co.uk")
    print(f"[INFO] football-data.co.uk resolves to: {ip}")
except Exception as e:
    print(f"[INFO] football-data.co.uk DNS: {e}")
