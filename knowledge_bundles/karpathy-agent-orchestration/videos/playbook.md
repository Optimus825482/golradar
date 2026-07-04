---
type: video
title: Karpathy's AI Setup — The Complete Agent Orchestration Playbook
tags: [karpathy, source, autorearch, parallel-agents]
timestamp: '2026-07-02'
description: 'Andrej Karpathy on the No Priors Podcast (March 2026). Distilled by Hyperautomation Labs. Original is a long-form interview; this concept sheet preserves the 7 key ideas with verbatim quotes.'
resource: 'https://hyperautomationlabs.co'
related_concepts: [mindset-shift, skill-issue-not-model, token-throughput, parallel-agent-workflow, autoresearch-framework, program-md-meta-optimization, jaggedness-and-jevons]
---

# Karpathy's AI Setup — Source Playbook (Long-Form Notes)

The full source-distilled playbook from the No Priors Podcast interview. Every concept page in this bundle is a refinement of one section here.

## Source detail

- **Subject:** Andrej Karpathy (former Tesla AI Director, OpenAI co-founder, current independent researcher).
- **Show:** No Priors Podcast.
- **Episode:** March 2026 (estimated — based on "by Dec 2025" reference in the interview).
- **Distilled by:** Hyperautomation Labs (hyperautomationlabs.co).
- **Format:** Long-form interview, ~45-60 minutes, plus a written summary with embedded images. This concept sheet preserves the written summary.

## Sections — direct from source

### The Mindset Shift

Before the tools and workflows, Karpathy changed how he thinks about programming. Four shifts foundation everything else is built on:

1. **From 80/20 to 20/80.** Karpathy went from 80% hand-coding/20% AI assistance to 20% human/80% AI agents by December 2025.
2. **It's a Skill Issue.** When agents fail, the problem is YOUR setup (bad prompts, missing context, unclear constraints), not the model.
3. **Token Throughput > Typing Speed.** Productivity = tokens you command. New bottleneck = orchestration bandwidth.
4. **AI Psychosis.** Anxiety of not being at the frontier — real signal to push harder. The cure is more parallel agents, not less.

### Karpathy's Rule

> *"If you have subscription left over, you haven't maximized your token throughput."*

### The Setup

Karpathy described in the interview the actual tools, workflow, and orchestration pattern he uses daily.

**Primary tools:** Claude Code (primary coding agent, terminal, full codebase, executes commands), Codex (secondary agent, switched to when Claude hits quota, 24/7 pipeline continuity).

### Parallel Agent Workflow — Multiple agents running simultaneously

- **Agent 1:** Feature Implementation — building the actual feature, writing code, running tests.
- **Agent 2:** Research / Exploration — exploring approaches, reading docs, prototyping solutions.
- **Agent 3:** Planning / Architecture — designing systems, writing specs, mapping dependencies.
- **Agent 4:** Code Review / Testing — reviewing Agent 1's output, writing tests, catching bugs.

### CLAUDE.md / program.md

Detailed markdown files describing HOW agents should work. The meta-layer — the instructions that shape every agent interaction.

### Macro Actions

Stop thinking "write a function." Think "build this feature" and delegate the entire scope to an agent. **Feature-level delegation, not line-level.**

### Peter Steinberg Method

Tile multiple agent terminal windows on screen. Give each a 20-minute task. Rotate between them — review one agent's output while others are still working. Your job: **keep every agent fed with clear, well-scoped tasks.**

### AutoResearch Framework

Karpathy's most powerful concept: autonomous AI research loops. **Define the metric, set the boundaries, hit go** — and let it run overnight.

5-step setup:
1. Define the objective to optimize.
2. Define the success metric.
3. Set CAN-change boundaries.
4. Set CANNOT-change boundaries.
5. Hit go. Let the agent run experiments autonomously.

Each iteration: change one variable, measure, log, decide keep or revert. Review results in the morning — agent ran 20+ experiments overnight.

### What Karpathy Found

On his own training runs (NanoChat), the agents discovered non-obvious optimizations:

- **Weight Decay on Value Embeddings** — selective regularization on value projection weights improved generalization.
- **Adam Betas Tuning** — non-default beta values for the Adam optimizer yielded measurable loss reduction.
- **Joint Interactions** — combinations of small tweaks that individually do nothing but together compound into significant gains.

### The Recursive Layer

program.md itself can be optimized by models — **meta-optimization of the instruction set.**

> v1 written by human. Model refines the instructions based on experiment results. v2 produces better outcomes.

Instruction optimization is the new hyperparameter tuning.

### Important Limitation

AutoResearch works best for tasks with **OBJECTIVE metrics**. If you can't evaluate it automatically (loss, accuracy, latency, pass rate), you can't auto-research it. Subjective quality (writing style, UX, design) still requires human judgment in the loop.

### Key Concepts — Quick Reference

| Concept | Key insight |
|---|---|
| Skill Issue | You're the bottleneck, not the model |
| Token Throughput | New measure of productivity — tokens commanded, not lines typed |
| Macro Actions | Feature-level delegation, not line-level editing |
| AutoResearch | Define metric + boundaries, hit go, review in the morning |
| program.md | Meta-layer that can itself be optimized by models |
| Jaggedness | Brilliant at code and math, mediocre at jokes and nuance |

### Jaggedness (deep)

Models are brilliant at verifiable tasks (code, math, structured data) but mediocre at non-verifiable tasks (humor, nuance, cultural context). The capability surface is jagged, not smooth. Don't expect general intelligence — expect spiky excellence.

### Jevons Paradox

When software gets cheaper to produce, demand increases, not decreases. **More engineers will be needed, not fewer** — but the role changes. You shift from writing code to orchestrating systems that write code. The demand curve bends up.

### The Independence Tradeoff

Inside labs = access to frontier capabilities, cutting-edge models, massive compute. Outside labs = freedom, speed, alignment with humanity's interests. Karpathy recommends going back and forth — build capability inside, deploy it outside.

### Digital vs. Physical

AI transforms digital work at the speed of light — code, documents, data, analysis. Physical work changes slower because atoms are harder to move than bits. **The biggest near-term gains are in purely digital domains.**

---

## How to use this concept sheet

This is the **long-form source**. Every other concept page in this bundle is a refinement of a section above. When in doubt, refer back here. When building an AutoResearch loop or refining program.md, this is the canonical reference.

**Verified:** the 7 concepts distilled from this source are pinned into the global `personal` PMB workspace under tags `(Karpathy)`. Recall them with `pm__recall "Karpathy ..."` from any AI client connected to PMB.

