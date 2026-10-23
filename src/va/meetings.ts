/**
 * Meetings notetaker stub (Workstream E).
 * Wire to self-hosted Vexa when VEXA_API_URL is set. Until then, fail closed.
 * See docs/VEXA-MEETINGS.md.
 */
import { env } from '../config/env.ts';

export function meetingsConfigured(): boolean {
  return Boolean(env.vexaApiUrl.trim());
}

export function isMeetingsAsk(text: string): boolean {
  const t = text.trim();
  return (
    /\b(join|take notes|notetak|transcribe|meeting prep|prep (me )?for)\b/i.test(t)
    && /\b(meeting|call|zoom|meet|teams|standup|sync)\b/i.test(t)
  );
}

export function meetingsSetupReply(): string {
  return [
    'Meeting notes are not connected yet.',
    '',
    'Self-host Vexa (Apache 2.0), then set:',
    '  VEXA_API_URL=http://127.0.0.1:…',
    '  VEXA_API_KEY=…',
    '',
    'I will never join a call without an explicit opt-in for that meeting.',
    'Details: docs/VEXA-MEETINGS.md',
  ].join('\n');
}

export async function askMeetings(text: string): Promise<{ ok: boolean; reply: string }> {
  if (!meetingsConfigured()) {
    return { ok: false, reply: meetingsSetupReply() };
  }
  return {
    ok: false,
    reply:
      `Vexa is configured at ${env.vexaApiUrl}, but the join/transcript connector is still a stub. `
      + `Your ask was noted: ${text.slice(0, 200)}. See docs/VEXA-MEETINGS.md.`,
  };
}
