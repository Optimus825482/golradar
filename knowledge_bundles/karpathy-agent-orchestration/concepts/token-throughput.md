---
type: concept
title: Token Throughput > Typing Speed
tags: [karpathy, metrics, productivity]
related_videos: [playbook]
timestamp: '2026-07-02'
description: 'Your productivity is no longer lines of code you type. It is tokens you command. How many agents running, tasks in flight, output reviewed per hour.'
---

# Token Throughput > Typing Speed

Karpathy's new productivity metric: **tokens commanded**, not lines typed.

## What "token throughput" measures

| Old metric | New metric |
|---|---|
| Lines per hour | Tokens consumed per hour across all agents you supervise |
| Pull requests authored | Pull requests reviewed (from agents) |
| Hours at the keyboard | Hours of agent runtime you've commissioned |
| Features shipped solo | Features shipped through orchestrated agents |

## Why this matters

The old bottleneck was **how fast you type / how much you remember about syntax**. Both are now near-zero. The new bottleneck is:

1. **How many agents can you keep productive.** (Sub-agent count, parallel scheduling)
2. **How clear can you make the task.** (Prompt quality, context quality — see [[skill-issue-not-model]])
3. **How fast can you review output.** (Reading speed, integration skill)

This is **orchestration bandwidth** — the same role as API rate-limit thinking, but applied to your own attention.

## Karpathy Rule

> *"If you have subscription left over, you haven't maximized your token throughput."*

Most users pay for Opus / GPT-5 and use 20% of their monthly allowance. That's the **AI Psychosis** that Karpathy names: you feel guilty for not being at the frontier, but your actual spend is hobby-grade. The cure is to **actually run more agents in parallel** and trust them with bigger scope.

## Practical applications

- **Don't babysit a single agent for 2 hours.** Tile 4 agents on 4 features, review in 20-minute rotations.
- **Let things run overnight.** AutoResearch loops work while you sleep.
- **Maximize what you read, not what you type.** A 200-line diff takes 5 minutes to read but 2 hours to write — agent writes, you review.
- **Track the metric in your head.** "How many tokens did I command today?" If low, you're under-using.

## Anti-pattern

Spending 4 hours hand-tuning one regex because "I just know this will work" when an agent could run 20 variations of it in 10 minutes. See [[autoresearch-framework]] for the pattern that fixes this.
