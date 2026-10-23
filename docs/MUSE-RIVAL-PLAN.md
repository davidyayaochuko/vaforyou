# Funke vs Muse: rivalry plan

How Funke (this repo) rivals [Meta Muse](https://muse.ai) as an open-source, local-first personal VA, without charging the owner for an agent SaaS.

Read this before picking the next connector or MCP. Pair it with [`FEATURES.md`](./FEATURES.md) for status and priority, and [`AGENT-CONTROL.md`](./AGENT-CONTROL.md) for safety rules.

Last updated: 23 October 2026 (Workstreams A + C spike landed).

---

## 0. How to use this document

Work top to bottom through the **workstreams** in section 5. Each workstream has:

- Goal (what “done” looks like)
- Why it matters against Muse
- What already exists in this repo
- Free tools / MCP servers to use (no agent subscription)
- Concrete steps
- Acceptance checks

Do not start a new workstream until the previous one’s acceptance checks pass, unless two streams do not touch the same files.

**Cost rule:** the owner must not pay for a Funke-as-a-service product. Allowed free or bring-your-own:

- Self-hosted Docker / Node on their machine
- Free Google OAuth, Slack app, Bitwarden personal vault
- Groq free tier (already the default AI lane)
- Optional paid LLM only when `AI_PAID=true` (existing rule)

Not allowed as a dependency for P0: Recall.ai, Firecrawl paid, Krisp seats, Muse-style cloud VM rental, Stripe Link shopping.

---

## 1. What Muse is (and what we are not copying)

Muse ([launch post](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/), [design essay](https://introducing.muse.ai/), [safety](https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)) is Meta’s personal agent:

- Runs in a **cloud Secure VM** with browser, terminal, and files
- Stays working after the app closes; comes back for approvals
- Connects email, calendar, shopping, forms, Instagram-class apps
- Uses a separate **Sentinel** for egress and permissions
- Hides passwords from the model (credential surrogation)
- Talks like a messenger (app + WhatsApp)
- Has Goals, Ideas, Artifacts, and proactive nudges
- Free for “most” use, paid tiers for heavier use

Funke’s bet is different and worth keeping:

- Local-first SQLite and loopback control API (`:4310`)
- Approvals rail + `gate()` + hard boundaries (payments, contracts, hiring)
- Voice never approves
- Real social publishing (LinkedIn / X / Bluesky) with template bank and rate caps
- No Meta ads adjacency, no cloud VM required for day-one value

We rival Muse by matching **useful agency** (email, calendar, meetings, research, browser tasks) behind **our** trust model, not by cloning Secure VM theatre.

---

## 2. Rivalry scorecard (honest)

Where Funke already wins for an open-source operator:

- Local data and loopback security
- Approvals, autonomy levels, audit log
- Social engine with templates and pacing
- Chat + Talk + Speak on web (Astro)

Where Muse still wins until we ship:

- Always-on background goals with polished UI
- Consumer WhatsApp as a first-class surface (Meta-blessed)
- One-click booking / shopping with Link purchase protection
- Proactive “caught the school email” polish at consumer scale

Where we refuse to compete (by design):

- Agent-held payment cards and autonomous checkout
- Typing the owner’s passwords into sites (keep owner login / vault injection)
- Public dashboard without a strong token

---

## 3. Principles that govern every workstream

Copied from FEATURES; do not relax them for “Muse parity.”

1. Approve before anything leaves the machine.
2. Voice never approves (`decidedBy: voice` refused).
3. Fail closed.
4. Local-first; cloud connectors opt-in and visible.
5. One brain (`src/va/`, `src/server/http.ts`); surfaces only render.
6. Plain English in Chat must reach every feature.

Extra rules for this plan:

7. Prefer MCP or OSS adapters over reimplementing Gmail / Slack / Zoom SDKs from scratch, then promote hot paths to native when a panel needs them (Calendar, Mail).
8. Writes stay draft-only until the approvals rail gates them.
9. Ask before adding a paid dependency.

---

## 4. Free stack map (by Funke feature area)

Use this as the shopping list. Prefer the **Recommended** row.

### 4.1 Google Workspace (mail, calendar, drive, docs, contacts)

**Recommended:** keep [taylorwilsdon/google_workspace_mcp](https://github.com/taylorwilsdon/google_workspace_mcp) (already documented in `src/va/workspace.ts`).

```bash
# .env
WORKSPACE_MCP_COMMAND=uvx
WORKSPACE_MCP_ARGS=workspace-mcp
# writes stay off until approvals gate them
WORKSPACE_MCP_WRITES=false
```

**Later (official):** Google’s remote MCP servers (Developer Preview, Workspace account): Gmail, Calendar, Drive, Docs, People, Sheets, Chat. See [Configure Workspace MCP servers](https://developers.google.com/workspace/guides/configure-mcp-servers). Good long-term native replacement; do not run two write paths at once.

**Optional triage helper:** [inbox-mcp](https://github.com/yama662607/inbox-mcp) (masks PII, draft-only replies, calendar upsert, Slack digest).

### 4.2 Slack

**Recommended:** [Official Slack MCP](https://mcp.slack.com/mcp) with a Slack app the owner installs, minimal scopes. All sends go through approvals.

### 4.3 Meetings (notetaker)

**Recommended bot path:** [Vexa](https://github.com/Vexa-ai/vexa) (Apache 2.0). Self-host Docker; bot joins Meet / Zoom / Teams; Whisper transcripts over API. Answers FEATURES open question 1 without Recall.ai.

**Recommended local-capture path (desktop):** [Meetily](https://github.com/Zackriya-Solutions/meetily) or Tauri system-audio capture later. Matches FEATURES “Local capture fallback.”

### 4.4 Web research with citations

**Recommended:** self-host [SearXNG](https://github.com/searxng/searxng) + [mcp-searxng](https://github.com/ihor-sokoliuk/mcp-searxng), or [SearchForge](https://github.com/divyanshu-iitian/SearchForge) (bundles private SearXNG). Drop unsourced claims in code (FEATURES rule).

### 4.5 General browser agency (forms, booking research, carts)

**Recommended:** [Playwright MCP](https://github.com/microsoft/playwright-mcp) (`npx @playwright/mcp@latest`). Same Playwright family as the social engine. Every irreversible action → approvals.

**Optional higher-level agent:** [browser-use](https://github.com/browser-use/browser-use) local MCP (OSS; LLM tokens only). Use only if Playwright MCP is too low-level for a task class.

Checkout and payments stay blocked (hard boundary).

### 4.6 Credentials (Muse-style “agent can’t see the password”)

**Recommended:** [Bitwarden Agent Access](https://github.com/bitwarden/agent-access) (Apache 2.0, early). Inject credentials into a child process without putting them in the LLM context.

**Avoid for production vault dumps:** exposing full Bitwarden MCP vault reads to the model. Fine for local experiments only ([bitwarden/mcp-server](https://github.com/bitwarden/mcp-server) warning: local use only).

### 4.7 Messaging channels (Later / P2)

- Telegram: Bot API (free)
- WhatsApp compliant: Meta Business API (approval required)
- WhatsApp experimental: Baileys bridges ([whatsapp-bridge](https://github.com/obirimensah05/whatsapp-bridge)) — ToS risk; secondary number only

Study [OpenClaw](https://openclaw.ai/) for channel-gateway ideas. Do not replace Funke’s brain with OpenClaw.

### 4.8 Voice (Talk / Speak) — upgrade path

Current Funke pipeline (`web/src/lib/voice.ts` + `src/voice/`):

- Mic with browser `echoCancellation` / `noiseSuppression` / `autoGainControl`
- Crude RMS energy threshold (`THRESHOLD = 0.045`) for “hearing”
- MediaRecorder → Groq Whisper (`src/voice/stt.ts`)
- Reply TTS: Azure Neural when configured, else browser `speechSynthesis`
- Custom vocabulary via `/api/voice/vocab`

That works, but RMS VAD is brittle in cafés and with laptop fans, and browser noise suppression alone is weak.

**Recommended free upgrade (browser, no SaaS):**

1. **VAD:** [@ricky0123/vad-web](https://github.com/ricky0123/vad) (Silero ONNX in the browser). Replace RMS start/stop. Prefer Silero model `v5` or `v6`.
2. **Noise suppression (light, first):** [@sapphi-red/web-noise-suppressor](https://www.npmjs.com/package/@sapphi-red/web-noise-suppressor) (RNNoise / Speex worklets, MIT). Or `@jitsi/rnnoise-wasm` if you wire the worklet yourself.
3. **Noise suppression (heavier, better quality):** [denoise-voice-clarity](https://www.npmjs.com/package/denoise-voice-clarity) (DeepFilterNet 3 in WASM). Lazy-load; larger download.
4. When using a custom suppressor, set `getUserMedia` `noiseSuppression: false` so two suppressors do not fight.
5. Keep **echoCancellation: true** and **autoGainControl: true**.
6. Keep Groq Whisper as cloud STT (free tier). Optional later: local `faster-whisper` for offline.
7. Keep Azure en-NG TTS as optional quality lane; browser speech as fallback.
8. Do not stream room audio continuously to a server for wake word (FEATURES: wake word on-device only, Later).

**Not recommended for P0:** Krisp, Deepgram Nova paid seats, ElevenLabs as a hard dependency. Optional later if the owner opts in.

**Reference architectures to steal patterns from (not to vendor-lock):**

- [whisper-loop](https://github.com/aryeo0908/whisper-loop): Silero VAD + barge-in cancel + streaming TTS
- LiveKit-style duplex patterns (AEC while Funke is speaking)

---

## 5. Workstreams (do these in order)

### Workstream A — Trust foundation for connectors

**Goal:** any new MCP write tool can only draft; send/publish needs Approvals UI.

**Exists:** approvals rail, autonomy levels, `WORKSPACE_MCP_WRITES` default false, hard boundaries.

**Steps:**

1. List every Workspace MCP tool name the process can see; classify read vs write (`isWorkspaceWriteTool` already exists).
2. Route write tool calls into the approvals queue with a human-readable preview (to, subject, body snippet).
3. On Approve, re-invoke the same tool once; on Reject, discard.
4. Add smoke checks: write without approval fails; voice cannot decide.
5. Add a connector consent screen (FEATURES P0) showing scopes and revoke.

**Acceptance:**

- `WORKSPACE_MCP_WRITES=true` still cannot send mail without Approve
- Audit log records draft → approve → sent
- `npm run smoke` includes at least one connector-gate assertion

---

### Workstream B — Google Workspace: make Partial → Have

**Goal:** Gmail triage + Calendar two-way sync feel native in Chat and panels, still free.

**Exists:** local calendar, Google Calendar write OAuth, Workspace MCP stopgap for Gmail/Drive/Docs/People.

**Steps:**

1. Document setup in `.env.example` (command already sketched in `workspace.ts`).
2. Morning digest command: “what needs a reply / FYI / noise” via Gmail search tools → Chat reply, no auto-send.
3. Draft reply in owner voice → approvals only.
4. Calendar: free/busy → propose three slots → draft email; send needs Approve.
5. Reschedule / cancel always show who gets notified before send.
6. When Mail and Calendar Astro panels ship, promote hot paths from MCP to native Google API clients (FEATURES connector note). Until then MCP is fine.

**Acceptance:**

- Owner can ask in Chat: “what’s in my inbox that needs me?” and get a labelled list
- “Find a time with Bola next week” returns three slots without sending
- Calendar panel shows upcoming Google events after sync, not only local rows

**Tools:** `google_workspace_mcp`; optional `inbox-mcp` for masking + Slack digest.

---

### Workstream C — Voice quality (Talk / Speak)

**Goal:** Talk works in noisy rooms; fewer false starts; barge-in stays reliable.

**Exists:** `web/src/lib/voice.ts`, Groq STT, Azure TTS optional, vocab API.

**Steps:**

1. Add `@ricky0123/vad-web` (ask before adding dependency; user rule). Wire `MicVAD` so `onSpeechEnd` yields 16 kHz PCM → encode → existing `/api/voice/transcribe`.
2. Add RNNoise via `@sapphi-red/web-noise-suppressor` on the mic graph **before** VAD/recorder. Disable browser `noiseSuppression` when RNNoise is on.
3. Keep conversation vs hold modes; keep barge-in (RMS or Silero speech-prob while speaking).
4. A/B: café noise / keyboard / fan — measure wrong cuts and missed ends.
5. If RNNoise is not enough, trial `denoise-voice-clarity` behind a settings flag (`voiceEnhance: rnnoise | deepfilter | browser`).
6. Optional: expose “Voice enhance” in status / settings so the owner can turn it off on low-end phones.
7. Do not change “voice never approves.”

**Acceptance:**

- Silero drives utterance boundaries (RMS threshold removed or demoted to barge-in helper only)
- Noise suppress runs client-side; no new paid voice API required
- Talk still works with only Groq + browser TTS if Azure is unset
- `prefers-reduced-motion` and existing Speak toggle behaviour unchanged

**Files likely touched:** `web/src/lib/voice.ts`, maybe a small `web/src/lib/voice-enhance.ts`, `.env.example` notes only if server flags appear.

---

### Workstream D — Tasks and Today view

**Goal:** FEATURES P0 “what a VA does” without Muse Goals branding.

**Exists:** meetings, reminders, follow-ups in replies; `/api/va/summary`; Today panel planned.

**Steps:**

1. Decide FEATURES open Q3: single `tasks` table (recommended) vs extending reminders/follow-ups. Record the decision in FEATURES.
2. Migrate reminders and follow-ups into task types.
3. “Prioritise my day” proposes order; owner reorders; never silently drop.
4. Ship Astro Today panel from `/api/va/status` + tasks.
5. Recurring tasks and delegation tracking can wait for P1.

**Acceptance:**

- Chat: “what’s on my plate?” returns ranked tasks + meetings + approvals
- Create / complete / snooze from Chat and Today panel
- Data survives restart in SQLite

---

### Workstream E — Meetings notetaker

**Goal:** prep brief + join-for-notes + action items → tasks, free of Recall.ai.

**Steps:**

1. Self-host Vexa (Docker) on the owner machine or a private VPS they control.
2. Funke connector: spawn bot for an upcoming event (owner opt-in per meeting); announce “Funke (notes for …)”.
3. Stream or poll transcript → summarise (Groq): decisions, actions, owners, dates.
4. Each action → task / follow-up; recap email is draft → Approve.
5. Meeting prep brief: attendees + last notes + open follow-ups + linked docs (Workspace MCP search).
6. Desktop local capture (Meetily or Tauri) as P1 fallback when bots are blocked.

**Acceptance:**

- One supervised Meet or Zoom call produces a stored summary and at least one task
- Opt-in is explicit; no silent recording
- Works with Groq (or local Whisper in Vexa) without a notetaker SaaS bill

---

### Workstream F — Slack

**Goal:** summarise unread / mentions; draft replies; “Funke, remind me” later.

**Steps:**

1. Create Slack app; user-token scopes (FEATURES open Q5: prefer user token, document sensitivity).
2. Wire official Slack MCP or thin Slack Web API client behind the same write gate as Workspace.
3. Chat commands: “what did I miss on Slack?” / “draft a reply in #ops”.
4. Slash command or DM → create reminder/task (P1).

**Acceptance:**

- Read path works read-only first
- Send path requires Approve
- Revoke documented on consent screen

---

### Workstream G — Web research

**Goal:** every research claim has a URL; unsourced lines dropped.

**Steps:**

1. Run SearXNG via Docker Compose (private instance; do not scrape public instances).
2. Add mcp-searxng or SearchForge as an MCP/stdio tool Funke can call from research asks.
3. Prompt + post-filter: no citation → strip claim.
4. Feed company/person briefs into meeting prep (Workstream E).

**Acceptance:**

- “Research X” returns bullets with links
- Offline / SearXNG down → fail closed with a clear message

---

### Workstream H — Browser agency (Muse “books / shops / forms”)

**Goal:** Funke can operate a headed browser for non-social tasks under approval.

**Steps:**

1. Spawn Playwright MCP as a supervised tool lane (separate from social account profiles).
2. Policy: browse and fill OK; send email / pay / submit legal forms → Approve or blocked.
3. Never reuse LinkedIn/X profile directories for general browsing.
4. Optional Bitwarden Agent Access for login injection without model-visible passwords.
5. Shopping: stop at cart or payment page; owner completes pay (hard boundary).

**Acceptance:**

- Demo: fill a public demo form end-to-end with Approve on submit
- Social profiles untouched
- Payment actions remain blocked in code

---

### Workstream I — Surfaces and remote access

**Goal:** PWA + remote phone without opening the API to the world.

**Exists:** Astro web; Tailscale preferred in FEATURES §4.2.

**Steps:**

1. PWA: manifest, install prompt, offline shell, Web Push for reminders.
2. Default remote: Tailscale to owner machine; API stays loopback + tailnet.
3. Tauri shell P1 (menu bar, global hotkey, Keychain).
4. Do not default to a public VPS unless owner sets `BIND_ALLOW_NON_LOOPBACK` + strong `API_TOKEN`.

**Acceptance:**

- Phone on tailnet can Talk and see Today
- Public bind without token still refuses to start

---

### Workstream J — Proactivity and Goals (Muse parity, later)

**Goal:** background work without spam.

**Steps:**

1. Reuse `jobs` scheduler patterns for VA digests (morning inbox, open follow-ups).
2. Goals tab: owner-set goals → plans → next actions as tasks.
3. Proactive messages only when materially new (Muse’s bar); owner can dial down.
4. Ideas: optional, after digests are trusted.

**Acceptance:**

- Owner can disable proactivity
- No proactive send of email/Slack without Approve

---

## 6. Explicit non-goals (for now)

- Replacing Funke with OpenClaw / Open WebUI / LibreChat / AnythingLLM
- Muse Secure VM / Confidential VM as a requirement
- Agent checkout with virtual cards
- Instagram / Facebook / TikTok adapters before fixtures exist
- Wake word that streams the room to a server
- Baileys WhatsApp on a primary number

---

## 7. Suggested build order (first six weeks)

Week-shaped, not calendar gospel. Adjust to your pace.

1. **Week 1:** Workstream A (connector write gate) + Workstream C start (Silero VAD)
2. **Week 2:** Finish C (RNNoise) + Workstream B digest/drafts (read-heavy)
3. **Week 3:** Workstream D tasks + Today panel
4. **Week 4:** Workstream E Vexa spike (one platform: Google Meet first)
5. **Week 5:** Workstream F Slack read + draft
6. **Week 6:** Workstream G SearXNG research + Workstream H Playwright MCP spike

Social pipeline stays as-is unless a bug blocks demos. It is already a Muse gap we own.

---

## 8. Env and commands cheat sheet

```bash
# health
npm run doctor
npm run smoke

# Workspace MCP (example)
WORKSPACE_MCP_COMMAND=uvx
WORKSPACE_MCP_ARGS=workspace-mcp
WORKSPACE_MCP_WRITES=false

# AI / voice (existing)
GROQ_API_KEY=...
STT_PROVIDER=groq
# optional TTS quality
AZURE_SPEECH_KEY=...
AZURE_SPEECH_REGION=...
AZURE_TTS_VOICE=en-NG-EzinneNeural

# never for P0
# RECALL_API_KEY=...
# KRISP_...
```

Playwright MCP (dev spike only until gated):

```bash
npx @playwright/mcp@latest
```

SearXNG (sketch):

```bash
docker compose -f deploy/searxng/compose.yml up -d
# point mcp-searxng at SEARXNG_URL=http://127.0.0.1:8080
```

Vexa (sketch):

```bash
git clone https://github.com/Vexa-ai/vexa.git && cd vexa && make all
```

---

## 9. Decision log (fill as you go)

Record choices here so agents do not re-litigate them.

| Date | Decision | Why |
|---|---|---|
| 2026-10-23 | Rival Muse via local connectors + MCP, not a cloud VM | Matches Funke principles; free to run |
| 2026-10-23 | Meeting bots: Vexa first, not Recall.ai | Apache 2.0, self-host, no SaaS bill |
| 2026-10-23 | Voice: Silero vad-web + RNNoise first, DeepFilterNet optional | Better than RMS; free; client-side |
| 2026-10-23 | Browser agency: Playwright MCP before browser-use | Same stack as social engine |
| 2026-10-23 | Tasks: single `tasks` table; migrate reminders/follow-ups into types | One plate, clearer Today view |
| 2026-10-23 | Remote default: Tailscale (or WireGuard) to owner machine | FEATURES §4.2; API stays private |
| 2026-10-23 | Slack: user token (acts as owner), minimal scopes | More useful than bot; document sensitivity |

---

## 10. Sources

Product and architecture:

- https://muse.ai
- https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/
- https://introducing.muse.ai/
- https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse

OSS / MCP:

- https://github.com/taylorwilsdon/google_workspace_mcp
- https://developers.google.com/workspace/guides/configure-mcp-servers
- https://github.com/Vexa-ai/vexa
- https://github.com/Zackriya-Solutions/meetily
- https://github.com/microsoft/playwright-mcp
- https://github.com/browser-use/browser-use
- https://github.com/ihor-sokoliuk/mcp-searxng
- https://github.com/divyanshu-iitian/SearchForge
- https://github.com/bitwarden/agent-access
- https://openclaw.ai/
- https://github.com/ricky0123/vad
- https://www.npmjs.com/package/@sapphi-red/web-noise-suppressor
- https://www.npmjs.com/package/denoise-voice-clarity

Internal:

- `docs/FEATURES.md`
- `docs/AGENT-CONTROL.md`
- `docs/HANDOFF.md`
- `src/va/workspace.ts`
- `web/src/lib/voice.ts`
- `src/voice/stt.ts`
- `src/voice/tts.ts`

---

## 11. Progress

| Workstream | Status | Notes |
|---|---|---|
| A Trust / write gate | Done | Approvals gate Workspace writes |
| C Voice Silero + RNNoise | Done | Silero VAD + RNNoise; Talk is toggle (Space/orb/Talk), not hold-to-talk |
| D Tasks / Today | Done | `va_tasks` table, dual-write from reminders/follow-ups, Today panel, prioritise |
| B Workspace digest | Partial | Chat: “triage my inbox” / “what needs a reply” → structured Gmail read (needs MCP configured) |
| G Web research | Done | `deploy/searxng` + `src/va/research.ts`; `SEARXNG_URL`; fail closed when down |
| F Slack | Done | `src/va/slack.ts` + `slack.send` approvals; `SLACK_USER_TOKEN` |
| H Browser agency | Spike | `src/va/browser-agency.ts` + `docs/BROWSER-AGENCY.md`; pay blocked; MCP env ready |
| E Meetings / Vexa | Stub | `src/va/meetings.ts` + `docs/VEXA-MEETINGS.md`; fail closed until VEXA_API_URL |
| I–J | Not started | PWA/Tailscale, proactivity |

## 12. Next action

1. Wire Playwright MCP stdio client for live fill demos (H follow-up).
2. Stand up Vexa and implement join/transcript → tasks (E).
3. Workstream I (PWA / Tailscale) when you want phone access.

### How to view the UI

```bash
# terminal 1 — control API (loopback :4310)
npm run start

# terminal 2 — Astro UI (:4330), proxies /api to :4310
npm run ui
```

Open **http://127.0.0.1:4330/** (or `/home`). Dock: Apps → **Today**, Chat, Calendar, Approvals. Classic dashboard also at **http://127.0.0.1:4310/** if you prefer.

When a workstream finishes, tick its acceptance checks above and bump “Last updated.”
