import subprocess, json, sys
# Default: poisson+frank kappa=-0.10 (eski corrector'un en iyi konfigürasyonu)
pmf = sys.argv[1] if len(sys.argv) > 1 else "poisson"
corrector = sys.argv[2] if len(sys.argv) > 2 else "frank"
kappa = sys.argv[3] if len(sys.argv) > 3 else "-0.10"
r = subprocess.run(
    ["bun", "scripts/weibull-copula-benchmark.ts",
     f"--pmf={pmf}", f"--corrector={corrector}",
     f"--kappa={kappa}", "--beta=0.10", "--take=10000"],
    capture_output=True, text=True, cwd=r"D:\golradar2", timeout=180,
)
# Benchmark script stdout'ta "score: <X>" ilk satir, JSON ikinci.
# eval.py ilk "score:" satirini, gerekirse JSON parse eder.
score_line = None
for line in r.stdout.strip().split("\n"):
    if line.startswith("score:"):
        score_line = line.strip()
        break
if score_line is None:
    # Yanlizlikla json gelmisse
    for line in r.stdout.strip().split("\n"):
        if line.startswith("{"):
            d = json.loads(line)
            score_line = f"score: {d.get('brierBttsCorrected', 0.5):.4f}"
            break
print(score_line)
# Secondary icin JSON tekrar parse:
for line in r.stdout.strip().split("\n"):
    if line.startswith("{"):
        d = json.loads(line)
        print(
            f"secondary: brierBase={d['brierBase']:.4f} brierCorrected={d['brierCorrected']:.4f} "
            f"deltaBtts={d['deltaBtts']:.4f} pmf={d['pmf']} corrector={d['corrector']}",
            file=sys.stderr,
        )
        break
