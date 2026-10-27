# Funke

**A self-hosted personal assistant you can chat with or talk to.** Funke keeps your
calendar, reminders, tasks and follow-ups, drafts posts for LinkedIn, X and Bluesky,
and asks you to approve the exact final text before anything leaves your machine.

- Runs entirely on your computer. No SaaS, no account to create, nothing phones home.
- Works on a **free** Groq API key. Paid models are strictly opt-in.
- Voice is optional, and voice can never approve anything. Approvals are always a tap on screen.
- The social engine is **off** until you press Start, and it never starts on its own.

Funke is built on [social-media-automation-agent](https://github.com/zackfounder/social-media-automation-agent)
by [Zack Guerrand](https://www.linkedin.com/in/zackguerrand/), and is released under the
same [MIT license](LICENSE).

---

## Quick start (about 10 minutes)

### 1. What you need

| | |
|---|---|
| **Node.js 22.5 or newer** | Check with `node -v`. Get it from [nodejs.org](https://nodejs.org/). |
| **Git** | To clone the repo. |
| **A free Groq API key** | [console.groq.com/keys](https://console.groq.com/keys). No card, takes a minute. |

You do **not** need LinkedIn, X, Google or Docker to start. Chat, reminders and
drafts work with just the Groq key.

### 2. Install

```bash
git clone https://github.com/davidyayaochuko/vaforyou.git
cd vaforyou
npm install
```

`npm install` installs the server, the UI (in `web/`), and a copy of Chromium that
Playwright uses for the social accounts. Expect a couple of minutes.

### 3. Set up

```bash
npm run setup
```

This opens a short setup page in your browser. Paste your Groq key, and it is checked
live. Skip the LinkedIn step for now if you like. Setup:

- writes `.env` (readable only by you) and generates an `API_TOKEN`,
- creates the local SQLite database in `data/`,
- copies the example instructions and template bank into files that are yours to edit.

It is safe to re-run. Nothing you already set is overwritten. No browser on that
machine? Use `npm run setup:cli` for the same flow in the terminal.

### 4. Build and run

```bash
npm run build    # builds the UI. Run again after every git pull.
npm run start
```

Open **[http://localhost:4310](http://localhost:4310)**. That is the whole app: one
process, one address, reachable only from this computer.

### 5. Try it

Open **Chat** from the dock (or press `Cmd/Ctrl + K`) and ask:

1. `What's on my plate?`
2. `Remind me tomorrow at 9am to call Ada`
3. `Book a call with Chioma Thursday at 3pm`
4. `Draft a LinkedIn post about our launch`, then tap **Approve** on the card

Nothing posts until you approve it **and** start the social engine in **Settings**.
Leave the engine off while you learn.

---

## Using Funke

The home screen is a desktop with a dock. Everything lives in panels:

| Panel | What it does |
|---|---|
| **Chat** | Ask in plain English. Cards appear for anything that needs your approval. |
| **Today** | Tasks, reminders and meetings for the day, with one-tap Done and Prioritise. |
| **Calendar** | Upcoming meetings in your home timezone. |
| **Approvals** | Everything waiting on you. Approve or reject the exact final text. |
| **Socials** | Connected LinkedIn, X and Bluesky accounts and their status. |
| **Settings** | Start or stop the social engine, connect Google Calendar, see voice providers, teach Funke names and how to say them, and review or forget what Funke remembers. |

The orb in the middle is voice. Tap it (or press Space) to talk. Funke listens,
replies out loud, and listens again. It will read you an approval card, but it will
not approve one.

---

## Optional extras

Everything below is configured in `.env`. Restart `npm run start` after changing it.
[`.env.example`](.env.example) documents every variable.

### Better voice

By default Funke uses your browser's speech engine. For better quality:

- **Transcription:** your `GROQ_API_KEY` already enables Groq Whisper (`STT_PROVIDER=auto`).
- **Speaking:** set `XAI_API_KEY` for xAI voices, or `AZURE_SPEECH_KEY` and
  `AZURE_SPEECH_REGION` for Azure neural voices (Nigerian English by default).

Audio is sent for the request and discarded. Details in [`docs/DATA.md`](docs/DATA.md).

### Google Calendar

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and
   enable the **Google Calendar API**.
2. Create an **OAuth client ID** (type *Web application*) with this redirect URI:
   `http://127.0.0.1:4310/api/google/callback`
3. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
4. Restart, open **Settings**, and press **Connect** next to Google Calendar.

### Reminder emails

Set `NOTIFY_EMAIL` and the `SMTP_*` variables. For Gmail use `smtp.gmail.com`, port
`587`, and an [App Password](https://myaccount.google.com/apppasswords), not your
normal password.

### Social accounts

You log in yourself. A real browser window opens and waits; nothing in this repo
ever types a password or touches 2FA.

```bash
npm run login -- linkedin  --platform linkedin
npm run login -- twitter   --platform x
npm run login -- main-bsky --platform bluesky
```

Each account gets its own browser profile in `data/profiles/<name>/`. **Treat that
folder like a password**: anyone who has it is logged in as you. Then see
[The social engine](#the-social-engine) below.

### More integrations

Google Workspace through an MCP server, Slack, private web research through SearXNG,
supervised browser tasks and meeting notes are all optional and off by default. Each
one has a commented block in [`.env.example`](.env.example). Write actions from
every integration still wait in Approvals.

---

## Security model

| What | Where | Protected by |
|---|---|---|
| AI keys and `API_TOKEN` | `.env` | git-ignored, mode `600` |
| Logged-in sessions | `data/profiles/` | git-ignored. The most sensitive thing on disk. |
| Database (chat, memory, audit log) | `data/` | git-ignored |
| The app and its API | `localhost:4310` | bound to `127.0.0.1` only |

The UI authenticates with an HttpOnly, SameSite=Strict session cookie, so the API
token is never visible to page scripts. Scripts and agents call the API with
`Authorization: Bearer $API_TOKEN`.

If you set `BIND_HOST` to anything other than loopback, the server **refuses to
start** unless you also set `BIND_ALLOW_NON_LOOPBACK=true` and an `API_TOKEN` of at
least 24 characters. The first visit from another machine must then be
`/?token=<API_TOKEN>`. Run `npm run doctor` any time to check all of this.

`data/` is not in git, so it is also not in any backup that only covers the repo.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "The Funke UI is not built yet" | Run `npm run build`, then reload. |
| Panels say the server is not answering | Make sure `npm run start` is still running. |
| Replies are blocked or look like stubs | No AI key is set, so the mock is running. Check `npm run doctor`. |
| Groq says the model is gone | Re-run `npm run setup`. It picks a live model. |
| Mic does nothing | Allow microphone access for `localhost` in your browser. |
| Anything else | `npm run doctor` is read-only and tells you what is wrong. |

On Windows, use PowerShell or Windows Terminal. The commands are the same.

---

## Developing

```bash
npm run dev      # API server with reload on :4310
npm run ui       # UI dev server with hot reload on :4330 (proxies /api to :4310)
```

Open [http://127.0.0.1:4330](http://127.0.0.1:4330) while developing. The dev proxy
adds your `API_TOKEN` from `.env`, so you do not need to log in.

| Check | Command |
|---|---|
| Types (server) | `npm run typecheck` |
| Types (UI) | `npm run ui:check` |
| Engine checks, no network or credentials | `npm run smoke` |
| Approvals and guardrails | `npm run guardrails` |
| Browser layer against fixture pages | `npm run selftest` |

Read [`docs/HANDOFF.md`](docs/HANDOFF.md) before changing the engine. It explains the
two queues, the tick loop and the content gate. [`CLAUDE.md`](CLAUDE.md) has the
invariants that the tests enforce.

```
src/
  server/      HTTP API, and serves the built UI from web/dist
  va/          the assistant: chat commands, calendar, reminders, memory, Google
  voice/       transcription, speech, vocabulary
  guardrails/  approvals, audit log, hard boundaries
  platforms/   one adapter per social platform. Every selector lives here.
  content/     templates, generation, and the content gate
  engine/      rate limits, scheduler, jobs
  browser/     one persistent Chromium per account, human pacing
  mcp/         MCP server for coding agents
  db/          schema and plain-function repositories
web/           the Astro + React UI
instructions/  the assistant's and agents' brief (examples ship, yours are git-ignored)
templates/     approved post shapes per platform
knowledge/     your local knowledge base (examples ship)
docs/          architecture, data handling, agent control
```

---

## The social engine

Optional. It publishes and engages on **LinkedIn** (profile or company page: posts,
comments, reactions, reposts, replies, DMs, invitations), **X** (posts, threads, DMs,
likes) and **Bluesky** (posts, threads, replies, likes, follows), from browsers you
are logged into. No platform API keys.

> Automating these platforms is against their terms of service. The realistic
> downside is a restricted or banned account. The defaults are a warm-up profile
> (one post a day, a handful of comments, 35-140 seconds between actions). Raise
> them slowly, over weeks, or not at all.

Read [`docs/AGENT-CONTROL.md`](docs/AGENT-CONTROL.md) before connecting real accounts.

Every piece of text a model writes passes the content gate before it is queued, and
again immediately before publishing. There is no bypass. Posts must match an approved
shape in `templates/<platform>/bank.json`.

### Write and publish one post by hand

```bash
npm run draft -- linkedin "the number that surprised me this week" \
  --facts "churn 4.1%, was 6.8% in May. one onboarding change."
npm run queue                          # what is waiting, with ids
npm run queue -- edit 3 "new text"     # replace it. This re-runs the gate.
npm run publish -- 3                   # opens the browser and publishes it
```

### Schedule the agents

```bash
# write a LinkedIn post every day, publish whatever is approved every 2 hours
npm run schedule -- add linkedin generate_post --every 1d \
  --brief "This week's real number or decision. Nothing invented."
npm run schedule -- add linkedin publish_due --every 2h

# answer comments on your own posts twice a day, at most 3 replies
npm run schedule -- add linkedin reply_comments --every 12h --max 3

npm run schedule -- list
npm run schedule -- pause 3
```

Job kinds: `generate_post`, `publish_due`, `engage_feed`, `send_dm`, `engage_post`,
`reply_comments`, `grow_network`, `visit_profiles`, `follow_targets`. Recurrence is
`90m`, `6h` or `1d` with up to 20% jitter. Everything obeys working hours and rate
caps. Then press **Start engine** in Settings.

### Change what it is allowed to say

| To change | Edit | Takes effect |
|---|---|---|
| Voice, rules, engagement bar | `instructions/GLOBAL.md`, `instructions/<platform>.md` | Next generation |
| Approved post shapes | `templates/<platform>/bank.json` | Next generation |
| Hard-enforced rules | `src/content/gate.ts` | Restart |
| Rate caps, working hours | `POST /api/limits` or the `set_limits` MCP tool | Immediately |

### Connect a coding agent (MCP)

```bash
claude mcp add funke -- npx tsx /path/to/vaforyou/src/mcp/server.ts
```

Agents can draft, queue, schedule and control jobs. They cannot invent a template,
publish text that fails the gate, exceed or raise a cap, or act outside working
hours. Those limits live in the engine, not in the tool descriptions.

### What is verified

`npm run smoke` and `npm run selftest` cover the engine and drive the real adapters
in a real browser against local fixture pages. **No platform selector has been
verified against a live session.** Each platform needs one supervised run: log in,
schedule one job, watch the browser, and fix whatever the log says it could not find.
Selectors for each platform live in a single file in `src/platforms/`.

---

## Commands

| Command | Does |
|---|---|
| `npm run setup` | Setup page: key, database, first account. Re-runnable. |
| `npm run setup:cli` | The same, in the terminal |
| `npm run build` | Build the UI |
| `npm run start` | Run Funke at http://localhost:4310 |
| `npm run doctor` | Read-only health check |
| `npm run login -- <name> --platform <p>` | Connect one social account |
| `npm run login:all` | Log in every account without a live session |
| `npm run accounts` | What is connected and today's budget. `-- forget <name>` removes one. |
| `npm run draft` / `queue` / `publish` | Write, review and publish posts by hand |
| `npm run schedule -- ...` | `list`, `add`, `pause`, `resume`, `rm` jobs |
| `npm run campaign -- <file.json>` | Load a LinkedIn outreach funnel (needs `OUTREACH_ENABLED=true`) |
| `npm run leads -- csv <file> --campaign 1` | Import leads |
| `npm run mcp` | MCP server on stdio |

## License

[MIT](LICENSE). Contributions are welcome: open an issue or a pull request.
