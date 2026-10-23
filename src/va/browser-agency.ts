/**
 * General browser agency (Workstream H spike).
 * Separate from social Chromium profiles under PROFILES_DIR — never reuse those.
 *
 * When PLAYWRIGHT_MCP_COMMAND is set, Funke can ask the Playwright MCP server to
 * browse/fill. Submits and anything payment-adjacent go through Approvals / hard blocks.
 * Until the MCP is configured, asks get a clear setup reply (fail closed).
 */
import { env } from '../config/env.ts';
import { checkHardBoundary } from '../guardrails/boundaries.ts';

export type BrowserAgencyResult = {
  ok: boolean;
  reply: string;
};

export function browserAgencyConfigured(): boolean {
  return Boolean(env.playwrightMcpCommand.trim());
}

export function browserAgencySetupReply(): string {
  return [
    'General browser agency is not enabled yet (spike path).',
    '',
    'This lane is separate from your LinkedIn/X login profiles. It will never open those folders.',
    '',
    'To try the supervised Playwright MCP lane:',
    '  PLAYWRIGHT_MCP_COMMAND=npx',
    '  PLAYWRIGHT_MCP_ARGS=@playwright/mcp@latest',
    '',
    'Policy (enforced in code):',
    '  • Browse and fill public forms: OK when MCP is up',
    '  • Submit / send / pay: Approve or blocked',
    '  • Payment / checkout: hard-blocked — you finish pay yourself',
    '',
    'Say “fill the demo form at …” once the MCP env is set. Shopping stops at cart.',
  ].join('\n');
}

export function isBrowserAgencyAsk(text: string): boolean {
  const t = text.trim();
  if (/\b(linkedin|twitter|bluesky|x\.com)\b/i.test(t) && /\b(post|engage|dm|invite)\b/i.test(t)) {
    return false;
  }
  return (
    /\b(fill|book|browse|shop|cart|checkout|form|playwright)\b/i.test(t)
    && /\b(form|website|site|page|url|http|demo|ticket|hotel|flight|cart|checkout)\b/i.test(t)
  );
}

function isPaymentAsk(text: string): boolean {
  return /\b(pay|payment|checkout|buy now|place order|credit card|card number)\b/i.test(text);
}

function isSubmitAsk(text: string): boolean {
  return /\b(submit|send the form|confirm booking|complete (the )?purchase)\b/i.test(text);
}

/**
 * Spike handler: hard-block payments; otherwise fail closed with setup or a
 * clear “MCP not wired for live control yet” message. Full MCP tool loop is next.
 */
export async function askBrowserAgency(text: string): Promise<BrowserAgencyResult> {
  const boundary = checkHardBoundary(text, isPaymentAsk(text) ? 'payment.any' : undefined);
  if (boundary.level === 'blocked' || isPaymentAsk(text)) {
    return {
      ok: false,
      reply:
        'I will not enter payment details or complete checkout. I can stop at a cart or filled form; you finish pay yourself.',
    };
  }

  if (!browserAgencyConfigured()) {
    return { ok: false, reply: browserAgencySetupReply() };
  }

  if (isSubmitAsk(text)) {
    return {
      ok: false,
      reply:
        'Form submit is gated. The Playwright MCP lane is configured, but live submit-through-Approve is still the spike follow-up. '
        + 'For now, I will not submit. Browse/fill demos land in the next pass.',
    };
  }

  return {
    ok: true,
    reply: [
      'Playwright MCP is configured (`PLAYWRIGHT_MCP_COMMAND`).',
      'Live browse/fill tool calls are the next wire-up after this spike (stdio client, same pattern as Workspace MCP).',
      'Social profiles under PROFILES_DIR stay untouched.',
      '',
      `Your ask: ${text.slice(0, 280)}`,
    ].join('\n'),
  };
}
