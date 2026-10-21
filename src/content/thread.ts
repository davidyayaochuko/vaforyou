import { splitThread } from '../platforms/x.ts';

/**
 * Turn one over-long post into the numbered thread the publisher already
 * understands: lines that start "1/ ", "2/ ", and so on. Each part stays
 * inside maxChars, including that prefix.
 */
export function fitAsThread(body: string, maxChars: number): { body: string; threaded: boolean } {
  const trimmed = body.trim();
  if (!trimmed) return { body: trimmed, threaded: false };

  const existing = splitThread(trimmed);
  if (existing.length > 1 && existing.every((part) => part.length <= maxChars)) {
    return { body: trimmed, threaded: true };
  }

  const plain = existing
    .map((part) => part.replace(/^\s*\d+\s*[/.]\s+/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  // "99/ " is the widest prefix we plan for. The content budget stays under the cap.
  const budget = Math.max(20, maxChars - 4);
  const atoms = sentences(plain).flatMap((sentence) => chunks(sentence, budget));
  const tweets: string[] = [];
  let current = '';
  for (const atom of atoms) {
    const candidate = current ? `${current} ${atom}` : atom;
    if (candidate.length <= budget) {
      current = candidate;
    } else {
      if (current) tweets.push(current);
      current = atom;
    }
  }
  if (current) tweets.push(current);
  if (tweets.length < 2) return { body: trimmed, threaded: false };

  const threaded = tweets.map((tweet, i) => `${i + 1}/ ${tweet}`).join('\n\n');
  const parts = splitThread(threaded);
  if (parts.length < 2 || parts.some((part) => part.length > maxChars)) {
    return { body: trimmed, threaded: false };
  }
  return { body: threaded, threaded: true };
}

function sentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [text];
}

function chunks(text: string, budget: number): string[] {
  if (text.length <= budget) return [text];
  const out: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    if (word.length > budget) {
      if (current) out.push(current);
      for (let i = 0; i < word.length; i += budget) out.push(word.slice(i, i + budget));
      current = '';
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length <= budget) current = next;
    else {
      if (current) out.push(current);
      current = word;
    }
  }
  if (current) out.push(current);
  return out;
}
