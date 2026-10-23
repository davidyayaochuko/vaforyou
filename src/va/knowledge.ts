/**
 * FAQ and policy knowledge base. When asked about prices, dates, or policies
 * not in the store, Funke says she will check with the team instead of guessing.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db/index.ts';

export interface KbEntry {
  id: number;
  kind: string;
  question: string;
  answer: string;
  tags: string;
  updated_at: string;
}

function all<T>(sql: string, ...params: unknown[]): T[] {
  return db().prepare(sql).all(...(params as never[])) as unknown as T[];
}

function one<T>(sql: string, ...params: unknown[]): T {
  return db().prepare(sql).get(...(params as never[])) as unknown as T;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const knowledgeDir = () => join(root, 'knowledge');

export function ensureKbTable(): void {
  db().exec(`
    CREATE TABLE IF NOT EXISTS kb_entries (
      id         INTEGER PRIMARY KEY,
      kind       TEXT NOT NULL,
      question   TEXT NOT NULL,
      answer     TEXT NOT NULL,
      tags       TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_kb_kind ON kb_entries (kind);
  `);
}

export function upsertKbEntry(row: {
  kind: 'faq' | 'policy';
  question: string;
  answer: string;
  tags?: string;
}): KbEntry {
  ensureKbTable();
  const existing = all<KbEntry>(
    `SELECT * FROM kb_entries WHERE kind = ? AND lower(question) = lower(?) LIMIT 1`,
    row.kind,
    row.question.trim(),
  )[0];
  if (existing) {
    return one<KbEntry>(
      `UPDATE kb_entries SET answer = ?, tags = ?, updated_at = datetime('now') WHERE id = ? RETURNING *`,
      row.answer.trim(),
      row.tags ?? '',
      existing.id,
    );
  }
  return one<KbEntry>(
    `INSERT INTO kb_entries (kind, question, answer, tags) VALUES (?, ?, ?, ?) RETURNING *`,
    row.kind,
    row.question.trim(),
    row.answer.trim(),
    row.tags ?? '',
  );
}

export function listKb(kind?: string, limit = 100): KbEntry[] {
  ensureKbTable();
  if (kind) {
    return all<KbEntry>(
      `SELECT * FROM kb_entries WHERE kind = ? ORDER BY id DESC LIMIT ?`,
      kind,
      limit,
    );
  }
  return all<KbEntry>(`SELECT * FROM kb_entries ORDER BY id DESC LIMIT ?`, limit);
}

/** Load markdown FAQ/policy files from knowledge/ into the table (idempotent by question). */
export function loadKnowledgeFiles(): number {
  ensureKbTable();
  const dir = knowledgeDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    return 0;
  }
  let n = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.md') || file.includes('.example.')) continue;
    const kind: 'faq' | 'policy' = file.toLowerCase().includes('policy') ? 'policy' : 'faq';
    const body = readFileSync(join(dir, file), 'utf8');
    const blocks = body.split(/\n(?=##\s+)/);
    for (const block of blocks) {
      const m = block.match(/^##\s+(.+)\n([\s\S]*)$/);
      if (!m) continue;
      const question = m[1]!.trim();
      const answer = m[2]!.trim();
      if (!question || !answer) continue;
      upsertKbEntry({ kind, question, answer, tags: file });
      n++;
    }
  }
  return n;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

export function lookupKb(query: string, limit = 3): KbEntry[] {
  ensureKbTable();
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const q = query.toLowerCase();
  const albionAsk = /\balbion\b|\boutlands\b|\bcaerleon\b|\blymhurst\b|\bzvz\b|\bblack zone|\bred zone|\bmists\b|\bavalon\b|\bdestiny board\b|\bsandbox interactive\b|\blearning points?\b|\bfarming\b|\bcrafting\b/i.test(
    query,
  );
  const cultureAsk = /\bnigeria\b|\bnigerian\b|\bpidgin\b|\bnaija\b|\bjollof\b|\blagos\b|\byoruba\b|\bigbo\b|\bhausa\b|\bafrobeats?\b|\bnollywood\b|\bokada\b/i.test(
    query,
  );
  const rows = listKb(undefined, 400);
  const scored = rows
    .map((row) => {
      const hay = `${row.question} ${row.answer} ${row.tags}`.toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (hay.includes(t)) score += 1;
      }
      if (row.question.toLowerCase().includes(q.slice(0, 40))) score += 2;
      if (albionAsk && /albion/i.test(row.tags || row.question)) score += 3;
      if (cultureAsk && /nigeria|speech-world|pidgin|culture/i.test(row.tags || row.question)) {
        score += 3;
      }
      return { row, score };
    })
    .filter((s) => s.score >= (albionAsk || cultureAsk ? 1 : 2))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.row);
}

const PRICE_POLICY_DATE =
  /\b(price|pricing|cost|fee|how much (does|is|are|do|for)|quote|rate card|discount|our policy|company policy|sla|refund policy|cancellation policy|valid until|effective (from|date)|what is the deadline)\b/i;

/** True when the ask is about facts that must come from the KB, not the model. */
export function needsGroundedAnswer(text: string): boolean {
  return PRICE_POLICY_DATE.test(text);
}

export function groundedReply(text: string): {
  handled: boolean;
  reply: string;
  hits: KbEntry[];
} {
  if (!needsGroundedAnswer(text)) {
    return { handled: false, reply: '', hits: [] };
  }
  const hits = lookupKb(text, 3);
  if (!hits.length) {
    return {
      handled: true,
      reply:
        'I do not have that price, date, or policy in the knowledge base, so I will not guess. I will check with the team and get back to you.',
      hits: [],
    };
  }
  const lines = hits.map((h) => `**${h.question}** (${h.kind})\n${h.answer}`);
  return {
    handled: true,
    reply: ['Here is what is in the knowledge base:', '', ...lines].join('\n'),
    hits,
  };
}
