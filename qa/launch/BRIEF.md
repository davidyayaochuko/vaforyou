# Launch QA brief (shared)

## Isolated Funke under test
- Dashboard: http://127.0.0.1:4321 (loopback only)
- Source tree for docs: `/Users/mac/Documents/code/vaforyou` (README, LICENSE, docs/DATA.md)
- QA copy: `/tmp/funke-qa-base` (engine stopped; dry-run; do NOT start social engine; do NOT call real LinkedIn/X/Google)
- Screenshots: `/Users/mac/Documents/code/vaforyou/qa/launch/screenshots/`
  Name: `{persona}_{NN}_{slug}.png` e.g. `impatient_03_setup-error.png`

## First success (all three required)
1. Chat: "What's on my plate?" → sensible answer
2. Set a reminder through chat
3. Draft a LinkedIn post via chat, see approval card, Approve (engine stays off; dry-run)

Bonus: Google Calendar (expect clear "not connected" messaging; do not complete real OAuth)

## Hard rules
- Real browser (Playwright/Chrome MCP). Not API-only.
- No real LinkedIn, X, Google, or inbox credentials.
- Never start the social engine.
- Narrate friction in first person.
- Time the journey (start → first success or quit).
- Return a structured JSON-like findings list at the end.
