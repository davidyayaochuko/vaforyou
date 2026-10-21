/**
 * Text-to-speech helpers.
 * Browser speechSynthesis is the default; Azure en-NG is optional via server.
 * What we send to TTS must match the spoken line shown on screen.
 */

export const MAX_SPOKEN = 240;

const ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function underThousand(n: number): string {
  if (n < 20) return ONES[n] || '';
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)] || '';
    const o = ONES[n % 10] || '';
    return o ? `${t} ${o}` : t;
  }
  const h = ONES[Math.floor(n / 100)] || '';
  const rest = n % 100;
  return rest ? `${h} hundred ${underThousand(rest)}` : `${h} hundred`;
}

/** Speak integers up to 999,999,999 in plain English. */
export function numberToWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  if (n === 0) return 'zero';
  if (n < 1000) return underThousand(n);
  if (n < 1_000_000) {
    const k = Math.floor(n / 1000);
    const rest = n % 1000;
    return rest
      ? `${underThousand(k)} thousand ${underThousand(rest)}`
      : `${underThousand(k)} thousand`;
  }
  const m = Math.floor(n / 1_000_000);
  const rest = n % 1_000_000;
  return rest
    ? `${underThousand(m)} million ${numberToWords(rest)}`
    : `${underThousand(m)} million`;
}

export function applyPronunciation(text: string, map: Record<string, string>): string {
  let out = text;
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const term of keys) {
    const spoken = map[term];
    if (!spoken) continue;
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    out = out.replace(re, spoken);
  }
  return out;
}

/**
 * Clean text for speech. Shared by browser and Azure adapters.
 * Does not truncate; use spokenLine() for on-screen spoken + audio parity.
 */
export function prepareForSpeech(
  text: string,
  pronunciation: Record<string, string> = {},
): string {
  let t = String(text ?? '');
  t = t.replace(/\u2014/g, '-');
  t = t.replace(/[*_~`#]+/g, '');
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, '$1 link');
  t = t.replace(/https?:\/\/\S+/gi, 'link');
  t = t.replace(/₦\s?([\d,]+(?:\.\d+)?)/g, (_m, num: string) => {
    const n = Number(String(num).replace(/,/g, ''));
    if (!Number.isFinite(n)) return 'naira';
    return `${numberToWords(Math.round(n))} naira`;
  });
  t = t.replace(/\bNGN\s?([\d,]+)/gi, (_m, num: string) => {
    const n = Number(String(num).replace(/,/g, ''));
    return Number.isFinite(n) ? `${numberToWords(Math.round(n))} naira` : 'naira';
  });
  t = t.replace(/\b(\d{1,2})\s*:\s*(\d{2})\s*(am|pm)\b/gi, (_m, h, min, ap) => {
    const hour = Number(h);
    const minute = Number(min);
    const apWord = String(ap).toLowerCase() === 'am' ? 'a.m.' : 'p.m.';
    const hourWords = numberToWords(hour);
    if (minute === 0) return `${hourWords} ${apWord}`;
    return `${hourWords} ${numberToWords(minute)} ${apWord}`;
  });
  t = t.replace(/\b(\d{1,2})\s*(am|pm)\b/gi, (_m, h, ap) => {
    const apWord = String(ap).toLowerCase() === 'am' ? 'a.m.' : 'p.m.';
    return `${numberToWords(Number(h))} ${apWord}`;
  });
  t = t.replace(/\n+/g, '. ').replace(/\s+/g, ' ').trim();
  t = applyPronunciation(t, pronunciation);
  return t;
}

export function splitSentences(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const parts = t.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [t];
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Build the exact line that should be spoken AND shown as the spoken caption.
 * Approvals get a fixed short line. Long replies get a short summary ending with
 * "Details are on screen."
 */
export function spokenLine(
  text: string,
  opts: { hasApproval?: boolean; pronunciation?: Record<string, string> } = {},
): { spoken: string; isSummary: boolean } {
  if (opts.hasApproval || isApprovalPrompt(text)) {
    const spoken = prepareForSpeech(
      'I need your approval on screen. Voice cannot approve.',
      opts.pronunciation,
    );
    return { spoken, isSummary: true };
  }
  const prepared = prepareForSpeech(text, opts.pronunciation);
  if (!prepared) return { spoken: '', isSummary: false };
  if (prepared.length <= MAX_SPOKEN) return { spoken: prepared, isSummary: false };

  const para = prepared.split(/\.\s+/).slice(0, 2).join('. ');
  let cut = para.length > MAX_SPOKEN ? para.slice(0, MAX_SPOKEN) : para;
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  if (lastStop > 80) cut = cut.slice(0, lastStop + 1);
  else cut = cut.replace(/\s+\S*$/, '');
  const spoken = `${cut.trim()} Details are on screen.`;
  return { spoken, isSummary: true };
}

/** @deprecated Prefer spokenLine(); kept for smoke compatibility. */
export function spokenSummary(text: string): string {
  return spokenLine(text).spoken;
}

export function isApprovalPrompt(text: string): boolean {
  return /I need your approval|Approve, edit, or reject|Voice cannot approve/i.test(text);
}

/** Prefer Nigerian English browser voices when listing. */
export function rankBrowserVoice(name: string, lang: string): number {
  const n = `${name} ${lang}`.toLowerCase();
  let score = 0;
  if (/en-ng|nigeria/.test(n)) score += 100;
  if (/ezinne|abeo/.test(n)) score += 40;
  if (/en-gb|en-us|en-za|en-in/.test(n)) score += 10;
  if (/natural|online/.test(n)) score += 5;
  return score;
}

export type TtsProviderId = 'browser' | 'azure';

export function pickDefaultBrowserVoiceUri(
  voices: { voiceURI: string; name: string; lang: string }[],
): string | null {
  if (!voices.length) return null;
  const sorted = [...voices].sort(
    (a, b) => rankBrowserVoice(b.name, b.lang) - rankBrowserVoice(a.name, a.lang),
  );
  return sorted[0]?.voiceURI ?? null;
}
