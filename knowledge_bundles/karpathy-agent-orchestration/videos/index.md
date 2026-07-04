---
type: concept
title: Source Playbook — TL;DR
tags: [karpathy, source]
timestamp: '2026-07-02'
description: '60-second summary of the Karpathy playbook; this concept page is the source-distilled version of all the cross-cutting concept pages in this bundle.'
---

# Source Playbook — TL;DR

> **Source:** "Karpathy's AI Setup — The Complete Agent Orchestration Playbook" by Hyperautomation Labs, based on No Priors Podcast, March 2026.
> **Bundle:** `D:\golradar2\knowledge_bundles\karpathy-agent-orchestration\`

## The 7 concepts, in 60 seconds

1. **Mindset** — 20/80 human/AI. Human = orchestrator, agent = builder.
2. **Skill Issue** — Agent failure = your setup, not model weakness. Improve prompt + context + boundaries.
3. **Token Throughput** — Productivity metric = tokens commanded, not lines typed. Maximize agent runtime per hour.
4. **Parallel Workflow** — Run 4 agents simultaneously: Feature / Research / Architecture / Review. Tile windows, 20-minute rotation.
5. **AutoResearch** — Define objective + metric + CAN/CANNOT-change → run 20+ experiments overnight → review morning.
6. **program.md Meta-Optimization** — Instruction file is itself tunable. Agent refines program v2 based on results.
7. **Jaggedness + Jevons** — Models are brilliant at verifiable work, mediocre at subjective. Cheaper software means more engineers needed, role shifts.

## Quote wall

- *"If you have subscription left over, you haven't maximized your token throughput."*
- *"Researchers shouldn't run experiments. They should design systems that run them."*
- *"When agents fail, the instinct is to blame the model. The problem is your setup."*
- *"The capability surface is jagged, not smooth."*
- *"Instruction optimization is the new hyperparameter tuning."*

## The five-step AutoResearch loop (this is the headline)

```
1. Objective →  2. Metric →  3. CAN change →  4. CANNOT change →  5. Hit go
                                                                  │
                                                                  ▼
                                                          (runs overnight)
                                                                  │
                                                                  ▼
                                                          (review morning)
```

## Companion bundles

| Bundle | Role |
|---|---|
| `D:\golradar2\knowledge_bundles\cole-medin-ai-coding\` | Micro-execution: PRP, PIV Loop, AI Layer, Harness |
| `D:\golradar2\knowledge_bundles\karpathy-agent-orchestration\` (this) | Macro-orchestration: parallelism, AutoResearch, meta-optimization |

**Together:** Cole = how one agent works well. Karpathy = how to run many agents that work well together.

## Concrete next step for this workspace

`D:\golradar2\program.md` is shipped with this bundle. It's the **instantiated AutoResearch spec** for GolRadar ML pipeline optimization. Run it overnight. Review in the morning.
