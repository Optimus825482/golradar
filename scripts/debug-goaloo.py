#!/usr/bin/env python3
"""Debug Goaloo JSON structure."""
import urllib.request, json, ssl

ctx = ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE

url = "https://football.goaloo.com/jsData/matchResult/json/2024-2025/s36_en.json"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
r = urllib.request.urlopen(req, timeout=15, context=ctx)
data = json.loads(r.read())

print(f"Top-level keys: {list(data.keys())}")
print()

schedule = data.get("ScheduleList", [])
print(f"ScheduleList: {len(schedule)} items")
if schedule:
    s = schedule[0]
    print(f"First ScheduleItem type: {type(s)}")
    if isinstance(s, dict):
        print(f"Keys: {list(s.keys())}")
        print(f"Values: {json.dumps(s, ensure_ascii=False)[:500]}")
    elif isinstance(s, list):
        print(f"First item: {s}")

# Check TeamInfo
ti = data.get("TeamInfo", [])
print(f"\nTeamInfo: {len(ti)} items")
if ti:
    print(f"First TeamItem: {json.dumps(ti[0], ensure_ascii=False)[:300]}" if isinstance(ti[0], dict) else f"Type: {type(ti[0])}")

# Check total scores
ts = data.get("TotalScore", [])
print(f"\nTotalScore: {len(ts)} items, first 5: {ts[:5]}")
print(f"HomeScore first 5: {data.get('HomeScore', [])[:5]}")
print(f"GuestScore first 5: {data.get('GuestScore', [])[:5]}")

# Check GoalInTimeList
git = data.get("GoalInTimeList", [])
print(f"\nGoalInTimeList: {len(git)} items, first 3: {git[:3]}")
