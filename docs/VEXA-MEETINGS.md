# Meetings notetaker (Workstream E stub)

Goal: prep brief + join-for-notes + action items → tasks, without Recall.ai.

## Recommended stack

Self-host [Vexa](https://github.com/Vexa-ai/vexa) (Apache 2.0) on the owner machine or a private VPS they control.

```bash
git clone https://github.com/Vexa-ai/vexa.git
cd vexa && make all
```

Optional desktop fallback: [Meetily](https://github.com/Zackriya-Solutions/meetily) or a future Tauri capture path when meeting bots are blocked.

## Funke hooks (planned)

Env (not required until the connector lands):

```bash
# VEXA_API_URL=http://127.0.0.1:8081
# VEXA_API_KEY=
```

Intended Chat / API flow:

1. Owner opts in per meeting (“join my 3pm for notes”).
2. Funke calls Vexa to spawn a bot; announce “Funke (notes for …)”.
3. Poll or stream transcript → summarise (Groq/xAI): decisions, actions, owners, dates.
4. Each action → `va_tasks` / follow-up; recap email is draft → Approve.
5. Meeting prep brief: attendees + last notes + open follow-ups + Workspace docs.

## Hard rules

- No silent recording, explicit opt-in per event.
- No notetaker SaaS bill required (Vexa + local/Groq STT).
- Recap send and calendar writes still go through Approvals.

## Status

Stub / docs only. API route and `src/va/meetings.ts` land when Vexa is running on this machine.
