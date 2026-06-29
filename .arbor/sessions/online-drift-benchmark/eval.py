import subprocess, json, sys
# PRIMARY METRIC: maxAccuracy (rule model) — min=0.5 (tahmin yararsız),
# max=1.0 (mükemmel). Arbor max yönde maximize → yüksek = iyi.
r = subprocess.run(
    ["bun", "scripts/online-drift-benchmark.ts", "--window=500"],
    capture_output=True, text=True, cwd=r"D:\golradar2", timeout=120,
)
for line in r.stdout.strip().split("\n"):
    if line.startswith("{"):
        d = json.loads(line)
        score = d.get("maxAccuracy", 0)
        print(f"score: {score:.4f}")
        print(
            f"secondary: totalRecords={d['totalRecords']} "
            f"topModel={d['topModel']} "
            f"adjustmentFactors={d['adjustmentFactors']} "
            f"perModelAccuracy={d['perModelAccuracy']} "
            f"positiveRate={d['positiveRate']}",
            file=sys.stderr,
        )
        break
