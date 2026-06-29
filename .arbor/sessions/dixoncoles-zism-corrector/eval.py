import subprocess, json, sys
# Primary metric: brierCorrected (anyGoal-corrected). Minimize.
# Eval hipotezin moduna/kappasina/betasina göre override edilebilir.
mode = sys.argv[1] if len(sys.argv) > 1 else "frank"
kappa = sys.argv[2] if len(sys.argv) > 2 else "-0.10"
beta = sys.argv[3] if len(sys.argv) > 3 else "0.10"
r = subprocess.run(
    ["bun", "scripts/zism-corrector-benchmark.ts",
     f"--mode={mode}", f"--kappa={kappa}", f"--beta={beta}",
     "--take=50000"],
    capture_output=True, text=True, cwd=r"D:\golradar2", timeout=180,
)
for line in r.stdout.strip().split("\n"):
    if line.startswith("{"):
        d = json.loads(line)
        score = d.get("brierCorrected", 0.5)
        print(f"score: {score:.4f}")
        print(
            f"secondary: brierBase={d['brierBase']:.4f} brierCorrected={d['brierCorrected']:.4f} "
            f"deltaBrier={d['deltaBrier']:.4f} deltaOverUnder={d['deltaOverUnder']:.4f} "
            f"deltaBtts={d['deltaBtts']:.4f}",
            file=sys.stderr,
        )
        break
