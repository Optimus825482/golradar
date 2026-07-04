#!/usr/bin/env python3
"""Explore OpenLigaDB data structure."""
import urllib.request
import json
import ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

# Get detailed match data for 1 match
url = "https://api.openligadb.de/getmatchdata/bl1/2024"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
r = urllib.request.urlopen(req, timeout=15, context=ctx)
data = json.loads(r.read())

print(f"Total matches: {len(data)}")
print(f"\n--- Full first match ---")
print(json.dumps(data[0], indent=2, ensure_ascii=False)[:2000])

# Count leagues available
leagues_url = "https://api.openligadb.de/getavailableleagues"
req2 = urllib.request.Request(leagues_url, headers={"User-Agent": "Mozilla/5.0"})
r2 = urllib.request.urlopen(req2, timeout=15, context=ctx)
leagues = json.loads(r2.read())
print(f"\n--- Available Leagues ({len(leagues)}) ---")
for l in sorted(leagues, key=lambda x: x.get('leagueId', 0)):
    print(f"  {l.get('leagueId')}: {l.get('leagueName')} ({l.get('leagueShortcut')})")
