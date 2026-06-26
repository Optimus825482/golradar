import json, subprocess, sys

# Get Galatasaray matches from last month
r = subprocess.run(
    ['bsd', 'search-matches', '--team', 'Galatasaray', '--date-from', '2026-05-01', '--output', 'json'],
    capture_output=True, text=True, timeout=30
)
raw = json.loads(r.stdout)
text = json.loads(raw['content'][0]['text'])
print(f"Toplam maç: {text.get('count', 0)}")

for m in text.get('results', []):
    h = m.get('home_team', '')
    a = m.get('away_team', '')
    h_id = m.get('home_team_id')
    a_id = m.get('away_team_id')
    lid = m.get('league_id')
    # Check both name and ID
    if h_id == 125 or a_id == 125 or 'Galatasaray' in h or 'Galatasaray' in a:
        print(f"LigID:{lid} | {h} vs {a} (home_id:{h_id}, away_id:{a_id})")
