/**
 * Durable memory: preferences, per-contact notes, per-task context.
 * Survives process restarts (SQLite). Session turns hydrate from va_turns.
 */

import { db, getSetting } from '../db/index.ts';
import { ensureVaTables } from './store.ts';
import { clearSession } from './session.ts';
import {
  chatHistoryForActiveUi,
  ensureConversations,
  hydrateSessionFromActive,
} from './conversations.ts';
import { activeContext } from './contexts.ts';

export interface MemoryRow {
  id: number;
  scope: string;
  key: string;
  value: string;
  contact: string;
  meta: string;
  updated_at: string;
}

function all<T>(sql: string, ...params: unknown[]): T[] {
  return db().prepare(sql).all(...(params as never[])) as unknown as T[];
}

function one<T>(sql: string, ...params: unknown[]): T {
  return db().prepare(sql).get(...(params as never[])) as unknown as T;
}

export function ensureMemoryTable(): void {
  ensureVaTables();
  db().exec(`
    CREATE TABLE IF NOT EXISTS va_memory (
      id         INTEGER PRIMARY KEY,
      scope      TEXT NOT NULL,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      contact    TEXT NOT NULL DEFAULT '',
      meta       TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (scope, key, contact)
    );
    CREATE INDEX IF NOT EXISTS idx_va_memory_contact ON va_memory (contact);
    CREATE INDEX IF NOT EXISTS idx_va_memory_scope ON va_memory (scope, updated_at DESC);
  `);
}

export function remember(opts: {
  scope: 'preference' | 'contact' | 'task' | 'fact';
  key: string;
  value: string;
  contact?: string | null;
  meta?: Record<string, unknown>;
}): MemoryRow {
  ensureMemoryTable();
  const contact = opts.contact?.trim() || '';
  const key = opts.key.trim().slice(0, 120);
  const value = opts.value.trim().slice(0, 2000);
  // Preferences are global. Everything else is tagged with the active work context.
  const meta = {
    ...(opts.meta ?? {}),
    ...(opts.scope === 'preference' ? {} : { context: opts.meta?.context ?? activeContext() }),
  };
  return one<MemoryRow>(
    `INSERT INTO va_memory (scope, key, value, contact, meta, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(scope, key, contact) DO UPDATE SET
       value = excluded.value,
       meta = excluded.meta,
       updated_at = datetime('now')
     RETURNING *`,
    opts.scope,
    key,
    value,
    contact,
    JSON.stringify(meta),
  );
}

function metaContext(row: MemoryRow): string | null {
  try {
    const m = JSON.parse(row.meta || '{}') as { context?: string };
    return m.context ?? null;
  } catch {
    return null;
  }
}

export function recall(opts: {
  scope?: string;
  contact?: string | null;
  key?: string;
  limit?: number;
}): MemoryRow[] {
  ensureMemoryTable();
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 200);
  if (opts.key && opts.scope) {
    return all<MemoryRow>(
      `SELECT * FROM va_memory WHERE scope = ? AND key = ? AND contact = ? LIMIT 1`,
      opts.scope,
      opts.key,
      opts.contact?.trim() || '',
    );
  }
  if (opts.contact) {
    return all<MemoryRow>(
      `SELECT * FROM va_memory WHERE contact = ? ORDER BY updated_at DESC LIMIT ?`,
      opts.contact.trim(),
      limit,
    );
  }
  if (opts.scope) {
    return all<MemoryRow>(
      `SELECT * FROM va_memory WHERE scope = ? ORDER BY updated_at DESC LIMIT ?`,
      opts.scope,
      limit,
    );
  }
  return all<MemoryRow>(`SELECT * FROM va_memory ORDER BY updated_at DESC LIMIT ?`, limit);
}

/** Prefer rows for the active context; preferences always included. */
export function recallForActiveContext(limit = 40): MemoryRow[] {
  const ctx = activeContext() || getSetting<string>('active_context', 'personal');
  return recall({ limit: Math.min(limit * 3, 120) })
    .filter((r) => {
      if (r.scope === 'preference') return true;
      const c = metaContext(r);
      if (!c || c === 'personal') return ctx === 'personal';
      return c === ctx;
    })
    .slice(0, limit);
}

export function forget(id: number): boolean {
  ensureMemoryTable();
  const r = db().prepare(`DELETE FROM va_memory WHERE id = ?`).run(id);
  return Number(r.changes) > 0;
}

/** Hard-delete every durable memory row. Does not touch chat, audit, or approvals. */
export function forgetAllMemory(): { deleted: number } {
  ensureMemoryTable();
  const n = one<{ c: number }>(`SELECT COUNT(*) AS c FROM va_memory`).c;
  db().prepare(`DELETE FROM va_memory`).run();
  return { deleted: n };
}

/** Compact block for the LLM prompt. */
export function memoryBlock(limit = 12): string {
  const rows = recallForActiveContext(limit);
  if (!rows.length) return '';
  return rows
    .map((r) => {
      const who = r.contact ? ` (${r.contact})` : '';
      return `- [${r.scope}] ${r.key}${who}: ${r.value}`;
    })
    .join('\n');
}

/**
 * Reload short-term session turns from the active conversation after a restart.
 * Durable memory (preferences/contacts) is separate and still applies to new chats.
 */
export function hydrateSessionFromHistory(limit = 10): number {
  ensureVaTables();
  ensureConversations();
  clearSession();
  return hydrateSessionFromActive(limit);
}

export function chatHistoryForUi(limit = 40): {
  id?: number;
  role: 'user' | 'funke';
  text: string;
  at: string;
  intent?: string;
}[] {
  ensureVaTables();
  ensureConversations();
  return chatHistoryForActiveUi().slice(-Math.min(Math.max(limit, 1), 200));
}
