# Idea Tree

**Baseline**: 0.7% | **Trunk**: N/A

## ROOT: Research session [PENDING]

### 1: H1: Grid search all Elo params (K_BASE, HOME_ADV, drawProb, decayRate) on 87K matches. Baseline Brier=0.6655. Test: bun scripts/elo-benchmark.ts --kBase=X --homeAdv=Y --drawProb=Z [COMPLETED]

#### 1.1: H1a: Test K_BASE=60 (further increase from 50). Higher K = faster rating convergence, more responsive to recent results. [PRUNED] (score: 0.7%)

**Result**: K=60 → Brier=0.6643. Worse than baseline 0.6655. PRUNED.

#### 1.2: H1b: Test HOME_ADV=30 (lower than 50). Minimal home advantage in leagues with high away-win rates. [PRUNED] (score: 0.7%)

**Result**: HA=30 → Brier=0.6642. Worse than baseline. PRUNED.

#### 1.3: H1c: Test drawProb=0.30 (increase from 0.25). Higher draw rate for leagues with frequent draws. [COMPLETED] (score: 0.6%)

**Result**: D=0.30 → Brier=0.6374. Better than baseline, but 0.6296 still wins. MERGED as insight: drawProb ceiling ≈ 0.25-0.30.

#### 1.4: H1d: Test combo K=60, HA=30, D=0.30 — theoretical best corner of parameter space. [COMPLETED] (score: 0.6%)

**Result**: K=60+HA=30+D=0.30 → Brier=0.6362. Better than baseline but 0.6296 still champion. Interaction effect confirmed: K and HA must move together.
