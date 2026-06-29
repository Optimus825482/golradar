import subprocess, json, sys
# Primary metric: brierPiEloBlend (alpha-blend). Minimize. Default alpha=0.5.
# Not: baseline = brierElo (cold-start fallback), ancak regression kontrolu
# icin alpha-blend skorunu birincil metrik olarak kullanıyoruz.
alpha = sys.argv[1] if len(sys.argv) > 1 else "0.5"
r = subprocess.run(
    ["bun", "scripts/pi-rating-benchmark.ts", f"--alpha={alpha}", "--take=10000"],
    capture_output=True, text=True, cwd=r"D:\golradar2", timeout=180,
)
for line in r.stdout.strip().split("\n"):
    if line.startswith("{"):
        d = json.loads(line)
        score = d.get("brierPiEloBlend", 0.5)
        print(f"score: {score:.4f}")
        print(
            f"secondary: brierElo={d['brierElo']:.4f} brierPi={d['brierPi']:.4f} "
            f"brierBlend={d['brierPiEloBlend']:.4f} alpha={d['alpha']} "
            f"totalUpdates={d['totalUpdates']}",
            file=sys.stderr,
        )
        break
