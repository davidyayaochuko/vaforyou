import { buildAiClient } from '../ai/client.ts';
import { generate } from '../content/generate.ts';
import { createContent, templateUsage, recentPublishedBodies } from '../db/content.ts';
import { getAccountByName, listAccounts } from '../db/index.ts';
import { isPlatformId } from '../platforms/index.ts';
import { engine } from '../engine/scheduler.ts';
import {
  createFollowUp,
  createReminder,
  listOpenFollowUps,
  listReminders,
  listUpcomingEvents,
  findDuplicateCalendarEvent,
  type CalendarEvent,
} from './store.ts';
import { logChatExchange } from './conversations.ts';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DateTime } from 'luxon';
import { convertWallTime, homeTimezone } from './timezone.ts';
import { parseMeetingInvite } from './invite.ts';
import { askWorkspace, isWorkspaceAsk, workspaceConfigured, workspaceSetupReply } from './workspace.ts';
import {
  clearPending,
  conversationBlock,
  getPending,
  pushTurn,
  recentTurns,
  setPending,
} from './session.ts';
import { remember, recall } from './memory.ts';
import { replyStylePromptBlock } from './reply-style.ts';
import { tryContextCommand, contextLabel, activeContext } from './contexts.ts';
import { lookupKb } from './knowledge.ts';

export type VaIntent =
  | 'remind'
  | 'calendar_create'
  | 'draft_post'
  | 'follow_up'
  | 'status'
  | 'help'
  | 'unknown';

interface ParsedCommand {
  intent: VaIntent;
  reply: string;
  needs_clarification?: boolean;
  remind?: {
    title: string;
    when: string;
    timezone?: string | null;
    body?: string | null;
  } | null;
  calendar?: {
    title: string;
    start: string;
    end?: string | null;
    timezone?: string | null;
    location?: string | null;
    notes?: string | null;
    remind_minutes_before?: number | null;
  } | null;
  draft?: {
    platform: string;
    account?: string | null;
    brief: string;
    facts?: string | null;
  } | null;
  follow_up?: {
    who: string;
    what: string;
    due?: string | null;
    timezone?: string | null;
  } | null;
}

export interface VaResult {
  ok: boolean;
  intent: VaIntent;
  reply: string;
  detail?: unknown;
}

/**
 * Flat schema for Groq strict JSON. Nested anyOf/null objects were causing
 * 400 "Generated JSON does not match the expected schema" errors.
 */
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'intent',
    'reply',
    'needs_clarification',
    'remind_active',
    'remind_title',
    'remind_when',
    'remind_timezone',
    'remind_body',
    'calendar_active',
    'calendar_title',
    'calendar_start',
    'calendar_end',
    'calendar_timezone',
    'calendar_location',
    'calendar_notes',
    'calendar_remind_minutes_before',
    'draft_active',
    'draft_platform',
    'draft_account',
    'draft_brief',
    'draft_facts',
    'follow_active',
    'follow_who',
    'follow_what',
    'follow_due',
    'follow_timezone',
  ],
  properties: {
    intent: {
      type: 'string',
      enum: ['remind', 'calendar_create', 'draft_post', 'follow_up', 'status', 'help', 'unknown'],
    },
    reply: { type: 'string' },
    needs_clarification: { type: 'boolean' },
    remind_active: { type: 'boolean' },
    remind_title: { type: 'string' },
    remind_when: { type: 'string' },
    remind_timezone: { type: 'string' },
    remind_body: { type: 'string' },
    calendar_active: { type: 'boolean' },
    calendar_title: { type: 'string' },
    calendar_start: { type: 'string' },
    calendar_end: { type: 'string' },
    calendar_timezone: { type: 'string' },
    calendar_location: { type: 'string' },
    calendar_notes: { type: 'string' },
    calendar_remind_minutes_before: { type: 'number' },
    draft_active: { type: 'boolean' },
    draft_platform: { type: 'string' },
    draft_account: { type: 'string' },
    draft_brief: { type: 'string' },
    draft_facts: { type: 'string' },
    follow_active: { type: 'boolean' },
    follow_who: { type: 'string' },
    follow_what: { type: 'string' },
    follow_due: { type: 'string' },
    follow_timezone: { type: 'string' },
  },
} as const;

type FlatParsed = {
  intent: VaIntent;
  reply: string;
  needs_clarification: boolean;
  remind_active: boolean;
  remind_title: string;
  remind_when: string;
  remind_timezone: string;
  remind_body: string;
  calendar_active: boolean;
  calendar_title: string;
  calendar_start: string;
  calendar_end: string;
  calendar_timezone: string;
  calendar_location: string;
  calendar_notes: string;
  calendar_remind_minutes_before: number;
  draft_active: boolean;
  draft_platform: string;
  draft_account: string;
  draft_brief: string;
  draft_facts: string;
  follow_active: boolean;
  follow_who: string;
  follow_what: string;
  follow_due: string;
  follow_timezone: string;
};

function emptyToNull(s: string | undefined): string | null {
  const t = (s ?? '').trim();
  return t ? t : null;
}

function flattenToParsed(flat: FlatParsed): ParsedCommand {
  return {
    intent: flat.intent,
    reply: flat.reply,
    needs_clarification: flat.needs_clarification,
    remind: flat.remind_active
      ? {
          title: flat.remind_title,
          when: flat.remind_when,
          timezone: emptyToNull(flat.remind_timezone),
          body: emptyToNull(flat.remind_body),
        }
      : null,
    calendar: flat.calendar_active
      ? {
          title: flat.calendar_title,
          start: flat.calendar_start,
          end: emptyToNull(flat.calendar_end),
          timezone: emptyToNull(flat.calendar_timezone),
          location: emptyToNull(flat.calendar_location),
          notes: emptyToNull(flat.calendar_notes),
          remind_minutes_before: flat.calendar_remind_minutes_before || 60,
        }
      : null,
    draft: flat.draft_active
      ? {
          platform: flat.draft_platform || 'linkedin',
          account: emptyToNull(flat.draft_account),
          brief: flat.draft_brief,
          facts: emptyToNull(flat.draft_facts),
        }
      : null,
    follow_up: flat.follow_active
      ? {
          who: flat.follow_who,
          what: flat.follow_what,
          due: emptyToNull(flat.follow_due),
          timezone: emptyToNull(flat.follow_timezone),
        }
      : null,
  };
}

function loadFunkeVoice(): string {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const chunks: string[] = [];
  const funke = join(root, 'instructions', 'FUNKE.md');
  const example = join(root, 'instructions', 'FUNKE.example.md');
  const learned = join(root, 'instructions', 'VOICE.md');
  if (existsSync(funke)) chunks.push(readFileSync(funke, 'utf8'));
  else if (existsSync(example)) chunks.push(readFileSync(example, 'utf8'));
  if (existsSync(learned)) chunks.push(readFileSync(learned, 'utf8'));
  chunks.push(replyStylePromptBlock());
  const text = chunks.join('\n\n').trim();
  return (text || 'You are Funke. Speak briefly and clearly. No jargon dumps.').slice(0, 6_000);
}

async function parseCommand(text: string): Promise<ParsedCommand> {
  const ai = buildAiClient();
  const home = homeTimezone();
  const now = new Date().toISOString();
  const history = conversationBlock(8);
  const pending = getPending();
  const { memoryBlock } = await import('./memory.ts');
  const memory = memoryBlock(10);

  const flat = await ai.json<FlatParsed>({
    system: [
      loadFunkeVoice(),
      '',
      'You parse the latest user message into one Funke intent.',
      `Home timezone: ${home}. Current UTC: ${now}.`,
      'If they name another timezone, put it in *_timezone and keep wall-clock times in that zone as ISO without offset (e.g. 2026-10-21T17:00:00).',
      'Central Time (US and Canada) = America/Chicago. Use Africa/Lagos when none is named.',
      'Set *_active true only for the intent you are filling. Other *_active flags must be false; unused strings must be "".',
      'calendar_remind_minutes_before: use 60 when active, else 0.',
      'Meeting / Google Meet / Zoom / call with someone → calendar_create (not remind).',
      'Never ask how long a meeting is. Default calendar_remind_minutes_before to 60 and leave calendar_end empty; the app adds one hour.',
      'If they give a time but no topic for a reminder, set needs_clarification true and ask what it is about. Do not invent a title.',
      'If the user is answering your last clarifying question with a short title or time, MERGE with the pending ask.',
      'If they change topic (list meetings, what is on my plate, draft a post, help), do NOT keep the pending ask. Set the new intent. Never use their new question as a calendar or reminder title.',
      'Reschedule / move / change time of a meeting → calendar_create with the new start time. Prefer the real meeting title from conversation if known; otherwise leave calendar_title empty and ask which meeting.',
      'Ask at most one clarifying question. Required fields: remind needs title+when; calendar needs title+start.',
      'reply must be natural speech for the user. Never mention JSON, schemas, or API errors.',
      'Do not invent prices, policies, or deadlines. Those come from the knowledge base path, not you.',
      pending
        ? `Pending ask: intent=${pending.intent} partial=${JSON.stringify(pending.partial)}`
        : 'No pending ask.',
      memory ? `Durable memory (use when relevant):\n${memory}` : 'No durable memory notes yet.',
    ].join('\n'),
    prompt: [
      history ? `Recent conversation:\n${history}\n` : '',
      `Latest user message:\n${text}`,
    ].join('\n'),
    schema: SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 1_400,
  });

  return flattenToParsed(flat);
}

/** "Remember that Ada prefers Meet" / "Remember for Yusuf: mornings only" */
function tryRememberCommand(text: string): { reply: string; detail: unknown } | null {
  const t = text.trim();
  if (!/^remember\b/i.test(t) || /^remind\b/i.test(t)) return null;

  // Allow multi-word names: "Remember for Bola Ventures: …" / "Remember for Chioma Bello: …"
  const forContact = t.match(
    /^remember\s+(?:that\s+)?(?:for\s+)?([A-Za-z][A-Za-z.'\- ]{1,60}?)\s*[:\-]\s*(.+)$/i,
  );
  const plain = t.match(/^remember\s+(?:that\s+)?(.+)$/i);
  const value = (forContact?.[2] || plain?.[1] || '').trim();
  if (!value || /^(me to |to )/i.test(value)) return null;

  const contact = forContact?.[1]?.trim() || null;
  const isPref = /\bprefer/i.test(value);
  const row = remember({
    scope: contact ? 'contact' : isPref ? 'preference' : 'fact',
    key: contact ? 'note' : isPref ? 'preference' : value.slice(0, 60),
    value,
    contact,
  });
  const reply = contact
    ? `Got it. I'll remember that about ${contact}. You can review or forget it under Social accounts.`
    : `Got it. I saved that${isPref ? ' as a preference' : ''}. You can review or forget it under Social accounts.`;
  return { reply, detail: { memoryId: row.id, contact, scope: row.scope } };
}

/** Answer preference / "what do you remember" from durable memory only (no LLM guess). */
function tryRecallMemoryCommand(text: string): { reply: string; detail: unknown } | null {
  const t = text.trim();
  const asksMemory =
    /\b(what|when|which|do you|can you|tell me).{0,40}\b(prefer|preference|preferences|remember|know about me)\b/i.test(t)
    || /\bwhat (did|do) you remember\b/i.test(t)
    || /\bmy preferences?\b/i.test(t)
    || /\bwhat do you know about me\b/i.test(t);
  if (!asksMemory) return null;

  const rows = recall({ limit: 20 });
  if (!rows.length) {
    return {
      reply:
        'I do not have any saved preferences or contacts right now. '
        + 'Say "Remember that I prefer ..." to store one, or check Social accounts → What Funke remembers.',
      detail: { memory: [] },
    };
  }
  const lines = rows.slice(0, 12).map((r) => {
    const who = r.contact ? ` (${r.contact})` : '';
    return `• [${r.scope}] ${r.value}${who}`;
  });
  return {
    reply: `Here is what I have saved:\n${lines.join('\n')}\n\nForget items under Social accounts when you want a clean slate.`,
    detail: { memory: rows.map((r) => r.id) },
  };
}

/** User switched topics instead of answering the clarifying question. */
function looksLikeNewCommand(text: string): boolean {
  const t = text.trim();
  if (/\?/.test(t) && /^(what|who|which|when|where|how|can|could|do|does|is|are|give|list|show)\b/i.test(t)) {
    return true;
  }
  return /^(give me|list|show|what('|’)?s|whats|what are|what is|who|help|draft|remind me|check my|on my plate)\b/i.test(t)
    || /\b(list|show|pull up)\b[\s\S]{0,40}\b(meeting|meetings|calendar|reminder|reminders|follow-?ups?)\b/i.test(t);
}

/** Safe to treat the whole message as a short title answer. */
function looksLikeTitleAnswer(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 80) return false;
  if (looksLikeNewCommand(t)) return false;
  if (/^(yes|no|ok|okay|thanks|thank you)\b/i.test(t)) return false;
  if (/\b(tomorrow|today|am|pm|cst|est|pst|gmt|utc)\b/i.test(t) && t.length < 24) return false;
  return true;
}

function mergeWithPending(parsed: ParsedCommand, text: string): ParsedCommand {
  const pending = getPending();
  if (!pending) return parsed;

  // Drop the half-finished ask when they clearly started something else.
  if (
    looksLikeNewCommand(text)
    || parsed.intent === 'status'
    || parsed.intent === 'help'
    || (parsed.intent !== 'unknown' && parsed.intent !== pending.intent && !parsed.needs_clarification)
  ) {
    clearPending();
    return parsed;
  }

  // If they started a reminder, then said "Google Meet / meeting with Yusuf", promote to calendar.
  const meetish = /google\s*meet|zoom|meeting with|call with/i.test(text);
  if (pending.intent === 'remind' && meetish) {
    const when = String(pending.partial.when ?? parsed.remind?.when ?? parsed.calendar?.start ?? '');
    const whoMatch = /meeting with\s+([^,.]+)/i.exec(text)?.[1]?.trim();
    const title =
      parsed.calendar?.title ||
      parsed.remind?.title ||
      (whoMatch ? `Meeting with ${whoMatch}` : 'Meeting');
    const location = /google\s*meet/i.test(text) ? 'Google Meet' : parsed.calendar?.location || null;
    return {
      ...parsed,
      intent: 'calendar_create',
      needs_clarification: !when,
      calendar: {
        title,
        start: when || parsed.calendar?.start || '',
        end: parsed.calendar?.end ?? null,
        timezone: parsed.calendar?.timezone ?? (pending.partial.timezone as string | null) ?? null,
        location,
        notes: parsed.calendar?.notes ?? parsed.remind?.body ?? text,
        remind_minutes_before: 60,
      },
      remind: null,
    };
  }

  if (pending.intent === 'remind') {
    const pendingTitle = String(pending.partial.title ?? '').trim();
    const pendingWhen = String(pending.partial.when ?? '').trim();
    const title =
      (parsed.remind?.title && parsed.remind.title.trim())
      || pendingTitle
      || (looksLikeTitleAnswer(text) ? text.slice(0, 80) : '');
    let when = (parsed.remind?.when && parsed.remind.when.trim()) || pendingWhen;
    // Time-only follow-ups must not wipe the pending title or re-ask "what about".
    if (title && !when) {
      const extracted = extractWhenPhrase(text);
      if (extracted) {
        const home = homeTimezone();
        const now = DateTime.now().setZone(home);
        const normalized = normalizeRemindWhen(extracted, now);
        if (normalized) when = normalized;
      }
    }
    return {
      ...parsed,
      intent: 'remind',
      remind: {
        title,
        when,
        timezone: parsed.remind?.timezone ?? (pending.partial.timezone as string | null) ?? null,
        body: parsed.remind?.body ?? (pending.partial.body as string | null) ?? null,
      },
      needs_clarification: !(title && when),
      reply: title && when
        ? parsed.reply
        : (parsed.reply || (!title ? 'What should I call this reminder?' : 'What time should I set that for?')),
    };
  }

  if (pending.intent === 'calendar_create') {
    const title =
      parsed.calendar?.title
      || String(pending.partial.title ?? '')
      || (looksLikeTitleAnswer(text) ? text.slice(0, 80) : '');
    const start = parsed.calendar?.start || String(pending.partial.start ?? '');
    return {
      ...parsed,
      intent: 'calendar_create',
      calendar: {
        title,
        start,
        end: parsed.calendar?.end ?? (pending.partial.end as string | null) ?? null,
        timezone: parsed.calendar?.timezone ?? (pending.partial.timezone as string | null) ?? null,
        location: parsed.calendar?.location ?? (pending.partial.location as string | null) ?? null,
        notes: parsed.calendar?.notes ?? (pending.partial.notes as string | null) ?? null,
        remind_minutes_before: parsed.calendar?.remind_minutes_before ?? 60,
      },
      needs_clarification: !(title && start),
      reply: title && start
        ? parsed.reply
        : (parsed.reply || (!title ? 'Which meeting should I move? Reply with the title.' : 'What day and time should I put on the calendar?')),
    };
  }

  return parsed;
}

function rememberPending(parsed: ParsedCommand): void {
  if (!parsed.needs_clarification) {
    clearPending();
    return;
  }
  const prev = getPending();
  if (parsed.intent === 'remind') {
    const prevTitle = prev?.intent === 'remind' ? String(prev.partial.title ?? '') : '';
    const prevWhen = prev?.intent === 'remind' ? String(prev.partial.when ?? '') : '';
    setPending({
      intent: 'remind',
      partial: {
        title: (parsed.remind?.title || prevTitle || '').trim(),
        when: (parsed.remind?.when || prevWhen || '').trim(),
        timezone: parsed.remind?.timezone ?? (prev?.partial.timezone as string | null) ?? null,
        body: parsed.remind?.body ?? (prev?.partial.body as string | null) ?? null,
      },
      askedAt: Date.now(),
    });
    return;
  }
  if (parsed.intent === 'calendar_create') {
    const prevTitle = prev?.intent === 'calendar_create' ? String(prev.partial.title ?? '') : '';
    const prevStart = prev?.intent === 'calendar_create' ? String(prev.partial.start ?? '') : '';
    setPending({
      intent: 'calendar_create',
      partial: {
        title: (parsed.calendar?.title || prevTitle || '').trim(),
        start: (parsed.calendar?.start || prevStart || '').trim(),
        timezone: parsed.calendar?.timezone ?? null,
        location: parsed.calendar?.location ?? null,
        notes: parsed.calendar?.notes ?? null,
      },
      askedAt: Date.now(),
    });
    return;
  }
  if (parsed.intent === 'draft_post') {
    setPending({
      intent: 'draft_post',
      partial: { ...(parsed.draft ?? {}) },
      askedAt: Date.now(),
    });
  }
}

function accountsForPlatform(platform: string) {
  return listAccounts().filter((a) => a.platform === platform);
}

function defaultAccount(platform: string): string | null {
  const matches = accountsForPlatform(platform);
  if (matches.length === 1) return matches[0]!.name;
  return null;
}

/** Resolve "personal LinkedIn" / "company-page" / fuzzy names. */
function resolveAccountName(raw: string | null | undefined, platform: string): {
  name: string | null;
  clarify?: string;
} {
  const accounts = accountsForPlatform(platform);
  if (!accounts.length) return { name: null };
  if (!raw || !raw.trim()) {
    if (accounts.length === 1) return { name: accounts[0]!.name };
    return {
      name: null,
      clarify:
        `Which ${platform === 'x' ? 'X' : 'LinkedIn'} account? `
        + accounts.map((a) => a.name).join(', '),
    };
  }
  const q = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  const exact = accounts.find((a) => a.name.toLowerCase() === q);
  if (exact) return { name: exact.name };
  const fuzzy = accounts.filter((a) => {
    const n = a.name.toLowerCase();
    return n.includes(q) || q.includes(n) || q.replace(/\s+/g, '-').includes(n) || n.includes(q.replace(/\s+/g, '-'));
  });
  if (fuzzy.length === 1) return { name: fuzzy[0]!.name };
  if (fuzzy.length > 1 || accounts.length > 1) {
    return {
      name: null,
      clarify:
        `Which ${platform === 'x' ? 'X' : 'LinkedIn'} account? `
        + accounts.map((a) => a.name).join(', '),
    };
  }
  return { name: accounts[0]!.name };
}

export async function handleVaCommand(text: string): Promise<VaResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, intent: 'unknown', reply: 'Say what you want me to do.' };
  }

  pushTurn('user', trimmed);

  const ctxCmd = tryContextCommand(trimmed);
  if (ctxCmd) {
    pushTurn('funke', ctxCmd.reply, 'help');
    logChatExchange(trimmed, 'help', ctxCmd.reply, { context: ctxCmd.id });
    return { ok: true, intent: 'help', reply: ctxCmd.reply, detail: { context: ctxCmd.id } };
  }

  const pendingRemind = tryResolvePendingRemind(trimmed);
  if (pendingRemind) {
    const result = await runRemind(pendingRemind);
    if (result.ok) clearPending();
    else rememberPending(pendingRemind);
    pushTurn('funke', result.reply, result.intent);
    logChatExchange(trimmed, result.intent, result.reply, result.detail ?? {});
    return result;
  }

  const { checkHardBoundary, isHardBlocked } = await import('../guardrails/boundaries.ts');
  const boundary = checkHardBoundary(trimmed);
  if (isHardBlocked(boundary)) {
    const { writeAudit } = await import('../guardrails/audit.ts');
    writeAudit({
      actionType: `boundary.${boundary.code}`,
      target: null,
      inputSummary: trimmed.slice(0, 200),
      result: 'escalated',
      detail: { code: boundary.code },
    });
    const reply = `${boundary.reason} I will not do that on my own.`;
    pushTurn('funke', reply, 'unknown');
    logChatExchange(trimmed, 'unknown', reply, { boundary });
    return { ok: false, intent: 'unknown', reply };
  }

  const { checkEscalation } = await import('../guardrails/escalation.ts');
  const escalation = checkEscalation(trimmed);
  if (escalation.escalate) {
    const { writeAudit } = await import('../guardrails/audit.ts');
    const { raiseAlert } = await import('./alerts.ts');
    writeAudit({
      actionType: `escalation.${escalation.code}`,
      target: null,
      inputSummary: trimmed.slice(0, 200),
      result: 'escalated',
      detail: { code: escalation.code },
    });
    raiseAlert({
      kind: `escalation.${escalation.code}`,
      message: escalation.reason.slice(0, 200),
      detail: { input: trimmed.slice(0, 300) },
    });
    const reply = escalation.reason;
    pushTurn('funke', reply, 'unknown');
    logChatExchange(trimmed, 'unknown', reply, { escalation });
    return { ok: false, intent: 'unknown', reply, detail: { escalation } };
  }

  const remembered = tryRememberCommand(trimmed);
  if (remembered) {
    pushTurn('funke', remembered.reply, 'unknown');
    logChatExchange(trimmed, 'unknown', remembered.reply, { memory: remembered.detail });
    return { ok: true, intent: 'unknown', reply: remembered.reply, detail: remembered.detail };
  }

  const recalled = tryRecallMemoryCommand(trimmed);
  if (recalled) {
    pushTurn('funke', recalled.reply, 'unknown');
    logChatExchange(trimmed, 'unknown', recalled.reply, { memory: recalled.detail });
    return { ok: true, intent: 'unknown', reply: recalled.reply, detail: recalled.detail };
  }

  const research = tryResearchAsk(trimmed);
  if (research) {
    pushTurn('funke', research.reply, 'help');
    logChatExchange(trimmed, 'help', research.reply, research.detail);
    return { ok: true, intent: 'help', reply: research.reply, detail: research.detail };
  }

  const { groundedReply } = await import('./knowledge.ts');
  const grounded = groundedReply(trimmed);
  if (grounded.handled) {
    pushTurn('funke', grounded.reply, 'help');
    logChatExchange(trimmed, 'help', grounded.reply, { kb: grounded.hits.map((h) => h.id) });
    return { ok: true, intent: 'help', reply: grounded.reply, detail: { kb: grounded.hits } };
  }

  // Deterministic path for Zoom / calendar invite pastes (timezone-safe).
  const invite = parseMeetingInvite(trimmed);
  if (invite) {
    clearPending();
    const result = await runCalendar({
      intent: 'calendar_create',
      reply: `Got it. Adding "${invite.title}" from the invite.`,
      needs_clarification: false,
      calendar: {
        title: invite.title,
        start: invite.startLocal,
        end: invite.endLocal ?? null,
        timezone: invite.sourceTz,
        location: invite.location ?? null,
        notes: invite.notes ?? null,
        remind_minutes_before: 60,
      },
    });
    pushTurn('funke', result.reply, result.intent);
    logChatExchange(trimmed, result.intent, result.reply, result.detail ?? {});
    return result;
  }

  // Gmail, Drive, Docs, and contacts go through the Workspace MCP server.
  if (isWorkspaceAsk(trimmed)) {
    const result = workspaceConfigured()
      ? await askWorkspace(trimmed)
      : { ok: false, reply: workspaceSetupReply() };
    const va: VaResult = { ok: result.ok, intent: 'unknown', reply: result.reply };
    pushTurn('funke', va.reply, va.intent);
    logChatExchange(trimmed, va.intent, va.reply, { workspace: true });
    return va;
  }

  // Deterministic help (no LLM).
  if (/^(help|what can you do|what do you do)\??$/i.test(trimmed) || /^hi[,!]?\s*(what can you do)\??$/i.test(trimmed)) {
    clearPending();
    const reply = helpReply();
    pushTurn('funke', reply, 'help');
    logChatExchange(trimmed, 'help', reply, {});
    return { ok: true, intent: 'help', reply };
  }

  // Daily summary without LLM.
  if (isDailySummaryAsk(trimmed)) {
    clearPending();
    const { formatDailySummary } = await import('./summary.ts');
    const reply = formatDailySummary();
    pushTurn('funke', reply, 'status');
    logChatExchange(trimmed, 'status', reply, { dailySummary: true });
    return { ok: true, intent: 'status', reply, detail: { dailySummary: true } };
  }

  // Multi-task dumps: do not collapse to plate-only.
  const multi = detectMultiAsks(trimmed);
  if (multi && multi.length >= 2) {
    clearPending();
    const result = await runMultiAsks(trimmed, multi);
    pushTurn('funke', result.reply, result.intent);
    logChatExchange(trimmed, result.intent, result.reply, result.detail ?? {});
    return result;
  }

  // Deterministic status / plate (no LLM). Skip if the message also packs other tasks.
  if (isStatusAsk(trimmed) && !hasCompanionTasks(trimmed)) {
    clearPending();
    const result = runStatus({
      intent: 'status',
      reply: '',
      needs_clarification: false,
    });
    pushTurn('funke', result.reply, result.intent);
    logChatExchange(trimmed, result.intent, result.reply, result.detail ?? {});
    return result;
  }

  // Deterministic reminder: "Remind me tomorrow at 9am to call Ada"
  const remindAsk = parseRemindAsk(trimmed);
  if (remindAsk) {
    clearPending();
    const result = await runRemind(remindAsk);
    pushTurn('funke', result.reply, result.intent);
    logChatExchange(trimmed, result.intent, result.reply, result.detail ?? {});
    return result;
  }

  // Deterministic draft path so first-success does not depend on LLM JSON.
  const draftAsk = parseDraftAsk(trimmed);
  if (draftAsk) {
    clearPending();
    try {
      const result = await runDraft(draftAsk);
      pushTurn('funke', result.reply, result.intent);
      logChatExchange(trimmed, result.intent, result.reply, result.detail ?? {});
      return result;
    } catch (err) {
      const reply = friendlyAiError(err);
      pushTurn('funke', reply, 'draft_post');
      logChatExchange(trimmed, 'draft_post', reply, { error: String(err) });
      return { ok: false, intent: 'draft_post', reply };
    }
  }

  let parsed: ParsedCommand;
  try {
    parsed = mergeWithPending(await parseCommand(trimmed), trimmed);
  } catch (err) {
    const reply = friendlyAiError(err);
    pushTurn('funke', reply, 'unknown');
    logChatExchange(trimmed, 'unknown', reply, { error: String(err) });
    return { ok: false, intent: 'unknown', reply };
  }

  rememberPending(parsed);

  if (parsed.needs_clarification) {
    const reply = parsed.reply || 'Could you add one more detail so I can finish that?';
    pushTurn('funke', reply, parsed.intent);
    logChatExchange(trimmed, parsed.intent, reply, { pending: getPending() });
    return { ok: true, intent: parsed.intent, reply };
  }

  const intent = parsed.intent ?? 'unknown';
  let result: VaResult;

  try {
    switch (intent) {
      case 'remind':
        result = await runRemind(parsed);
        break;
      case 'calendar_create':
        result = await runCalendar(parsed);
        break;
      case 'draft_post':
        result = await runDraft(parsed);
        break;
      case 'follow_up':
        result = await runFollowUp(parsed);
        break;
      case 'status':
        result = runStatus(parsed);
        break;
      case 'help':
        result = {
          ok: true,
          intent: 'help',
          reply: helpReply(parsed.reply),
        };
        break;
      default:
        result = {
          ok: false,
          intent: 'unknown',
          reply: parsed.reply || "I'm not sure what you need yet. Reminders, calendar, drafts, or follow-ups all work.",
        };
    }
  } catch (err) {
    result = {
      ok: false,
      intent,
      reply: "Something went wrong on my side. Try again in one short sentence.",
    };
    logChatExchange(trimmed, intent, result.reply, { error: String(err) });
  }

  if (result.ok) clearPending();
  pushTurn('funke', result.reply, result.intent);
  logChatExchange(trimmed, result.intent, result.reply, result.detail ?? {});
  return result;
}

async function runRemind(parsed: ParsedCommand): Promise<VaResult> {
  const r = parsed.remind;
  if (!r?.title || !r.when) {
    setPending({
      intent: 'remind',
      partial: {
        title: r?.title ?? '',
        when: r?.when ?? '',
        timezone: r?.timezone ?? null,
        body: r?.body ?? null,
      },
      askedAt: Date.now(),
    });
    const missing = !r?.when
      ? 'What time should I set that for?'
      : 'What should I call this reminder?';
    return { ok: true, intent: 'remind', reply: parsed.reply || missing };
  }
  const converted = convertWallTime({ isoOrLocal: r.when, sourceTz: r.timezone });
  if (!converted.ok) {
    return { ok: false, intent: 'remind', reply: `Could not read that time: ${converted.error}` };
  }

  const row = createReminder({
    title: r.title,
    body: r.body ?? null,
    dueAt: converted.utcIso,
  });

  return {
    ok: true,
    intent: 'remind',
    reply: [
      parsed.reply || `Okay. I'll remind you about “${row.title}”.`,
      `Due ${friendlyWhen(row.due_at)} (${converted.homeTz}).`,
    ].join('\n'),
    detail: {
      reminder: row,
      converted,
      cards: { reminders: [{ title: row.title, when: friendlyWhen(row.due_at) }] },
    },
  };
}

function eventsOnHomeDay(dayUtcIso: string): CalendarEvent[] {
  const day = DateTime.fromISO(dayUtcIso, { zone: 'utc' }).setZone(homeTimezone()).toISODate();
  if (!day) return [];
  return listUpcomingEvents(40).filter((e) => {
    const d = DateTime.fromISO(e.start_at, { zone: 'utc' }).setZone(homeTimezone()).toISODate();
    return d === day;
  });
}

function recentMentionsReschedule(): boolean {
  return recentTurns(6).some((t) => /reschedule|move (the |my )?meeting|change (the )?time/i.test(t.text));
}

async function runCalendar(parsed: ParsedCommand): Promise<VaResult> {
  const c = parsed.calendar;
  const wantsMove = recentMentionsReschedule()
    || /reschedule|move (the |my )?meeting|change (the )?time/i.test(parsed.reply || '');

  if (!c?.start) {
    setPending({
      intent: 'calendar_create',
      partial: {
        title: c?.title ?? '',
        start: '',
        timezone: c?.timezone ?? null,
        location: c?.location ?? null,
        notes: c?.notes ?? null,
      },
      askedAt: Date.now(),
    });
    return { ok: true, intent: 'calendar_create', reply: parsed.reply || 'What day and time should I put on the calendar?' };
  }

  const start = convertWallTime({ isoOrLocal: c.start, sourceTz: c.timezone });
  if (!start.ok) {
    return { ok: false, intent: 'calendar_create', reply: `Could not read start time: ${start.error}` };
  }

  let title = (c.title || '').trim();
  let moving: CalendarEvent | undefined;

  // Only auto-pick or disambiguate when the person asked to move something.
  // A missing title on a new meeting must never hijack the only event that day.
  if (wantsMove) {
    const sameDay = eventsOnHomeDay(start.utcIso);
    if (title) {
      moving = sameDay.find((e) => e.title.toLowerCase() === title.toLowerCase())
        ?? sameDay.find((e) => e.title.toLowerCase().includes(title.toLowerCase()))
        ?? listUpcomingEvents(40).find((e) => e.title.toLowerCase().includes(title.toLowerCase()));
    } else if (sameDay.length === 1) {
      moving = sameDay[0];
      title = moving!.title;
    } else if (sameDay.length > 1) {
      setPending({
        intent: 'calendar_create',
        partial: {
          title: '',
          start: c.start,
          timezone: c.timezone ?? null,
          location: c.location ?? null,
          notes: c.notes ?? null,
        },
        askedAt: Date.now(),
      });
      return {
        ok: true,
        intent: 'calendar_create',
        reply: [
          'You have more than one meeting that day. Which one should I move?',
          '',
          ...sameDay.map((e) => `• ${e.title} (${friendlyWhen(e.start_at)})`),
        ].join('\n'),
        detail: {
          cards: {
            events: sameDay.map((e) => ({ title: e.title, when: friendlyWhen(e.start_at), raw: e.start_at })),
          },
        },
      };
    } else if (!title) {
      setPending({
        intent: 'calendar_create',
        partial: {
          title: '',
          start: c.start,
          timezone: c.timezone ?? null,
          location: c.location ?? null,
          notes: c.notes ?? null,
        },
        askedAt: Date.now(),
      });
      return {
        ok: true,
        intent: 'calendar_create',
        reply: 'I do not see a meeting on that day to move. Which meeting should I reschedule?',
      };
    }

    if (wantsMove && title && !moving) {
      setPending({
        intent: 'calendar_create',
        partial: {
          title,
          start: c.start,
          timezone: c.timezone ?? null,
          location: c.location ?? null,
          notes: c.notes ?? null,
        },
        askedAt: Date.now(),
      });
      return {
        ok: true,
        intent: 'calendar_create',
        reply: `I could not find “${title}” to move. Reply with the exact title from your calendar, or say add it as a new meeting.`,
      };
    }
  }

  if (!title) {
    setPending({
      intent: 'calendar_create',
      partial: {
        title: '',
        start: c.start,
        timezone: c.timezone ?? null,
        location: c.location ?? null,
        notes: c.notes ?? null,
      },
      askedAt: Date.now(),
    });
    return { ok: true, intent: 'calendar_create', reply: parsed.reply || 'What should I call the meeting?' };
  }

  if (!moving) {
    const dup = findDuplicateCalendarEvent(title, start.utcIso);
    if (dup) {
      return {
        ok: true,
        intent: 'calendar_create',
        reply: [
          `That looks like a duplicate of “${dup.title}” already on your calendar (${friendlyWhen(dup.start_at)}).`,
          'I did not create a second one. Say reschedule if you want a different time.',
        ].join('\n'),
        detail: {
          event: dup,
          duplicate: true,
          cards: { events: [{ title: dup.title, when: friendlyWhen(dup.start_at), raw: dup.start_at }] },
        },
      };
    }
  }

  const minutes = c.remind_minutes_before ?? 60;
  const preview = [
    `${wantsMove || moving ? 'Reschedule' : 'Add'} “${title}”`,
    `When (source): ${start.sourceLocal} (${start.sourceTz})`,
    `For you (${start.homeTz}): ${start.homeLocal}`,
    c.location ? `Where: ${c.location}` : null,
    `Reminder: ${minutes} minutes before`,
  ].filter(Boolean).join('\n');

  const { requestAction, approvalToCard } = await import('../guardrails/approvals.ts');
  const outcome = await requestAction({
    actionType: moving || wantsMove ? 'calendar.reschedule' : 'calendar.create',
    title: moving || wantsMove ? `Reschedule: ${title}` : `Calendar: ${title}`,
    summary: preview,
    preview,
    sourceText: parsed.reply || title,
    idempotencyKey: `cal-${title}-${start.utcIso}`,
    payload: {
      title,
      start: c.start,
      end: c.end ?? null,
      timezone: c.timezone ?? null,
      location: c.location ?? null,
      notes: c.notes ?? null,
      remind_minutes_before: minutes,
      eventId: moving?.id ?? null,
    },
  });

  return {
    ok: outcome.ok,
    intent: 'calendar_create',
    reply: outcome.reply,
    detail: {
      approval: outcome.approval ? approvalToCard(outcome.approval) : null,
      approvals: outcome.approval ? [approvalToCard(outcome.approval)] : [],
      start,
      moved: Boolean(moving),
    },
  };
}

function friendlyAiError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/429|rate limit|tokens per minute|TPM/i.test(msg)) {
    return 'The AI provider is busy right now (rate limit). Wait about a minute, then try the same ask again.';
  }
  if (/fetch failed|ECONNRESET|ETIMEDOUT|network/i.test(msg)) {
    return 'I could not reach the AI provider. Check your connection, then try once more.';
  }
  return "I didn't catch that cleanly. Try one short sentence, like: “Remind me tomorrow at 5pm to call Ada.”";
}

function isStatusAsk(text: string): boolean {
  const t = text.trim();
  return (
    /\b(what('|’)?s|whats|what is)\s+on\s+my\s+plate\b/i.test(t)
    || /\b(what('|’)?s|whats|what is|what are)\s+(on\s+)?(my\s+)?(calendar|schedule|meetings?)\b/i.test(t)
    || /\b(wetin dey|wetin dey for)\s+(my\s+)?plate\b/i.test(t)
    || /^(status|overview|catch me up|plate)\b/i.test(t)
    || /^what did i miss\??$/i.test(t)
  );
}

function isDailySummaryAsk(text: string): boolean {
  const t = text.trim();
  return (
    /^(summary|daily summary|end of day summary|eod summary)\b/i.test(t)
    || /\b(daily summary|end-?of-?day summary)\b/i.test(t)
    || /^what did i miss\??$/i.test(t)
  );
}

function hasCompanionTasks(text: string): boolean {
  const t = text.trim();
  const statusish = isStatusAsk(t) || /\bon my plate\b/i.test(t);
  if (!statusish) return false;
  return (
    /\bremind\b/i.test(t)
    || /\b(draft|write|compose|post\s*:)/i.test(t)
    || /\b(schedule|meeting|meet with|coffee with)\b/i.test(t)
  );
}

type MultiKind = 'status' | 'remind' | 'draft' | 'calendar';

function detectMultiAsks(text: string): MultiKind[] | null {
  const t = text.trim();
  if (!/\b(also|and then|, and)\b/i.test(t) && !/\n[-*•\d]/.test(t) && t.length < 80) {
    return null;
  }
  const kinds: MultiKind[] = [];
  if (/\b(on my plate|catch me up|status|overview|plate)\b/i.test(t)) kinds.push('status');
  if (/\bremind\b/i.test(t)) kinds.push('remind');
  if (/\b(draft|write|compose|post\s*:)/i.test(t)) kinds.push('draft');
  if (/\b(schedule|meeting|coffee with|meet with)\b/i.test(t)) kinds.push('calendar');
  const uniq = [...new Set(kinds)];
  return uniq.length >= 2 ? uniq : null;
}

async function runMultiAsks(text: string, kinds: MultiKind[]): Promise<VaResult> {
  const lines: string[] = [
    `I heard ${kinds.length} asks: ${kinds.join(', ')}.`,
    'Doing what I can now. Send any leftover as its own short message.',
    '',
  ];
  const detail: Record<string, unknown> = { multi: kinds };

  if (kinds.includes('status')) {
    const st = runStatus({ intent: 'status', reply: '', needs_clarification: false });
    lines.push(st.reply, '');
    detail.plate = st.detail;
  }

  const remindAsk = parseRemindAsk(text) || parseRemindAskLoose(text);
  if (kinds.includes('remind') && remindAsk) {
    const r = await runRemind(remindAsk);
    lines.push(r.reply, '');
    detail.remind = r.detail;
  } else if (kinds.includes('remind')) {
    lines.push('Reminder: say “Remind me Saturday at 10am to …” as its own message.', '');
  }

  const draftAsk = parseDraftAsk(text);
  if (kinds.includes('draft') && draftAsk) {
    try {
      const d = await runDraft(draftAsk);
      lines.push(d.reply, '');
      detail.draft = d.detail;
    } catch (err) {
      lines.push(friendlyAiError(err), '');
    }
  } else if (kinds.includes('draft')) {
    lines.push('Draft: say “Draft a LinkedIn post about …” as its own message.', '');
  }

  if (kinds.includes('calendar')) {
    lines.push('Meeting: say “Meeting with Name on Thursday at 3pm” as its own message.', '');
  }

  return {
    ok: true,
    intent: 'status',
    reply: lines.join('\n').trim(),
    detail,
  };
}

function helpReply(prefix?: string | null): string {
  return [
    prefix || "I'm Funke. Here's what I can help with:",
    '',
    '• Paste a Zoom invite and ask me to add it',
    '• Remind me tomorrow at 10am to reply to BHM',
    '• Add a Google Meet with Yusuf tomorrow at 5pm',
    '• Draft a LinkedIn post about our launch',
    '• What is on my plate?',
    '• Daily summary / What did I miss?',
    '• Check my Gmail or Drive (needs the Workspace MCP server)',
    '',
    'Want me to walk you through one? Say calendar, reminder, or draft.',
    'There is no separate Reminders menu. Use chat, or the Cal / Ok tabs in the dock.',
    'Switch work context anytime: “switch to boss context” or Soc → Work context.',
    '',
    `I use ${homeTimezone()} unless you name another timezone.`,
  ].join('\n');
}

function extractExactPostBody(text: string): string | null {
  const m = text.match(/use this exact text:\s*([\s\S]+)/i);
  if (!m) return null;
  const body = m[1]!.trim().replace(/^["']|["']$/g, '');
  return body.length >= 20 ? body : null;
}

/** Pull a wall-clock phrase out of a chatty follow-up ("Friday 3pm", "at 3pm"). */
function extractWhenPhrase(text: string): string | null {
  const t = text.trim();
  const week = t.match(
    /\b((?:this|next)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i,
  );
  if (week) return week[0]!.replace(/\s+/g, ' ').trim();
  const at = t.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (at) {
    const pending = getPending();
    const dayHint = String(pending?.partial?.when ?? '').trim();
    if (dayHint && !/^\d{4}-/.test(dayHint) && !/\d{1,2}\s*(am|pm)/i.test(dayHint)) {
      return `${dayHint} ${at[0]}`.replace(/\s+/g, ' ').trim();
    }
    // Bare clock → tomorrow afternoon if after noon today is ambiguous; prefer today if still ahead.
    return `today ${at[0]}`.replace(/\s+/g, ' ').trim();
  }
  const dayOnly = t.match(
    /\b((?:this|next)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/i,
  );
  if (dayOnly) return `${dayOnly[0]} at 9am`;
  return null;
}

function looksLikeTimeAnswer(text: string): boolean {
  const t = text.trim();
  if (!t || looksLikeNewCommand(t)) return false;
  if (/^remind\s+me\b/i.test(t)) return false;
  return Boolean(extractWhenPhrase(t));
}

/**
 * Complete a pending reminder when the user answers with a time (possibly buried in chat).
 * Keeps the pending title so we never re-ask "what is this about?".
 */
function tryResolvePendingRemind(text: string): ParsedCommand | null {
  const pending = getPending();
  if (!pending || pending.intent !== 'remind') return null;
  if (!looksLikeTimeAnswer(text)) return null;
  const title = String(pending.partial.title ?? '').trim();
  if (!title) return null;
  const phrase = extractWhenPhrase(text);
  if (!phrase) return null;
  const home = homeTimezone();
  const now = DateTime.now().setZone(home);
  const when = normalizeRemindWhen(phrase, now);
  if (!when) return null;
  return {
    intent: 'remind',
    reply: `Got it. I'll remind you about “${title}”.`,
    needs_clarification: false,
    remind: {
      title,
      when,
      timezone: (pending.partial.timezone as string | null) ?? home,
      body: (pending.partial.body as string | null) ?? null,
    },
  };
}

/** Competitor / research asks: memory + KB only. Never invent sources. */
function tryResearchAsk(text: string): { reply: string; detail: unknown } | null {
  const t = text.trim();
  if (
    !/\b(research|competitor|look up|brief (me )?on|funding|raised)\b/i.test(t)
    && !/\bwhat do (we|you) know about\b/i.test(t)
  ) {
    return null;
  }
  // Skip preferences / self / draft / remind.
  if (/\b(draft|remind|schedule|post\s*:|about me|my preference)\b/i.test(t)) return null;

  const rows = recall({ limit: 40 });
  const tokens = t
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^(what|who|the|about|research|know|look|brief|tell|me|you|our|for)$/.test(w));
  const hits = rows.filter((r) => {
    const hay = `${r.key} ${r.value} ${r.contact}`.toLowerCase();
    return tokens.some((tok) => hay.includes(tok));
  });

  const kbHits = lookupKb(t, 3);

  if (!hits.length && !kbHits.length) {
    return {
      reply:
        'I do not have verified notes on that in memory or the knowledge base, so I will not invent sources or funding figures. '
        + 'Say “Remember that RivalCo …” with what you know, or add a ## section under knowledge/. Mark anything uncertain as UNVERIFIED.',
      detail: { research: true, hits: [] },
    };
  }

  const lines: string[] = [
    'Here is what I have on file (local notes only). I did not search the web.',
    '',
  ];
  for (const h of hits.slice(0, 6)) {
    const flag = /unverified/i.test(h.value) ? ' [UNVERIFIED]' : '';
    lines.push(`• ${h.value}${flag}${h.contact ? ` (${h.contact})` : ''}`);
  }
  for (const k of kbHits.slice(0, 3)) {
    lines.push(`• KB · ${k.question}: ${k.answer.slice(0, 280)}`);
  }
  lines.push('', 'Anything not listed here is unknown. Do not treat this as web-sourced research.');
  return { reply: lines.join('\n'), detail: { research: true, memoryIds: hits.map((h) => h.id) } };
}

function weekdayOffset(name: string, from: DateTime): number {
  const map: Record<string, number> = {
    sunday: 7,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sun: 7,
    mon: 1,
    tue: 2,
    tues: 2,
    wed: 3,
    thu: 4,
    thur: 4,
    thurs: 4,
    fri: 5,
    sat: 6,
  };
  const want = map[name.toLowerCase()];
  if (!want) return -1;
  const cur = from.weekday;
  let delta = want - cur;
  if (delta <= 0) delta += 7;
  return delta;
}

function normalizeRemindWhen(whenRaw: string, now: DateTime): string | null {
  const raw = whenRaw.trim();
  const ampm = raw.match(
    /^(tomorrow|today)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i,
  );
  if (ampm) {
    const day = ampm[1]!.toLowerCase() === 'tomorrow' ? now.plus({ days: 1 }) : now;
    let hour = Number(ampm[2]);
    const minute = Number(ampm[3] ?? 0);
    const mer = (ampm[4] || '').toLowerCase();
    if (mer === 'pm' && hour < 12) hour += 12;
    if (mer === 'am' && hour === 12) hour = 0;
    return day.set({ hour, minute, second: 0, millisecond: 0 }).toFormat("yyyy-LL-dd'T'HH:mm:ss");
  }
  const week = raw.match(
    /^(this\s+|next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i,
  );
  if (week) {
    const next = Boolean(week[1] && /next/i.test(week[1]));
    let delta = weekdayOffset(week[2]!, now);
    if (delta < 0) return null;
    if (next) delta += 7;
    let hour = Number(week[3]);
    const minute = Number(week[4] ?? 0);
    const mer = (week[5] || '').toLowerCase();
    if (mer === 'pm' && hour < 12) hour += 12;
    if (mer === 'am' && hour === 12) hour = 0;
    if (!mer && hour <= 7) hour += 12;
    return now
      .plus({ days: delta })
      .set({ hour, minute, second: 0, millisecond: 0 })
      .toFormat("yyyy-LL-dd'T'HH:mm:ss");
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw;
  return null;
}

/** "Remind me tomorrow at 9am to call Ada" / "Remind me Friday at 2pm to prep" */
function parseRemindAsk(text: string): ParsedCommand | null {
  const t = text.trim();
  const m = t.match(/^remind\s+me\s+(.+?)\s+to\s+(.+)$/i);
  if (!m) return null;
  const whenRaw = m[1]!.trim();
  const title = m[2]!.trim().replace(/[.?!]+$/, '');
  if (!title || title.length > 120) return null;
  const home = homeTimezone();
  const now = DateTime.now().setZone(home);
  const when = normalizeRemindWhen(whenRaw, now);
  if (!when) return null;
  return {
    intent: 'remind',
    reply: `Got it. I'll remind you about “${title}”.`,
    needs_clarification: false,
    remind: { title, when, timezone: home, body: null },
  };
}

function parseRemindAskLoose(text: string): ParsedCommand | null {
  const m = text.match(/\bremind\s+me\s+(.+?)\s+to\s+([^.,;\n]+)/i);
  if (!m) return null;
  return parseRemindAsk(`Remind me ${m[1]!.trim()} to ${m[2]!.trim()}`);
}

/** "Draft a LinkedIn post about X" / "post: we're hiring" / exact text */
function parseDraftAsk(text: string): ParsedCommand | null {
  const t = text.trim();
  if (/use this exact text:/i.test(t)) {
    const bodyMatch = t.match(/use this exact text:\s*([\s\S]+)/i);
    const body = bodyMatch?.[1]?.trim() ?? '';
    if (body.length >= 20) {
      const acct = t.match(/\b(?:on|for|to)\s+([a-z0-9._-]+)\b/i);
      const account =
        acct && /linkedin|personal|company|brand|page/i.test(acct[1]!) ? acct[1]! : null;
      return {
        intent: 'draft_post',
        reply: 'Queuing your exact text for approval.',
        needs_clarification: false,
        draft: {
          platform: 'linkedin',
          account,
          brief: `use this exact text: ${body}`,
          facts: null,
        },
      };
    }
  }
  const commander = t.match(/^post\s*:\s*(.+)$/i);
  if (commander) {
    const brief = commander[1]!.trim();
    if (brief.length >= 3) {
      return {
        intent: 'draft_post',
        reply: 'Drafting a LinkedIn post about that.',
        needs_clarification: false,
        draft: { platform: 'linkedin', account: null, brief, facts: null },
      };
    }
  }
  const m = t.match(
    /^(?:please\s+)?(?:draft|write|compose)\s+(?:an?\s+)?(?:(linkedin|twitter|x)\s+)?(?:post|update)\s+(?:about|on|for)\s+(.+)$/i,
  );
  if (!m) return null;
  const platformRaw = (m[1] || 'linkedin').toLowerCase();
  const platform = platformRaw === 'twitter' || platformRaw === 'x' ? 'x' : 'linkedin';
  const brief = m[2]!.trim().replace(/[.?!]+$/, '');
  if (brief.length < 3) return null;
  let account: string | null = null;
  let briefClean = brief;
  const acct = brief.match(/^(?:for\s+)?([a-z0-9._-]+)\s+(?:about|on)\s+(.+)$/i);
  if (acct && /linkedin|personal|company|brand|page/i.test(acct[1]!)) {
    account = acct[1]!;
    briefClean = acct[2]!.trim();
  }
  return {
    intent: 'draft_post',
    reply: `Drafting a ${platform === 'x' ? 'Twitter/X' : 'LinkedIn'} post about that.`,
    needs_clarification: false,
    draft: { platform, account, brief: briefClean, facts: null },
  };
}

async function runDraft(parsed: ParsedCommand): Promise<VaResult> {
  const d = parsed.draft;
  if (!d?.brief) {
    return { ok: false, intent: 'draft_post', reply: parsed.reply || 'Tell me what the post should be about.' };
  }

  const platform = (d.platform || 'linkedin').toLowerCase().replace('twitter', 'x');
  if (!isPlatformId(platform) || (platform !== 'linkedin' && platform !== 'x')) {
    return { ok: false, intent: 'draft_post', reply: `Platform must be linkedin or x (got "${d.platform}").` };
  }

  const resolved = resolveAccountName(d.account, platform);
  if (resolved.clarify) {
    return { ok: true, intent: 'draft_post', reply: resolved.clarify };
  }
  const accountName = resolved.name;
  if (!accountName) {
    return { ok: false, intent: 'draft_post', reply: `No ${platform} account connected.` };
  }
  const account = getAccountByName(accountName);
  if (!account) {
    return { ok: false, intent: 'draft_post', reply: `No account named "${accountName}".` };
  }

  const exactBody = extractExactPostBody(d.brief) ?? extractExactPostBody(parsed.reply || '');
  let body: string;
  let templateId: string | null = null;
  let violations: string[] = [];
  let gateOk = true;

  if (exactBody) {
    // User pasted the final copy. Template bank still applies to agent-written posts;
    // user-supplied exact text is gated for length/banned words, then still needs Approve.
    const { gate } = await import('../content/gate.ts');
    const g = gate({
      platform: platform as 'linkedin' | 'x',
      kind: 'post',
      body: exactBody,
      provenance: 'founder_approved',
    });
    body = g.body;
    gateOk = g.pass;
    violations = g.violations;
    templateId = null;
  } else {
    const prefs = recall({ scope: 'preference', limit: 8 })
      .map((r) => r.value)
      .filter(Boolean);
    const voiceFacts = [
      d.facts?.trim() || '',
      prefs.length
        ? `Founder voice and preferences (follow these; do not invent metrics):\n${prefs.map((p) => `- ${p}`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const result = await generate({
      ai: buildAiClient(),
      platform,
      kind: 'post',
      brief: d.brief,
      facts: voiceFacts || undefined,
      usage: templateUsage(account.id),
      recentBodies: recentPublishedBodies(account.id),
      onLog: (l) => engine.log(l),
    });
    body = result.body;
    templateId = result.templateId;
    gateOk = result.ok;
    violations = result.violations;
  }

  const row = createContent({
    accountId: account.id,
    platform,
    kind: 'post',
    templateId,
    body,
    state: gateOk ? 'drafted' : 'blocked',
    violations,
    meta: { brief: d.brief, via: 'va_ask', exact: Boolean(exactBody) },
  });

  if (!gateOk) {
    return {
      ok: false,
      intent: 'draft_post',
      reply: [
        parsed.reply,
        '',
        `I drafted something, but the content gate blocked it before approval: ${violations.join('; ')}`,
        '',
        'Try a simpler brief, or open the Pg tab to edit the draft.',
        '',
        body.slice(0, 800),
      ]
        .filter(Boolean)
        .join('\n'),
      detail: { content: row, gate: { pass: false, violations } },
    };
  }

  // Chat-first: same approval card as the Ok tab. Exact final text before queue.
  const { ensureContentApproval, approvalToCard } = await import('../guardrails/approvals.ts');
  const approval = ensureContentApproval(row.id);
  const card = approvalToCard(approval);

  return {
    ok: true,
    intent: 'draft_post',
    reply: [
      parsed.reply?.trim() || 'Here is a draft.',
      '',
      exactBody ? body : '',
      exactBody ? '' : undefined,
      `Draft #${row.id} for ${accountName} (${platform}).`,
      'Approve queues this exact text (Ok tab). Nothing posts until you approve and you start the social engine. Voice cannot approve.',
    ]
      .filter((line) => line !== undefined)
      .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
      .join('\n'),
    detail: {
      content: row,
      gate: { pass: true, violations: [] },
      approval: card,
      approvals: [card],
    },
  };
}

async function runFollowUp(parsed: ParsedCommand): Promise<VaResult> {
  const f = parsed.follow_up;
  if (!f?.who || !f.what) {
    return { ok: false, intent: 'follow_up', reply: parsed.reply || 'Who should I follow up with, and about what?' };
  }

  let dueAt: string | null = null;
  let homeLocal: string | null = null;
  if (f.due) {
    const converted = convertWallTime({ isoOrLocal: f.due, sourceTz: f.timezone });
    if (!converted.ok) {
      return { ok: false, intent: 'follow_up', reply: `Could not read due date: ${converted.error}` };
    }
    dueAt = converted.utcIso;
    homeLocal = converted.homeLocal;
    createReminder({
      title: `Follow up: ${f.who}`,
      body: f.what,
      dueAt,
    });
  }

  const row = createFollowUp({ who: f.who, what: f.what, dueAt });

  return {
    ok: true,
    intent: 'follow_up',
    reply: [
      parsed.reply,
      '',
      `Follow-up #${row.id}: ${row.who}: ${row.what}`,
      homeLocal ? `Due: ${homeLocal}` : 'No due date set.',
    ]
      .filter(Boolean)
      .join('\n'),
    detail: { followUp: row },
  };
}

function friendlyWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(homeTimezone());
  if (!dt.isValid) return iso;
  const now = DateTime.now().setZone(homeTimezone());
  if (dt.hasSame(now, 'day')) return `today at ${dt.toFormat('h:mm a')}`;
  if (dt.hasSame(now.plus({ days: 1 }), 'day')) return `tomorrow at ${dt.toFormat('h:mm a')}`;
  return dt.toFormat("ccc d LLL 'at' h:mm a");
}

function clockLabel(iso: string): string {
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(homeTimezone());
  if (!dt.isValid) return iso;
  return dt.toFormat('h:mm a');
}

function runStatus(parsed: ParsedCommand): VaResult {
  const lastUser = [...recentTurns(4)].reverse().find((t) => t.role === 'user')?.text ?? '';
  const ask = `${lastUser}\n${parsed.reply || ''}`;
  const wantTomorrow = /\btomorrow\b/i.test(ask);
  const wantMeetings = /\b(meeting|meetings|calendar|schedule|what's on|whats on)\b/i.test(ask)
    || wantTomorrow;
  const wantReminders = /\breminders?\b/i.test(ask) && !wantMeetings;
  const wantFollowups = /\bfollow-?ups?\b/i.test(ask);
  const wantAccounts = /\b(linkedin|twitter|\bx\b|accounts?|connected)\b/i.test(ask);
  const wantPlate = /\b(on my plate|overview|status|everything|catch me up)\b/i.test(ask);
  const greets = /\b(hi|hello|hey|how are you|how's it going)\b/i.test(lastUser);

  const focus: 'meetings' | 'reminders' | 'followups' | 'accounts' | 'plate' =
    wantAccounts && !wantMeetings && !wantPlate ? 'accounts'
    : wantFollowups && !wantPlate ? 'followups'
    : wantReminders ? 'reminders'
    : wantMeetings && !wantPlate ? 'meetings'
    : 'plate';

  const tomorrow = DateTime.now().setZone(homeTimezone()).plus({ days: 1 }).toISODate();
  let events = listUpcomingEvents(20);
  if (wantTomorrow && tomorrow) {
    events = events.filter(
      (e) => DateTime.fromISO(e.start_at, { zone: 'utc' }).setZone(homeTimezone()).toISODate() === tomorrow,
    );
  } else {
    events = events.slice(0, focus === 'plate' ? 5 : 8);
  }
  const reminders = listReminders(30)
    .filter((r) => r.state === 'scheduled')
    .slice(0, focus === 'reminders' ? 12 : 8);
  const followups = listOpenFollowUps(8);
  const accounts = listAccounts();

  const greeting = greets ? "I'm good, thanks." : '';
  const lines: string[] = [];
  if (greeting) lines.push(greeting, '');

  const eventCards = events.map((e) => ({
    title: e.title,
    when: wantTomorrow ? clockLabel(e.start_at) : friendlyWhen(e.start_at),
    raw: e.start_at,
  }));
  const reminderCards = reminders.map((r) => ({
    title: r.title,
    when: friendlyWhen(r.due_at),
  }));
  const followCards = followups.map((f) => ({
    who: f.who,
    what: f.what,
    when: friendlyWhen(f.due_at),
  }));

  if (focus === 'meetings') {
    const heading = wantTomorrow ? "Tomorrow's meetings" : 'Upcoming meetings';
    if (!events.length) {
      lines.push(wantTomorrow ? 'Nothing on the calendar for tomorrow.' : 'Nothing coming up on the calendar.');
    } else {
      lines.push(`${heading} (${events.length}):`);
      for (const e of events) {
        lines.push(`• ${e.title} · ${wantTomorrow ? clockLabel(e.start_at) : friendlyWhen(e.start_at)}`);
      }
    }
    return {
      ok: true,
      intent: 'status',
      reply: lines.join('\n').trim(),
      detail: { cards: { events: eventCards }, focus },
    };
  }

  if (focus === 'reminders') {
    lines.push(reminders.length ? `Reminders (${reminders.length}):` : 'No upcoming reminders.');
    for (const r of reminders) lines.push(`• ${r.title} · ${friendlyWhen(r.due_at)}`);
    return {
      ok: true,
      intent: 'status',
      reply: lines.join('\n').trim(),
      detail: { cards: { reminders: reminderCards }, focus },
    };
  }

  if (focus === 'followups') {
    lines.push(followups.length ? `Follow-ups (${followups.length}):` : 'No open follow-ups.');
    for (const f of followups) {
      lines.push(`• ${f.who}: ${f.what}${f.due_at ? ` · ${friendlyWhen(f.due_at)}` : ''}`);
    }
    return {
      ok: true,
      intent: 'status',
      reply: lines.join('\n').trim(),
      detail: { cards: { followups: followCards }, focus },
    };
  }

  if (focus === 'accounts') {
    if (!accounts.length) lines.push('No social accounts connected yet.');
    else {
      lines.push('Social accounts:');
      for (const a of accounts) {
        const label = a.name === 'twitter' ? 'Twitter / X' : a.name === 'linkedin' ? 'LinkedIn' : a.name;
        lines.push(`• ${label} · ${a.status === 'ok' ? 'connected' : a.status}`);
      }
    }
    return {
      ok: true,
      intent: 'status',
      reply: lines.join('\n').trim(),
      detail: {
        cards: {
          accounts: accounts.map((a) => ({ name: a.name, platform: a.platform, status: a.status })),
        },
        focus,
      },
    };
  }

  // Full plate: short structured sections, no SMTP / connection noise.
  lines.push("Here's your plate.");
  lines.push(`Context: ${contextLabel(activeContext())}.`);
  lines.push('');
  lines.push(wantTomorrow ? "Tomorrow's meetings:" : 'Meetings:');
  if (!events.length) lines.push('• none');
  else for (const e of events) {
    lines.push(`• ${e.title} · ${wantTomorrow ? clockLabel(e.start_at) : friendlyWhen(e.start_at)}`);
  }
  lines.push('');
  lines.push('Reminders:');
  if (!reminders.length) lines.push('• none');
  else for (const r of reminders.slice(0, 8)) {
    lines.push(`• ${r.title} · ${friendlyWhen(r.due_at)}`);
  }
  if (followups.length) {
    lines.push('');
    lines.push('Follow-ups:');
    for (const f of followups.slice(0, 4)) {
      lines.push(`• ${f.who}: ${f.what}`);
    }
  }

  return {
    ok: true,
    intent: 'status',
    reply: lines.join('\n').trim(),
    detail: {
      cards: {
        events: eventCards,
        reminders: reminderCards.slice(0, 4),
        followups: followCards.slice(0, 3),
      },
      focus,
    },
  };
}
