# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# ui
- Use dropdown selectors with human-readable names instead of numeric ID inputs for data identifiers (tournament, season, etc.). Confidence: 0.70
- For tournament selection: use country-first flow — user picks a country first, then the tournament dropdown lists only tournaments from that selected country. Confidence: 0.70

# sofascore
- When fetching matches by date, use Sofascore's date-based URL pattern (e.g., /football/YYYY-MM-DD) instead of fetching all season rounds and filtering locally. Confidence: 0.65
- When computing live match minutes from Sofascore statusTime: initial is seconds elapsed in current period (not total). 1st half (code=6): minute = initial//60. 2nd half (code=7): minute = 45 + initial//60. Halftime (code=31): show HT. Started (code=20): no minute. extra (540s default) is NOT actual injury time — only show extra when initial > periodLength * 0.85 (truly in injury time). periodLength from time.periodLength (default 2700). Confidence: 0.65
- In live matches listing, exclude matches that lack detail data (e.g., no score, no team names, or minimal status-only entries). Confidence: 0.70

# ui
- Match details should open as a separate page with a back button to return to the match list, not as an inline panel. Confidence: 0.65

