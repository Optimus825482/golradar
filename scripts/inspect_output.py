"""Inspect scraper output for debugging."""
import json
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "D:/temp/sahadan_test.json"
with open(path) as f:
    d = json.load(f)

print(f"Date: {d.get('date')}")
print(f"Match count: {d['matchCount']}")
print(f"Detail fetched: {d['detailFetched']}")
print()

print("İlk 5 maç:")
for m in d['matches'][:5]:
    ta = m.get('teamA') or {}
    tb = m.get('teamB') or {}
    print(f"  #{m.get('matchId')} {ta.get('name', '?')} vs {tb.get('name', '?')} @ {m.get('time', '?')}")
    print(f"     uuid={m.get('uuid')[:8] if m.get('uuid') else '?'}, status={m.get('status')}, fullTime={m.get('fullTimeScore')}")
    if m.get('referee'):
        print(f"     referee: {m['referee']}")
    if m.get('injured'):
        print(f"     injured: {m['injured'][:2]}")
    if m.get('suspended'):
        print(f"     suspended: {m['suspended'][:2]}")
    print()

# teamA None sayısı
none_teamA = sum(1 for m in d['matches'] if m.get('teamA') is None)
none_teamB = sum(1 for m in d['matches'] if m.get('teamB') is None)
print(f"teamA=None: {none_teamA}, teamB=None: {none_teamB}")

# teamA var ama name yok olan
ta_noname = sum(1 for m in d['matches'] if m.get('teamA') and not m['teamA'].get('name'))
print(f"teamA var ama name=None: {ta_noname}")
