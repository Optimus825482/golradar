#!/usr/bin/env python3
"""Debug: test various OpenLigaDB endpoint patterns."""
import json, urllib.request, ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

tests = [
    ("bl1 (shortcut)", "https://api.openligadb.de/getmatchdata/bl1/2024"),
    ("ID 4741", "https://api.openligadb.de/getmatchdata/4741/2024"),
    ("ID 4741 no season", "https://api.openligadb.de/getmatchdata/4741"),
    ("PL ID 92", "https://api.openligadb.de/getmatchdata/92/2009"),
    ("PL ID 338", "https://api.openligadb.de/getmatchdata/338/2011"),
    ("bl1 shortcut (www)", "https://www.openligadb.de/api/getmatchdata/bl1/2024"),
]

for name, url in tests:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        data = json.loads(urllib.request.urlopen(req, timeout=15, context=ctx).read())
        if isinstance(data, list):
            print(f"[OK] {name}: {len(data)} matches")
        else:
            print(f"[?] {name}: {type(data)}")
    except Exception as e:
        print(f"[FAIL] {name}: {e}")
