# Karpathy Agent Orchestration — Knowledge Bundle

Andrej Karpathy's daily AI workflow distilled from the **No Priors Podcast** (March 2026) by Hyperautomation Labs. An Open Knowledge Format (OKF v0.1) bundle.

## Use it from any AI client

Paste this to your AI assistant (ZCode, Claude Code, Codex, Gemini CLI, …):

```
Here's a knowledge bundle: D:\golradar2\knowledge_bundles\karpathy-agent-orchestration\
Read its README and set it up so I can search over it. Then tell me what's inside.
```

## Quick search

```bash
cd "D:/golradar2/knowledge_bundles/karpathy-agent-orchestration"
python okf-cli.py index              # table of contents
python okf-cli.py find "AutoResearch boundaries"
python okf-cli.py read concepts/autoresearch-framework
python okf-cli.py meta               # bundle stats + top tags
```

`okf-cli.py` is dependency-free (Python stdlib only).

## For PMB users

The 7 concepts are also **pinned into the global `personal` PMB workspace** under tags `(Karpathy)`. Recall with:

```
recall("Karpathy AutoResearch")
recall("Karpathy parallel agents")
recall("Karpathy token throughput")
```

## Companion bundles

| Bundle | Path | Role |
|---|---|---|
| Cole Medin OKF | `D:\golradar2\knowledge_bundles\cole-medin-ai-coding\` | Micro-execution (PIV, AI Layer, Harness) |
| **Karpathy OKF (this)** | `D:\golradar2\knowledge_bundles\karpathy-agent-orchestration\` | Macro-orchestration (parallel, AutoResearch, meta-opt) |

Together they describe the same workflow from two angles: Cole = how one agent does it well. Karpathy = how to run many agents doing it well simultaneously.

## Concrete output

`D:\golradar2\program.md` — instantiated AutoResearch spec for the GolRadar ML pipeline. Run it overnight, review in the morning. If the loop underperforms, write `program_v2.md` and start the meta-optimization loop.
