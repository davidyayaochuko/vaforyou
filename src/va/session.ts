/**
 * Short-lived conversation memory for Funke.
 * Lets follow-up messages complete a half-finished ask (time without title, etc.).
 */

export interface ChatTurn {
  role: 'user' | 'funke';
  text: string;
  intent?: string;
  at: number;
}

export interface PendingAsk {
  intent: 'remind' | 'calendar_create' | 'draft_post' | 'follow_up';
  partial: Record<string, unknown>;
  askedAt: number;
}

const MAX_TURNS = 12;
const PENDING_TTL_MS = 15 * 60_000;

let turns: ChatTurn[] = [];
let pending: PendingAsk | null = null;

export function pushTurn(role: 'user' | 'funke', text: string, intent?: string): void {
  turns.push({ role, text, intent, at: Date.now() });
  if (turns.length > MAX_TURNS) turns = turns.slice(-MAX_TURNS);
}

export function recentTurns(limit = 8): ChatTurn[] {
  return turns.slice(-limit);
}

export function conversationBlock(limit = 8): string {
  const slice = recentTurns(limit);
  if (!slice.length) return '';
  return slice
    .map((t) => `${t.role === 'user' ? 'User' : 'Funke'}: ${t.text}`)
    .join('\n');
}

export function getPending(): PendingAsk | null {
  if (!pending) return null;
  if (Date.now() - pending.askedAt > PENDING_TTL_MS) {
    pending = null;
    return null;
  }
  return pending;
}

export function setPending(next: PendingAsk | null): void {
  pending = next;
}

export function clearPending(): void {
  pending = null;
}

export function clearSession(): void {
  turns = [];
  pending = null;
}
