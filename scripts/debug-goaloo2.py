#!/usr/bin/env python3
"""Debug Goaloo - TeamInfo + ScheduleList array format."""
import urllib.request, json, ssl

ctx = ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE

url = "https://football.goaloo.com/jsData/matchResult/json/2024-2025/s36_en.json"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
r = urllib.request.urlopen(req, timeout=15, context=ctx)
data = json.loads(r.read())

ti = data.get("TeamInfo", {})
print(f"TeamInfo type: {type(ti)}")
if isinstance(ti, dict):
    keys = list(ti.keys())[:3]
    for k in keys:
        v = ti[k]
        if isinstance(v, dict):
            print(f"  {k}: {v.get('TeamName_En','?')} (ID={v.get('TeamId','?')})")

sched = data.get("ScheduleList", {})
first_round = list(sched.values())[0]
first_match = first_round[0]
print(f"\nFirst match array ({len(first_match)} elements):")
print(f"  [0] ID={first_match[0]}")
print(f"  [1] LeagueID={first_match[1]}")
print(f"  [2] ?={first_match[2]}")
print(f"  [3] Date={first_match[3]}")
print(f"  [4] HomeTeamID={first_match[4]}")
print(f"  [5] AwayTeamID={first_match[5]}")
print(f"  [6] Score={first_match[6]}")
print(f"  [7] HT Score={first_match[7]}")
print(f"  [8] Home Goal Minutes={first_match[8]}")
print(f"  [9] Away Goal Minutes={first_match[9]}")

# Map team IDs
hid = str(first_match[4])
aid = str(first_match[5])
print(f"\nHome: ID={hid} -> {ti.get(hid, {}).get('TeamName_En', '?')}")
print(f"Away: ID={aid} -> {ti.get(aid, {}).get('TeamName_En', '?')}")

# Check TotalScore
total_score = data.get("TotalScore", {})
print(f"\nTotalScore for this match: {total_score.get(str(first_match[0]), '?')}")
