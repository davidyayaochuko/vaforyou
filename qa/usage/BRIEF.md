# Usage testing brief (communication styles + typical users)

## Isolated Funke
- Dashboard: http://127.0.0.1:4322
- Auth: `Authorization: Bearer $API_TOKEN` (from `/tmp/funke-usage-qa/.env`)
- Chat: `POST /api/ask` JSON `{ "text": "..." }`
- Approvals: `GET /api/approvals` then approve via UI or API if available
- Engine: **STOPPED**. Never start. No real LinkedIn/X/Google/OAuth.
- Seeded DB: meetings, overdue reminders, Nigerian contacts, pricing facts, 3 accounts (`personal-linkedin`, `company-page`, `brand-x`)
- Documented anchor time for narration: **Wed 21 Oct 2026 ~09:00 Africa/Lagos**. Wall clock is real (no TEST_NOW). Prefer absolute dates when asserting schedule.

## Rules
- Dry-run only. Drafts may create approval cards; do not publish for real.
- Play the persona realistically: follow-ups, corrections, changes of mind.
- Text where natural; for Talk/voice (A2, A9) use the dashboard Talk control if feasible, else long chat turns that mimic spoken digressions.
- Save screenshots under `qa/usage/screenshots/{persona_id}_{nn}_{slug}.png` for frustration moments.
- Write your result to `qa/usage/persona-results/{persona_id}.md` AND return JSON metrics.

## Metrics (required)
```json
{
  "id": "A1",
  "name": "...",
  "tasks_attempted": ["..."],
  "success": "yes|partly|no",
  "success_rate": 0.0,
  "avg_effort_turns": 0,
  "misunderstandings": 0,
  "style_fit": 1-5,
  "satisfaction": 1-5,
  "satisfaction_reason": "one sentence in character",
  "features_found": ["..."],
  "features_missed": ["..."],
  "frustration": [{"expected":"...","happened":"...","felt":"..."}],
  "issues": [{"severity":1-5,"title":"...","detail":"..."}]
}
```
