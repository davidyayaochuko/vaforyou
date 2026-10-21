import { db } from '../db/index.ts';

export interface AuditEvent {
  id: number;
  at: string;
  action_type: string;
  target: string | null;
  input_summary: string;
  result: string;
  approved_by: string | null;
  approval_id: number | null;
  detail: string;
  sensitive: number;
}

function all<T>(sql: string, ...params: unknown[]): T[] {
  return db().prepare(sql).all(...(params as never[])) as unknown as T[];
}

function one<T>(sql: string, ...params: unknown[]): T {
  return db().prepare(sql).get(...(params as never[])) as unknown as T;
}

export function ensureAuditTable(): void {
  db().exec(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id            INTEGER PRIMARY KEY,
      at            TEXT NOT NULL DEFAULT (datetime('now')),
      action_type   TEXT NOT NULL,
      target        TEXT,
      input_summary TEXT NOT NULL,
      result        TEXT NOT NULL,
      approved_by   TEXT,
      approval_id   INTEGER,
      detail        TEXT NOT NULL DEFAULT '{}',
      sensitive     INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_events (at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_events (action_type, at DESC);
  `);
}

/** Mask obvious secrets / long numbers in summaries before storage. */
export function maskSummary(text: string): string {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[card]')
    .replace(/\b(?:gsk_|sk-|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/g, '[secret]')
    .replace(/\b\d{11,}\b/g, '[number]')
    .slice(0, 500);
}

export function writeAudit(entry: {
  actionType: string;
  target?: string | null;
  inputSummary: string;
  result: 'ok' | 'fail' | 'blocked' | 'pending' | 'rejected' | 'escalated' | 'expired';
  approvedBy?: string | null;
  approvalId?: number | null;
  detail?: unknown;
  sensitive?: boolean;
}): AuditEvent {
  ensureAuditTable();
  return one<AuditEvent>(
    `INSERT INTO audit_events
       (action_type, target, input_summary, result, approved_by, approval_id, detail, sensitive)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
    entry.actionType,
    entry.target ?? null,
    maskSummary(entry.inputSummary),
    entry.result,
    entry.approvedBy ?? null,
    entry.approvalId ?? null,
    JSON.stringify(entry.detail ?? {}),
    entry.sensitive ? 1 : 0,
  );
}

export function searchAudit(opts: {
  q?: string;
  actionType?: string;
  limit?: number;
}): AuditEvent[] {
  ensureAuditTable();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const q = (opts.q ?? '').trim();
  if (q && opts.actionType) {
    return all<AuditEvent>(
      `SELECT * FROM audit_events
        WHERE action_type = ? AND (input_summary LIKE ? OR target LIKE ? OR result LIKE ?)
        ORDER BY id DESC LIMIT ?`,
      opts.actionType,
      `%${q}%`,
      `%${q}%`,
      `%${q}%`,
      limit,
    );
  }
  if (q) {
    return all<AuditEvent>(
      `SELECT * FROM audit_events
        WHERE input_summary LIKE ? OR target LIKE ? OR action_type LIKE ? OR result LIKE ?
        ORDER BY id DESC LIMIT ?`,
      `%${q}%`,
      `%${q}%`,
      `%${q}%`,
      `%${q}%`,
      limit,
    );
  }
  if (opts.actionType) {
    return all<AuditEvent>(
      `SELECT * FROM audit_events WHERE action_type = ? ORDER BY id DESC LIMIT ?`,
      opts.actionType,
      limit,
    );
  }
  return all<AuditEvent>(`SELECT * FROM audit_events ORDER BY id DESC LIMIT ?`, limit);
}
