/**
 * Lightweight work contexts: personal / work / boss / named client.
 * Scopes durable memory; calendar and reminders stay global but can be labeled.
 */
import { getSetting, setSetting } from '../db/index.ts';

export type ContextId = string; // personal | work | boss | client:slug

const DEFAULT: ContextId = 'personal';

export function activeContext(): ContextId {
  const raw = getSetting<string>('active_context', DEFAULT);
  return (raw || DEFAULT).trim() || DEFAULT;
}

export function setActiveContext(id: string): ContextId {
  const next = normalizeContextId(id);
  setSetting('active_context', next);
  return next;
}

export function normalizeContextId(raw: string): ContextId {
  const t = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t || t === 'personal' || t === 'me' || t === 'default') return 'personal';
  if (t === 'work' || t === 'company') return 'work';
  if (t === 'boss' || t === 'ea' || t === 'executive') return 'boss';
  if (t.startsWith('client:')) return `client:${t.slice(7).replace(/\s+/g, '-')}`;
  if (t.startsWith('client ')) return `client:${t.slice(7).replace(/\s+/g, '-')}`;
  return `client:${t.replace(/\s+/g, '-')}`;
}

export function contextLabel(id: ContextId = activeContext()): string {
  if (id === 'personal') return 'Personal';
  if (id === 'work') return 'Work';
  if (id === 'boss') return 'Boss';
  if (id.startsWith('client:')) {
    return `Client ${id.slice(7).replace(/-/g, ' ')}`;
  }
  return id;
}

export function listKnownContexts(): { id: ContextId; label: string }[] {
  const saved = getSetting<string[]>('known_contexts', ['personal', 'work', 'boss']);
  const set = new Set<string>([DEFAULT, 'work', 'boss', activeContext(), ...saved]);
  return [...set].map((id) => ({ id, label: contextLabel(id) }));
}

export function rememberContext(id: ContextId): void {
  const known = getSetting<string[]>('known_contexts', ['personal', 'work', 'boss']);
  if (!known.includes(id)) {
    setSetting('known_contexts', [...known, id].slice(0, 40));
  }
}

/** Chat: "switch to boss context" / "working on client Adire" */
export function tryContextCommand(text: string): { reply: string; id: ContextId } | null {
  const t = text.trim();
  const switchTo = t.match(
    /^(?:switch\s+to|use|set)\s+(?:the\s+)?(.+?)\s+context\.?$/i,
  );
  const working = t.match(
    /^(?:working\s+(?:as\s+)?(?:ea\s+)?(?:for|on)|context\s*[:=]\s*)(.+)$/i,
  );
  const show = /^(?:which|what)\s+context\b|^show\s+context\b/i.test(t);
  if (show) {
    return {
      id: activeContext(),
      reply: `Active context: ${contextLabel()}. Say “switch to personal context” or “working on client Adire”.`,
    };
  }
  const raw = switchTo?.[1] || working?.[1];
  if (!raw) return null;
  const id = setActiveContext(raw.replace(/\s+context$/i, ''));
  rememberContext(id);
  return {
    id,
    reply: `Switched to ${contextLabel(id)}. New memories I save will be tagged for this context. Calendar stays shared; say the owner’s name in the title when it matters.`,
  };
}
