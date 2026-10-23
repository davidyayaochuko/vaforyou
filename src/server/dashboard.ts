/**
 * Funke conversational dashboard (Elena-style chat surface).
 * Single file, no build step. API token is embedded for localhost calls.
 */
export function dashboardHtml(apiToken: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Funke</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #f6f5f1;
    --paper: #ffffff;
    --ink: #171717;
    --mut: #6b6b6b;
    --line: #e7e5df;
    --soft: #f0eee8;
    --accent: #1a1a1a;
    --funke: #2f6b4f;
    --funke-soft: #e8f3ec;
    --user: #eef2ff;
    --shadow: 0 10px 40px rgba(23,23,23,0.06);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    color: var(--ink);
    background:
      radial-gradient(900px 420px at 50% -8%, rgba(47,107,79,0.08), transparent 55%),
      var(--bg);
    font: 16px/1.55 "DM Sans", ui-sans-serif, sans-serif;
  }
  .page {
    min-height: 100%;
    max-width: 720px;
    margin: 0 auto;
    padding: 20px 16px 200px;
    display: flex;
    flex-direction: column;
  }
  .dock {
    align-self: center;
    display: flex;
    gap: 8px;
    padding: 8px;
    border-radius: 999px;
    background: var(--paper);
    box-shadow: var(--shadow);
    border: 1px solid var(--line);
    margin-bottom: 28px;
  }
  .dock button {
    width: 44px; height: 44px; border-radius: 14px; border: 0;
    background: var(--soft); color: var(--ink); cursor: pointer;
    font: inherit; font-size: 13px; font-weight: 600;
  }
  .dock button.active { background: var(--funke); color: #fff; }
  .dock button:hover { filter: brightness(0.98); }
  .hero { text-align: center; margin: 8px 0 22px; }
  .eyebrow {
    font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--mut); margin: 0 0 10px;
  }
  .hero h1 {
    font-family: "Instrument Serif", Georgia, serif;
    font-weight: 400;
    font-size: clamp(2.4rem, 7vw, 3.4rem);
    margin: 0;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .hero h1 em { font-style: italic; color: var(--funke); }
  .hero p { color: var(--mut); margin: 12px auto 0; max-width: 28rem; font-size: 15px; }
  .badge {
    display: inline-flex; align-items: center; gap: 6px;
    margin-top: 14px; padding: 5px 10px; border-radius: 999px;
    background: var(--paper); border: 1px solid var(--line);
    color: var(--mut); font-size: 12px;
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #b0b0b0; }
  .dot.on { background: #3cba6f; }
  .dot.off { background: #c4a35a; }
  .chat {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-bottom: 18px;
  }
  .msg {
    max-width: 92%;
    padding: 14px 16px;
    border-radius: 18px;
    box-shadow: var(--shadow);
    border: 1px solid var(--line);
    background: var(--paper);
    white-space: pre-wrap;
    animation: rise 0.28s ease;
  }
  .msg.funke { align-self: flex-start; background: var(--paper); border-radius: 18px 18px 18px 6px; }
  .msg.user { align-self: flex-end; background: var(--user); border-radius: 18px 18px 6px 18px; }
  .msg .who {
    font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--mut); margin-bottom: 6px; font-weight: 600;
  }
  .msg.funke .who { color: var(--funke); }
  .cards {
    display: grid; gap: 8px; margin-top: 12px;
  }
  .card-line {
    background: var(--funke-soft);
    border-radius: 12px;
    padding: 10px 12px;
    font-size: 14px;
  }
  .card-line strong { display: block; font-size: 14px; margin-bottom: 2px; }
  .card-line span { color: var(--mut); font-size: 13px; }
  .suggestions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 6px;
  }
  @media (max-width: 560px) { .suggestions { grid-template-columns: 1fr; } }
  .suggestion {
    text-align: left;
    border: 1px solid var(--line);
    background: var(--paper);
    border-radius: 18px;
    padding: 16px;
    cursor: pointer;
    box-shadow: var(--shadow);
    font: inherit;
  }
  .suggestion:hover { border-color: #c9c5bb; }
  .suggestion b { display: block; margin-bottom: 4px; }
  .suggestion span { color: var(--mut); font-size: 13px; }
  .composer-wrap {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 5;
    padding: 14px 16px 22px;
    background: linear-gradient(180deg, transparent, var(--bg) 28%);
    pointer-events: none;
  }
  .composer-wrap .composer,
  .composer-wrap .composer *,
  .composer-wrap .voice-status {
    pointer-events: auto;
  }
  .composer-wrap .hint { pointer-events: none; }
  .composer {
    max-width: 720px; margin: 0 auto;
    display: flex; gap: 10px; align-items: flex-end;
    padding: 10px 10px 10px 16px;
    border-radius: 999px;
    background: var(--paper);
    border: 1px solid var(--line);
    box-shadow: 0 12px 40px rgba(23,23,23,0.08);
  }
  .composer textarea {
    flex: 1; border: 0; outline: 0; resize: none;
    font: inherit; background: transparent; color: var(--ink);
    max-height: 120px; padding: 10px 0; line-height: 1.4;
  }
  .composer textarea:focus {
    outline: 2px solid var(--funke);
    outline-offset: 2px;
    border-radius: 8px;
  }
  .dock button:focus-visible, .composer button:focus-visible, .next button:focus-visible {
    outline: 2px solid var(--funke);
    outline-offset: 2px;
  }
  .composer button.send, .composer button.mic, .composer button.speak {
    width: 44px; height: 44px; min-width: 44px; min-height: 44px; border-radius: 50%; border: 0;
    cursor: pointer; font-size: 16px; flex-shrink: 0;
  }
  .dock button { min-width: 44px; min-height: 44px; }
  #chat[aria-busy="true"]::after {
    content: 'Working…';
    display: block;
    color: var(--mut);
    font-size: 13px;
    margin: 8px 0 0 4px;
  }
  @media (max-width: 400px) {
    .composer { border-radius: 22px; padding: 8px; gap: 6px; }
    .composer button.speak, .composer button.mic { font-size: 11px; }
    .page { padding-bottom: 220px; }
    .hint { font-size: 11px; line-height: 1.35; max-height: 2.8em; overflow: hidden; }
  }
  .composer button.send {
    background: var(--accent); color: #fff; font-size: 18px;
  }
  .composer button.send:disabled { opacity: 0.45; cursor: wait; }
  .composer button.mic {
    background: var(--soft); color: var(--ink); border: 1px solid var(--line);
  }
  .composer button.mic.rec {
    background: #b42318; color: #fff; border-color: #b42318;
    animation: pulse-rec 1s ease infinite;
  }
  .composer button.speak, .composer button.mic {
    font-size: 12px; font-weight: 600; letter-spacing: 0.02em;
  }
  .composer button.speak {
    background: var(--soft); color: var(--mut); border: 1px solid var(--line);
  }
  .composer button.speak.on { color: var(--funke); border-color: rgba(47,107,79,0.45); }
  .voice-status {
    text-align: center; color: var(--mut); font-size: 12px; margin-top: 6px; min-height: 1.2em;
  }
  .voice-status.rec { color: #b42318; font-weight: 600; }
  @keyframes pulse-rec {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.06); }
  }
  .hint { text-align: center; color: var(--mut); font-size: 12px; margin-top: 8px; }
  .panel {
    display: none;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 16px;
    box-shadow: var(--shadow);
  }
  .panel.open { display: block; }
  .panel h3 { margin: 0 0 10px; font-size: 15px; }
  .panel .row { color: var(--mut); font-size: 14px; padding: 8px 0; border-bottom: 1px solid var(--line); }
  .panel .row:last-child { border-bottom: 0; }
  .ops { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  .ops button, .next button, .draft button {
    border: 1px solid var(--line); background: var(--soft); border-radius: 999px;
    padding: 10px 14px; font: inherit; cursor: pointer;
    min-height: 44px; min-width: 44px;
  }
  .next { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
  .next button.primary { background: var(--funke); color: #fff; border-color: var(--funke); }
  .draft { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }
  .msg .draft { margin-bottom: 8px; padding-bottom: 4px; }
  .draft p { margin: 0 0 8px; white-space: pre-wrap; font-size: 14px; overflow-wrap: anywhere; }
  .draft textarea {
    width: 100%; min-height: 110px; margin: 0 0 8px;
    border: 1px solid var(--line); border-radius: 12px;
    padding: 10px 12px; font: inherit; font-size: 14px;
    background: var(--soft); color: var(--ink); resize: vertical;
  }
  .stages {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
    margin: 12px 0;
  }
  @media (max-width: 560px) { .stages { grid-template-columns: repeat(2, 1fr); } }
  .stage {
    background: var(--soft);
    border-radius: 12px;
    padding: 8px 10px;
    text-align: center;
  }
  .stage strong { display: block; font-size: 18px; line-height: 1.1; }
  .stage span { color: var(--mut); font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; }
  .stage.active { background: var(--funke-soft); outline: 1px solid rgba(47,107,79,0.35); }
  .stage-label { color: var(--mut); font-size: 13px; margin-top: 4px; }
  @keyframes rise {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: none; }
  }
  .skip-link {
    position: absolute; left: -999px; top: 0;
    background: var(--funke); color: #fff; padding: 8px 12px; z-index: 20;
  }
  .skip-link:focus { left: 12px; top: 12px; }
  .chat-toolbar {
    display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
    margin: 0 0 12px; justify-content: center;
  }
  .chat-toolbar button {
    min-height: 44px; border: 1px solid var(--line); background: var(--paper);
    border-radius: 999px; padding: 8px 14px; font: inherit; font-size: 13px;
    font-weight: 600; cursor: pointer; color: var(--ink);
  }
  .chat-toolbar button.primary { background: var(--funke); color: #fff; border-color: var(--funke); }
  .chat-note { color: var(--mut); font-size: 12px; text-align: center; margin: 0 0 10px; max-width: 28rem; margin-inline: auto; }
  .msg { position: relative; }
  .msg .msg-actions {
    display: flex; gap: 6px; margin-top: 8px; opacity: 0.85;
  }
  .msg .msg-actions button {
    min-height: 36px; min-width: 36px; border: 1px solid var(--line);
    background: var(--soft); border-radius: 999px; padding: 4px 10px;
    font: inherit; font-size: 12px; cursor: pointer;
  }
  .msg:focus-within .msg-actions, .msg:hover .msg-actions { opacity: 1; }
  .drawer-backdrop {
    display: none; position: fixed; inset: 0; background: rgba(23,23,23,0.35);
    z-index: 30;
  }
  .drawer-backdrop.open { display: block; }
  .drawer {
    position: fixed; top: 0; bottom: 0; left: 0; width: min(360px, 92vw);
    background: var(--paper); z-index: 31; transform: translateX(-105%);
    transition: transform 0.2s ease; box-shadow: var(--shadow);
    display: flex; flex-direction: column; padding: 16px;
  }
  .drawer.open { transform: none; }
  .drawer h2 { margin: 0 0 8px; font-size: 1.15rem; font-family: "Instrument Serif", Georgia, serif; }
  .drawer .drawer-note { color: var(--mut); font-size: 12px; margin: 0 0 12px; }
  .drawer .search {
    width: 100%; padding: 10px 12px; border: 1px solid var(--line);
    border-radius: 999px; font: inherit; margin-bottom: 10px;
  }
  .drawer .tabs { display: flex; gap: 6px; margin-bottom: 10px; }
  .drawer .tabs button {
    flex: 1; min-height: 40px; border: 1px solid var(--line); background: var(--soft);
    border-radius: 999px; font: inherit; font-size: 13px; cursor: pointer;
  }
  .drawer .tabs button.active { background: var(--funke); color: #fff; border-color: var(--funke); }
  .drawer .list { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
  .conv-item {
    border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px;
    background: var(--soft); text-align: left;
  }
  .conv-item.active { outline: 1px solid rgba(47,107,79,0.45); background: var(--funke-soft); }
  .conv-item b { display: block; font-size: 14px; margin-bottom: 2px; }
  .conv-item .meta { color: var(--mut); font-size: 12px; }
  .conv-item .ops { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .conv-item .ops button {
    min-height: 36px; border: 1px solid var(--line); background: var(--paper);
    border-radius: 999px; padding: 4px 10px; font: inherit; font-size: 12px; cursor: pointer;
  }
  .drawer-foot { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
  .drawer-foot button {
    min-height: 44px; border: 1px solid var(--line); background: var(--soft);
    border-radius: 999px; font: inherit; font-size: 13px; cursor: pointer;
  }
  .drawer-foot button.danger { color: #8a1f1f; border-color: #e2b6b6; }
  .toast {
    position: fixed; left: 50%; bottom: 110px; transform: translateX(-50%);
    z-index: 40; display: none; align-items: center; gap: 12px;
    background: var(--ink); color: #fff; padding: 12px 16px; border-radius: 14px;
    max-width: min(420px, 92vw); font-size: 14px; box-shadow: var(--shadow);
  }
  .toast.open { display: flex; }
  .toast button {
    border: 0; background: var(--funke); color: #fff; border-radius: 999px;
    padding: 8px 12px; font: inherit; font-weight: 600; cursor: pointer; min-height: 36px;
  }
  .mem-row { display: flex; gap: 8px; align-items: flex-start; justify-content: space-between; }
  .mem-row button { flex-shrink: 0; min-height: 36px; }
  .voice-settings label { display: block; font-size: 13px; color: var(--mut); margin: 10px 0 4px; }
  .voice-settings select, .voice-settings input[type="range"] {
    width: 100%; font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px;
  }
  .spoken-caption {
    margin-top: 8px; padding: 8px 10px; border-radius: 10px;
    background: var(--funke-soft); color: var(--ink); font-size: 13px;
  }
  .spoken-caption .karaoke-word { opacity: 0.45; }
  .spoken-caption .karaoke-word.on { opacity: 1; font-weight: 600; color: var(--funke); }
  .conv-bar {
    display: none; position: fixed; left: 50%; bottom: 100px; transform: translateX(-50%);
    z-index: 35; align-items: center; gap: 10px; padding: 10px 14px;
    background: var(--ink); color: #fff; border-radius: 999px; max-width: 92vw;
    font-size: 14px; box-shadow: var(--shadow);
  }
  .conv-bar.open { display: flex; }
  .conv-bar .dot-live {
    width: 10px; height: 10px; border-radius: 50%; background: #3cba6f;
    animation: pulse-rec 1s ease infinite;
  }
  .conv-bar button {
    border: 0; background: #b42318; color: #fff; border-radius: 999px;
    padding: 8px 14px; font: inherit; font-weight: 600; cursor: pointer; min-height: 40px;
  }
  .tx-chip {
    display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; padding: 10px;
    border: 1px solid var(--line); border-radius: 12px; background: var(--soft);
  }
  .tx-chip button.word {
    border: 0; background: transparent; font: inherit; font-size: 15px;
    padding: 4px 2px; cursor: pointer; border-radius: 4px;
  }
  .tx-chip button.word.low {
    text-decoration: underline wavy rgba(180, 35, 24, 0.55);
    text-underline-offset: 3px;
  }
  .tx-suggest {
    display: none; position: absolute; z-index: 36; background: var(--paper);
    border: 1px solid var(--line); border-radius: 12px; padding: 8px;
    box-shadow: var(--shadow); max-width: 260px;
  }
  .tx-suggest.open { display: block; }
  .tx-suggest button {
    display: block; width: 100%; text-align: left; border: 0; background: var(--soft);
    margin: 4px 0; padding: 8px 10px; border-radius: 8px; font: inherit; cursor: pointer;
  }
  .tour-overlay {
    position: fixed; inset: 0; background: rgba(20, 24, 18, 0.55); z-index: 80;
    display: flex; align-items: flex-end; justify-content: center; padding: 24px;
  }
  /* display:flex above would otherwise keep the overlay visible when hidden is set */
  .tour-overlay[hidden] { display: none !important; }
  .tour-card {
    background: var(--paper); color: var(--ink); border-radius: 16px; padding: 20px 22px;
    max-width: 420px; width: 100%; box-shadow: 0 12px 40px rgba(0,0,0,0.25);
  }
  .tour-card h2 { font-family: 'Instrument Serif', serif; font-size: 28px; margin: 0 0 8px; font-weight: 400; }
  .tour-card p { margin: 0 0 14px; color: var(--mut); font-size: 15px; line-height: 1.45; }
  .tour-card .ops { justify-content: flex-end; gap: 8px; }
</style>
</head>
<body>
<div class="tour-overlay" id="tourOverlay" hidden>
  <div class="tour-card" role="dialog" aria-labelledby="tourTitle">
    <h2 id="tourTitle">Welcome to Funke</h2>
    <p id="tourBody">Three quick steps. Nothing posts until you approve.</p>
    <div class="ops">
      <button type="button" onclick="skipTour()">Skip</button>
      <button type="button" class="primary" id="tourNext" onclick="advanceTour()">Next</button>
    </div>
  </div>
</div>
<div class="page">
  <a href="#askBox" class="skip-link">Skip to message box</a>
  <a href="#chatsBtn" class="skip-link">Skip to chat history</a>
  <nav class="dock" aria-label="Main views">
    <button class="active" title="Chat" aria-label="Chat" onclick="showView('chat')" id="tab-chat">Fk</button>
    <button title="Chat history" aria-label="Open chat history" onclick="openDrawer()" id="chatsBtn">Ch</button>
    <button title="Calendar" aria-label="Calendar" onclick="showView('cal')" id="tab-cal">Cal</button>
    <button title="Accounts" aria-label="Social accounts" onclick="showView('acc')" id="tab-acc">Soc</button>
    <button title="Page pipeline" aria-label="Page pipeline" onclick="showView('pipe')" id="tab-pipe">Pg</button>
    <button title="Approvals" aria-label="Approvals and audit" onclick="showView('appr')" id="tab-appr">Ok</button>
    <button title="Connect Google" aria-label="Connect Google Calendar" onclick="connectGoogle()" id="tab-g">G</button>
  </nav>

  <header class="hero">
    <p class="eyebrow">Personal assistant</p>
    <h1>Fun<em>ke</em></h1>
    <p>Ask in plain English. Paste invites, set reminders, draft posts. I answer like a person, not a log dump.</p>
    <div class="badge"><span class="dot off" id="liveDot"></span><span id="liveStatus">checking…</span></div>
  </header>

  <main id="view-chat">
    <div class="chat-toolbar" role="toolbar" aria-label="Conversation actions">
      <button type="button" class="primary" id="newChatBtn" onclick="newConversation()">New chat</button>
      <button type="button" id="historyToolbarBtn" accesskey="h" onclick="openDrawer()" title="Chat history (press H when not typing)">History</button>
      <button type="button" onclick="clearCurrentChat()" title="Remove messages in this chat only">Clear messages</button>
      <button type="button" onclick="exportActiveChat()">Export</button>
    </div>
    <p class="chat-note">Deleting chat removes messages only. Your activity log is kept separately for safety. Preferences stay unless you forget them in Social accounts.</p>
    <div class="chat" id="chat" aria-live="polite" aria-relevant="additions"></div>
    <div class="suggestions" id="suggestions">
      <button class="suggestion" onclick="promptAsk('What is on my plate?')">
        <b>What is on my plate?</b>
        <span>Calendar, reminders, and follow-ups in plain language.</span>
      </button>
      <button class="suggestion" onclick="promptAsk('Remind me tomorrow at 9am to prep for Talent Sourcing')">
        <b>Set a reminder</b>
        <span>Tomorrow 9am: prep for Talent Sourcing.</span>
      </button>
      <button class="suggestion" onclick="document.getElementById('askBox').focus()">
        <b>Paste a Zoom invite</b>
        <span>I will convert the timezone and put it on your calendar.</span>
      </button>
      <button class="suggestion" onclick="promptAsk('Draft a LinkedIn post about Spendprofile reconcile honesty')">
        <b>Draft a LinkedIn post</b>
        <span>I write a draft. You approve before anything publishes.</span>
      </button>
      <button class="suggestion" onclick="useSavedVoice()">
        <b>Use saved voice</b>
        <span>Uses the voice profile already on this computer. Does not reopen LinkedIn or Twitter.</span>
      </button>
    </div>
  </main>

  <div class="panel" id="view-cal">
    <h3>Calendar &amp; reminders</h3>
    <div id="calPanel"></div>
  </div>

  <div class="panel" id="view-acc">
    <h3>Social accounts</h3>
    <div id="accPanel"></div>
    <div class="ops">
      <button onclick="useSavedVoice()">Use saved voice</button>
      <button onclick="refreshVoice()">Re-read my LinkedIn and Twitter (opens browsers)</button>
      <button onclick="startEngine()">Start social engine</button>
      <button onclick="api('/api/engine/stop','POST')">Stop</button>
      <button onclick="api('/api/engine/pause','POST',{paused:true})">Pause</button>
      <button onclick="api('/api/engine/pause','POST',{paused:false})">Resume</button>
    </div>
    <h3 style="margin-top:18px">What Funke remembers</h3>
    <p class="stage-label">Preferences and contacts survive new chats. Separate from chat history and the activity log.</p>
    <div id="memPanel"><div class="row">Loading…</div></div>
    <div class="ops">
      <button onclick="loadMemoryPanel()">Refresh memory</button>
      <button onclick="forgetAllMemory()">Forget what Funke knows about me</button>
    </div>
    <h3 style="margin-top:18px">Work context</h3>
    <p class="stage-label">Tag new memories for personal, work, boss, or a client. Calendar stays shared.</p>
    <div class="ops">
      <select id="contextSel" onchange="saveContext()"></select>
      <button type="button" onclick="loadContextUi()">Refresh</button>
    </div>
    <h3 style="margin-top:18px">Reply length</h3>
    <p class="stage-label">How long Funke’s chat replies should be.</p>
    <div class="ops">
      <select id="replyStyleSel" onchange="saveReplyStyle()">
        <option value="brief">Brief</option>
        <option value="normal">Normal</option>
        <option value="detailed">Detailed</option>
      </select>
    </div>
    <h3 style="margin-top:18px">Voice</h3>
    <p class="stage-label">Prefer Nigerian English (en-NG) when your browser offers it. Optional Azure neural voices need keys in .env. No voice cloning.</p>
    <div class="voice-settings" id="voiceSettings">
      <label for="ttsProviderSel">Speech engine</label>
      <select id="ttsProviderSel" onchange="saveVoiceSettings()">
        <option value="browser">Browser (prefer en-NG)</option>
        <option value="azure">Azure Nigerian neural (needs keys)</option>
      </select>
      <label for="ttsVoiceSel">Voice</label>
      <select id="ttsVoiceSel" onchange="saveVoiceSettings()"></select>
      <label for="ttsRate">Speed <span id="ttsRateLabel">1.0</span></label>
      <input id="ttsRate" type="range" min="0.7" max="1.4" step="0.05" value="1" oninput="saveVoiceSettings()" />
      <div class="ops" style="margin-top:10px">
        <button type="button" onclick="previewVoice()">Preview voice</button>
        <button type="button" onclick="loadVocabPanel()">Vocabulary</button>
      </div>
      <div id="vocabPanel" class="row" style="margin-top:8px"></div>
      <p class="stage-label" id="ttsPrivacyNote" style="margin-top:8px"></p>
    </div>
  </div>

  <div class="panel" id="view-pipe">
    <h3>Page management</h3>
    <div id="pipePanel"><div class="row">Loading pipeline…</div></div>
    <div class="ops">
      <button onclick="showPipeline()">Refresh stages</button>
      <button onclick="reviewDrafts(true)">Refresh approvals</button>
      <button onclick="startEngine()">Start engine</button>
    </div>
  </div>

  <div class="panel" id="view-appr">
    <h3>Approvals</h3>
    <p class="stage-label">Pending actions. Approve shows the exact final content. Voice cannot approve.</p>
    <div id="apprPanel"><div class="row">Loading…</div></div>
    <h3 style="margin-top:16px">Alerts</h3>
    <div id="alertsPanel"><div class="row">Loading…</div></div>
    <h3 style="margin-top:16px">Audit log</h3>
    <div class="ops">
      <input id="auditQ" placeholder="Search audit…" style="flex:1;min-width:140px;padding:8px 10px;border:1px solid var(--line);border-radius:999px;font:inherit" />
      <button onclick="loadAudit()">Search</button>
      <button onclick="loadSummary()">Daily summary</button>
    </div>
    <div id="auditPanel"></div>
    <div id="summaryPanel" style="margin-top:12px"></div>
  </div>
</div>

<div class="composer-wrap">
  <div class="composer">
    <button type="button" class="speak" id="speakBtn" title="Read replies aloud" aria-label="Read replies aloud" aria-pressed="false" onclick="toggleSpeak()">Say</button>
    <button type="button" class="mic" id="micBtn" title="Hold to talk" aria-label="Hold to talk. Release to stop.">Mic</button>
    <button type="button" class="speak" id="convBtn" title="Conversation mode" aria-label="Start conversation mode" aria-pressed="false" onclick="toggleConversationMode()">Talk</button>
    <textarea id="askBox" rows="1" placeholder="Ask Funke anything…" aria-label="Message to Funke"></textarea>
    <button type="button" class="send" id="askBtn" onclick="ask()" title="Send" aria-label="Send message">↑</button>
  </div>
  <p class="voice-status" id="voiceStatus"></p>
  <p class="hint">Hold Mic to talk, then edit before send. Enter sends · Shift+Enter for a new line. Voice cannot approve. Chat uses your AI key (Groq by default); mic audio is transcribed then discarded. See docs/DATA.md.</p>
</div>

<div class="drawer-backdrop" id="drawerBackdrop" onclick="closeDrawer()" hidden></div>
<aside class="drawer" id="chatDrawer" aria-label="Chat history" role="dialog" aria-modal="true" hidden>
  <h2 id="drawerTitle">Chats</h2>
  <p class="drawer-note">New chats still use saved preferences. Deleting chat never erases the activity log.</p>
  <label class="visually-hidden" for="convSearch">Search chats</label>
  <input class="search" id="convSearch" type="search" placeholder="Search chats…" aria-label="Search chats" oninput="loadConvList()" />
  <div class="tabs" role="tablist">
    <button type="button" class="active" id="tabActiveConvs" onclick="setConvTab(false)">Active</button>
    <button type="button" id="tabArchivedConvs" onclick="setConvTab(true)">Archived</button>
  </div>
  <div class="list" id="convList" role="list"></div>
  <div class="drawer-foot">
    <button type="button" class="primary" onclick="newConversation(); closeDrawer();">New chat</button>
    <button type="button" class="danger" onclick="deleteAllConversations()">Delete all conversations…</button>
    <button type="button" onclick="closeDrawer()">Close</button>
  </div>
</aside>
<div class="toast" id="undoToast" role="status" aria-live="polite">
  <span id="undoToastText">Deleted.</span>
  <button type="button" id="undoToastBtn" onclick="runUndo()">Undo</button>
</div>
<div class="conv-bar" id="convBar" role="status" aria-live="polite">
  <span class="dot-live" id="convDot" aria-hidden="true"></span>
  <span id="convStateLabel">Listening</span>
  <button type="button" onclick="stopConversationMode()">Stop conversation</button>
</div>
<div class="tx-suggest" id="txSuggest" role="listbox" aria-label="Suggested corrections"></div>
<style>
  .visually-hidden {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0,0,0,0); border: 0;
  }
  .drawer-foot button.primary { background: var(--funke); color: #fff; border-color: var(--funke); }
</style>

<script>
const TOKEN = ${JSON.stringify(apiToken)};
const chatEl = document.getElementById('chat');
let booted = false;
let speakOn = localStorage.getItem('funkeSpeak') === '1';
let sttInfo = { provider: 'browser', groqConfigured: false };
let mediaRecorder = null;
let mediaStream = null;
let mediaChunks = [];
let recording = false;
let recordStartedAt = 0;
let activeConversationId = null;
let showArchived = false;
let pendingUndoToken = null;
let undoTimer = null;
let ttsInfo = { provider: 'browser', azure: { configured: false } };
let voiceSettings = {
  provider: localStorage.getItem('funkeTtsProvider') || 'browser',
  voiceURI: localStorage.getItem('funkeTtsVoice') || '',
  azureVoice: localStorage.getItem('funkeAzureVoice') || 'en-NG-EzinneNeural',
  rate: Number(localStorage.getItem('funkeTtsRate') || '1') || 1,
};
let vocabTerms = [];
let convMode = false;
let convState = 'idle'; // idle | listening | thinking | speaking | paused
let convSilenceMs = Number(localStorage.getItem('funkeConvSilenceMs') || '1200') || 1200;
let convPauseAfterMs = Number(localStorage.getItem('funkeConvPauseMs') || '30000') || 30000;
let convStream = null;
let convAudioCtx = null;
let convAnalyser = null;
let convRaf = 0;
let convLastVoiceAt = 0;
let convSpeechStarted = false;
let convQuietSince = 0;
let convIdleSince = 0;
let azureAudio = null;
let lastTxWords = null;
let convMediaRecorder = null;
let convRecChunks = [];

async function api(path, method='GET', body) {
  if (!navigator.onLine) {
    throw new Error('You look offline. Check your connection, then try again. Nothing was sent.');
  }
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: Object.assign({'content-type':'application/json'}, TOKEN ? {authorization:'Bearer '+TOKEN} : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (_) {
    throw new Error('Network error. I could not reach Funke. Check your connection and try once more.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function addMsg(role, text, cards, approvals, messageId) {
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : 'funke');
  if (messageId) div.dataset.msgId = String(messageId);
  const who = role === 'user' ? 'You' : 'Funke';
  let html = '<div class="who">' + who + '</div>' + esc(text);
  if (cards && cards.length) {
    html += '<div class="cards">' + cards.map(c =>
      '<div class="card-line"><strong>' + esc(c.title) + '</strong><span>' + esc(c.sub || '') + '</span></div>'
    ).join('') + '</div>';
  }
  if (approvals && approvals.length) {
    html += approvals.map(a => approvalCardHtml(a)).join('');
  }
  if (messageId) {
    html += '<div class="msg-actions">' +
      '<button type="button" onclick="deleteMessage(' + messageId + ')">Delete</button>' +
      '</div>';
  }
  div.innerHTML = html;
  chatEl.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });
  if (role === 'funke' && (speakOn || convMode)) {
    try { speakReply(text, !!(approvals && approvals.length), div); }
    catch (_) { /* TTS must never break the chat turn */ }
  }
}

function showUndoToast(token, text) {
  pendingUndoToken = token;
  const toast = document.getElementById('undoToast');
  document.getElementById('undoToastText').textContent = text || 'Deleted.';
  toast.classList.add('open');
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    toast.classList.remove('open');
    pendingUndoToken = null;
  }, 10000);
}

async function runUndo() {
  if (!pendingUndoToken) return;
  const token = pendingUndoToken;
  pendingUndoToken = null;
  document.getElementById('undoToast').classList.remove('open');
  try {
    const out = await api('/api/conversations/undo', 'POST', { token });
    addMsg('funke', out.reply || 'Restored.');
    await reloadActiveChat();
    loadConvList();
  } catch (err) {
    addMsg('funke', String(err.message || err));
  }
}

function openDrawer() {
  const d = document.getElementById('chatDrawer');
  const b = document.getElementById('drawerBackdrop');
  d.hidden = false; b.hidden = false;
  d.classList.add('open'); b.classList.add('open');
  loadConvList();
  document.getElementById('convSearch').focus();
}

function closeDrawer() {
  const d = document.getElementById('chatDrawer');
  const b = document.getElementById('drawerBackdrop');
  d.classList.remove('open'); b.classList.remove('open');
  d.hidden = true; b.hidden = true;
}

function setConvTab(archived) {
  showArchived = !!archived;
  document.getElementById('tabActiveConvs').classList.toggle('active', !showArchived);
  document.getElementById('tabArchivedConvs').classList.toggle('active', showArchived);
  loadConvList();
}

async function loadConvList() {
  const q = document.getElementById('convSearch').value.trim();
  const list = document.getElementById('convList');
  try {
    const data = await api('/api/conversations?archived=' + (showArchived ? '1' : '0') +
      (q ? '&q=' + encodeURIComponent(q) : ''));
    const rows = data.conversations || [];
    list.innerHTML = rows.map(c => {
      const active = c.id === activeConversationId ? ' active' : '';
      return '<div class="conv-item' + active + '" role="listitem">' +
        '<b>' + esc(c.title) + '</b>' +
        '<div class="meta">' + esc((c.updated_at || c.created_at || '').replace('T', ' ').slice(0, 16)) +
        (c.preview ? ' · ' + esc(c.preview.slice(0, 60)) : '') + '</div>' +
        '<div class="ops">' +
        '<button type="button" onclick="openConversation(' + c.id + ')">Open</button>' +
        '<button type="button" onclick="renameConversation(' + c.id + ')">Rename</button>' +
        (showArchived
          ? '<button type="button" onclick="unarchiveConversation(' + c.id + ')">Restore</button>'
          : '<button type="button" onclick="archiveConversation(' + c.id + ')">Archive</button>') +
        '<button type="button" onclick="exportConversation(' + c.id + ')">Export</button>' +
        '<button type="button" onclick="deleteConversation(' + c.id + ')">Delete</button>' +
        '</div></div>';
    }).join('') || '<div class="row">No chats here.</div>';
  } catch (err) {
    list.innerHTML = '<div class="row">' + esc(String(err.message || err)) + '</div>';
  }
}

function approvalsFromDetail(detail) {
  if (!detail) return null;
  if (detail.approvals && detail.approvals.length) return detail.approvals;
  if (detail.approval) return [detail.approval];
  return null;
}

async function reloadActiveChat() {
  chatEl.innerHTML = '';
  const history = await api('/api/chat/history?limit=200');
  const messages = history.messages || (Array.isArray(history) ? history : []);
  if (history.conversation) activeConversationId = history.conversation.id;
  for (const m of messages) {
    addMsg(
      m.role === 'user' ? 'user' : 'funke',
      m.text,
      m.role === 'funke' ? cardsFromDetail(m.detail) : null,
      approvalsFromDetail(m.detail),
      m.id,
    );
  }
  document.getElementById('suggestions').style.display = messages.length ? 'none' : 'grid';
}

async function newConversation() {
  try {
    const c = await api('/api/conversations/new', 'POST', {});
    activeConversationId = c.id;
    chatEl.innerHTML = '';
    document.getElementById('suggestions').style.display = 'grid';
    addMsg('funke', 'New chat. I still remember your preferences and contacts unless you forget them under Social accounts.');
    loadConvList();
    showView('chat');
  } catch (err) {
    addMsg('funke', String(err.message || err));
  }
}

async function openConversation(id) {
  try {
    await api('/api/conversations/open', 'POST', { id });
    activeConversationId = id;
    await reloadActiveChat();
    closeDrawer();
    showView('chat');
  } catch (err) {
    addMsg('funke', String(err.message || err));
  }
}

async function renameConversation(id) {
  const title = window.prompt('Rename conversation');
  if (title == null) return;
  try {
    await api('/api/conversations/rename', 'POST', { id, title });
    loadConvList();
  } catch (err) {
    addMsg('funke', String(err.message || err));
  }
}

async function archiveConversation(id) {
  try {
    await api('/api/conversations/archive', 'POST', { id });
    if (id === activeConversationId) await newConversation();
    loadConvList();
  } catch (err) {
    addMsg('funke', String(err.message || err));
  }
}

async function unarchiveConversation(id) {
  try {
    await api('/api/conversations/unarchive', 'POST', { id });
    setConvTab(false);
    addMsg('funke', 'Restored that chat to Active history.');
    loadConvList();
  } catch (err) {
    addMsg('funke', String(err.message || err));
  }
}

async function exportConversation(id) {
  try {
    const data = await api('/api/conversations/export', 'POST', { id, format: 'md' });
    const blob = new Blob([data.body || ''], { type: data.contentType || 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = data.filename || ('funke-chat-' + id + '.md');
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    addMsg('funke', String(err.message || err));
  }
}

async function exportActiveChat() {
  if (!activeConversationId) {
    const history = await api('/api/chat/history?limit=1');
    if (history.conversation) activeConversationId = history.conversation.id;
  }
  if (!activeConversationId) return addMsg('funke', 'Nothing to export yet.');
  return exportConversation(activeConversationId);
}

async function deleteConversation(id) {
  try {
    let out = await api('/api/conversations/delete', 'POST', { id });
    if (out.needsConfirm) {
      const ok = window.confirm(
        (out.warning || 'Pending approvals stay in Approvals.') +
        '\\n\\nDelete this chat anyway? Approvals are not cancelled.',
      );
      if (!ok) return;
      out = await api('/api/conversations/delete', 'POST', { id, confirmPending: true });
    }
    let toast = out.warning || 'Chat deleted.';
    if (out.otherPendingCount > 0 && !(out.pendingApprovals && out.pendingApprovals.length)) {
      toast += ' Note: ' + out.otherPendingCount + ' other pending approval(s) remain in the Approvals tab.';
    }
    showUndoToast(out.undo && out.undo.token, toast);
    if (id === activeConversationId) await newConversation();
    loadConvList();
  } catch (err) {
    addMsg('funke', String(err.message || err));
  }
}

async function clearCurrentChat() {
  try {
    let out = await api('/api/conversations/clear', 'POST', { id: activeConversationId });
    if (out.needsConfirm) {
      const ok = window.confirm(
        (out.warning || 'Pending approvals stay.') +
        '\\n\\nClear messages anyway?',
      );
      if (!ok) return;
      out = await api('/api/conversations/clear', 'POST', {
        id: activeConversationId, confirmPending: true,
      });
    }
    showUndoToast(out.undo && out.undo.token, out.warning || 'Chat cleared.');
    await reloadActiveChat();
    if (!chatEl.children.length) {
      addMsg('funke', 'Chat cleared. Activity log and memory are unchanged.');
    }
  } catch (err) {
    addMsg('funke', String(err.message || err));
  }
}

async function deleteAllConversations() {
  const typed = window.prompt(
    'Delete ALL conversations? Type DELETE ALL to confirm.\\n\\n' +
    'Approvals, activity log, calendar, reminders, and memory stay. Undo is available for 10 seconds.',
  );
  if (typed == null) return;
  try {
    const out = await api('/api/conversations/delete-all', 'POST', { confirm: typed });
    showUndoToast(out.undo && out.undo.token, out.warning || 'All chats deleted.');
    await reloadActiveChat();
    loadConvList();
  } catch (err) {
    addMsg('funke', String(err.message || err));
  }
}

async function deleteMessage(id) {
  try {
    const out = await api('/api/messages/delete', 'POST', { id });
    showUndoToast(out.undo && out.undo.token, 'Message deleted. Activity log unchanged.');
    const el = document.querySelector('[data-msg-id=\"' + id + '\"]');
    if (el) el.remove();
  } catch (err) {
    addMsg('funke', String(err.message || err));
  }
}

async function loadMemoryPanel() {
  const panel = document.getElementById('memPanel');
  if (!panel) return;
  try {
    const rows = await api('/api/memory?limit=40');
    panel.innerHTML = (rows || []).length
      ? rows.map(r =>
        '<div class="row mem-row"><div><b>' + esc(r.scope) + '</b> · ' + esc(r.key) +
        (r.contact ? ' · ' + esc(r.contact) : '') +
        '<br>' + esc(r.value) + '</div>' +
        '<button type="button" onclick="forgetMemory(' + r.id + ')">Forget</button></div>'
      ).join('')
      : '<div class="row">Nothing stored yet.</div>';
  } catch (err) {
    panel.innerHTML = '<div class="row">' + esc(String(err.message || err)) + '</div>';
  }
}

async function forgetMemory(id) {
  try {
    await api('/api/memory/forget', 'POST', { id });
    loadMemoryPanel();
  } catch (err) {
    addMsg('funke', String(err.message || err));
  }
}

async function forgetAllMemory() {
  const typed = window.prompt(
    'Forget preferences and contacts Funke stored? Type FORGET ALL.\\n\\n' +
    'Chat history, approvals, and the activity log stay.',
  );
  if (typed == null) return;
  try {
    const out = await api('/api/memory/forget-all', 'POST', { confirm: typed });
    addMsg(
      'funke',
      'Forgot ' + (out.deleted || 0) + ' memory item(s). '
        + 'Ask "what do you remember about me?" and I should say I have nothing saved. '
        + 'Chat history and the activity log stay.',
    );
    loadMemoryPanel();
    showView('chat');
  } catch (err) {
    addMsg('funke', String(err.message || err));
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
  if (e.key === 'h' || e.key === 'H') {
    e.preventDefault();
    openDrawer();
  }
});

function approvalCardHtml(a) {
  return '<div class="draft" id="approval-' + a.id + '">' +
    '<b>Approval #' + a.id + ' · ' + esc(a.actionType || '') + '</b>' +
    '<p style="color:var(--mut);font-size:13px;margin:6px 0">' + esc(a.summary || a.title || '') + '</p>' +
    (a.preview ? '<p id="approval-preview-' + a.id + '">' + esc(a.preview) + '</p>' : '') +
    '<div class="next">' +
    '<button class="primary" onclick="decideApproval(' + a.id + ',\\'approved\\', this)">Approve</button>' +
    '<button onclick="editApproval(' + a.id + ')">Edit</button>' +
    '<button onclick="decideApproval(' + a.id + ',\\'rejected\\', this)">Reject</button>' +
    '</div></div>';
}

const decidingApprovals = new Set();
async function decideApproval(id, decision, btn) {
  if (decidingApprovals.has(id)) return;
  decidingApprovals.add(id);
  try {
    // Hard rule: only an on-screen click. Never decidedBy: 'voice'.
    if (btn) btn.disabled = true;
    document.querySelectorAll('#approval-' + id + ' button').forEach((b) => { b.disabled = true; });
    const previewEl = document.getElementById('approval-preview-' + id);
    const preview = previewEl && (previewEl.tagName === 'TEXTAREA' ? previewEl.value : previewEl.textContent);
    const data = await api('/api/approvals/decide', 'POST', {
      id, decision, decidedBy: 'dashboard', preview: preview || null,
    });
    if (btn) btn.textContent = decision === 'approved' ? 'Approved' : 'Rejected';
    addMsg('funke', data.reply || (decision === 'approved' ? 'Approved.' : 'Rejected.'));
    loadApprovalsPanel();
  } catch (err) {
    decidingApprovals.delete(id);
    document.querySelectorAll('#approval-' + id + ' button').forEach((b) => { b.disabled = false; });
    addMsg('funke', String(err.message || err));
  }
}

function editApproval(id) {
  const el = document.getElementById('approval-preview-' + id);
  if (!el) return;
  if (el.tagName === 'TEXTAREA') return;
  const area = document.createElement('textarea');
  area.id = 'approval-preview-' + id;
  area.value = el.textContent || '';
  el.replaceWith(area);
}

function showView(name) {
  const chat = document.getElementById('view-chat');
  if (chat) chat.style.display = name === 'chat' ? 'block' : 'none';
  document.getElementById('view-cal').classList.toggle('open', name === 'cal');
  document.getElementById('view-acc').classList.toggle('open', name === 'acc');
  document.getElementById('view-pipe').classList.toggle('open', name === 'pipe');
  document.getElementById('view-appr').classList.toggle('open', name === 'appr');
  document.getElementById('suggestions').style.display = name === 'chat' && chatEl.children.length <= 1 ? 'grid' : 'none';
  for (const id of ['chat','cal','acc','pipe','appr']) {
    document.getElementById('tab-' + id)?.classList.toggle('active', id === name);
  }
  if (name === 'pipe') showPipeline(false);
  if (name === 'appr') { loadApprovalsPanel(); loadAudit(); loadAlerts(); }
  if (name === 'acc') { loadMemoryPanel(); loadVoiceSettingsUi(); loadContextUi(); loadReplyStyleUi(); }
}

function promptAsk(text) {
  document.getElementById('askBox').value = text;
  showView('chat');
  ask();
}

function cardsFromDetail(detail) {
  const c = detail && detail.cards;
  if (!c) return [];
  // Focused meeting answers already list times in the reply; skip duplicate cards.
  if (detail.focus === 'meetings') return [];
  const out = [];
  for (const e of (c.events || []).slice(0, 4)) out.push({ title: e.title, sub: e.when });
  for (const r of (c.reminders || []).slice(0, 3)) out.push({ title: r.title, sub: 'Reminder · ' + r.when });
  for (const f of (c.followups || []).slice(0, 3)) out.push({ title: f.who, sub: f.what + (f.when ? ' · ' + f.when : '') });
  return out;
}

let asking = false;
async function ask() {
  const box = document.getElementById('askBox');
  const btn = document.getElementById('askBtn');
  const text = box.value.trim();
  if (!text || asking) return;
  asking = true;
  document.getElementById('suggestions').style.display = 'none';
  addMsg('user', text);
  box.value = '';
  autoSize(box);
  btn.disabled = true;
  chatEl.setAttribute('aria-busy', 'true');
  setVoiceStatus('Working…');
  try {
    if (convMode) setConvState('thinking');
    const data = await api('/api/ask', 'POST', { text });
    const approvals = (data.detail && (data.detail.approvals || (data.detail.approval ? [data.detail.approval] : []))) || [];
    const prevSpeak = speakOn;
    speakOn = false;
    await reloadActiveChat();
    speakOn = prevSpeak;
    const last = chatEl.lastElementChild;
    if (data.reply && (speakOn || convMode)) {
      try { await speakReply(data.reply, !!approvals.length, last); }
      catch (_) {}
    } else if (convMode) {
      setConvState('listening');
    }
    refreshPanels();
    if (approvals.length) loadApprovalsPanel();
    setVoiceStatus('');
    const chip = document.getElementById('txChipHost');
    if (chip) chip.innerHTML = '';
  } catch (err) {
    addMsg('funke', String(err.message || err));
    setVoiceStatus('');
    if (convMode) setConvState('listening');
  } finally {
    asking = false;
    btn.disabled = false;
    chatEl.removeAttribute('aria-busy');
  }
}

function autoSize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(120, el.scrollHeight) + 'px';
}
const askBox = document.getElementById('askBox');
askBox.addEventListener('input', () => autoSize(askBox));
askBox.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    ask();
  }
});

async function useSavedVoice() {
  showView('chat');
  document.getElementById('suggestions').style.display = 'none';
  addMsg('user', 'Use my saved voice.');
  addMsg('funke', 'Using the voice I already saved. I am not opening LinkedIn or Twitter.');
  try {
    const data = await api('/api/voice/learn', 'POST', {});
    const cards = (data.drafts || []).slice(0, 4).map(d => ({
      title: (d.platform === 'twitter' ? 'Twitter' : 'LinkedIn') + (d.imageBrief ? ' · with image idea' : ''),
      sub: d.preview,
    }));
    addMsg('funke', data.reply || data.summary || 'Voice saved.', cards);
    addNextStep();
  } catch (err) {
    addMsg('funke', String(err.message || err));
  }
}

async function refreshVoice() {
  showView('chat');
  document.getElementById('suggestions').style.display = 'none';
  addMsg('user', 'Refresh my voice from LinkedIn and Twitter.');
  addMsg('funke', 'Opening your logged-in pages again. This can take a minute. I will draft posts, not publish them.');
  try {
    const data = await api('/api/voice/refresh', 'POST', {});
    const cards = (data.drafts || []).slice(0, 4).map(d => ({
      title: (d.platform === 'twitter' ? 'Twitter' : 'LinkedIn') + (d.imageBrief ? ' · with image idea' : ''),
      sub: d.preview,
    }));
    addMsg('funke', data.reply || data.summary || 'Voice saved.', cards);
    addNextStep();
  } catch (err) {
    addMsg('funke', String(err.message || err));
  }
}

function addNextStep() {
  const div = document.createElement('div');
  div.className = 'msg funke';
  div.innerHTML =
    '<div class="who">Funke</div>' +
    'Voice is saved. Do you want to approve the drafts for page management, or start the management engine?' +
    '<div class="next">' +
    '<button class="primary" onclick="reviewDrafts()">Approve page management</button>' +
    '<button onclick="showPipeline(true)">Show stages</button>' +
    '<button onclick="startEngine()">Start management engine</button>' +
    '<button onclick="refreshVoice()">Re-read my LinkedIn and Twitter (opens browsers)</button>' +
    '</div>';
  chatEl.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function platformLabel(platform) {
  return platform === 'x' ? 'Twitter' : platform === 'linkedin' ? 'LinkedIn' : platform;
}

function stageHtml(pipe) {
  const s = pipe.stages || {};
  const active = pipe.stage || '';
  const cells = [
    ['drafted', 'Drafts', s.drafted || 0, active === 'awaiting_approval'],
    ['queued', 'Queued', s.queued || 0, active === 'publishing_queue'],
    ['published', 'Live', s.published || 0, active === 'idle_after_publish'],
    ['blocked', 'Blocked', (s.blocked || 0) + (s.failed || 0), false],
  ];
  return '<div class="stages">' + cells.map(c =>
    '<div class="stage' + (c[3] ? ' active' : '') + '"><strong>' + c[2] + '</strong><span>' + c[1] + '</span></div>'
  ).join('') + '</div>' +
    '<p class="stage-label">' + esc(pipe.stageLabel || '') +
    (pipe.engine?.running ? ' Engine is on.' : ' Engine is off.') +
    (pipe.engine?.paused ? ' Paused.' : '') + '</p>';
}

async function showPipeline(inChat) {
  if (inChat === true) showView('chat');
  let pipe;
  try {
    pipe = await api('/api/content/pipeline');
  } catch (err) {
    if (inChat === true) addMsg('funke', String(err.message || err));
    return;
  }
  const panel = document.getElementById('pipePanel');
  if (panel) {
    panel.innerHTML =
      stageHtml(pipe) +
      '<h3 style="margin-top:14px">Waiting for approval</h3>' +
      ((pipe.waiting || []).map(c =>
        '<div class="row"><b>#' + c.id + ' · ' + esc(platformLabel(c.platform)) + ' · ' + esc(c.state) + '</b><br>' + esc(c.preview) +
        '<div class="ops" style="margin-top:6px">' +
        '<button onclick="showView(\\'chat\\'); reviewDrafts(true)">Open approvals</button>' +
        '</div></div>'
      ).join('') || '<div class="row">No drafts waiting.</div>') +
      '<h3 style="margin-top:14px">Queued</h3>' +
      ((pipe.queued || []).map(c =>
        '<div class="row"><b>#' + c.id + ' · ' + esc(platformLabel(c.platform)) + '</b><br>' + esc(c.preview) + '</div>'
      ).join('') || '<div class="row">Nothing queued.</div>');
  }
  if (inChat !== true) return;
  const div = document.createElement('div');
  div.className = 'msg funke';
  div.innerHTML =
    '<div class="who">Funke</div>Here is where page management is right now.' +
    stageHtml(pipe) +
    '<div class="next">' +
    '<button class="primary" onclick="reviewDrafts(true)">Refresh approvals</button>' +
    '<button onclick="showPipeline(true)">Refresh stages</button>' +
    '<button onclick="startEngine()">Start management engine</button>' +
    '</div>';
  chatEl.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

async function reviewDrafts(mode) {
  showView('chat');
  if (mode === true) addMsg('user', 'Refresh the approval list.');
  let rows = [];
  let pipe = null;
  try {
    [rows, pipe] = await Promise.all([
      api('/api/content?limit=80'),
      api('/api/content/pipeline'),
    ]);
  } catch (err) {
    addMsg('funke', String(err.message || err));
    return;
  }
  let drafts = (rows || []).filter(c => c.state === 'drafted' || c.state === 'blocked');
  // Show the exact final text before Approve. Prep never runs after Approve.
  for (const c of drafts.slice(0, 12)) {
    try {
      const prep = await api('/api/content/prepare', 'POST', { id: c.id });
      if (prep.content) Object.assign(c, prep.content);
      c._prepNote = prep.note || '';
      c._prepChanged = !!prep.changed;
      c._gate = prep.gate;
    } catch (_) { /* keep original body */ }
  }
  const existing = document.getElementById('approval-board');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.className = 'msg funke';
  div.id = 'approval-board';
  if (!drafts.length) {
    div.innerHTML =
      '<div class="who">Funke</div>There are no drafts waiting right now.' +
      stageHtml(pipe) +
      '<div class="next">' +
      '<button onclick="reviewDrafts(true)">Refresh approvals</button>' +
      '<button onclick="showPipeline(true)">Show stages</button>' +
      '<button onclick="useSavedVoice()">Use saved voice</button>' +
      '</div>';
    chatEl.appendChild(div);
    div.scrollIntoView({ behavior: 'smooth', block: 'end' });
    return;
  }
  div.innerHTML =
    '<div class="who">Funke</div>' +
    (mode ? 'Fresh list. ' : '') +
    'This is the final text that will post. Approve queues it as shown. Edit if you want to change it first. Skip drops it.' +
    stageHtml(pipe) +
    drafts.slice(0, 12).map(c => {
      const label = platformLabel(c.platform);
      const prepNote = c._prepChanged && c._prepNote
        ? '<p style="color:var(--mut);font-size:13px;margin:0 0 8px">' + esc(c._prepNote) + '</p>'
        : '';
      const gateNote = c._gate && !c._gate.pass
        ? '<p style="color:#a33;font-size:13px;margin:0 0 8px">Gate: ' + esc((c._gate.violations || []).join(' | ')) + '</p>'
        : '';
      return '<div class="draft" id="draft-' + c.id + '">' +
        '<b>#' + c.id + ' · ' + esc(label) + ' · ' + esc(c.state) + '</b>' +
        prepNote + gateNote +
        '<p id="draft-body-' + c.id + '">' + esc(String(c.body || '')) + '</p>' +
        '<div class="next" id="draft-actions-' + c.id + '">' +
        '<button class="primary" onclick="setDraft(' + c.id + ',\\'queued\\', this)">Approve</button>' +
        '<button onclick="editDraft(' + c.id + ')">Edit</button>' +
        '<button onclick="setDraft(' + c.id + ',\\'skipped\\', this)">Skip</button>' +
        '</div></div>';
    }).join('') +
    '<div class="next">' +
    '<button onclick="reviewDrafts(true)">Refresh approvals</button>' +
    '<button onclick="showPipeline(true)">Show stages</button>' +
    '<button onclick="startEngine()">Start management engine</button>' +
    '</div>';
  chatEl.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function editDraft(id) {
  const bodyEl = document.getElementById('draft-body-' + id);
  const actions = document.getElementById('draft-actions-' + id);
  if (!bodyEl || !actions) return;
  const current = bodyEl.value != null && bodyEl.tagName === 'TEXTAREA' ? bodyEl.value : (bodyEl.textContent || '');
  const area = document.createElement('textarea');
  area.id = 'draft-body-' + id;
  area.value = current;
  bodyEl.replaceWith(area);
  actions.innerHTML =
    '<button class="primary" onclick="saveDraft(' + id + ')">Save edit</button>' +
    '<button onclick="reviewDrafts(\\'reload\\')">Cancel</button>';
}

async function saveDraft(id) {
  const box = document.getElementById('draft-body-' + id);
  if (!box) return;
  const text = box.value;
  try {
    const data = await api('/api/content/body', 'POST', { id, body: text });
    addMsg('funke', data.note || 'Saved.');
    await reviewDrafts(true);
  } catch (err) {
    addMsg('funke', String(err.message || err));
  }
}

async function setDraft(id, state, btn) {
  try {
    if (state === 'queued') {
      const card = await api('/api/approvals/ensure-content', 'POST', { contentId: id });
      const data = await api('/api/approvals/decide', 'POST', {
        id: card.id, decision: 'approved', decidedBy: 'dashboard', preview: card.preview,
      });
      if (btn) { btn.disabled = true; btn.textContent = 'Approved'; }
      addMsg('funke', data.reply || 'Approved and queued.');
    } else {
      await api('/api/content/state', 'POST', { id, state });
      if (btn) { btn.disabled = true; btn.textContent = 'Skipped'; }
    }
    const wrap = document.getElementById('draft-' + id);
    if (wrap) {
      const actions = document.getElementById('draft-actions-' + id);
      if (actions) Array.from(actions.querySelectorAll('button')).forEach(b => { b.disabled = true; });
    }
    showPipeline(false);
    loadApprovalsPanel();
  } catch (err) {
    addMsg('funke', String(err.message || err));
    if (String(err.message || err).includes('Refresh approvals') || String(err.message || err).includes('final text')) {
      await reviewDrafts('reload');
    }
  }
}

async function loadApprovalsPanel() {
  const panel = document.getElementById('apprPanel');
  if (!panel) return;
  try {
    const rows = await api('/api/approvals');
    panel.innerHTML = (rows || []).length
      ? rows.map(a =>
          '<div class="row"><b>#' + a.id + ' · ' + esc(a.actionType) + '</b><br>' +
          esc(a.summary || a.title) +
          (a.preview ? '<pre style="white-space:pre-wrap;font:inherit;margin:8px 0 0">' + esc(a.preview) + '</pre>' : '') +
          '<div class="ops" style="margin-top:8px">' +
          '<button class="primary" onclick="decideApproval(' + a.id + ',\\'approved\\')">Approve</button>' +
          '<button onclick="decideApproval(' + a.id + ',\\'rejected\\')">Reject</button>' +
          '<button onclick="showView(\\'chat\\')">Open in chat</button>' +
          '</div></div>'
        ).join('')
      : '<div class="row">Nothing waiting for approval.</div>';
  } catch (err) {
    panel.innerHTML = '<div class="row">' + esc(String(err.message || err)) + '</div>';
  }
}

async function loadAudit() {
  const panel = document.getElementById('auditPanel');
  if (!panel) return;
  const q = (document.getElementById('auditQ') && document.getElementById('auditQ').value) || '';
  try {
    const rows = await api('/api/audit?limit=40' + (q ? '&q=' + encodeURIComponent(q) : ''));
    panel.innerHTML = (rows || []).map(r =>
      '<div class="row"><b>' + esc(r.action_type) + ' · ' + esc(r.result) + '</b><br>' +
      esc(r.input_summary) +
      (r.approved_by ? '<br><span style="color:var(--mut)">by ' + esc(r.approved_by) + '</span>' : '') +
      '</div>'
    ).join('') || '<div class="row">No audit events yet.</div>';
  } catch (err) {
    panel.innerHTML = '<div class="row">' + esc(String(err.message || err)) + '</div>';
  }
}

async function startEngine() {
  const ok = window.confirm(
    'Start the social engine?\\n\\n' +
    'It can publish queued posts and act on LinkedIn/X from this machine.\\n' +
    'Automating those platforms can violate their terms and risk account limits or bans.\\n\\n' +
    'Outreach and feed engagement stay off unless enabled in .env.\\n' +
    'Press OK only if you accept that risk.',
  );
  if (!ok) {
    addMsg('funke', 'Okay. I left the social engine off.');
    return;
  }
  try {
    const status = await api('/api/engine/start', 'POST', {});
    addMsg('funke', status.running
      ? 'Management engine is on. It will only publish drafts you have approved and queued, and only inside your rate limits. Outreach and feed engagement stay off unless you enable them in .env.'
      : 'I asked the engine to start. Check the status badge if it does not show as on.');
    await showPipeline(true);
    refreshPanels();
  } catch (err) {
    addMsg('funke', String(err.message || err));
  }
}

async function connectGoogle() {
  try {
    const data = await api('/api/google/start');
    if (data.url) window.location.href = data.url;
  } catch (err) {
    showView('chat');
    addMsg('funke', String(err.message || err));
  }
}

async function refreshPanels() {
  try {
    const [health, limits, va] = await Promise.all([
      api('/api/health'), api('/api/limits'), api('/api/va/status'),
    ]);
    const google = va.google || {};
    const running = !!health.engine?.running;
    const eng = running ? 'engine on' : 'engine off (scheduled posts wait until you start it)';
    const dot = document.getElementById('liveDot');
    if (dot) {
      dot.classList.toggle('on', running);
      dot.classList.toggle('off', !running);
    }
    document.getElementById('liveStatus').textContent =
      (google.connected ? 'Google connected · ' : '') + eng + ' · ' + (va.homeTimezone || '');

    document.getElementById('calPanel').innerHTML =
      ((va.events || []).map(e => '<div class="row"><b>' + esc(e.title) + '</b><br>' + esc(e.start_at) + (e.source_tz ? ' · from ' + esc(e.source_tz) : '') + '</div>').join('') || '<div class="row">No events yet.</div>') +
      '<h3 style="margin-top:16px">Reminders</h3>' +
      ((va.reminders || []).filter(r => r.state === 'scheduled').map(r => '<div class="row"><b>' + esc(r.title) + '</b><br>' + esc(r.due_at) + '</div>').join('') || '<div class="row">No reminders.</div>');

    document.getElementById('accPanel').innerHTML = (limits.usage || []).map(a => {
      const label = a.account === 'twitter' ? 'Twitter / X' : a.account === 'linkedin' ? 'LinkedIn' : a.account;
      return '<div class="row"><b>' + esc(label) + '</b> · ' + esc(a.status) + '</div>';
    }).join('') || '<div class="row">No accounts connected.</div>';
  } catch (_) {}
}

async function loadAlerts() {
  const panel = document.getElementById('alertsPanel');
  if (!panel) return;
  try {
    const rows = await api('/api/alerts?scan=1');
    panel.innerHTML = (rows || []).map(a =>
      '<div class="row"><b>' + esc(a.kind) + '</b><br>' + esc(a.message) +
      ' <button onclick="ackAlert(' + a.id + ')">Ack</button></div>'
    ).join('') || '<div class="row">No open alerts.</div>';
  } catch (err) {
    panel.innerHTML = '<div class="row">' + esc(err.message || err) + '</div>';
  }
}

async function ackAlert(id) {
  try {
    await api('/api/alerts/ack', 'POST', { id });
    loadAlerts();
  } catch (err) {
    addMsg('funke', String(err.message || err));
  }
}

async function loadSummary() {
  const panel = document.getElementById('summaryPanel');
  if (!panel) return;
  try {
    const data = await api('/api/va/summary');
    const text = (data.current && data.current.text) || (data.last && data.last.text) || 'No summary yet.';
    panel.innerHTML = '<div class="row" style="white-space:pre-wrap">' + esc(text) + '</div>';
  } catch (err) {
    panel.innerHTML = '<div class="row">' + esc(err.message || err) + '</div>';
  }
}

function setVoiceStatus(text, rec) {
  const el = document.getElementById('voiceStatus');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('rec', !!rec);
}

function setConvState(state) {
  convState = state;
  const bar = document.getElementById('convBar');
  const label = document.getElementById('convStateLabel');
  if (!bar || !label) return;
  if (!convMode) { bar.classList.remove('open'); return; }
  bar.classList.add('open');
  const map = { listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', paused: 'Paused', idle: 'Ready' };
  label.textContent = map[state] || state;
}

function toggleSpeak() {
  speakOn = !speakOn;
  localStorage.setItem('funkeSpeak', speakOn ? '1' : '0');
  syncSpeakBtn();
  if (!speakOn) stopSpeaking();
}

function syncSpeakBtn() {
  const btn = document.getElementById('speakBtn');
  if (!btn) return;
  btn.classList.toggle('on', speakOn);
  btn.title = speakOn ? 'Stop reading aloud' : 'Read replies aloud';
  btn.setAttribute('aria-pressed', speakOn ? 'true' : 'false');
}

function stopSpeaking() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (azureAudio) { try { azureAudio.pause(); } catch (_) {} azureAudio = null; }
}

function rankVoice(name, lang) {
  const n = (name + ' ' + lang).toLowerCase();
  let s = 0;
  if (/en-ng|nigeria/.test(n)) s += 100;
  if (/ezinne/.test(n)) s += 90;
  if (/abeo/.test(n)) s -= 60;
  if (/female|woman|girl|ezinne|samantha|karen|moira|fiona|tessa|veena|raveena|zira|susan|hazel|serena|aria|jenny|sara|emma|ava|allison|kathy|victoria|martha|helen|catherine|sonia|lekha|neerja/.test(n)) s += 55;
  if (/male|\bman\b|boy|abeo|daniel|david|fred|jorge|thomas|mark|george|james|ravi|sean|alex(?!a)|tom\b|lee\b/.test(n)) s -= 45;
  if (/en-gb/.test(n)) s += 18;
  else if (/en-za|en-in|en-au|en-ie/.test(n)) s += 12;
  else if (/en-us/.test(n)) s += 8;
  if (/natural|neural|online|premium|enhanced/.test(n)) s += 8;
  return s;
}

function browserVoicesSorted() {
  if (!window.speechSynthesis) return [];
  return speechSynthesis.getVoices().slice().sort((a, b) =>
    rankVoice(b.name, b.lang) - rankVoice(a.name, a.lang));
}

function fillVoiceSelect() {
  const sel = document.getElementById('ttsVoiceSel');
  const prov = document.getElementById('ttsProviderSel');
  if (!sel || !prov) return;
  prov.value = voiceSettings.provider === 'azure' ? 'azure' : 'browser';
  sel.innerHTML = '';
  if (prov.value === 'azure') {
    [['en-NG-EzinneNeural', 'Ezinne (female, NG)'], ['en-NG-AbeoNeural', 'Abeo (male, NG)']].forEach(([v, label]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = label;
      if (v === voiceSettings.azureVoice) o.selected = true;
      sel.appendChild(o);
    });
  } else {
    const voices = browserVoicesSorted();
    if (!voices.length) {
      const o = document.createElement('option');
      o.value = ''; o.textContent = 'No browser voices yet (try Edge for en-NG)';
      sel.appendChild(o);
    }
    voices.forEach((v) => {
      const o = document.createElement('option');
      o.value = v.voiceURI;
      o.textContent = v.name + ' (' + v.lang + ')';
      if (v.voiceURI === voiceSettings.voiceURI) o.selected = true;
      sel.appendChild(o);
    });
    if (!voiceSettings.voiceURI && voices[0]) {
      voiceSettings.voiceURI = voices[0].voiceURI;
      sel.value = voices[0].voiceURI;
    }
  }
  const rate = document.getElementById('ttsRate');
  const rateLab = document.getElementById('ttsRateLabel');
  if (rate) rate.value = String(voiceSettings.rate);
  if (rateLab) rateLab.textContent = Number(voiceSettings.rate).toFixed(2);
  const note = document.getElementById('ttsPrivacyNote');
  if (note) {
    note.textContent = prov.value === 'azure'
      ? ((ttsInfo.azure && ttsInfo.azure.note) || 'Azure sends text to Microsoft Speech.')
      : 'Browser TTS keeps text on this device when using local voices. Prefer Edge for female Nigerian English (Ezinne).';
  }
}

function saveVoiceSettings() {
  const prov = document.getElementById('ttsProviderSel');
  const sel = document.getElementById('ttsVoiceSel');
  const rate = document.getElementById('ttsRate');
  if (prov) voiceSettings.provider = prov.value;
  if (sel) {
    if (voiceSettings.provider === 'azure') voiceSettings.azureVoice = sel.value;
    else voiceSettings.voiceURI = sel.value;
  }
  if (rate) {
    voiceSettings.rate = Number(rate.value) || 1;
    const rateLab = document.getElementById('ttsRateLabel');
    if (rateLab) rateLab.textContent = voiceSettings.rate.toFixed(2);
  }
  localStorage.setItem('funkeTtsProvider', voiceSettings.provider);
  localStorage.setItem('funkeTtsVoice', voiceSettings.voiceURI || '');
  localStorage.setItem('funkeAzureVoice', voiceSettings.azureVoice || '');
  localStorage.setItem('funkeTtsRate', String(voiceSettings.rate));
  fillVoiceSelect();
}

async function loadVoiceSettingsUi() {
  try { ttsInfo = await api('/api/voice/tts'); } catch (_) {}
  if (ttsInfo.provider === 'azure' && !localStorage.getItem('funkeTtsProvider')) {
    voiceSettings.provider = 'azure';
  }
  fillVoiceSelect();
  if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => fillVoiceSelect();
}

async function loadVocabPanel() {
  const panel = document.getElementById('vocabPanel');
  if (!panel) return;
  try {
    const data = await api('/api/voice/vocab');
    vocabTerms = (data.terms || []).map((t) => t.term);
    panel.innerHTML = '<b>Vocabulary</b> (STT hints + TTS pronunciation)<br>' +
      (data.terms || []).slice(0, 40).map((t) =>
        esc(t.term) + (t.pronunciation ? ' · ' + esc(t.pronunciation) : '')
      ).join(' · ') +
      '<div class="ops" style="margin-top:8px"><button type="button" onclick="addVocabTerm()">Add term</button></div>';
  } catch (err) {
    panel.innerHTML = esc(String(err.message || err));
  }
}

async function addVocabTerm() {
  const term = window.prompt('Word or name to recognize (e.g. Adaeze)');
  if (!term) return;
  const pronunciation = window.prompt('Optional pronunciation for speech', '') || '';
  try {
    await api('/api/voice/vocab', 'POST', { term, pronunciation: pronunciation || null, kind: 'term' });
    loadVocabPanel();
  } catch (err) {
    addMsg('funke', String(err.message || err));
  }
}

async function previewVoice() {
  speakOn = true;
  syncSpeakBtn();
  await speakReply('Hi, I am Funke. Ikeja, Lekki, and Yaba are in Lagos. Fifty thousand naira at three p.m.', false);
}

function attachSpokenCaption(msgEl, spoken, isSummary) {
  if (!msgEl || !spoken) return null;
  let cap = msgEl.querySelector('.spoken-caption');
  if (!cap) {
    cap = document.createElement('div');
    cap.className = 'spoken-caption';
    msgEl.appendChild(cap);
  }
  const parts = spoken.split(/(\\s+)/);
  cap.innerHTML = (isSummary ? '<b>Spoken</b> ' : '') +
    parts.map((w) =>
      /^\\s+$/.test(w) ? w : '<span class="karaoke-word">' + esc(w) + '</span>'
    ).join('');
  return cap;
}

async function speakReply(text, hasApproval, msgEl) {
  if (!speakOn && !convMode) return;
  stopSpeaking();
  if (convMode) setConvState('speaking');
  let prepared;
  try {
    prepared = await api('/api/voice/prepare', 'POST', { text, hasApproval: !!hasApproval });
  } catch (_) {
    prepared = { spoken: String(text || ''), isSummary: false, sentences: [String(text || '')] };
  }
  const spoken = prepared.spoken || '';
  if (!spoken) { if (convMode) setConvState('listening'); return; }
  const cap = attachSpokenCaption(msgEl || chatEl.lastElementChild, spoken, prepared.isSummary);
  const useAzure = voiceSettings.provider === 'azure' && ttsInfo.azure && ttsInfo.azure.configured;
  if (useAzure) {
    try {
      const data = await api('/api/voice/speak', 'POST', {
        text, hasApproval: !!hasApproval,
        voice: voiceSettings.azureVoice,
        rate: String(voiceSettings.rate),
      });
      const bin = atob(data.audioBase64 || '');
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const blob = new Blob([arr], { type: data.mimeType || 'audio/mpeg' });
      azureAudio = new Audio(URL.createObjectURL(blob));
      azureAudio.onended = () => { if (convMode) afterSpeakDone(); };
      await azureAudio.play();
      return;
    } catch (err) {
      setVoiceStatus(String(err.message || err));
    }
  }
  if (!window.speechSynthesis) { if (convMode) afterSpeakDone(); return; }
  const sentences = (prepared.sentences && prepared.sentences.length) ? prepared.sentences : [spoken];
  let idx = 0;
  const speakNext = () => {
    if (idx >= sentences.length) { afterSpeakDone(); return; }
    const u = new SpeechSynthesisUtterance(sentences[idx++]);
    // Default cadence is a touch slower than 1.0 so Funke sounds measured, not rushed.
    u.rate = voiceSettings.rate || 0.94;
    u.pitch = 1.08;
    u.lang = 'en-NG';
    const voices = browserVoicesSorted();
    const match = voices.find((v) => v.voiceURI === voiceSettings.voiceURI) || voices[0];
    if (match) u.voice = match;
    u.onboundary = (ev) => {
      if (!cap || ev.name !== 'word') return;
      const spans = cap.querySelectorAll('.karaoke-word');
      const progress = Math.min(spans.length - 1, Math.floor(((ev.charIndex || 0) / Math.max(spoken.length, 1)) * spans.length));
      spans.forEach((sp, i) => sp.classList.toggle('on', i <= progress));
    };
    u.onend = speakNext;
    u.onerror = () => afterSpeakDone();
    speechSynthesis.speak(u);
  };
  speakNext();
}

function afterSpeakDone() {
  if (convMode) {
    setConvState('listening');
    convSpeechStarted = false;
    convQuietSince = 0;
    convLastVoiceAt = Date.now();
  }
}

function putTranscript(text, words) {
  const box = document.getElementById('askBox');
  if (!box) return;
  box.value = text;
  autoSize(box);
  box.focus();
  lastTxWords = words || null;
  renderTranscriptChip(text, words);
  setVoiceStatus('Transcript ready. Tap underlined words to correct. Voice cannot approve.');
}

function renderTranscriptChip(text, words) {
  let host = document.getElementById('txChipHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'txChipHost';
    const wrap = document.querySelector('.composer-wrap');
    if (wrap) wrap.insertBefore(host, wrap.firstChild);
  }
  if (!words || !words.length) { host.innerHTML = ''; return; }
  host.innerHTML = '<div class="tx-chip" id="txChip"></div>';
  const chip = document.getElementById('txChip');
  words.forEach((w, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'word' + (w.lowConfidence ? ' low' : '');
    b.textContent = w.word;
    b.onclick = (ev) => openTxSuggest(ev, i, w.word);
    chip.appendChild(b);
  });
}

function openTxSuggest(ev, index, word) {
  const tip = document.getElementById('txSuggest');
  if (!tip) return;
  const suggestions = suggestLocal(word);
  tip.innerHTML = '<div style="font-size:12px;color:var(--mut);margin-bottom:6px">Replace ' + esc(word) + '</div>' +
    suggestions.map((s) => '<button type="button" role="option">' + esc(s) + '</button>').join('') +
    '<button type="button" id="txCustom">Type correction…</button>' +
    '<button type="button" id="txAddVocab">Add to vocabulary</button>';
  tip.classList.add('open');
  const r = ev.target.getBoundingClientRect();
  tip.style.left = Math.min(window.innerWidth - 280, r.left) + 'px';
  tip.style.top = (r.bottom + 6 + windowY) + 'px';
  tip.querySelectorAll('button[role="option"]').forEach((btn) => {
    btn.onclick = () => applyTxCorrection(index, btn.textContent);
  });
  const custom = document.getElementById('txCustom');
  if (custom) custom.onclick = () => {
    const v = window.prompt('Correction', word);
    if (v) applyTxCorrection(index, v);
  };
  const add = document.getElementById('txAddVocab');
  if (add) add.onclick = async () => {
    try {
      await api('/api/voice/vocab', 'POST', { term: word, kind: 'term' });
      tip.classList.remove('open');
      loadVocabPanel();
    } catch (err) { setVoiceStatus(String(err.message || err)); }
  };
}

function suggestLocal(word) {
  const t = word.toLowerCase().replace(/[^a-z0-9']/g, '');
  const scored = vocabTerms.map((v) => {
    const vl = v.toLowerCase();
    let score = 0;
    if (vl === t) score = 100;
    else if (vl.startsWith(t) || t.startsWith(vl)) score = 80;
    else if (vl.includes(t) || t.includes(vl)) score = 50;
    else if (Math.abs(vl.length - t.length) <= 2) score = 30;
    return { v, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const out = scored.slice(0, 5).map((x) => x.v);
  if (!out.length) out.push(word);
  return out;
}

function applyTxCorrection(index, replacement) {
  document.getElementById('txSuggest')?.classList.remove('open');
  if (!lastTxWords || !lastTxWords[index]) return;
  lastTxWords[index] = Object.assign({}, lastTxWords[index], { word: replacement, lowConfidence: false });
  const text = lastTxWords.map((w) => w.word).join(' ');
  putTranscript(text, lastTxWords);
  if (window.confirm('Add "' + replacement + '" to vocabulary for next time?')) {
    api('/api/voice/vocab', 'POST', { term: replacement, kind: 'term' }).then(() => loadVocabPanel());
  }
}

function pickRecorderMime() {
  const canType = typeof MediaRecorder !== 'undefined'
    && typeof MediaRecorder.isTypeSupported === 'function';
  if (canType && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (canType && MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  if (canType && MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  return '';
}

function beginUtteranceRecording() {
  if (!convStream || (convMediaRecorder && convMediaRecorder.state === 'recording')) return;
  convRecChunks = [];
  const mime = pickRecorderMime();
  try {
    convMediaRecorder = mime
      ? new MediaRecorder(convStream, { mimeType: mime })
      : new MediaRecorder(convStream);
  } catch (_) {
    convMediaRecorder = new MediaRecorder(convStream);
  }
  convMediaRecorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size) convRecChunks.push(ev.data);
  };
  try { convMediaRecorder.start(); } catch (_) { convMediaRecorder = null; }
}

function endUtteranceRecording() {
  return new Promise((resolve) => {
    const rec = convMediaRecorder;
    if (!rec || rec.state === 'inactive') {
      resolve(null);
      return;
    }
    rec.onstop = () => {
      const type = rec.mimeType || pickRecorderMime() || 'audio/webm';
      const blob = new Blob(convRecChunks.slice(), { type });
      convRecChunks = [];
      convMediaRecorder = null;
      resolve(blob.size >= 800 ? blob : null);
    };
    try { rec.stop(); } catch (_) {
      convMediaRecorder = null;
      resolve(null);
    }
  });
}

async function toggleConversationMode() {
  if (convMode) { stopConversationMode(); return; }
  convMode = true;
  speakOn = true;
  syncSpeakBtn();
  const btn = document.getElementById('convBtn');
  if (btn) { btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true'); }
  setConvState('listening');
  setVoiceStatus('Conversation mode on. Speak naturally. Voice cannot approve.');
  try {
    convStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    // VAD only while idle. Each utterance gets its own MediaRecorder so the
    // WebM/MP4 file includes a valid header (mid-stream chunks break Groq).
    convMediaRecorder = null;
    convRecChunks = [];
    convAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (convAudioCtx.state === 'suspended') await convAudioCtx.resume();
    const src = convAudioCtx.createMediaStreamSource(convStream);
    convAnalyser = convAudioCtx.createAnalyser();
    convAnalyser.fftSize = 2048;
    src.connect(convAnalyser);
    convLastVoiceAt = Date.now();
    convIdleSince = Date.now();
    convSpeechStarted = false;
    convLoop();
  } catch (err) {
    stopConversationMode();
    setVoiceStatus(/Permission|NotAllowed|denied/i.test(String(err.message || err))
      ? 'Mic permission denied for conversation mode.'
      : String(err.message || err));
  }
}

function stopConversationMode() {
  convMode = false;
  setConvState('idle');
  document.getElementById('convBar')?.classList.remove('open');
  const btn = document.getElementById('convBtn');
  if (btn) { btn.classList.remove('on'); btn.setAttribute('aria-pressed', 'false'); }
  if (convRaf) cancelAnimationFrame(convRaf);
  convRaf = 0;
  try { if (convMediaRecorder && convMediaRecorder.state !== 'inactive') convMediaRecorder.stop(); } catch (_) {}
  convMediaRecorder = null;
  convRecChunks = [];
  if (convStream) { convStream.getTracks().forEach((t) => t.stop()); convStream = null; }
  if (convAudioCtx) { try { convAudioCtx.close(); } catch (_) {} convAudioCtx = null; }
  convAnalyser = null;
  stopSpeaking();
  setVoiceStatus('Conversation mode off.');
}

function convRms() {
  if (!convAnalyser) return 0;
  const data = new Uint8Array(convAnalyser.fftSize);
  convAnalyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

function convLoop() {
  if (!convMode) return;
  convRaf = requestAnimationFrame(convLoop);
  const now = Date.now();
  const rms = convRms();
  const speakingThreshold = 0.045;
  if (convState === 'speaking' && rms > speakingThreshold * 1.6) {
    stopSpeaking();
    setConvState('listening');
    convSpeechStarted = false;
    convQuietSince = 0;
    convLastVoiceAt = now;
    try { if (convMediaRecorder && convMediaRecorder.state !== 'inactive') convMediaRecorder.stop(); } catch (_) {}
    convMediaRecorder = null;
    convRecChunks = [];
    return;
  }
  if (convState !== 'listening') return;
  if (rms > speakingThreshold) {
    if (!convSpeechStarted) beginUtteranceRecording();
    convSpeechStarted = true;
    convLastVoiceAt = now;
    convQuietSince = 0;
    convIdleSince = now;
  } else if (convSpeechStarted) {
    if (!convQuietSince) convQuietSince = now;
    if (now - convQuietSince >= convSilenceMs) {
      convSpeechStarted = false;
      convQuietSince = 0;
      captureConvUtterance();
    }
  } else if (now - convIdleSince >= convPauseAfterMs) {
    setConvState('paused');
    speakOn = true;
    speakReply("I'll pause for now. Tap Talk to continue.", false).then(() => stopConversationMode());
  }
}

async function captureConvUtterance() {
  if (!convMode || !convStream) return;
  setConvState('thinking');
  setVoiceStatus('Transcribing…');
  try {
    const blob = await endUtteranceRecording();
    if (!blob) {
      setVoiceStatus('I barely caught that. Try again a bit louder.');
      setConvState('listening');
      return;
    }
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const mime = blob.type || pickRecorderMime() || 'audio/webm';
    const data = await api('/api/voice/transcribe', 'POST', {
      audioBase64: btoa(bin),
      mimeType: mime,
    });
    if (!data.text) { setConvState('listening'); return; }
    const risky = (data.words || []).filter((w) => w.lowConfidence && /^[A-Za-z]{3,}$/.test(w.word));
    putTranscript(data.text, data.words);
    if (risky.length) {
      const w = risky[0].word;
      const alts = suggestLocal(w).slice(0, 2);
      const confirm = alts.length > 1
        ? ('Did you say ' + alts[0] + ' or ' + alts[1] + '? Correct on screen if needed, then send.')
        : ('Please check ' + w + ' on screen, then send.');
      await speakReply(confirm, false);
      setConvState('listening');
      return;
    }
    document.getElementById('askBox').value = data.text;
    await ask();
  } catch (err) {
    const msg = String(err.message || err);
    setVoiceStatus(/valid media|process file/i.test(msg)
      ? 'Could not read that recording. Say something, pause briefly, then wait for Thinking.'
      : msg);
    setConvState('listening');
  }
}

async function startMic(e) {
  if (e) e.preventDefault();
  if (recording) return;
  const btn = document.getElementById('micBtn');
  try {
    if (sttInfo.provider === 'groq' || sttInfo.groqConfigured) {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaChunks = [];
      const canType = typeof MediaRecorder !== 'undefined'
        && typeof MediaRecorder.isTypeSupported === 'function';
      const mime = canType && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (canType && MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
      mediaRecorder = mime ? new MediaRecorder(mediaStream, { mimeType: mime }) : new MediaRecorder(mediaStream);
      mediaRecorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) mediaChunks.push(ev.data); };
      mediaRecorder.start();
      recording = true;
      recordStartedAt = Date.now();
      if (btn) btn.classList.add('rec');
      setVoiceStatus('Listening… release Mic to stop', true);
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) throw new Error('This browser has no speech recognition. Add GROQ_API_KEY for Whisper, or try Chrome.');
    const rec = new SR();
    rec.lang = 'en-NG';
    rec.interimResults = false;
    rec.onresult = (ev) => {
      const text = Array.from(ev.results).map(r => r[0].transcript).join(' ').trim();
      if (text) putTranscript(text);
    };
    rec.onerror = (ev) => setVoiceStatus(ev.error === 'not-allowed'
      ? 'Mic permission denied. Allow the mic in your browser settings.'
      : 'Could not hear that. Try again.');
    rec.onend = () => {
      recording = false;
      if (btn) btn.classList.remove('rec');
    };
    recording = true;
    if (btn) btn.classList.add('rec');
    setVoiceStatus('Listening (browser)… tap Mic again to stop', true);
    rec.start();
    window._browserRec = rec;
  } catch (err) {
    recording = false;
    if (btn) btn.classList.remove('rec');
    const msg = String(err.message || err);
    setVoiceStatus(/Permission|NotAllowed|denied/i.test(msg)
      ? 'Mic permission denied. Allow the mic, then try again.'
      : msg);
  }
}

async function stopMic(e) {
  if (e) e.preventDefault();
  const btn = document.getElementById('micBtn');
  if (window._browserRec) {
    try { window._browserRec.stop(); } catch (_) {}
    window._browserRec = null;
    recording = false;
    if (btn) btn.classList.remove('rec');
    return;
  }
  if (!recording || !mediaRecorder) return;
  const elapsed = Date.now() - recordStartedAt;
  recording = false;
  if (btn) btn.classList.remove('rec');
  setVoiceStatus('Transcribing…');
  await new Promise((resolve) => {
    mediaRecorder.onstop = resolve;
    try { mediaRecorder.stop(); } catch (_) { resolve(); }
  });
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
  if (elapsed < 400) {
    setVoiceStatus('Hold a bit longer, then release.');
    mediaChunks = [];
    mediaRecorder = null;
    return;
  }
  try {
    const blob = new Blob(mediaChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    mediaChunks = [];
    mediaRecorder = null;
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin);
    const data = await api('/api/voice/transcribe', 'POST', {
      audioBase64: b64,
      mimeType: blob.type || 'audio/webm',
    });
    if (data.text) putTranscript(data.text, data.words);
    else setVoiceStatus('I heard silence. Try again.');
  } catch (err) {
    setVoiceStatus(String(err.message || err));
  }
}

function cancelMic() {
  if (window._browserRec) {
    try { window._browserRec.abort(); } catch (_) {}
    window._browserRec = null;
  }
  if (mediaRecorder && recording) {
    try { mediaRecorder.stop(); } catch (_) {}
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
  recording = false;
  mediaChunks = [];
  mediaRecorder = null;
  const btn = document.getElementById('micBtn');
  if (btn) btn.classList.remove('rec');
  setVoiceStatus('Cancelled.');
}

function bindMic() {
  const btn = document.getElementById('micBtn');
  if (!btn) return;
  btn.addEventListener('pointerdown', startMic);
  btn.addEventListener('pointerup', stopMic);
  btn.addEventListener('pointerleave', (e) => { if (recording && mediaRecorder) stopMic(e); });
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cancelMic();
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (recording) stopMic(e); else startMic(e);
    }
  });
  syncSpeakBtn();
}

async function boot() {
  if (booted) return;
  booted = true;
  bindMic();
  try { sttInfo = await api('/api/voice/stt'); } catch (_) {}
  try { await loadVoiceSettingsUi(); } catch (_) {}
  try {
    const v = await api('/api/voice/vocab');
    vocabTerms = (v.terms || []).map((t) => t.term);
  } catch (_) {}
  const prevSpeak = speakOn;
  speakOn = false;
  try {
    const history = await api('/api/chat/history?limit=200');
    const messages = history.messages || (Array.isArray(history) ? history : []);
    if (history.conversation) activeConversationId = history.conversation.id;
    if (messages.length) {
      for (const m of messages) addMsg(m.role === 'user' ? 'user' : 'funke', m.text, null, null, m.id);
      speakOn = prevSpeak;
      addMsg('funke', 'Welcome back. I kept this chat. Use New chat for a clean slate; preferences stay.');
    } else {
      speakOn = prevSpeak;
      addMsg('funke', "Hi, I'm Funke. Paste a Zoom invite, ask what's on your plate, or tell me to remind you. I'll keep the jargon out of the way.");
    }
  } catch (_) {
    speakOn = prevSpeak;
    addMsg('funke', "Hi, I'm Funke. Paste a Zoom invite, ask what's on your plate, or tell me to remind you. I'll keep the jargon out of the way.");
  }
  await refreshPanels();
  showView('chat');
  try { await maybeShowTour(); } catch (_) {}
}

let tourStep = 0;
const TOUR_STEPS = [
  { title: 'Welcome to Funke', body: 'Ask in plain English: plate, reminders, calendar, LinkedIn or X drafts. Nothing posts until you tap Approve in Ok.' },
  { title: 'Try one ask', body: 'Tap a suggestion chip, or type “What is on my plate?”. Hold Mic or Talk when you want voice.' },
  { title: 'Approvals and Social', body: 'Ok holds exact final text. Soc has accounts, reply length, work context, and what Funke remembers.' },
];

async function maybeShowTour() {
  const st = await api('/api/onboarding');
  if (st.done) return;
  tourStep = 0;
  renderTour();
  document.getElementById('tourOverlay').hidden = false;
}

function renderTour() {
  const step = TOUR_STEPS[tourStep] || TOUR_STEPS[0];
  document.getElementById('tourTitle').textContent = step.title;
  document.getElementById('tourBody').textContent = step.body;
  document.getElementById('tourNext').textContent = tourStep >= TOUR_STEPS.length - 1 ? 'Done' : 'Next';
}

async function advanceTour() {
  if (tourStep >= TOUR_STEPS.length - 1) {
    await skipTour();
    return;
  }
  tourStep += 1;
  renderTour();
}

async function skipTour() {
  document.getElementById('tourOverlay').hidden = true;
  try { await api('/api/onboarding', 'POST', { done: true }); } catch (_) {}
}

async function loadContextUi() {
  const sel = document.getElementById('contextSel');
  if (!sel) return;
  const data = await api('/api/context');
  const known = data.known || [];
  sel.innerHTML = known.map((c) =>
    '<option value="' + esc(c.id) + '"' + (c.id === data.active ? ' selected' : '') + '>' + esc(c.label) + '</option>'
  ).join('');
}

async function saveContext() {
  const sel = document.getElementById('contextSel');
  if (!sel) return;
  await api('/api/context', 'POST', { id: sel.value });
  addMsg('funke', 'Switched work context. New memories will be tagged for it.');
}

async function loadReplyStyleUi() {
  const sel = document.getElementById('replyStyleSel');
  if (!sel) return;
  const data = await api('/api/reply-style');
  sel.value = data.style || 'brief';
}

async function saveReplyStyle() {
  const sel = document.getElementById('replyStyleSel');
  if (!sel) return;
  await api('/api/reply-style', 'POST', { style: sel.value });
  addMsg('funke', 'Reply length set to ' + sel.value + '.');
}

boot();
setInterval(refreshPanels, 12000);
</script>
</body>
</html>`;
}
