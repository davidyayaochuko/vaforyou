/**
 * Web research via a private SearXNG instance (HTTP JSON API).
 * Every returned web bullet must carry a URL. Unsourced lines are dropped.
 * Offline / unset SEARXNG_URL → fail closed (caller keeps memory/KB path).
 */
import { env } from '../config/env.ts';

export type ResearchHit = {
  title: string;
  url: string;
  snippet: string;
  engine?: string;
};

export type SearxSearchResult =
  | { ok: true; query: string; hits: ResearchHit[] }
  | { ok: false; query: string; error: string };

export function researchConfigured(): boolean {
  return Boolean(env.searxngUrl.trim());
}

/** Pull a usable query out of “Research RivalCo funding” / “look up X”. */
export function extractResearchQuery(text: string): string {
  const t = text.trim();
  const patterns = [
    /^(?:please\s+)?(?:research|look\s+up|brief\s+(?:me\s+)?on)\s+(.+)$/i,
    /^what\s+do\s+(?:we|you)\s+know\s+about\s+(.+)$/i,
    /^(.+?)\s+(?:funding|competitors?|raised)\s*$/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) return m[1].replace(/[?.!]+$/, '').trim();
  }
  return t.replace(/^(please\s+)?/i, '').trim();
}

export async function searchSearxng(query: string, limit = 6): Promise<SearxSearchResult> {
  const base = env.searxngUrl.replace(/\/$/, '');
  if (!base) {
    return { ok: false, query, error: 'SEARXNG_URL is not set.' };
  }
  const q = query.trim();
  if (!q) {
    return { ok: false, query: q, error: 'Empty research query.' };
  }

  const url = new URL(`${base}/search`);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'json');
  url.searchParams.set('language', 'en');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), env.searxngTimeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        query: q,
        error: `SearXNG returned HTTP ${res.status}. Is the private instance up?`,
      };
    }
    const ctype = res.headers.get('content-type') || '';
    if (!/json/i.test(ctype)) {
      return {
        ok: false,
        query: q,
        error:
          'SearXNG returned HTML instead of JSON. Enable json under search.formats in deploy/searxng/settings.yml and restart the container.',
      };
    }
    const body = (await res.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        engine?: string;
        engines?: string[];
      }>;
    };
    const hits = (body.results || [])
      .map((r): ResearchHit | null => {
        const link = String(r.url || '').trim();
        const title = String(r.title || '').trim();
        if (!link || !/^https?:\/\//i.test(link)) return null;
        if (!title) return null;
        return {
          title,
          url: link,
          snippet: String(r.content || '').replace(/\s+/g, ' ').trim().slice(0, 280),
          engine: r.engine || r.engines?.[0],
        };
      })
      .filter((h): h is ResearchHit => h !== null)
      .slice(0, Math.max(1, limit));

    return { ok: true, query: q, hits };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    const message = aborted
      ? `SearXNG timed out after ${env.searxngTimeoutMs}ms.`
      : err instanceof Error
        ? err.message
        : String(err);
    return {
      ok: false,
      query: q,
      error: `${message} Start it with: docker compose -f deploy/searxng/compose.yml up -d`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Drop any bullet that lacks a http(s) URL (FEATURES: unsourced claims dropped). */
export function stripUnsourcedClaims(lines: string[]): string[] {
  return lines.filter((line) => {
    const t = line.trim();
    if (!t.startsWith('•') && !t.startsWith('-')) return true;
    return /https?:\/\/\S+/i.test(t);
  });
}

export function formatWebHits(hits: ResearchHit[]): string[] {
  return hits.map((h) => {
    const bit = h.snippet ? ` — ${h.snippet}` : '';
    return `• ${h.title}${bit}\n  ${h.url}`;
  });
}
