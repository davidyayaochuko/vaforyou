/**
 * How long Funke's replies should be. Injected into voice / parse prompts.
 */
import { getSetting, setSetting } from '../db/index.ts';

export type ReplyStyle = 'brief' | 'normal' | 'detailed';

const ALLOWED: ReplyStyle[] = ['brief', 'normal', 'detailed'];

export function loadReplyStyle(): ReplyStyle {
  const raw = getSetting<string>('reply_style', 'brief');
  return ALLOWED.includes(raw as ReplyStyle) ? (raw as ReplyStyle) : 'brief';
}

export function saveReplyStyle(style: string): ReplyStyle {
  const next = ALLOWED.includes(style as ReplyStyle) ? (style as ReplyStyle) : 'brief';
  setSetting('reply_style', next);
  return next;
}

export function replyStylePromptBlock(style: ReplyStyle = loadReplyStyle()): string {
  const spoken =
    'Spoken cadence (read aloud, female voice): fluent Nigerian English that can dip into light Pidgin when casual ("abeg", "sha", "no wahala", "I sabi"), then clean English for exact facts. Short clauses, contractions, natural pauses. End a thought before the next. No bullet dumps, no telegram-speak, no semicolon stacks.';
  if (style === 'detailed') {
    return `${spoken}\nReply style: detailed. Short paragraphs. Numbered steps only when guiding. Still no jargon dumps.`;
  }
  if (style === 'normal') {
    return `${spoken}\nReply style: normal. A few short sentences. One clarifying question max.`;
  }
  return `${spoken}\nReply style: brief. One or two short sentences unless they ask for steps.`;
}
