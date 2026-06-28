"""eval.py — Elo benchmark harness for Arbor."""
from __future__ import annotations
import subprocess, json, sys
from pathlib import Path

def evaluate(split: str) -> float:
    project = Path(__file__).resolve().parent
    bench = project / "scripts" / "elo-benchmark.ts"
    result = subprocess.run(
        ["bun", str(bench)],
        capture_output=True, text=True, cwd=str(project),
        timeout=120,
    )
    for line in result.stdout.strip().split("\n"):
        if line.startswith("{"):
            d = json.loads(line)
            return d["brierMulti"]
    print(f"eval error: {result.stderr}", file=sys.stderr)
    return 1.0

def main() -> None:
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--split", choices=["dev", "test"], default="dev")
    args = parser.parse_args()
    score = evaluate(args.split)
    print(f"score: {score:.4f}")

if __name__ == "__main__":
    main()
