# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# ui
- Remove data source labels/attribution names from the UI; do not show where data comes from anywhere in the interface. Confidence: 0.85

# logging
- Suppress all prefixed debug logs ([Scoremer], [ML], [Goaloo], etc.) from console output in production; use dev-only log wrappers for library files. Confidence: 0.70

# scraping
- For anti-bot protected sites (Cloudflare, etc.), use the SCRAPING_ULTIMATE skill (Python, `ultimate_scrape()` API) instead of curl/shell-based workarounds. Confidence: 0.75

# refactoring
- When replacing import blocks during component extraction, verify all imports used in the remaining code are preserved; lost imports cause runtime ReferenceErrors despite successful build. Confidence: 0.70

