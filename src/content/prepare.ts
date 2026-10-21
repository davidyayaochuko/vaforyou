import { getPlatform, isPlatformId } from '../platforms/index.ts';
import { splitThread } from '../platforms/x.ts';
import { replaceBannedWords } from './gate.ts';
import { fitAsThread } from './thread.ts';

/**
 * Mechanical normalization that must happen BEFORE a person approves.
 * After Approve, the body is frozen: queue and publish must not call this again.
 */
export function prepareContentBody(item: {
  platform: string;
  kind: string;
  body: string;
}): { body: string; note: string; changed: boolean } {
  let text = item.body;
  const notes: string[] = [];
  const softened = replaceBannedWords(text);
  if (softened.replaced.length > 0) {
    text = softened.body;
    notes.push(
      `I changed ${softened.replaced.map((w) => `"${w}"`).join(', ')} so the draft can pass the read-aloud check.`,
    );
  }

  if (isPlatformId(item.platform) && item.kind === 'post') {
    const rules = getPlatform(item.platform).rules.post;
    if (rules?.threads && rules.maxChars) {
      const over = splitThread(text).some((part) => part.length > rules.maxChars);
      if (over || text.length > rules.maxChars) {
        const fitted = fitAsThread(text, rules.maxChars);
        if (fitted.threaded && fitted.body !== text) {
          const count = splitThread(fitted.body).length;
          text = fitted.body;
          notes.push(
            `I turned this into a ${count}-part thread so each post stays within ${rules.maxChars} characters.`,
          );
        }
      }
    }
  }

  return { body: text, note: notes.join(' '), changed: text !== item.body };
}
