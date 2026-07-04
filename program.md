---
title: program.md — GolRadar AutoResearch Spec (historical, v1.2)
workspace: D:/golradar2
objective: minimize brier_multi on eval.py (currently 0.6655)
metric: brier_multi
status: v1.2 — runner REMOVED per user request (2026-07-02)
author: erkan
date: 2026-07-02
bundle: D:/golradar2/knowledge_bundles/karpathy-agent-orchestration/concepts/
---

# program.md — Historical Document (AutoResearch Pipeline Removed)

> **Status note (2026-07-02):** The AutoResearch runner, its wrapper, config, experiments log, and README were removed from `ml/` at the user's explicit request. This document is retained as a **historical record** only. The `ml/` directory now contains only `ml/AUDIT.md`, which keeps the audit notes for future reference.
>
> If AutoResearch is wanted again later, the simplest path is to clone the now-archived runner (see `ml/AUDIT.md`) and rebuild incrementally from there. The Karpathy bundle (`D:/golradar2/knowledge_bundles/karpathy-agent-orchestration/concepts/autoresearch-framework.md`) still documents the pattern in theory.

---

## v1.2 — removed scope

The v1.1 spec previously documented:

- Objective: minimize `brier_multi < 0.65` on `eval.py --split dev`
- Three live axes (`elo.k_base`, `elo.home_advantage`, `elo.draw_prob`)
- 8-experiment trail produced 2 keepers; baseline 0.6655 → best 0.6630
- Stop conditions: `--max-experiments`, `--objective-target`, `--reps`, deterministic metric
- Sacred ground: data/, scripts/, prisma/, components/, i18n/, package.json, Dockerfile, docker-compose.coolify.yml (enforced via `sacred_touched()` — but with `sacred_touched()` was never wired into the keeper path, per `ml/AUDIT.md`)

## v1.1 → v1.2 diff

- v1.2: deleted `ml/autoresearch_runner.py`, `ml/eval_with_overrides.py`, `ml/config.yaml`, `ml/experiments.md`, `ml/README.md`. Kept `ml/AUDIT.md`.
- v1.1: had documented all of the above in active use.
- v1: aspirational `log_loss` target, never wired.

## Companion references (still active)

| Reference | Path | Status |
|---|---|---|
| Karpathy AutoResearch concept | `D:\golradar2\knowledge_bundles\karpathy-agent-orchestration\concepts\autoresearch-framework.md` | Live — keeps the theory even though the runtime was removed |
| Karpathy program.md meta-optimization | `D:\golradar2\knowledge_bundles\karpathy-agent-orchestration\concepts\program-md-meta-optimization.md` | Live |
| Cole Medin PIV Loop | `D:\golradar2\knowledge_bundles\cole-medin-ai-coding\concepts\the-piv-loop.md` | Live |
| Audit (removal rationale + open items) | `D:\golradar2\ml\AUDIT.md` | Live, retained by decision |

## Why the runner was removed

User feedback after a 5-iteration trial ran cleanly: the nightly loop concept was not needed at this point in the project's lifecycle, so the runtime was taken out. The knowledge bundle, the spec, the audit log, and the conceptual references are kept for re-activation whenever the user decides to bring it back.
