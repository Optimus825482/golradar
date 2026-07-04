---
type: concept
title: Parallel Agent Workflow — Peter Steinberg Method
tags: [karpathy, parallel-agents, peter-steinberg, workflow]
related_videos: [playbook]
timestamp: '2026-07-02'
description: 'Karpathy runs 4 agents simultaneously: Feature Implementation, Research/Exploration, Planning/Architecture, Code Review/Testing. Peter Steinberg method: tile windows, rotate 20-min tasks, review one while others work.'
---

# Parallel Agent Workflow — Peter Steinberg Method

**The Peter Steinberg method** named after the Podscribe founder: tile multiple agent terminals on screen, give each a 20-minute task, rotate through them. While one agent's output is compiling, you review another.

## The four-agent split

| Agent | Role | Tools it needs |
|---|---|---|
| **A1 Feature Implementation** | Builds the feature. Writes code, runs tests, opens PR. | Editor, test runner, git |
| **A2 Research / Exploration** | Reads docs, prototypes alternatives, investigates the codebase. | Web search, file read, repl |
| **A3 Planning / Architecture** | Designs system, writes specs, maps dependencies, picks abstractions. | Diagram tool, doc editor |
| **A4 Code Review / Testing** | Reviews A1's output. Writes tests. Catches bugs. Fixes style. | Diff viewer, test runner, linter |

**They run simultaneously.** A1 writes a draft → A4 reviews in parallel → A2 brings references → A3 refines the spec → all four threads of output land in your review at the end.

## The window layout

```
┌──────────────────┬──────────────────┐
│  A1              │  A4              │
│  (Feature)       │  (Review)        │
│                  │                  │
├──────────────────┼──────────────────┤
│  A3              │  A2              │
│  (Architecture)  │  (Research)      │
│                  │                  │
└──────────────────┴──────────────────┘
```

Your eye sweeps the four panes. When one agent finishes a chunk (or stalls), you give it the next task. Other agents continue independently.

## The 20-minute rotation

Karpathy's cadence: **20 minutes per agent per task**. Why 20?

- Long enough to do meaningful work.
- Short enough that you don't lose context switch costs.
- Forces the agent's output to be **chunk-shaped**: deliverable every 20 min, not "I'll get back to you in 3 hours."

If an agent can't finish in 20 minutes → split the task or assign to a different agent. If an agent finishes early → new task immediately.

## What you DO vs. what agents do

| You (human, 20 min) | Agent (longer) |
|---|---|
| Read the spec | Implement the spec |
| Define next 20-min task | Run tests |
| Review output, give feedback | Open the PR |
| Correct scope drift | Commit checkpoints |
| Decide which agent gets the next slot | Wait |

The Peter Steinberg method **is not vibe coding.** Each agent has a clear task. You review every artifact. The orchestration overhead is small (5 minutes per rotation), the parallelism gain is large (4× throughput).

## How to apply with ZCode

ZCode doesn't have a 4-pane terminal built in, but it has 4 sub-agent slots via `Agent(subagent_type=...)`. For a task worth 4-agent parallelism:

```bash
# /predict-team <home> <away> <league>  -- existing multi-agent prediction
# + new: /parallel-feature <feature-spec>  -- splits the same spec across 4 agents
```

Even without explicit tool support, **the discipline is the same** — write the 4 sub-prompts as standalone A1/A2/A3/A4 instructions and launch them in the same message.

## Anti-pattern

**Serial delegation with churn**: agent A finishes → you read → write feedback → agent B starts → you wait. This kills the parallel throughput and turns the agent into a slow typist. Use Steinberg always.
