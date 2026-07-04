---
type: concept
title: Jaggedness and Jevons Paradox — How to Read Model Capability
tags: [karpathy, capability, jaggedness, jevons]
related_videos: [playbook]
timestamp: '2026-07-02'
description: 'Models are brilliant at verifiable tasks (code, math, structured data) but mediocre at non-verifiable (humor, nuance, culture). The capability surface is jagged, not smooth. AND cheaper software means more engineers needed, not fewer.'
---

# Jaggedness and Jevons Paradox

Two concepts from Karpathy's interview that you need for a **calibrated model of what agents can / can't do** and **what your role becomes**.

## Jaggedness: capability is spiky, not smooth

> **Don't expect general intelligence — expect spiky excellence.**

The capability surface of frontier models looks like this (schematically):

```
                    ┌──────────┐
                  ╱─┤   Code   ├─╲         Top: brilliant
                 ╱  └──────────┘  ╲
                ╱  ┌──────────┐   ╲
               ╱  ╱┤  Math    ├╲   ╲
              ╱  ╱ └──────────┘ ╲   ╲      Middle: very good
             ╱  ╱  ┌──────────┐  ╲   ╲
            ╱  ╱  ╱┤ Structured├╲╲   ╲
           ╱  ╱  ╱ └──────────┘  ╲    ╲
──────────╱──╱──╱──────────────────╲────╲─────── Low: mediocre
        ╱  ╱  ╱   ┌──────────┐    ╲    ╲
       ╱  ╱  ╱    │ Humor   │     ╲    ╲
      ╱  ╱  ╱     └──────────┘      ╲    ╲    Bottom: poor
     ╱  ╱  ╱       ┌──────────┐      ╲    ╲
    ╱──╱──╱────────│ Nuance  │────────╲───────
      ╱            └──────────┘        ╲
```

| Task class | Capability | Verifiable? |
|---|---|---|
| Code (especially typed, structured, with tests) | **Brilliant** | Yes — tests pass or fail |
| Math, formal logic | **Brilliant** | Yes — proof or counterexample |
| Structured data manipulation (SQL, JSON) | **Very good** | Yes |
| Auto-research loops | **Very good** | Yes — metric in / metric out |
| Writing that follows a template | Good | Partially |
| Open-ended writing | Mediocre | Subjective |
| Humor, sarcasm, cultural nuance | **Poor** | Subjective |
| Aesthetic design (logo, layout, color) | **Poor** | Subjective |
| Strategic / political decisions | **Poor** | Unknowable |

**The implication:** don't waste tokens on tasks where the model is mediocre. Don't ask it to be funny. Don't ask it to make a tasteful color palette. Do ask it to refactor, generate boilerplate, write tests, run experiments.

## How Jaggedness changes your daily work

- **Delegate what spikes up.** Code, tests, experiments, schema migrations, doc-to-code.
- **Own what dips down.** Taste, judgment, stakeholder management, ethical decisions.
- **Don't try to "round off" the jagged surface.** The frontier model IS jagged. Work with it, not against it.

## Jevons Paradox: when software gets cheaper, demand increases

This is economics from the 19th century: when coal became more efficient to use, total coal consumption went UP (not down). The same applies to software.

> **When software gets cheaper to produce, demand increases, not decreases.**

Applied to coding:

- **Old world:** Coding is expensive (typing, thinking). One engineer writes 500 lines/week. Companies want fewer engineers to save cost.
- **New world:** Coding is cheap (the agent produces 5000 lines/hour). Each engineer commands 10× more output. Companies want **MORE engineers** because the price of software drops in their product.
- **The role changes:** from "engineer who types" to "engineer who orchestrates engineers who type." No net job loss, just different jobs.

## What this means for you

1. **Your job title will change.** "Software Engineer" → "Agentic Engineer" or "AI Orchestration Engineer." Same person, different label.
2. **Demand for orchestration skill goes up.** Knowing how to write a great program.md, how to slot agents in parallel, how to review output — these are the new hard skills.
3. **Companies need MORE engineers, not fewer, in the long run.** Because the cost of software drops in the products they sell, so they sell more software.
4. **The "AI takes my job" fear is mostly wrong.** The role shifts; it doesn't disappear.

## Anti-pattern: hiding from the wave

If you're under-using your model subscription and still "writing code by hand because it's faster," you're **opting out of the Jevons Paradox**. You're the engineer who, in 1880, refused to use efficient coal stoves because "I like the open fire." The wave passes you by.

The Karpathy rule applies: **if you have subscription left over, you haven't maximized your token throughput.** Use the tools, produce more, expect the role to shift to orchestration.
