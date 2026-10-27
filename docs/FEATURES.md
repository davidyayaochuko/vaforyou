# Funke features

Funke is a personal virtual assistant (VA). This file lists every feature under consideration, what exists today, what comes next, and how each one reaches the owner on web, desktop (macOS, Windows) and mobile (iPhone, Android).

**Web is the priority.** Desktop and mobile wrap or extend the web app; they do not fork it.

Last reviewed: 22 October 2026.

---

## 1. Principles that apply to every feature

1. **Approve before anything leaves the machine.** Posts, sent emails, cancelled meetings, Slack messages and anything else that speaks for the owner is a draft until someone presses Approve on a screen. The approvals rail and `gate()` stay the only path out.
2. **Voice never approves.** Voice can ask, draft, read back and navigate. `POST /api/approvals/decide` already refuses `decidedBy: voice`.
3. **Fail closed.** If a connector, model or parser is unsure, Funke asks or does nothing. A missed task is cheaper than a wrong one.
4. **Local-first.** Data lives in the owner's SQLite database. Cloud services (Groq, Azure Speech, Google, Slack, Microsoft) are opt-in per connector and visible in the status bar.
5. **One brain, many surfaces.** Every surface (web, desktop, mobile, Slack, email) talks to the same Node control API. Features are built once in `src/va/` and `src/server/http.ts`, then rendered per surface.
6. **Plain English first.** Every feature must be reachable by typing or saying a sentence in Chat, not only by clicking.

---

## 2. Status key

| Status | Meaning |
|---|---|
| **Have** | Works today through chat or the UI (`:4310`). |
| **Partial** | Some of it works, or it works through a stopgap (for example the Workspace MCP). |
| **Planned** | Agreed direction, not built. |
| **Later** | Wanted, but after the P0/P1 set ships. |

| Priority | Meaning |
|---|---|
| **P0** | First release of the VA. Core of "what a VA does". |
| **P1** | Next. Makes Funke feel complete for a busy operator. |
| **P2** | Nice to have, or depends on P0/P1 groundwork. |

---

## 3. Feature catalogue

### 3.1 Conversation and voice (the front door)

| Feature | Status | Priority | Notes |
|---|---|---|---|
| Chat in plain English | Have | P0 | `POST /api/ask` → `handleVaCommand`. Astro Chat panel is wired to it. |
| Multiple conversations, rename, archive, export | Partial | P0 | Server has `/api/conversations/*`. The UI still stores threads in `localStorage`; move to server threads. |
| Talk (hands-free conversation) | Have | P0 | Mic + Silero VAD (RMS fallback), Groq Whisper, reply, optional speech. Barge-in stops Funke mid-sentence. RNNoise enhance still planned. |
| Speak (read replies aloud) | Have | P0 | Azure Neural TTS when configured, browser `speechSynthesis` otherwise. |
| Push-to-talk shortcut | Planned | P1 | Hold a key (web), global hotkey (desktop), Action Button or widget (mobile). |
| Wake word ("Hey Funke") | Later | P2 | On-device only. Never streams the room to a server. |
| Reply style: brief / normal / detailed | Have | P0 | `/api/reply-style`. |
| Work contexts: personal / work / boss / client | Have | P0 | Scopes memory. Calendar is still shared across contexts. |
| Multilingual and Pidgin input | Partial | P1 | Works through the model; no explicit language setting yet. |
| Custom vocabulary and pronunciation | Have | P1 | `/api/voice/vocab`. Feeds the Whisper prompt and TTS pronunciation map. |

### 3.2 Tasks and priorities

| Feature | Status | Priority | Notes |
|---|---|---|---|
| "What is on my plate?" (today view) | Have | P0 | Meetings, reminders, follow-ups in one reply. |
| Daily summary / "what did I miss" | Have | P0 | `/api/va/summary`. |
| Reminders (create, list, snooze, cancel) | Have (create, list), Planned (snooze, cancel from UI) | P0 | Delivered by email today. Needs push and in-app delivery. |
| Follow-ups ("chase Bola on Friday") | Have | P0 | `listOpenFollowUps`. |
| Task list with due dates | Planned | P0 | One `tasks` table: title, due, context, source (chat, email, meeting, Slack), status. Reminders and follow-ups become task types. |
| Prioritise my day | Planned | P0 | Rank tasks by due date, owner-set importance, who asked, and meeting load. Funke proposes an order; the owner reorders. Never silently drops a task. |
| Eisenhower / energy views | Later | P2 | Urgent vs important grid; deep-work blocks. |
| Recurring tasks | Planned | P1 | "Every Monday 9am, review approvals." |
| Delegation tracking | Planned | P1 | "I asked Chioma for the deck" becomes a follow-up with a nudge date. |

### 3.3 Calendar and scheduling

| Feature | Status | Priority | Notes |
|---|---|---|---|
| Local calendar | Have | P0 | `calendar_events` table. |
| Add events from plain English | Have | P0 | Timezone-aware, home timezone from `/api/va/status`. |
| Add events from a pasted invite (Zoom, Meet, Teams) | Have | P0 | `parseMeetingInvite`. |
| Google Calendar write | Have | P0 | OAuth at `/api/google/callback`, loopback only. |
| Google Calendar read and two-way sync | Partial | P0 | Through the Workspace MCP. Needs native sync so the Calendar panel is complete. |
| Outlook / Microsoft 365 calendar | Planned | P1 | Microsoft Graph connector. |
| Apple iCloud calendar | Later | P2 | CalDAV. |
| Find a time / propose slots | Planned | P0 | Reads free/busy across connected calendars, proposes three slots, drafts the reply. Sending needs approval. |
| Reschedule and cancel | Planned | P0 | Always an approval: shows who gets notified before it sends. |
| Scheduling links | Later | P2 | A public page that only exposes free/busy, behind the owner's rules. |
| Travel and buffer time | Later | P2 | Adds travel time between in-person meetings. |

### 3.4 Email

| Feature | Status | Priority | Notes |
|---|---|---|---|
| Send reminder emails to the owner | Have | P0 | `sendEmail` via SMTP. |
| Read and search Gmail | Partial | P0 | Through the Google Workspace MCP (`isWorkspaceAsk`). Writes queue as `workspace.write` approvals when `WORKSPACE_MCP_WRITES=true`. |
| Inbox triage: summarise, label, "needs you" list | Planned | P0 | Morning digest of what needs a reply, what is FYI, what is noise. |
| Draft replies in the owner's voice | Planned | P0 | Uses the learned voice profile. Sending is always an approval. |
| Turn emails into tasks or events | Planned | P0 | "Add this to my calendar" on an email thread. |
| Unsubscribe / archive suggestions | Later | P2 | Suggest only; owner confirms in bulk. |
| Outlook / Microsoft 365 mail | Planned | P1 | Microsoft Graph connector. |
| IMAP for other providers | Later | P2 | |

### 3.5 Meetings: join, take notes, follow up

| Feature | Status | Priority | Notes |
|---|---|---|---|
| Meeting prep brief | Planned | P0 | Before each meeting: who is attending, last notes, open follow-ups, linked docs. Stub: `docs/VEXA-MEETINGS.md`. |
| Join calls to take notes (Zoom, Google Meet, Teams) | Planned | P0 | Vexa self-host path documented; Chat fails closed until `VEXA_API_URL`. Opt-in per meeting; no silent join. |
| Local capture fallback | Planned | P1 | Desktop app records system audio for in-person or unsupported calls, with a visible indicator. |
| Live transcript and summary | Planned | P0 | Whisper (Groq) or a local model. Summary: decisions, action items, owners, dates. |
| Action items into tasks | Planned | P0 | Each action item becomes a task or follow-up, assigned to a person. |
| Send recap to attendees | Planned | P1 | Drafted after the call; sending is an approval. |
| Searchable meeting library | Planned | P1 | "What did we agree with Bola Ventures in September?" |

### 3.6 Notes and docs

| Feature | Status | Priority | Notes |
|---|---|---|---|
| Durable memory (preferences, contacts, facts) | Have | P0 | "Remember that…", "What do you know about…", forget, forget-all. |
| Knowledge base (FAQ, pricing, policies) | Have | P0 | Markdown files, `##` sections. Funke says she will check rather than guess. |
| Quick notes | Planned | P0 | "Note: Chioma prefers WhatsApp." Notes app panel with search and tags. |
| Voice notes | Planned | P1 | Talk → transcribe → note, with the audio discarded by default. |
| Google Docs / Drive read and search | Partial | P0 | Through the Workspace MCP. |
| Draft docs (proposals, briefs, SOPs) | Planned | P1 | Drafts into a Doc; sharing is an approval. |
| Notion / OneNote / Apple Notes | Later | P2 | Connectors after Google and Microsoft. |
| Summarise a doc or PDF | Planned | P1 | Upload or link; summary plus key dates as tasks. |

### 3.7 Social media

| Feature | Status | Priority | Notes |
|---|---|---|---|
| Drafts for LinkedIn, X, Bluesky | Have | P0 | Template bank + `gate()`. Agents cannot post without a template. |
| Approve, queue and publish | Have | P0 | Approvals → queue → engine. Engine never auto-starts. |
| Scheduled posts and recurring engagement | Have | P0 | `jobs` queue. |
| Comment, react, reply, DM, invitations | Have | P1 | Per-platform caps and human pacing. Selectors still need supervised calibration. |
| Learn the owner's voice from past posts | Have | P1 | `/api/voice/learn`. |
| Content calendar view | Planned | P1 | Pipeline panel: drafts, approved, scheduled, published. |
| Instagram, Facebook, TikTok, Threads | Later | P2 | Need their own adapters and fixtures before anything ships. |
| Mentions and inbox monitoring | Planned | P1 | "Who replied to me today?" with draft replies. |

### 3.8 Messaging and team tools

| Feature | Status | Priority | Notes |
|---|---|---|---|
| Slack: read channels and DMs | Have | P0 | `SLACK_USER_TOKEN` (xoxp). “what did I miss on Slack?” → search unreads/mentions. |
| Slack: draft and send replies | Have | P0 | Drafts in Chat; send queues `slack.send` on Approvals (never auto). |
| Slack: "Funke, remind me" from Slack | Planned | P1 | Slash command or DM to the Funke app creates tasks and reminders. |
| Microsoft Teams chat | Later | P2 | Graph connector. |
| WhatsApp (Business API) | Later | P2 | Important for Lagos clients; needs Meta Business approval and a template policy. |
| Telegram | Later | P2 | Bot API. |
| SMS / call reminders | Later | P2 | Twilio or similar, opt-in. |

### 3.9 Contacts and relationships

| Feature | Status | Priority | Notes |
|---|---|---|---|
| Contact notes | Have | P1 | Per-contact memory. |
| Google / Microsoft contacts lookup | Partial | P1 | Workspace MCP for Google. |
| Relationship nudges | Planned | P2 | "You have not spoken to Bola in 30 days." |
| Birthday and anniversary reminders | Later | P2 | |

### 3.10 Research and briefings

| Feature | Status | Priority | Notes |
|---|---|---|---|
| Research from memory and KB only | Have | P1 | Fails closed. Will not invent sources. |
| Web research with citations | Have | P1 | Private SearXNG (`SEARXNG_URL`). Every web bullet has a URL; down/unset → fail closed. |
| Company / person brief before a meeting | Planned | P1 | Feeds meeting prep. |

### 3.11 Safety, trust and control

| Feature | Status | Priority | Notes |
|---|---|---|---|
| Approvals rail | Have | P0 | One place for everything waiting on the owner. |
| Hard boundaries (hiring decisions, payments, contracts) | Have | P0 | Blocked outright, not approvable. |
| Autonomy levels per action | Have | P0 | `auto`, `approval_required`, `blocked` via `/api/autonomy`. |
| Audit log | Have | P0 | `/api/audit`. Every action is searchable. |
| Monitoring alerts | Have | P1 | Errors, failed jobs, spikes. |
| Per-connector consent screen | Planned | P0 | Shows exactly which scopes each connector holds, with one-click revoke. |
| Data export and delete | Partial | P1 | Chat export and memory forget-all exist. Needs one "export everything" archive. |

### 3.12 Onboarding and help

| Feature | Status | Priority | Notes |
|---|---|---|---|
| First-time tour | Planned | P0 | Build into the desktop UI. |
| Deterministic help ("what can you do?") | Have | P0 | No invented menus. |
| Connector setup wizard | Planned | P0 | Google, Microsoft, Slack, social accounts, voice, in that order. |
| Sample day | Planned | P1 | Demo data so a new owner can try everything before connecting real accounts. |

---

## 4. Platform plan

Web first. Everything else reuses the web UI and the same API.

| Surface | Approach | When | What it adds beyond web |
|---|---|---|---|
| **Web (desktop browsers)** | Astro app in `web/`, built and served by the Node server on `:4310`. | Now | The reference experience. Every feature lands here first. |
| **Web (mobile browsers)** | Responsive layout plus a Progressive Web App (PWA): manifest, install prompt, offline shell, Web Push. | P0 | Install to home screen on Android and iPhone, push reminders, mic for Talk. |
| **macOS** | Tauri shell around the web app (small, native webview). | P1 | Menu bar icon, global hotkey for Talk, native notifications, launch at login, local meeting capture with a visible recording indicator, Keychain for tokens. |
| **Windows** | Same Tauri shell. | P1 | System tray, global hotkey, toast notifications, start with Windows, Credential Manager for tokens. |
| **Linux** | Same Tauri shell. | P2 | Tray and notifications. |
| **iPhone / iPad** | PWA first. Native wrapper (Capacitor) once push, widgets and Siri are needed. | PWA: P0. Native: P2 | Home screen widget (today view), Siri Shortcuts ("Ask Funke…"), Share Sheet ("Send to Funke"), Action Button for Talk, Live Activity during calls. |
| **Android** | PWA first. Native wrapper (Capacitor) later. | PWA: P0. Native: P2 | Home screen widget, share target, Quick Settings tile for Talk, Assistant / Gemini app action. |
| **Browser extension** | Chrome / Edge / Safari extension. | P2 | "Send this page / email / LinkedIn post to Funke". |
| **Slack, email, Teams** | Funke as a participant (bot or forwarding address). | P0 (Slack), later others | Ask Funke without opening Funke. |

### 4.1 How the surfaces connect

```
   Web (Astro)   macOS / Windows (Tauri)   iPhone / Android (PWA → Capacitor)   Slack / Email
        \                  |                              |                          /
         \                 |                              |                         /
          +---------------- HTTPS + Bearer token, or loopback on the same machine --+
                                         |
                              Funke control API (Node, :4310)
                                         |
          +------------+-------------+---+-----------+-------------+-------------+
          |            |             |               |             |             |
      VA brain     Approvals     Social engine   Connectors     Voice        Storage
     (src/va)     + gate()      (src/engine)    Google, MS,   STT / TTS     SQLite
                                                Slack, Zoom                 (local)
```

### 4.2 Reaching Funke away from the desk

The control API is loopback-only by design, and the UI pages hand out a session cookie that carries the API token. Phones and remote devices must not get there by opening the port. Options, in order of preference:

1. **Tailscale (or WireGuard) to the owner's machine.** Phone joins the owner's private network; the API stays loopback-plus-tailnet. No public endpoint.
2. **A relay with paired devices.** Each device pairs once with a short code, gets its own revocable token, and talks to the home machine through an encrypted relay. Revoking a device never rotates everyone else.
3. **Self-hosted server** (a small VPS) for owners who want Funke always on. Requires `BIND_ALLOW_NON_LOOPBACK=true` and a 24+ character `API_TOKEN`, which `startServer()` already enforces.

Whatever the route, the rules do not change: per-device tokens, approvals on a screen, voice cannot approve.

### 4.3 Cross-platform rules

- **One design system.** Icons, colours, the orb and panel layouts live in `web/src`. Desktop and mobile shells load that bundle.
- **Notifications are the same event.** A reminder fires once on the server and fans out to Web Push, native desktop, and mobile push. The first device to dismiss it clears it everywhere.
- **Offline.** The PWA caches the shell and the last today view. Asks typed offline are queued locally and sent when back online, never silently dropped.
- **Accessibility.** Keyboard reachable, screen-reader labels, reduced-motion respected (the orb drops detail and sparkles), captions for everything Funke says.

---

## 5. Connector roadmap

| Connector | Unlocks | Priority | Auth |
|---|---|---|---|
| Google (Calendar, Gmail, Drive, Docs, Contacts) | Calendar, Email, Docs, Contacts | P0 | OAuth, loopback redirect. Replace the MCP stopgap with native calls where the Calendar and Email panels need them. |
| Slack | Messaging, tasks from Slack | P0 | Slack app, user token, minimal scopes. |
| Zoom / Google Meet / Microsoft Teams | Meeting notetaker | P0 | Per-platform app or bot; owner opt-in per meeting. |
| Microsoft 365 (Outlook, Calendar, OneDrive, Teams) | Calendar, Email, Docs, Teams | P1 | Microsoft Graph OAuth. |
| LinkedIn, X, Bluesky | Socials | Have | Owner logs in once per account in a real browser. Funke never types credentials. |
| Notion | Notes and docs | P2 | OAuth. |
| WhatsApp Business | Messaging | P2 | Meta Business API. |
| Apple (iCloud Calendar, Reminders) | Calendar, Tasks | P2 | CalDAV; native Reminders via the iOS app. |

---

## 6. First release scope (P0)

The first release should feel like a real VA, not a chatbot:

1. **Today view:** tasks, meetings, reminders, approvals, ranked.
2. **Chat + Talk + Speak** on web and installable PWA.
3. **Calendar:** Google read/write, find a time, reschedule and cancel through approvals.
4. **Email:** Gmail triage and drafted replies through approvals.
5. **Meetings:** prep brief, notetaker for Zoom and Google Meet, action items into tasks.
6. **Notes:** quick notes, memory, knowledge base, Docs search.
7. **Slack:** summaries, drafted replies, reminders from Slack.
8. **Socials:** existing LinkedIn / X / Bluesky pipeline, surfaced in the Pipeline panel.
9. **Trust:** approvals, boundaries, audit log, connector consent screen.

---

## 7. Web UI map (Astro `web/`)

| Dock / Apps entry | Feature areas | Panel status |
|---|---|---|
| Chat | 3.1 | Live (`/api/ask`) |
| Today | 3.2 | Planned panel; today data already in `/api/va/status` |
| Calendar | 3.3 | Live list of upcoming events and reminders |
| Approvals | 3.11 | Live list with Approve / Reject |
| Mail | 3.4 | Coming soon |
| Meetings | 3.5 | Coming soon |
| Notes | 3.6 | Coming soon (memory is live through Chat) |
| Socials | 3.7 | Live account list; pipeline view planned |
| Slack | 3.8 | Coming soon |

---

## 8. Open questions

1. Notetaker vendor: build on each platform's SDK, or use a meeting-bot provider (for example Recall.ai) for Zoom, Meet and Teams in one integration?
2. Remote access default: Tailscale or a paired relay?
3. Task store: extend `reminders` and `follow_ups`, or introduce a single `tasks` table and migrate?
4. Mobile: is the PWA enough for the first release on iPhone, given Web Push requires the app to be installed to the home screen?
5. Slack scopes: user token (acts as the owner) or bot token (acts as Funke)? User token is more useful and more sensitive.
