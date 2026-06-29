import subprocess, json, sys
# PRIMARY METRIC: brierBmaStackingWeighted (alpha-blend ile) — alt min=iyi.
# baseline_score brierBMA=0.0557; alpha-blend'in buna göre mutlak delta'sını
# ölçmek için brierBmaStackingWeighted kullanıyoruz.
# Cold-start: brierStacking 0.45 default eşit ağırlıklar → alpha-blend
# negatif delta üretecektir. Bu pruning için yeterli kanıt.
r = subprocess.run(
    ["bun", "scripts/stacking-benchmark.ts", "--alpha=0.3"],
    capture_output=True, text=True, cwd=r"D:\golradar2", timeout=180,
)
for line in r.stdout.strip().split("\n"):
    if line.startswith("{"):
        d = json.loads(line)
        score = d.get("brierBmaStackingWeighted")
        if score is None:
            score = d.get("brierBMA", 0.5)
        print(f"score: {score:.4f}")
        print(
            f"secondary: brierBMA={d['brierBMA']:.4f} "
            f"brierStacking={d['brierStacking']:.4f} "
            f"weightedDelta={d['weightedDelta']} "
            f"alpha={d['alpha']} "
            f"samplesLoaded={d['stackingSamplesLoaded']}",
            file=sys.stderr,
        )
        break
