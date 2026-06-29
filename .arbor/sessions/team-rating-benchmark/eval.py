import subprocess, json, sys
# Primary metric: piBrier from backfill-pi-ratings-full (TeamHistoryMatch ile)
# Bu eval, server'da calistirilmalidir (local DB'de TeamHistoryMatch yoksa).
# 
# Calistirma:
#   bun scripts/backfill-pi-ratings-full.ts --persist
#   python .arbor/sessions/team-rating-benchmark/eval.py
r = subprocess.run(
    ["bun", "scripts/backfill-pi-ratings-full.ts"],
    capture_output=True, text=True, cwd=r"D:\golradar2", timeout=300,
)
for line in r.stdout.strip().split("\n"):
    if line.startswith("{"):
        d = json.loads(line)
        score = d.get("piBrier", 0.5)
        print(f"score: {score:.4f}")
        print(
            f"secondary: teamsTrained={d.get('teamsTrained', 0)} "
            f"totalMatches={d.get('totalMatches', 0)}",
            file=sys.stderr,
        )
        break
