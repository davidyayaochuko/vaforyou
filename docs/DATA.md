# Data Funke stores

Local-first. Everything below lives on the machine that runs Funke unless you
configure SMTP or Google OAuth yourself.

## Where

| Path | Contents |
|---|---|
| `data/pilot.db` (or `DB_PATH`) | SQLite: accounts, jobs, content, calendar, reminders, approvals, audit, memory, KB, alerts, conversations |
| `data/profiles/` | Chromium profiles = logged-in social sessions. Treat like passwords. |
| `data/voice-profile.json` | Cached voice notes from Learn |
| `instructions/VOICE.md` | Learned voice markdown (gitignored when present) |
| `knowledge/*.md` | FAQ and policy source files loaded into `kb_entries` |
| `.env` | Secrets and flags (mode 600 from setup) |

## Main tables (VA / guardrails)

| Table | Purpose | Retention note |
|---|---|---|
| `va_conversations` | Chat threads (title, archive, soft-delete) | Until you delete; archive only hides |
| `va_messages` | Individual user/Funke messages per conversation | Deleted with chat/message clear (after undo window) |
| `va_turns` | Legacy flat chat log (still written for migration) | Prefer `va_messages`; prune with chats later |
| `va_memory` | Preferences, per-contact notes, task context | Until you forget (per item or Forget all) |
| `kb_entries` | FAQ / policy answers | Until you delete |
| `approvals` | Pending and decided actions | Keep for audit; expire pending after 48h |
| `audit_events` | Masked action history | Default keep 180 days (cleanup TBD) |
| `alerts` | Failed jobs, spikes, escalations, daily summary notice | Ack then optional purge |
| `calendar_events` / `reminders` / `followups` | Personal VA state | Until you delete |
| `action_log` | Social engine actions | Operational; mask already applied in VA audit path |
| `content` | Drafts and published posts | Until you delete |

## Chat controls: what goes away vs what stays

| Action | Removes | Keeps |
|---|---|---|
| New chat | Nothing (starts an empty thread) | Durable memory, approvals, audit, calendar |
| Clear chat | Messages in the current conversation (DB delete after ~10s undo) | Memory, approvals queue, audit log |
| Delete message | That one message row | Everything else |
| Delete conversation | That conversation + its messages (after undo) | Memory, approvals, audit |
| Delete all conversations | All conversations/messages (confirm `DELETE ALL`, then undo window) | Memory, approvals, audit, calendar |
| Archive / Restore | Nothing deleted; toggles `archived_at` | Full message body |
| Export | Nothing | Downloads Markdown or JSON of that chat only |
| Forget one memory / Forget all | `va_memory` rows only | Chat, approvals, audit |

**Pending approvals:** Deleting or clearing a chat that referenced a pending approval
warns you first. Approvals stay in the Approvals tab unless you decide them there.
Funke never silently approves, rejects, or orphans them.

**New chat + memory:** A clean slate clears only the visible thread and short-term
session turns. Preferences, contacts, and open tasks in `va_memory` still inform
Funke in the next conversation.

**Audit log:** Never deleted by chat controls. The UI notes that your activity log
is kept separately for safety.

## Masking

`audit_events.input_summary` runs through `maskSummary`: emails, card-like digit
runs, Groq/Slack-style keys, and long numbers are replaced before storage.

Raw audio is not stored by default. Mic recordings are held in memory, sent to
the configured STT provider (Groq Whisper when `GROQ_API_KEY` is set, otherwise
the browser Web Speech API), then discarded. Nothing is written under `data/`.
Browser Web Speech sends audio to the browser vendor; Groq receives audio only
for that API call.

### Voice (TTS / conversation mode)

| Path | What leaves the machine |
|---|---|
| Browser `speechSynthesis` (default) | Text stays local for OS/local voices. Some “Online Natural” voices (e.g. Edge en-NG Abeo/Ezinne) may use the browser vendor’s cloud. |
| Azure Neural (`TTS_PROVIDER=azure` + keys) | Spoken text is sent to Azure Speech (`en-NG-EzinneNeural` / `en-NG-AbeoNeural`). Audio is not saved on disk. Free F0 is typically 500k characters/month; confirm on your SKU. |
| Vocabulary (`va_vocabulary`) | Local SQLite only. Used as Whisper prompt hints and TTS pronunciation. |

Conversation mode uses the mic with echo cancellation flags, VAD (energy-based), and
never approves actions by voice. Auto-pause after idle silence. No raw audio retained.

## Approvals and voice

Approvals require an on-screen decision (`decidedBy` cannot be `voice`).
Untrusted channels (email, comments, DMs, web) cannot auto-run actions.

## Your obligations

If you run Funke for a company or process personal data of others:

- **NDPA (Nigeria)** and **GDPR** (if EU data subjects) still apply to you as
  the operator. This tool does not make you compliant by itself.
- Prefer loopback bind (`127.0.0.1`). Do not expose Funke without a
  strong `API_TOKEN`.
- Do not commit `data/`, `.env`, or browser profiles.
- Document any third-party processing you enable (Groq, Google, SMTP).

## Cleanup (planned)

A retention sweep will delete old soft-deleted rows and `audit_events` past
configurable days. Until that lands, chat delete/purge already hard-deletes after
the undo window; prune audit manually if the DB grows large.
