---
type: concept
title: program.md — Meta-Layer Optimization
tags: [karpathy, meta-optimization, instruction-set, recursive]
related_videos: [playbook]
timestamp: '2026-07-02'
description: 'CLAUDE.md / program.md is the meta-layer that shapes every agent interaction. The instruction file ITSELF can be optimized by another agent. v1 by human, model refines, v2 produces better outcomes.'
---

# program.md — Meta-Layer Optimization

Karpathy's most recursive concept: **the instruction file that tells the agent what to do can itself be optimized by another agent.**

## What program.md is

```
# program.md — Agent Configuration
## Objective
Optimize the training loop for NanoChat. Success metric: validation loss < 0.85

## Boundaries — CAN change
- Hyperparameters: learning rate, batch size, warmup
- Architecture: layer count, hidden dim, attention heads
- Optimizer: Adam betas, weight decay

## Boundaries — CANNOT change
- Dataset
- Core training loop structure
- External dependencies

## Process
1. Run baseline, record loss
2. Make ONE change, run experiment
3. Log results in experiments.md
4. If better → keep. If worse → revert.
5. Repeat until objective met OR 20 experiments done.
```

This is your **spec document for the agent**. The agent reads program.md and runs the loop autonomously.

## Why the meta-layer matters

Every agent interaction starts with reading program.md (or CLAUDE.md, or AGENTS.md). The quality of the program determines the quality of the agent's work. Improving the program improves ALL future runs.

This is **hyperparameter tuning for the instruction set.**

## The recursive loop

```
┌───────────────────────┐
│      Human             │
│  Writes program v1     │
└──────────┬─────────────┘
           │
           ▼
┌───────────────────────┐
│     Agent A            │
│  Runs experiments      │
│  per program v1        │
└──────────┬─────────────┘
           │
           ▼
┌───────────────────────┐
│     experiments.md     │
│  results logged        │
└──────────┬─────────────┘
           │
           ▼
┌───────────────────────┐
│     Agent B (meta)     │
│  Reads experiments.md  │
│  Suggests program v2   │
│  "Increase LR more     │
│   aggressively"        │
└──────────┬─────────────┘
           │
           ▼
┌───────────────────────┐
│      Human             │
│  Approves program v2   │
└──────────┬─────────────┘
           │
           ▼
   (Loop back to Agent A)
```

**Agent B suggests v2. Human approves. Agent A re-runs. The instruction file gets smarter over time.**

## When to use this

- **Your current program.md produces mediocre results.** The agent isn't following what you want.
- **You have many experiments but no clear winner.** Pattern: the program.md is wrong, not the experiment.
- **You want to share the optimization with teammates / future-you.** The improved program.md persists.

## When NOT to use this

- **Subjective work.** Instruction optimization only makes sense if you can measure outcomes (see AutoResearch limitation).
- **One-off tasks.** The meta-optimization loop is amortized cost; you only benefit if you run the loop multiple times.

## Companion: Cole Medin's "AI Layer" + "System Evolution"

| Karpathy | Cole Medin |
|---|---|
| program.md = meta-layer | CLAUDE.md / AGENTS.md = AI Layer |
| Recursive optimization | Inner loop (PIV) + Outer loop (after bug, improve AI Layer) |
| Agent B refines instructions | Human runs outer loop retroactively |

**They describe the same phenomenon** from different angles. Karpathy frames it as meta-optimization. Cole Medin frames it as "system evolution." Same idea: the instructions that govern the agent are version-controlled and get better over time.

## How to apply

1. **Version-control your program.md.** Treat it like code.
2. **After every AutoResearch run, review both results.md AND program.md.** Sometimes the program needs refinement.
3. **Let an agent propose program v2** based on what failed. You approve. The new file is checked in.
4. **Re-run.** Compound gains.
