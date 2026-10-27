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
  opts?: { timeoutMs?: number },
): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('You look offline. Nothing was sent.');
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const t = token();
  if (t) headers.authorization = `Bearer ${t}`;

  const timeoutMs = opts?.timeoutMs ?? 45_000;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      signal: ctrl?.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`That took too long (>${Math.round(timeoutMs / 1000)}s). Try again.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

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
  // One quick retry only, long backoff stacks looked like “stuck on Thinking”.
  const delays = [0, 2000];
  let last: AskResult = { reply: '', approvals: [] };
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
    const data = await api<AskResponse>('/api/ask', 'POST', { text }, { timeoutMs: 40_000 });
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

export type VaTask = {
  id: number;
  title: string;
  kind: string;
  due_at: string | null;
  state: string;
  priority: number;
  who: string | null;
};

export type VaStatus = {
  homeTimezone?: string;
  emailConfigured?: boolean;
  reminders?: Reminder[];
  events?: CalendarEvent[];
  followups?: FollowUp[];
  tasks?: VaTask[];
  tasksDone?: VaTask[];
  approvalsPending?: number;
};

export type TodayPlate = {
  homeTimezone?: string;
  tasks?: VaTask[];
  events?: CalendarEvent[];
  approvals?: { id: number; title: string; summary: string; actionType: string }[];
  ranked?: number[];
};

export async function fetchVaStatus(): Promise<VaStatus> {
  return api<VaStatus>('/api/va/status');
}

export async function fetchToday(): Promise<TodayPlate> {
  return api<TodayPlate>('/api/va/today');
}

export async function completeTask(id: number): Promise<{ ok?: boolean }> {
  return api('/api/va/tasks/complete', 'POST', { id });
}

export async function prioritiseTasks(): Promise<{ ok?: boolean; tasks?: VaTask[] }> {
  return api('/api/va/tasks/prioritise', 'POST', {});
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

export type EngineStatus = { running?: boolean; paused?: boolean; state?: string };

export async function startEngine(): Promise<EngineStatus> {
  return api<EngineStatus>('/api/engine/start', 'POST', {});
}

export async function stopEngine(): Promise<EngineStatus> {
  return api<EngineStatus>('/api/engine/stop', 'POST', {}, { timeoutMs: 120_000 });
}

export type GoogleStatus = { configured: boolean; connected: boolean };

export async function fetchGoogleStatus(): Promise<GoogleStatus> {
  const s = await api<{ google?: GoogleStatus }>('/api/va/status');
  return s.google ?? { configured: false, connected: false };
}

/** Returns the Google consent URL. Throws with setup instructions when OAuth is not configured. */
export async function googleConnectUrl(): Promise<string> {
  return (await api<{ url: string }>('/api/google/start')).url;
}

export type VoiceStatus = {
  stt: { provider: string; model?: string; note?: string };
  tts: { provider: string; note?: string };
};

export async function fetchVoiceStatus(): Promise<VoiceStatus> {
  const [stt, tts] = await Promise.all([
    api<VoiceStatus['stt']>('/api/voice/stt'),
    api<VoiceStatus['tts']>('/api/voice/tts'),
  ]);
  return { stt, tts };
}

export type VocabTerm = { id: number; term: string; kind: string; pronunciation: string | null };

export async function fetchVocab(): Promise<VocabTerm[]> {
  return (await api<{ terms: VocabTerm[] }>('/api/voice/vocab')).terms ?? [];
}

export async function addVocab(term: string, pronunciation?: string): Promise<VocabTerm> {
  return api<VocabTerm>('/api/voice/vocab', 'POST', { term, pronunciation: pronunciation || null });
}

export async function removeVocab(id: number): Promise<{ ok?: boolean }> {
  return api('/api/voice/vocab/delete', 'POST', { id });
}

export type MemoryItem = { id: number; scope: string; key: string; value: string; contact: string };

export async function fetchMemory(): Promise<MemoryItem[]> {
  return api<MemoryItem[]>('/api/memory?limit=100');
}

export async function forgetMemory(id: number): Promise<{ ok?: boolean }> {
  return api('/api/memory/forget', 'POST', { id });
}

export async function forgetAllMemory(): Promise<unknown> {
  return api('/api/memory/forget-all', 'POST', { confirm: 'FORGET ALL' });
}

/** Ask the chat panel to open with text ready to send. */
export function openChatWith(text: string) {
  (window as unknown as { __funkePrefill?: string }).__funkePrefill = text;
  window.dispatchEvent(new CustomEvent('funke:open', { detail: { panel: 'chat', prefill: text } }));
}
