# GLOBAL KURAL — Before any task, activate relevant skill(s)
## ZORUNLU — ASLA ES GECILMEYECEK
Herhangi bir goreve baslamadan ONCE, o goreve uygun skill yada skilleri Skill tool ile aktive et. Basit gorunen islerde bile %1 ihtimal varsa kontrol et. Bu kural tum gorevler icin gecerlidir, istisnasi yoktur. Bu kural AGENTS.md dosyasina kaydedilmistir.

# Agent References

## Proje Agent'ları (`.claude/agents/`)

| Agent | Description |
|-------|-------------|
| `ml-trainer` | ML training & feature engineering |
| `data-scraper` | Football data scraping (Sofascore, Goaloo) |
| `frontend-dev` | Next.js UI development |
| `poisson-agent` | Dixon-Coles Poisson model — score matrix, O/U, BTTS |
| `elo-agent` | Elo rating — team strength prior, form index |
| `ml-agent` | GBDT + XGBoost + Kalman model inference |
| `odds-agent` | Odds movement analysis — bookmaker consensus |

## Global Agent'lar (`~/.claude/agents/`)

Global agents listed in system prompt. Use `Agent(subagent_type="agent-name", ...)` to invoke.

## Command shortcuts

| Command | Action |
|---------|--------|
| `/train` | ML training pipeline |
| `/predict` | Run predictions |
| `/scrape` | Data scraping |
| `/predict-team` | 4-parallel-agent prediction + force verdict |
| `/powerup` | Interactive ZCode tutorials |

## Multi-Agent Prediction Pattern

Use `/predict-team <home> <away> <league>` for full ensemble prediction:
1. 4 parallel agents (poisson + elo + ml + odds)
2. Force verdict: HIGH / MEDIUM / LOW / SKIP
3. Thesis record created for each prediction

## Signal Tiers

| Tier | Condition | Action |
|------|-----------|--------|
| 🟢 **HIGH** | ≥3 models agree, prob > %65 | Alert |
| 🟡 **MEDIUM** | ≥2 models agree, prob > %50 | Watch |
| 🟠 **LOW** | 1 model strong | Log |
| 🔴 **SKIP** | No consensus | Skip |
