## Codebase

Working directory: D:\golradar2

## Git Isolation

Work in the assigned experiment branch/worktree. Do not switch back to the main repository for implementation or evaluation.

## Research Idea

**ID**: 1
**Hypothesis**:
Mechanism: Golden sonra cooling linear(0.6çarpan) yetersiz. Hücum patlaması faktörü anlık spike ile skoru eşik üstüne taşıyor.
Hypothesis: Quadratic cooling + 0.3 çarpan + 3dk cooldown M1'i %34→%60+ çıkarır.
Observable: 24h sonra false_alarm 179→60-, M1>%50, M2 sabit.
Conflicts: x0 kalibrasyon değişikliğiyle etkileşim — calibratedP düşük sinyaller eşiği geçebilir.

## Evaluation Info

- **Evaluation command (B_dev)**: `cd D:\golradar2 && echo M1:34.1 M2:67.5`
- **Baseline score**: 34

Use B_dev for final experiment scoring. Do NOT use B_test.

## Instructions

1. Understand the code before editing.
2. Implement the idea faithfully.
3. Run quick checks to ensure the new logic is active.
4. Iterate on implementation bugs.
5. Run the B_dev evaluation when credible.
6. Report Changes, Baseline vs Result, Score, and Insight. The score must be the absolute primary metric, not a delta.

Save results to `results/1-<brief-description>/`.
