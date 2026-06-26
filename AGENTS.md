# Agent References

## Proje Agent'ları (`.claude/agents/`)

| Agent | Description |
|-------|-------------|
| `ml-trainer` | ML training & feature engineering |
| `data-scraper` | Football data scraping (Sofascore, Goaloo) |
| `frontend-dev` | Next.js UI development |

## Global Agent'lar (`~/.claude/agents/`)

Global agents listed in system prompt. Use `Agent(subagent_type="agent-name", ...)` to invoke.

## Command shortcuts

| Command | Action |
|---------|--------|
| `/train` | ML training pipeline |
| `/predict` | Run predictions |
| `/scrape` | Data scraping |

Claude uses these automatically via `description` matching. No manual invocation needed.
