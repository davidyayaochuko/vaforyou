/**
 * Multi-conversation chat store.
 * Messages and conversations can be soft-deleted briefly for undo, then purged.
 * Audit events and durable memory are never touched here.
 */

import { randomBytes } from 'node:crypto';
import { db } from '../db/index.ts';
import { clearSession, pushTurn } from './session.ts';
import { listPendingApprovals } from '../guardrails/approvals.ts';

export interface ConversationRow {
  id: number;
  title: string;
  archived_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: number;
  conversation_id: number;
  role: 'user' | 'funke';
  text: string;
  intent: string | null;
  detail: string;
  deleted_at: string | null;
  created_at: string;
}

export interface UndoBundle {
  token: string;
  kind: 'conversation' | 'messages' | 'message' | 'clear' | 'delete_all';
  expiresAt: number;
  conversationIds: number[];
  messageIds: number[];
}

const UNDO_MS = 10_000;
const undoBundles = new Map<string, UndoBundle>();

let activeConversationId: number | null = null;
let conversationsReady = false;

function all<T>(sql: string, ...params: unknown[]): T[] {
  return db().prepare(sql).all(...(params as never[])) as unknown as T[];
}

function one<T>(sql: string, ...params: unknown[]): T {
  return db().prepare(sql).get(...(params as never[])) as unknown as T;
}

function run(sql: string, ...params: unknown[]): number {
  return Number(db().prepare(sql).run(...(params as never[])).changes);
}

export function ensureConversations(): void {
  if (conversationsReady) {
    purgeExpiredDeletes();
    return;
  }
  db().exec(`
    CREATE TABLE IF NOT EXISTS va_conversations (
      id          INTEGER PRIMARY KEY,
      title       TEXT NOT NULL,
      archived_at TEXT,
      deleted_at  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS va_messages (
      id              INTEGER PRIMARY KEY,
      conversation_id INTEGER NOT NULL,
      role            TEXT NOT NULL,
      text            TEXT NOT NULL,
      intent          TEXT,
      detail          TEXT NOT NULL DEFAULT '{}',
      deleted_at      TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES va_conversations(id)
    );
    CREATE INDEX IF NOT EXISTS idx_va_messages_conv
      ON va_messages (conversation_id, id);
    CREATE INDEX IF NOT EXISTS idx_va_messages_text
      ON va_messages (conversation_id, deleted_at);
  `);
  conversationsReady = true;
  migrateLegacyTurns();
  purgeExpiredDeletes();
}

function migrateLegacyTurns(): void {
  const hasTurns = all<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='va_turns'`,
  ).length;
  if (!hasTurns) return;
  const convCount = one<{ c: number }>(`SELECT COUNT(*) AS c FROM va_conversations`).c;
  const turnCount = one<{ c: number }>(`SELECT COUNT(*) AS c FROM va_turns`).c;
  if (convCount > 0 || turnCount === 0) return;
  const conv = insertConversationRow('Earlier chat');
  activeConversationId = conv.id;
  const turns = all<{
    id: number;
    input: string;
    intent: string;
    reply: string;
    detail: string;
    created_at: string;
  }>(`SELECT id, input, intent, reply, detail, created_at FROM va_turns ORDER BY id ASC`);
  for (const t of turns) {
    insertMessage(conv.id, 'user', t.input, t.intent, '{}', t.created_at);
    insertMessage(conv.id, 'funke', t.reply, t.intent, t.detail || '{}', t.created_at);
  }
  touchConversation(conv.id);
}

function insertMessage(
  conversationId: number,
  role: 'user' | 'funke',
  text: string,
  intent: string | null,
  detail: string,
  createdAt?: string,
): MessageRow {
  if (createdAt) {
    return one<MessageRow>(
      `INSERT INTO va_messages (conversation_id, role, text, intent, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
      conversationId,
      role,
      text,
      intent,
      detail,
      createdAt,
    );
  }
  return one<MessageRow>(
    `INSERT INTO va_messages (conversation_id, role, text, intent, detail)
     VALUES (?, ?, ?, ?, ?) RETURNING *`,
    conversationId,
    role,
    text,
    intent,
    detail,
  );
}

function touchConversation(id: number): void {
  run(`UPDATE va_conversations SET updated_at = datetime('now') WHERE id = ?`, id);
}

export function autoTitleFromText(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return 'New chat';
  const cut = t.length > 48 ? `${t.slice(0, 45).trim()}…` : t;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}

function insertConversationRow(title: string): ConversationRow {
  return one<ConversationRow>(
    `INSERT INTO va_conversations (title) VALUES (?) RETURNING *`,
    title.slice(0, 120) || 'New chat',
  );
}

export function createConversation(title = 'New chat'): ConversationRow {
  ensureConversations();
  const row = insertConversationRow(title);
  activeConversationId = row.id;
  return row;
}

export function getConversation(id: number): ConversationRow | undefined {
  ensureConversations();
  return all<ConversationRow>(`SELECT * FROM va_conversations WHERE id = ?`, id)[0];
}

export function getActiveConversation(): ConversationRow {
  ensureConversations();
  if (activeConversationId != null) {
    const cur = getConversation(activeConversationId);
    if (cur && !cur.deleted_at) return cur;
  }
  const latest = all<ConversationRow>(
    `SELECT * FROM va_conversations
     WHERE deleted_at IS NULL AND archived_at IS NULL
     ORDER BY updated_at DESC LIMIT 1`,
  )[0];
  if (latest) {
    activeConversationId = latest.id;
    return latest;
  }
  return createConversation('New chat');
}

export function setActiveConversation(id: number): ConversationRow {
  const row = getConversation(id);
  if (!row || row.deleted_at) throw new Error('Conversation not found');
  activeConversationId = id;
  clearSession();
  for (const m of listMessages(id)) {
    pushTurn(m.role, m.text, m.intent || undefined);
  }
  return row;
}

export function listConversations(opts: {
  archived?: boolean;
  q?: string;
  includeDeleted?: boolean;
  limit?: number;
} = {}): (ConversationRow & { preview: string })[] {
  ensureConversations();
  purgeExpiredDeletes();
  const limit = Math.min(Math.max(opts.limit ?? 80, 1), 200);
  const archived = !!opts.archived;
  const q = (opts.q || '').trim().toLowerCase();
  let rows = all<ConversationRow>(
    `SELECT * FROM va_conversations
     WHERE deleted_at IS NULL
       AND ${archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'}
     ORDER BY updated_at DESC
     LIMIT ?`,
    limit,
  );
  if (q) {
    const matchIds = new Set(
      all<{ conversation_id: number }>(
        `SELECT DISTINCT conversation_id FROM va_messages
         WHERE deleted_at IS NULL AND lower(text) LIKE ?`,
        `%${q}%`,
      ).map((r) => r.conversation_id),
    );
    rows = rows.filter(
      (r) => r.title.toLowerCase().includes(q) || matchIds.has(r.id),
    );
  }
  return rows.map((r) => {
    const last = all<{ text: string }>(
      `SELECT text FROM va_messages
       WHERE conversation_id = ? AND deleted_at IS NULL
       ORDER BY id DESC LIMIT 1`,
      r.id,
    )[0];
    return { ...r, preview: (last?.text || '').slice(0, 100) };
  });
}

export function renameConversation(id: number, title: string): ConversationRow {
  const t = title.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!t) throw new Error('Title is required');
  run(`UPDATE va_conversations SET title = ?, updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`, t, id);
  const row = getConversation(id);
  if (!row) throw new Error('Conversation not found');
  return row;
}

export function archiveConversation(id: number): ConversationRow {
  run(
    `UPDATE va_conversations SET archived_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ? AND deleted_at IS NULL`,
    id,
  );
  const row = getConversation(id);
  if (!row) throw new Error('Conversation not found');
  if (activeConversationId === id) {
    activeConversationId = null;
    getActiveConversation();
  }
  return row;
}

export function unarchiveConversation(id: number): ConversationRow {
  run(
    `UPDATE va_conversations SET archived_at = NULL, updated_at = datetime('now')
     WHERE id = ? AND deleted_at IS NULL`,
    id,
  );
  const row = getConversation(id);
  if (!row) throw new Error('Conversation not found');
  return row;
}

export function listMessages(conversationId: number, includeDeleted = false): MessageRow[] {
  ensureConversations();
  if (includeDeleted) {
    return all<MessageRow>(
      `SELECT * FROM va_messages WHERE conversation_id = ? ORDER BY id ASC`,
      conversationId,
    );
  }
  return all<MessageRow>(
    `SELECT * FROM va_messages
     WHERE conversation_id = ? AND deleted_at IS NULL
     ORDER BY id ASC`,
    conversationId,
  );
}

/** Extract pending approval ids referenced in message detail JSON. */
export function pendingApprovalsInConversation(conversationId: number): {
  id: number;
  title: string;
  actionType: string;
}[] {
  const msgs = listMessages(conversationId, true).filter((m) => !m.deleted_at);
  const ids = new Set<number>();
  for (const m of msgs) {
    try {
      const d = JSON.parse(m.detail || '{}') as {
        approvals?: { id?: number }[];
        approval?: { id?: number };
      };
      for (const a of d.approvals || []) if (a?.id) ids.add(Number(a.id));
      if (d.approval?.id) ids.add(Number(d.approval.id));
    } catch {
      /* ignore */
    }
  }
  if (!ids.size) return [];
  const pending = listPendingApprovals(200);
  return pending
    .filter((a) => ids.has(a.id))
    .map((a) => ({ id: a.id, title: a.title, actionType: a.action_type }));
}

function saveUndo(bundle: Omit<UndoBundle, 'token' | 'expiresAt'>): UndoBundle {
  const token = randomBytes(12).toString('hex');
  const full: UndoBundle = {
    ...bundle,
    token,
    expiresAt: Date.now() + UNDO_MS,
  };
  undoBundles.set(token, full);
  return full;
}

export function undo(token: string): { ok: boolean; reply: string } {
  const b = undoBundles.get(token);
  if (!b) return { ok: false, reply: 'Nothing to undo (the window closed).' };
  if (Date.now() > b.expiresAt) {
    undoBundles.delete(token);
    purgeExpiredDeletes();
    return { ok: false, reply: 'Nothing to undo (the window closed).' };
  }
  for (const id of b.messageIds) {
    run(`UPDATE va_messages SET deleted_at = NULL WHERE id = ?`, id);
  }
  for (const id of b.conversationIds) {
    run(`UPDATE va_conversations SET deleted_at = NULL WHERE id = ?`, id);
  }
  undoBundles.delete(token);
  return { ok: true, reply: 'Restored.' };
}

export function purgeExpiredDeletes(): void {
  if (!conversationsReady) return;
  const now = Date.now();
  for (const [token, b] of undoBundles) {
    if (now > b.expiresAt) undoBundles.delete(token);
  }
  // Hard-delete soft-deleted rows older than the undo window (SQLite datetime).
  run(`DELETE FROM va_messages WHERE deleted_at IS NOT NULL
       AND deleted_at < datetime('now', '-15 seconds')`);
  run(`DELETE FROM va_conversations WHERE deleted_at IS NOT NULL
       AND deleted_at < datetime('now', '-15 seconds')`);
  // Orphan messages of hard-deleted conversations
  run(`DELETE FROM va_messages WHERE conversation_id NOT IN (SELECT id FROM va_conversations)`);
}

function softDeleteMessages(ids: number[]): UndoBundle {
  const stamp = one<{ t: string }>(`SELECT datetime('now') AS t`).t;
  for (const id of ids) {
    run(`UPDATE va_messages SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`, stamp, id);
  }
  return saveUndo({ kind: 'messages', conversationIds: [], messageIds: ids });
}

export function deleteMessage(id: number): {
  undo: UndoBundle;
  conversationId: number;
} {
  ensureConversations();
  const msg = all<MessageRow>(`SELECT * FROM va_messages WHERE id = ? AND deleted_at IS NULL`, id)[0];
  if (!msg) throw new Error('Message not found');
  const undoBundle = softDeleteMessages([id]);
  return { undo: undoBundle, conversationId: msg.conversation_id };
}

export function clearConversation(id: number): {
  undo: UndoBundle;
  pendingApprovals: { id: number; title: string; actionType: string }[];
  warning?: string;
} {
  ensureConversations();
  const pendingApprovals = pendingApprovalsInConversation(id);
  const ids = listMessages(id).map((m) => m.id);
  const undoBundle = softDeleteMessages(ids);
  clearSession();
  touchConversation(id);
  return {
    undo: undoBundle,
    pendingApprovals,
    warning: pendingApprovals.length
      ? `${pendingApprovals.length} pending approval(s) stay in the Approvals tab. Chat clear does not cancel them.`
      : undefined,
  };
}

export function softDeleteConversation(id: number): {
  undo: UndoBundle;
  pendingApprovals: { id: number; title: string; actionType: string }[];
  warning: string;
} {
  ensureConversations();
  const pendingApprovals = pendingApprovalsInConversation(id);
  const stamp = one<{ t: string }>(`SELECT datetime('now') AS t`).t;
  run(`UPDATE va_conversations SET deleted_at = ?, updated_at = datetime('now') WHERE id = ?`, stamp, id);
  const msgIds = all<{ id: number }>(
    `SELECT id FROM va_messages WHERE conversation_id = ? AND deleted_at IS NULL`,
    id,
  ).map((m) => m.id);
  for (const mid of msgIds) {
    run(`UPDATE va_messages SET deleted_at = ? WHERE id = ?`, stamp, mid);
  }
  const undoBundle = saveUndo({
    kind: 'conversation',
    conversationIds: [id],
    messageIds: msgIds,
  });
  if (activeConversationId === id) {
    activeConversationId = null;
    clearSession();
  }
  return {
    undo: undoBundle,
    pendingApprovals,
    warning: pendingApprovals.length
      ? `This chat had ${pendingApprovals.length} pending approval(s). They stay in Approvals (not cancelled). Your activity log is kept separately for safety.`
      : 'Chat removed from history. Your activity log is kept separately for safety. Preferences and contacts in memory are unchanged.',
  };
}

export function deleteAllConversations(confirm: string): {
  undo: UndoBundle;
  count: number;
  warning: string;
} {
  if (confirm !== 'DELETE ALL') {
    throw new Error('Type DELETE ALL to confirm. This is hard to undo after 10 seconds.');
  }
  ensureConversations();
  const rows = all<ConversationRow>(`SELECT * FROM va_conversations WHERE deleted_at IS NULL`);
  const stamp = one<{ t: string }>(`SELECT datetime('now') AS t`).t;
  const convIds = rows.map((r) => r.id);
  const msgIds = all<{ id: number }>(
    `SELECT id FROM va_messages WHERE deleted_at IS NULL`,
  ).map((m) => m.id);
  for (const id of convIds) {
    run(`UPDATE va_conversations SET deleted_at = ? WHERE id = ?`, stamp, id);
  }
  for (const id of msgIds) {
    run(`UPDATE va_messages SET deleted_at = ? WHERE id = ?`, stamp, id);
  }
  const undoBundle = saveUndo({
    kind: 'delete_all',
    conversationIds: convIds,
    messageIds: msgIds,
  });
  activeConversationId = null;
  clearSession();
  createConversation('New chat');
  return {
    undo: undoBundle,
    count: convIds.length,
    warning:
      'All chats marked for deletion (Undo for 10 seconds). Approvals, audit log, calendar, reminders, and memory are unchanged.',
  };
}

export function startNewConversation(): ConversationRow {
  ensureConversations();
  clearSession();
  return createConversation('New chat');
}

export function appendExchange(
  input: string,
  intent: string,
  reply: string,
  detail: unknown,
): { conversationId: number; userId: number; funkeId: number } {
  ensureConversations();
  const conv = getActiveConversation();
  const detailStr = JSON.stringify(detail ?? {});
  const user = insertMessage(conv.id, 'user', input, intent, '{}');
  const funke = insertMessage(conv.id, 'funke', reply, intent, detailStr);
  if (conv.title === 'New chat' || conv.title === 'Earlier chat') {
    renameConversation(conv.id, autoTitleFromText(input));
  }
  touchConversation(conv.id);
  return { conversationId: conv.id, userId: user.id, funkeId: funke.id };
}

/** Dual-write: legacy va_turns + conversation messages. */
export function logChatExchange(
  input: string,
  intent: string,
  reply: string,
  detail: unknown,
): void {
  // Inline legacy insert avoids importing store.ts (circular with approvals).
  db()
    .prepare(`INSERT INTO va_turns (input, intent, reply, detail) VALUES (?, ?, ?, ?)`)
    .run(input, intent, reply, JSON.stringify(detail ?? {}));
  appendExchange(input, intent, reply, detail);
}

export function exportConversation(
  id: number,
  format: 'md' | 'json' = 'md',
): { filename: string; body: string; contentType: string } {
  const conv = getConversation(id);
  if (!conv || conv.deleted_at) throw new Error('Conversation not found');
  const messages = listMessages(id);
  const safe = conv.title.replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'chat';
  if (format === 'json') {
    return {
      filename: `funke-${safe}-${id}.json`,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(
        {
          id: conv.id,
          title: conv.title,
          created_at: conv.created_at,
          updated_at: conv.updated_at,
          messages: messages.map((m) => ({
            id: m.id,
            role: m.role,
            text: m.text,
            intent: m.intent,
            created_at: m.created_at,
          })),
        },
        null,
        2,
      ),
    };
  }
  const lines = [
    `# ${conv.title}`,
    '',
    `Exported from Funke. Conversation #${conv.id}.`,
    `Created ${conv.created_at}. Updated ${conv.updated_at}.`,
    '',
    'Note: Approvals and the activity (audit) log are stored separately and are not included here.',
    '',
  ];
  for (const m of messages) {
    lines.push(`## ${m.role === 'user' ? 'You' : 'Funke'} · ${m.created_at}`);
    lines.push('');
    lines.push(m.text);
    lines.push('');
  }
  return {
    filename: `funke-${safe}-${id}.md`,
    contentType: 'text/markdown; charset=utf-8',
    body: lines.join('\n'),
  };
}

export function chatHistoryForActiveUi(): {
  id: number;
  role: 'user' | 'funke';
  text: string;
  at: string;
  intent?: string;
  detail?: unknown;
}[] {
  const conv = getActiveConversation();
  return listMessages(conv.id).map((m) => {
    let detail: unknown;
    try {
      detail = JSON.parse(m.detail || '{}');
    } catch {
      detail = {};
    }
    return {
      id: m.id,
      role: m.role,
      text: m.text,
      at: m.created_at,
      intent: m.intent || undefined,
      detail,
    };
  });
}

export function hydrateSessionFromActive(limit = 10): number {
  ensureConversations();
  clearSession();
  const conv = getActiveConversation();
  const rows = listMessages(conv.id).slice(-limit);
  for (const row of rows) {
    pushTurn(row.role, row.text, row.intent || undefined);
  }
  return rows.length;
}

export function undoWindowMs(): number {
  return UNDO_MS;
}
