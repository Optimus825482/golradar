#!/usr/bin/env python3
"""Debug OpenLigaDB league IDs and shortcuts."""
import json, urllib.request, ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

req = urllib.request.Request(
    "https://api.openligadb.de/getavailableleagues",
    headers={"User-Agent": "Mozilla/5.0"},
)
data = json.loads(urllib.request.urlopen(req, timeout=15, context=ctx).read())

print("=== League mapping ===")
targets = {"PL": "Premier League", "bl1": "Bundesliga 1", "SA": "Serie A", "PD": "La Liga", "TSL": "Süper Lig"}
for l in data:
    sc = l.get("leagueShortcut", "")
    if sc in targets:
        print(f'  {sc} ({targets[sc]}): id={l["leagueId"]} season={l.get("leagueSeason","?")}')

print()
print("=== All distinct league shortcuts ===")
shortcuts = set()
for l in data:
    shortcuts.add(l.get("leagueShortcut", ""))
# Find PL-like shortcuts
for sc in sorted(shortcuts):
    if sc in ("PL", "bl1", "bl2", "bl3", "SA", "PD", "F1", "F2", "N1", "P1", "T1", "TSL", "D1", "D2", "I1", "I2", "SP1", "SP2", "E0", "E1", "E2", "E3", "SC0", "G1", "B1"):
        print(f"  Found: {sc}")

print()
print("=== Newer PL entries ===")
pl_entries = [l for l in data if l.get("leagueShortcut") == "PL"]
for e in sorted(pl_entries, key=lambda x: x.get("leagueSeason", 0)):
    print(f'  id={e["leagueId"]} season={e.get("leagueSeason")} name={e.get("leagueName")}')
