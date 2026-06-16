"""Quick exploration script for Goaloo football data structure."""
import json
from curl_cffi import requests

s = requests.Session(impersonate='chrome131')
r = s.get(
    'https://football.goaloo.com/jsData/matchResult/json/2026-2027/s34_en.json',
    timeout=30,
    headers={'Referer': 'https://football.goaloo.com/league/34'}
)
data = json.loads(r.content.decode('utf-8-sig'))

print('Type:', type(data).__name__)
print('Keys:', list(data.keys()))
print()

# Team mapping
print('=== TeamInfo (first 5) ===')
for t in data['TeamInfo'][:5]:
    print(f'  id={t[0]} name={t[1]}')
print()

# Schedule list structure
sl = data['ScheduleList']
print(f'=== ScheduleList: type={type(sl).__name__}, len={len(sl)} ===')
if sl and isinstance(sl, dict):
    keys = list(sl.keys())
    print(f'Top-level keys: {keys[:20]}')
    first_key = keys[0]
    val = sl[first_key]
    print(f'\n  {first_key}: type={type(val).__name__}')
    if isinstance(val, list) and val:
        print(f'  len={len(val)}')
        print(f'  Keys in first item: {list(val[0].keys())}')
        for i in [0, 1, min(2, len(val)-1)]:
            m = val[i]
            print(f'  --- Match {i} ---')
            for k, v in m.items():
                s_v = str(v)
                if len(s_v) > 120:
                    s_v = s_v[:120] + '...'
                print(f'    {k}: {s_v}')
            print()

# Check season info
print('=== SubLeagueInfo ===')
if 'SubLeagueInfo' in data:
    print(json.dumps(data['SubLeagueInfo'], indent=2)[:500])

print()
for k in [k for k in data.keys() if k not in ('ScheduleList','TeamInfo','SubLeagueInfo','ColorList','TeamTech')]:
    v = str(data[k])
    print(f'{k}: {v[:300]}')
