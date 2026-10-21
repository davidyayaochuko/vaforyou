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
  if (style === 'detailed') {
    return 'Reply style: detailed. Use short paragraphs. Include numbered steps when guiding. Still no jargon dumps.';
  }
  if (style === 'normal') {
    return 'Reply style: normal. A few short sentences. One clarifying question max.';
  }
  return 'Reply style: brief. One or two short sentences unless they ask for steps.';
}
