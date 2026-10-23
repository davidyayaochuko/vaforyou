/**
 * Slack connector (user token). Reads run immediately; sends go through Approvals.
 * Prefer a user token (xoxp-…) so Funke acts as the owner. Document that sensitivity
 * on the consent screen when the setup wizard lands.
 *
 * Minimal user-token scopes to request when creating the Slack app:
 *   search:read, channels:history, groups:history, im:history, mpim:history,
 *   channels:read, groups:read, im:read, mpim:read, users:read, chat:write
 */
import { createHash } from 'node:crypto';
import { env } from '../config/env.ts';

export type SlackAskResult = {
  ok: boolean;
  reply: string;
  approval?: {
    id: number;
    title: string;
    summary: string;
    preview: string | null;
    actionType: string;
    expiresAt: string | null;
  };
};

type SlackApiOk = { ok: true; [k: string]: unknown };
type SlackApiErr = { ok: false; error?: string };

export function slackConfigured(): boolean {
  return Boolean(env.slackUserToken.trim());
}

export function slackSetupReply(): string {
  return [
    'Slack is not connected yet.',
    '',
    '1. Create a Slack app at https://api.slack.com/apps (from scratch).',
    '2. Under OAuth & Permissions, add user-token scopes:',
    '   search:read, channels:history, groups:history, im:history, mpim:history,',
    '   channels:read, groups:read, im:read, mpim:read, users:read, chat:write',
    '3. Install to your workspace and copy the User OAuth Token (starts with xoxp-).',
    '4. Set SLACK_USER_TOKEN in .env and restart.',
    '',
    'That token acts as you. Treat it like a password. Revoke anytime in Slack →',
    'Settings → Apps. Sends still wait on Approvals; voice cannot approve.',
  ].join('\n');
}

/** True when the user is asking about Slack, not local chat. */
export function isSlackAsk(text: string): boolean {
  const t = text.trim();
  if (/\bslack\b/i.test(t)) return true;
  if (/\bwhat did i miss\b/i.test(t) && /\b(channel|dm|mention|thread|#)\b/i.test(t)) return true;
  if (/\bdraft (a )?reply\b/i.test(t) && /#\w+/.test(t)) return true;
  return false;
}

function isSendAsk(text: string): boolean {
  return /\b(send|post|publish)\b/i.test(text) && /\b(slack|message|#\w+|dm)\b/i.test(text);
}

function isDraftAsk(text: string): boolean {
  return /\bdraft\b/i.test(text) && /\b(reply|message|slack)\b/i.test(text);
}

async function slackApi<T extends Record<string, unknown>>(
  method: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T & (SlackApiOk | SlackApiErr)> {
  const token = env.slackUserToken.trim();
  if (!token) throw new Error('SLACK_USER_TOKEN is not set.');
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    body.set(k, String(v));
  }
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const json = (await res.json()) as T & (SlackApiOk | SlackApiErr);
  return json;
}

export async function postSlackMessage(opts: {
  channel: string;
  text: string;
  threadTs?: string;
}): Promise<{ ok: boolean; reply: string; detail?: unknown }> {
  const channel = opts.channel.trim();
  const text = opts.text.trim();
  if (!channel || !text) {
    return { ok: false, reply: 'Slack send needs a channel and message text.' };
  }
  try {
    const res = await slackApi<{ channel?: string; ts?: string }>('chat.postMessage', {
      channel,
      text,
      thread_ts: opts.threadTs,
    });
    if (!res.ok) {
      return {
        ok: false,
        reply: `Slack refused the send (${res.error ?? 'unknown'}). Check chat:write and channel access.`,
        detail: res,
      };
    }
    return {
      ok: true,
      reply: `Sent to ${channel}${opts.threadTs ? ' (thread)' : ''}.`,
      detail: { channel: res.channel, ts: res.ts },
    };
  } catch (err) {
    return {
      ok: false,
      reply: `I could not reach Slack (${err instanceof Error ? err.message : String(err)}).`,
    };
  }
}

function channelFromText(text: string): string | null {
  const m = text.match(/#([a-z0-9_-]+)/i);
  return m ? `#${m[1]}` : null;
}

function draftBodyFromText(text: string): string {
  const m = text.match(/\bdraft\b[\s\S]{0,40}\breply\b[:\s]+(.+)$/i)
    || text.match(/\b(?:say|message|reply)\b[:\s]+[“"']?(.+?)[”"']?\s*$/i);
  return (m?.[1] ?? text).trim().slice(0, 2000);
}

async function digestMissed(): Promise<SlackAskResult> {
  const res = await slackApi<{
    messages?: {
      matches?: Array<{
        text?: string;
        username?: string;
        channel?: { name?: string; id?: string };
        permalink?: string;
        ts?: string;
      }>;
    };
  }>('search.messages', {
    query: 'is:unreads OR is:mention',
    count: 12,
    sort: 'timestamp',
    sort_dir: 'desc',
  });

  if (!res.ok) {
    // search:read may be missing; fall back to auth.test so setup errors are clear.
    const auth = await slackApi<{ user?: string; team?: string }>('auth.test', {});
    if (!auth.ok) {
      return {
        ok: false,
        reply: `Slack auth failed (${auth.error ?? 'unknown'}). Check SLACK_USER_TOKEN.`,
      };
    }
    return {
      ok: false,
      reply:
        `Signed in to Slack as ${auth.user ?? 'you'} on ${auth.team ?? 'your workspace'}, `
        + `but search.messages failed (${res.error ?? 'unknown'}). `
        + 'Add the search:read user-token scope and reinstall the app.',
    };
  }

  const matches = res.messages?.matches ?? [];
  if (!matches.length) {
    return {
      ok: true,
      reply: 'Nothing jumped out in Slack search for unreads/mentions. You are clear for now.',
    };
  }

  const lines = ['Here is what Slack search surfaced (unreads / mentions):', ''];
  for (const m of matches.slice(0, 10)) {
    const where = m.channel?.name ? `#${m.channel.name}` : m.channel?.id || 'chat';
    const who = m.username || 'someone';
    const bit = String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const link = m.permalink ? `\n  ${m.permalink}` : '';
    lines.push(`• ${where} · ${who}: ${bit}${link}`);
  }
  lines.push('', 'I did not send anything. Ask me to draft a reply if you want one queued for Approve.');
  return { ok: true, reply: lines.join('\n') };
}

async function draftReply(text: string): Promise<SlackAskResult> {
  const channel = channelFromText(text) || 'the channel you name';
  const body = draftBodyFromText(text);
  const preview = `To: ${channel}\n\n${body}`;
  return {
    ok: true,
    reply: [
      'Draft Slack reply (not sent):',
      '',
      preview,
      '',
      'Say “send this on Slack to #channel: …” with the final text when you want it queued for Approve.',
    ].join('\n'),
  };
}

async function queueSend(text: string): Promise<SlackAskResult> {
  const channel = channelFromText(text);
  if (!channel) {
    return {
      ok: false,
      reply: 'Name a channel like #ops when you ask me to send on Slack, e.g. “send on Slack to #ops: we shipped”.',
    };
  }
  const afterChannel = text.replace(/#\S+/i, ' ').replace(/\b(send|post|publish|on slack|slack|to|in|message)\b/gi, ' ');
  const message = afterChannel.replace(/^[:\s-]+/, '').trim();
  if (message.length < 2) {
    return { ok: false, reply: 'I need the message text after the channel name.' };
  }

  const { requestAction, approvalToCard } = await import('../guardrails/approvals.ts');
  const idem = createHash('sha256')
    .update(JSON.stringify({ channel, message: message.slice(0, 400) }))
    .digest('hex')
    .slice(0, 24);
  const outcome = await requestAction({
    actionType: 'slack.send',
    title: `Slack: send to ${channel}`,
    summary: `Post as you in ${channel}`,
    preview: message,
    sourceText: text,
    idempotencyKey: `slack-${idem}`,
    payload: { channel, text: message },
  });
  return {
    ok: outcome.ok,
    reply: outcome.reply,
    approval: outcome.approval ? approvalToCard(outcome.approval) : undefined,
  };
}

/** Chat entry: digest, draft, or queue a send. */
export async function askSlack(text: string): Promise<SlackAskResult> {
  if (!slackConfigured()) {
    return { ok: false, reply: slackSetupReply() };
  }
  try {
    if (isSendAsk(text)) return await queueSend(text);
    if (isDraftAsk(text)) return await draftReply(text);
    return await digestMissed();
  } catch (err) {
    return {
      ok: false,
      reply: `Slack request failed (${err instanceof Error ? err.message : String(err)}).`,
    };
  }
}
