# Real-world usage testing report

Stopped 2026-10-21 after parallel Groq burn. Fixes landed the same day. Rerun of full personas is still pending (ask when ready).

## Mistakes in how we tested (learn / correct)

1. **19 parallel personas on one Groq key.** HTTP lock serialised Funke, not provider TPM. Almost every LLM path returned 429. Fix: one persona at a time; prefer deterministic parsers; `npm run usage:regression` for fast checks.
2. **Shared usage DB.** Personas polluted plate/memory/approvals for each other. Fix later: per-persona DB or wipe between users.
3. **No fixed clock.** Relative dates used wall clock; Saturday→Thursday bugs mixed with seed dates. Still missing `TEST_NOW` (harness gap).
4. **Stopped mid-suite.** B3, B5, B6, B8, B9 and Part C C2–C9 never finished. Partials for A1–A3, B2, B4.

## Feature check (unchanged need for larger builds)

| Feature | Was | After this pass |
|---|---|---|
| Help + walkthrough offer | PARTIAL | **Improved** (deterministic Help, walkthrough line, no fake Reminders menu) |
| Guided first-time tour | MISSING | Still missing (M) |
| Brief vs detailed setting | MISSING | Still missing (S–M) |
| Multi-account clarify | PARTIAL | **Improved** (asks which account when >1 LinkedIn) |
| What did I miss / daily summary in chat | PARTIAL | **Improved** (`summary` / `what did I miss` → `formatDailySummary`) |
| Work contexts (boss / clients) | MISSING | Still missing (L). Needs your approval before building. |

## Summary table (completed personas)

| User | Success | Rate | Sat | Biggest issue (pre-fix) |
|---|---|---|---|---|
| A1 direction-follower | partly | 0.35 | 2 | Invented Reminders UI; rate limits |
| A2 talker | partly | 0.35 | 2 | Reminder subject dropped on clarify |
| A3 newcomer | partly | 0.38 | 2 | No walkthrough; help example unparsable |
| A4 reader | partly | 0.70 | 2 | Publish vs queue wording; help hallucination |
| A5 commander | partly | 0.40 | 2 | Hiring draft hard-block; terse needs LLM |
| A6 detail-lover | partly | 0.35 | 2 | Exact text never queued under 429 |
| A7 changer of minds | no | 0.15 | 1 | Never booked first meeting (429) |
| A8 multi-tasker | no | 0.25 | 2 | Multi-dump → plate only |
| A9 mixed-language | partly | 0.73 | 3 | Multi-ask drop; plate truncated |
| B1 founder | partly | 0.55 | 2 | Voice preference ignored; EOD chat 429 |
| B2 SMB Lagos | partly | 0.35 | 2 | KB miss; payment remind false positive |
| B4 EA | partly | 0.40 | 2 | No boss/self lanes |
| B7 sales | partly | 0.50 | 2 | Invented research; Workspace traps contact/email |
| B3 B5 B6 B8 B9 | — | — | — | Not completed |
| Part C | partial | C1 only | — | C2–C9 not run |

## Issues ranked (merged) → status after fix pass

### Fixed in code (this pass)

1. **Hiring boundary blocked draft posts** (`post: we're hiring`) → content drafts allowed; hire decisions still blocked.
2. **Payment chase reminder false positive** → remind/chase allowed; wire/transfer still blocked.
3. **Multi-task dump collapsed to plate** → detects multi-asks, ACKs, runs plate/remind/draft when parseable.
4. **isWorkspaceAsk trapped contact/email** → narrowed to real Gmail/inbox/Google contacts.
5. **Terse `plate` / weekday remind / `post:`** → deterministic parsers.
6. **Help invented UI / no walkthrough / bad example time** → deterministic help copy.
7. **Multi-account silent default** → clarify when >1 account on platform.
8. **Remember multi-word names** → `Bola Ventures` / `Chioma Bello` work.
9. **usage-company.md not in KB** → `##` sections; pricing grounded.
10. **Approve card said Publish** → title/summary say Queue + engine note.
11. **Reminder success lectured about .env** → short confirm only.
12. **Plate truncated reminders to 4** → shows 8.
13. **Daily summary not in chat** → `summary` / `what did I miss`.
14. **Exact text drafts** → `use this exact text:` path (still needs Approve).

Regression: `npm run usage:regression` (PASS). Guardrails extended (PASS).

### Fixed in second pass (after “start fixing”)

15. **Pending remind keeps title** on time follow-ups (A2).
16. **Founder voice prefs** injected into draft `facts`.
17. **Research fail-closed** to memory/KB only (no invented Crunchbase).
18. **Reply style** brief/normal/detailed (Soc + `/api/reply-style`).
19. **Work contexts** personal/work/boss/client (Soc + chat “switch to … context”).
20. **First-time tour** overlay (`onboarding_done`).

### Still open

| Item | Notes |
|---|---|
| TEST_NOW fixed clock | Harness only |
| Per-persona isolated DB | Harness only |
| Finish B3 B5 B6 B8 B9 + Part C serial rerun | Ask when ready |
| Calendar rows scoped by context | Memory is scoped; calendar still shared by design for now |

### Security / autonomy (list only; not changed beyond false-positive fixes)

- Hard boundaries still block real hire decisions, payments, contracts.
- Voice still cannot approve.
- `content.publish` still approval_required; wording now says queue.

## Style-fit (brief)

- **Commander / newcomer / multi-tasker:** hurt most by LLM dependence + 429; parsers should help after this pass.
- **Talker:** caught buried remind once; lost subject on clarify (still open).
- **Detail-lover:** exact-text path now exists; not retested live under load.
- **Mixed-language:** best satisfaction (3); Pidgin plate worked.
- **Reader:** wording conflicts reduced on approval cards; help path fixed for capability ask.

## Proposed next steps (priority)

1. Serial rerun of missing B3/B5/B6/B8/B9 + Part C + spot-check A5/A8 (usage:regression already green).
2. Approve or reject: work contexts (L), guided tour (M), reply_style setting (S–M).
3. Fix reminder clarify retention + research fail-closed.
4. Optional: `TEST_NOW` + per-persona DB before next full suite.
