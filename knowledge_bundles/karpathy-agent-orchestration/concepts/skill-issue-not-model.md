---
type: concept
title: Skill Issue, Not Model Issue
tags: [karpathy, mindset, debugging]
related_videos: [playbook]
timestamp: '2026-07-02'
description: 'When agents fail, blame the setup (prompt, context, constraints), not the model. Models are capable. The question is whether you gave them what they need.'
---

# Skill Issue, Not Model Issue

Karpathy's most quoted line from the No Priors interview: **"When agents fail, the instinct is to blame the model. The problem is your setup."**

## What "your setup" means

A bad setup looks like:

- **Vague prompt.** "Make this code better." (Better how? In what dimension? For whom?)
- **Missing context files.** The agent doesn't know your codebase conventions, your data formats, your constraints.
- **Unclear constraints.** The agent invents permissions it doesn't have (because nothing told it what it can't do).
- **No success metric.** The agent optimizes for what it can measure, which might not be what you wanted.
- **No failure mode defined.** When the agent gets stuck, it doesn't know whether to ask, retry, or stop.

## What "the model is fine" means

Karpathy's stance: the frontier models from late 2025 / early 2026 can do 90% of coding work IF given the right setup. The work you spend debugging agent behavior is **operator work** — improving the prompt, the context, the constraint set.

## Diagnostic ladder

When an agent gives you a bad output:

1. **Re-read the prompt.** Is it specific? Are constraints explicit?
2. **Check the context.** Did you include the codebase rules, the data shape, the example of success?
3. **Check the tool access.** Did the agent have the tools it needed (filesystem, git, test runner)?
4. **Check the boundary.** Did you say what CANNOT be changed?
5. **Only then** consider model capability.

Skipping any of those steps and going straight to "model is too weak" is the **default-but-wrong** move.

## How this connects to the rest of the bundle

- [[parallel-agent-workflow]] — gives the agent a clearer scope (less ambiguous, more likely to succeed)
- [[autoresearch-framework]] — defines success metric + CAN/CANNOT boundaries upfront
- [[program-md-meta-optimization]] — when an agent fails repeatedly, you improve the instruction file, not switch models
- **Cole Medin's Context Engineering** — almost the same idea from a different angle: the model fails from missing context, not from weakness.
