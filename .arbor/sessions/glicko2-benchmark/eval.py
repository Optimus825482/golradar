import subprocess, json, sys
r = subprocess.run(
    ["bun", "scripts/glicko2-benchmark.ts", "--alpha=0.5", "--take=10000"],
    capture_output=True, text=True, cwd=r"D:\golradar2", timeout=180,
)
for line in r.stdout.strip().split("\n"):
    if line.startswith("{"):
        d = json.loads(line)
        score = d.get("brierBlend", 0.5)
        print(f"score: {score:.4f}")
        print(
            f"secondary: brierElo={d['brierElo']:.4f} brierGlicko={d['brierGlicko']:.4f} "
            f"brierBlend={d['brierBlend']:.4f} totalUpdates={d['totalUpdates']}",
            file=sys.stderr,
        )
        break
