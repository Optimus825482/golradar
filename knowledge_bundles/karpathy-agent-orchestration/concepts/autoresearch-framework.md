---
type: concept
title: AutoResearch Framework — Autonomous Overnight Loops
tags: [karpathy, autorearch, autonomous, experimentation]
related_videos: [playbook]
timestamp: '2026-07-02'
description: 'Define objective + metric + CAN-change boundaries + CANNOT-change boundaries. Hit go. Agent runs 20+ experiments overnight. You review in the morning. ONLY for verifiable tasks.'
---

# AutoResearch Framework — Autonomous Overnight Loops

The AutoResearch loop is Karpathy's most powerful pattern. **Define the metric, set the boundaries, hit go** — and let it run while you sleep.

## The 5-step setup

1. **Define the objective.** What are you optimizing? ("minimize validation loss on NanoChat")
2. **Define the metric.** How is success measured? Numeric and ideally cheap to compute.
3. **Set CAN-change boundaries.** What's in scope? (hyperparameters, architecture, optimizer settings)
4. **Set CANNOT-change boundaries.** What's sacred? (dataset, core loop, external dependencies)
5. **Hit go.** Let the agent iterate. Each iteration: change ONE variable, run experiment, log result, decide keep-or-revert.

You review the experiment log in the morning. 20+ experiments typically run overnight.

## What the agent did overnight — Karpathy's actual results

On his NanoChat runs, AutoResearch discovered:

| "Obvious-in-hindsight" non-obvious tweak | Net effect |
|---|---|
| Selective weight decay on value embeddings | Better generalization |
| Non-default Adam betas (e.g. β1=0.95, β2=0.99 vs the 0.9/0.999 default) | Measurable loss reduction |
| Joint tweaks that individually do nothing but compound | Significant compound gains |

These are tweaks **no human would have tried**, or would have tried and given up on. The agent doesn't have intuition-bias; it just runs the grid.

## What's required for AutoResearch to work

| Required | Why |
|---|---|
| **Objective numeric metric** | Loss, accuracy, F1, latency, pass rate, RMSE — anything with a single-number answer |
| **Cheap evaluation** | One experiment must run in minutes, not hours (otherwise overnight = 2 experiments, not 20) |
| **Clear change-boundary** | Without it, the agent might rewrite the entire system |
| **Version control** | The agent needs to revert failed experiments; git is mandatory |
| **Logging** | Each experiment must leave a trace (config, metric, hash of code) for morning review |

## Hard limitation — what's NOT auto-researchable

> **AutoResearch works ONLY for tasks with OBJECTIVE metrics.**
> **If you can't evaluate it automatically, you can't auto-research it.**

Things that DON'T work:

- **Subjective quality**: writing style, design taste, UX feel — still human-in-loop.
- **Strategic decisions**: which feature to ship next quarter, what business model — politics + values + unknowns, not a metric.
- **Open-ended creative work**: composing a poem, choosing a brand voice — no objective score.
- **Hard to eval**: customer satisfaction (slow feedback loop), revenue (lots of confounders).

For these, you still need the human in PIV loop. AutoResearch amplifies the parts that ARE automatable.

## The experimental loop

```python
# Pseudocode of what the agent runs all night
for experiment_id in range(20):
    config = perturb(baseline_config, in_scope_axes)
    if violates(out_of_scope, config): continue
    metric = train_and_evaluate(config, dataset=fixed)
    log(experiment_id, config, metric)
    if metric < best_seen:
        baseline_config = config
        best_seen = metric
        git_commit(f"autoresearch:{experiment_id}")
    else:
        git_revert_to(baseline_config)
```

**One variable per iteration.** Holding all-but-one constant is what makes the experiment interpretable.

## Companion: `D:\golradar2\program.md`

This bundle ships a concrete `program.md` instantiated for the **GolRadar ML pipeline** — defining the metric (log loss on validation), the in-scope axes (gradient boosting hyperparameters, ensemble weights), and the sacred ground (training data, fixture order). Run it overnight, review in the morning.

## How this connects

- [[parallel-agent-workflow]] — the orchestrator's job is to **run AutoResearch as one of the 4 agents**, not babysit it.
- [[program-md-meta-optimization]] — the **instruction file itself** can be AutoResearch'd (after the metric).
- [[skill-issue-not-model]] — bad results? Check the program.md, not the model.
