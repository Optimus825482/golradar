import subprocess, json, sys
r = subprocess.run(["bun", "scripts/measure-model-briers.ts"], capture_output=True, text=True, cwd=r"D:\golradar2", timeout=180)
for line in r.stdout.strip().split("\n"):
    if line.startswith("{"):
        d = json.loads(line)
        # Arbor min yönde: brierRule düşük = iyi. rule'ı primary yapıyoruz çünkü:
        #   - rule en yüksek ağırlığa sahip slot (0.45)
        #   - 0.1578 Brier ile en fazla kazanç potansiyeli burada
        # Yan etki: ensembleP brier (multivariate blend) de raporlanır.
        print(f"score: {d['brierRule']:.4f}")
        print(f"secondary: brierRule={d['brierRule']:.4f} brierPoisson={d['brierPoisson']:.4f} brierElo={d['brierElo']:.4f} brierMultiBaseline={d['brierMultiBaseline']:.4f}", file=sys.stderr)
        break
