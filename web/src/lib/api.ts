/** Thin client for the Funke control API (proxied via Astro to :4310). */

function token(): string {
  if (typeof window === 'undefined') return '';
  try {
    return (
      (import.meta.env.PUBLIC_FUNKE_TOKEN as string | undefined) ||
      localStorage.getItem('funke-api-token') ||
      ''
    );
  } catch {
    return '';
  }
}

export async function api<T = unknown>(
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>,
): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('You look offline. Nothing was sent.');
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const t = token();
  if (t) headers.authorization = `Bearer ${t}`;

  const res = await fetch(path, {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });

  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    const msg =
      (data && typeof data === 'object' && 'error' in data && data.error) ||
      (res.status === 502 || res.status === 504
        ? 'The Funke server is not running. Start it with npm run start.'
        : `Request failed (${res.status})`);
    throw new Error(String(msg));
  }
  return data;
}

export type ApprovalCard = {
  id: number;
  title: string;
  summary: string;
  preview: string | null;
  actionType: string;
  expiresAt: string | null;
};

type AskResponse = {
  ok?: boolean;
  intent?: string;
  reply?: string;
  detail?: { approvals?: ApprovalCard[]; approval?: ApprovalCard } & Record<string, unknown>;
};

export type AskResult = { reply: string; approvals: ApprovalCard[] };

function isRateLimitedReply(reply: string): boolean {
  return /rate limit|busy right now|try the same ask again|tokens per minute|\b429\b/i.test(reply);
}

/** Ask Funke, with a short backoff when the AI provider is rate-limiting. */
export async function askFunkeDetailed(text: string): Promise<AskResult> {
  const delays = [0, 2500, 6000, 12000];
  let last: AskResult = { reply: '', approvals: [] };
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
    const data = await api<AskResponse>('/api/ask', 'POST', { text });
    const reply =
      typeof data.reply === 'string' && data.reply.trim()
        ? data.reply
        : 'I heard you, but I could not form a reply. Try again in a moment.';
    const approvals =
      data.detail?.approvals ?? (data.detail?.approval ? [data.detail.approval] : []);
    last = { reply, approvals };
    if (!isRateLimitedReply(reply)) {
      if (approvals.length && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('funke:approvals-changed'));
      }
      return last;
    }
  }
  if (last.approvals.length && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('funke:approvals-changed'));
  }
  return last;
}

export async function askFunke(text: string): Promise<string> {
  return (await askFunkeDetailed(text)).reply;
}

export type CalendarEvent = {
  id: number;
  title: string;
  start_at: string;
  end_at: string | null;
  location: string | null;
};

export type Reminder = {
  id: number;
  title: string;
  body: string | null;
  due_at: string;
  state: string;
};

export type FollowUp = {
  id: number;
  who: string;
  what: string;
  due_at: string | null;
  state: string;
};

export type VaStatus = {
  homeTimezone?: string;
  emailConfigured?: boolean;
  reminders?: Reminder[];
  events?: CalendarEvent[];
  followups?: FollowUp[];
};

export async function fetchVaStatus(): Promise<VaStatus> {
  return api<VaStatus>('/api/va/status');
}

export type Health = {
  ok?: boolean;
  engine?: { running?: boolean; paused?: boolean; state?: string };
  ai?: string | { kind?: string };
};

export async function fetchHealth(): Promise<Health> {
  return api<Health>('/api/health');
}

export async function fetchApprovals(): Promise<ApprovalCard[]> {
  return api<ApprovalCard[]>('/api/approvals');
}

export async function decideApproval(
  id: number,
  decision: 'approved' | 'rejected',
): Promise<{ ok?: boolean; reply?: string; status?: string }> {
  const out = await api<{ ok?: boolean; reply?: string; status?: string }>(
    '/api/approvals/decide',
    'POST',
    { id, decision, decidedBy: 'web' },
  );
  window.dispatchEvent(new CustomEvent('funke:approvals-changed'));
  return out;
}

export type Account = {
  id: number;
  name: string;
  platform?: string;
  status: string;
  last_seen_at?: string | null;
};

export async function fetchAccounts(): Promise<Account[]> {
  return api<Account[]>('/api/accounts');
}

/** Ask the chat panel to open with text ready to send. */
export function openChatWith(text: string) {
  (window as unknown as { __funkePrefill?: string }).__funkePrefill = text;
  window.dispatchEvent(new CustomEvent('funke:open', { detail: { panel: 'chat', prefill: text } }));
}
