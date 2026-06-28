#!/bin/bash
# Elo Grid Search — Arbor-style hypothesis testing
# Metric: brierMulti (multi-class Brier, lower = better)

cd /d/golradar2
BEST_BRIER=999
BEST_PARAMS=""

echo "═══ ELO GRID SEARCH (Multi-class Brier) ═══"
echo ""

run_test() {
  local label="$1"
  local extra="$2"
  r=$(bun scripts/elo-benchmark.ts $extra 2>/dev/null | grep "^{" | tail -1)
  b=$(echo "$r" | python3 -c "import sys,json; print(json.load(sys.stdin)['brierMulti'])")
  a=$(echo "$r" | python3 -c "import sys,json; print(json.load(sys.stdin)['accuracy'])")
  echo "  $label → Brier=$b Acc=$a"
  better=$(python3 -c "print('yes' if $b < $BEST_BRIER else 'no')")
  if [ "$better" = "yes" ]; then
    BEST_BRIER=$b
    BEST_PARAMS="$label"
  fi
}

echo "─── H1: K_BASE ───"
for v in 10 15 20 25 30 35 40 50; do
  run_test "K_BASE=$v" "--kBase=$v"
done

echo "─── H2: HOME_ADVANTAGE ───"
for v in 30 50 70 80 90 110 130 150; do
  run_test "HOME_ADV=$v" "--homeAdv=$v"
done

echo "─── H3: DECAY_RATE ───"
for v in 0 0.001 0.00325 0.005 0.01 0.02 0.05 0.1; do
  run_test "DECAY=$v" "--decayRate=$v"
done

echo "─── H4: DRAW_PROB ───"
for v in 0.04 0.06 0.08 0.10 0.12 0.15 0.20 0.25; do
  run_test "DRAW=$v" "--drawProb=$v"
done

echo "─── H5: INITIAL_RATING ───"
for v in 1400 1500 1600; do
  run_test "INIT=$v" "--initRating=$v"
done

echo "─── H6: PROVISIONAL_THRESHOLD ───"
for v in 5 10 15 20 30; do
  run_test "PROV=$v" "--provThreshold=$v"
done

echo ""
echo "═══ BEST SINGLE ═══"
echo "Params: $BEST_PARAMS → Brier=$BEST_BRIER"
echo ""

# Best combo via Python
echo "─── BEST COMBO SEARCH ───"
python3 << 'PYEOF'
import subprocess, json, itertools
best = 999
best_params = {}
kbase_vals = [10, 15, 20, 30]
home_vals = [80, 90, 110]
draw_vals = [0.06, 0.08, 0.10]
decay_vals = [0.00325, 0.005, 0.01]
for kb, ha, dr, de in itertools.product(kbase_vals, home_vals, draw_vals, decay_vals):
    extra = f"--kBase={kb} --homeAdv={ha} --drawProb={dr} --decayRate={de}"
    result = subprocess.run(
        ["bun", "scripts/elo-benchmark.ts"] + extra.split(),
        capture_output=True, text=True, cwd="/d/golradar2"
    )
    lines = [l for l in result.stdout.strip().split("\n") if l.startswith("{")]
    if not lines: continue
    d = json.loads(lines[-1])
    b = d["brierMulti"]
    a = d["accuracy"]
    print(f"  K={kb} HA={ha} D={dr} DE={de} → Brier={b} Acc={a}")
    if b < best:
        best = b
        best_params = {"kBase": kb, "homeAdv": ha, "drawProb": dr, "decayRate": de}
print()
print("═══ FINAL BEST COMBO ═══")
print(f"{best_params} → Brier={best}")
# Improvement
default_result = subprocess.run(
    ["bun", "scripts/elo-benchmark.ts"],
    capture_output=True, text=True, cwd="/d/golradar2"
)
dl = [l for l in default_result.stdout.strip().split("\n") if l.startswith("{")][-1]
default_brier = json.loads(dl)["brierMulti"]
imp = (default_brier - best) / default_brier * 100
print(f"\nDefault Brier: {default_brier}")
print(f"Best Brier:    {best}")
print(f"Improvement:   {imp:.1f}%")
PYEOF
