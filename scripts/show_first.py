"""Show first match in full detail."""
import json
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "D:/temp/sahadan_test2.json"
with open(path) as f:
    d = json.load(f)
m = d["matches"][0]
print(json.dumps(m, ensure_ascii=False, indent=2))
