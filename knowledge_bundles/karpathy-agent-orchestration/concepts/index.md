---
type: concept
title: Mindset Shift — 80/20 to 20/80
tags: [karpathy, mindset, orchestration]
related_videos: [playbook]
timestamp: '2026-07-02'
description: 'By Dec 2025 Karpathy moved from 80% hand-coding/20% AI-assist to 20% human/80% AI agents. Human role is now orchestration: define objectives, review outputs, steer agents.'
---

# Mindset Shift — 80/20 to 20/80

The first shift Karpathy made before any tool or workflow change — he changed how he **thinks** about programming.

## What changed

- **Before:** 80% hand-coding, 20% AI-assist (autocomplete, doc-lookup).
- **By December 2025:** 20% human, 80% AI agents.
- **The ratio keeps shifting.** Treat 20/80 as a snapshot, not an end-state.

## What "20% human" actually means

The human role is no longer "write the code." It is **orchestration**:

| Human does | Human does NOT do |
|---|---|
| Define the objective | Pick the line-by-line syntax |
| Frame the constraints (CAN / CANNOT) | Hand-tune hyperparameters one by one |
| Review the output | Sit at the keyboard typing |
| Steer when off-course | Manage the agent micromanagement-style |
| Set the trust boundary | Second-guess every decision |

The typing is done by machines. Your job is to **define the system that produces the typing.**

## Anti-pattern: thinking "write a function"

Karpathy's antipattern: a senior engineer pulls up a feature ticket and their first mental move is "I'll write this helper, then call it from this other place, then fix tests." That's line-level thinking. The macro-action move is: *"Build this feature end-to-end. Validate it. Report."* You give the agent the **scope**, not the steps.

## How to apply

1. The next time you get a task that could plausibly be delegated wholesale — pause and ask: *"Could I describe the success criteria and let an agent figure out the steps?"*
2. If yes → write a `program.md` (see [[program-md-meta-optimization]]). If no → do it yourself, but limit that case to genuinely subjective/strategic work.
