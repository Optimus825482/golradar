# Idea Tree

**Baseline**: 0.6% | **Trunk**: N/A

## ROOT: Research session [PENDING]

### 1: DixonColes: rho and gamma grid search over 50K matches. Baseline rho=-0.13, gamma=1.10 → Brier=0.6448. Test rho∈{-0.20..0}, gamma∈{1.0..1.4}. [COMPLETED]

#### 1.1: H2: Test decayRate effect (currently 0.00325). Lower=slower aging, higher=faster revert to mean. [COMPLETED]

**Result**: decay={0, 0.02, 0.05} all → Brier=0.6370. Decay rate has NO MEASURABLE EFFECT on match-outcome Brier. Keep default 0.00325.
