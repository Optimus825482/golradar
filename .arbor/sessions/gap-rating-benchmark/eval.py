import subprocess, json, sys
# PRIMARY METRIC: brierBlend (GAP-ensemble alpha=0.3). Stub modda brierGap=null.
# Bu yüzden blend = eloP × (1-α) + 0 × α = eloP × 0.7. Baseline brierBlend=0.1282.
r = subprocess.run(
    ["bun", "scripts/gap-rating-benchmark.ts", "--alpha=0.3"],
    capture_output=True, text=True, cwd=r"D:\golradar2", timeout=180,
)
for line in r.stdout.strip().split("\n"):
    if line.startswith("{"):
        d = json.loads(line)
        score = d.get("brierBlend", 0.5)
        print(f"score: {score:.4f}")
        print(
            f"secondary: brierGap={d['brierGap']} brierElo={d['brierElo']:.4f} "
            f"totalUpdates={d['totalUpdates']} "
            f"matchesWithFeatures={d['matchesWithFeatures']} "
            f"alpha={d['alpha']}",
            file=sys.stderr,
        )
        break
