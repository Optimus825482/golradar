#!/usr/bin/env python3
"""Elo combo grid search — runs bun benchmark for each param combo."""
import subprocess, json

tests = [
    ("BASELINE", []),
    ("K=30 HA=30 D=0.25", ["--kBase=30", "--homeAdv=30", "--drawProb=0.25"]),
    ("K=30 HA=30 D=0.20", ["--kBase=30", "--homeAdv=30", "--drawProb=0.20"]),
    ("K=50 HA=30 D=0.25", ["--kBase=50", "--homeAdv=30", "--drawProb=0.25"]),
    ("K=50 HA=30 D=0.20", ["--kBase=50", "--homeAdv=30", "--drawProb=0.20"]),
    ("K=30 HA=50 D=0.25", ["--kBase=30", "--homeAdv=50", "--drawProb=0.25"]),
    ("K=50 HA=50 D=0.25", ["--kBase=50", "--homeAdv=50", "--drawProb=0.25"]),
    ("K=50 HA=30 D=0.27", ["--kBase=50", "--homeAdv=30", "--drawProb=0.27"]),
    ("K=50 HA=30 D=0.22", ["--kBase=50", "--homeAdv=30", "--drawProb=0.22"]),
]
best_brier = 999
best_label = ""

for label, args in tests:
    cmd = ["bun.exe", "scripts/elo-benchmark.ts"] + args
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=r"D:\golradar2", shell=False)
    out = r.stdout + r.stderr
    lines = [l for l in out.split("\n") if l.strip().startswith("{")]
    if not lines:
        print(f"{label}: NO OUTPUT")
        continue
    try:
        d = json.loads(lines[-1])
        b = d["brierMulti"]
        a = d["accuracy"]
        nH = d["nHome"]; nD = d["nDraw"]; nA = d["nAway"]
        print(f"{label}: Brier={b} Acc={a} (H={nH} D={nD} A={nA})")
        if b < best_brier:
            best_brier = b
            best_label = label
    except Exception as e:
        print(f"{label}: PARSE ERROR: {e}")

print(f"\nBEST: {best_label} -> Brier={best_brier}")
