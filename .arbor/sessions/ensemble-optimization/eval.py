import subprocess, json, sys
r = subprocess.run(["bun", "scripts/ensemble-benchmark.ts"], capture_output=True, text=True, cwd=r"D:\golradar2", timeout=180)
for line in r.stdout.strip().split("\n"):
    if line.startswith("{"):
        d = json.loads(line)
        print(f"score: {d['brierScore']:.4f}")