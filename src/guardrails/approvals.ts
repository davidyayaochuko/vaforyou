import { randomBytes } from 'node:crypto';
import { db } from '../db/index.ts';
import { autonomyFor, type AutonomyLevel } from './autonomy.ts';
import { checkHardBoundary, isHardBlocked } from './boundaries.ts';
import { writeAudit } from './audit.ts';
import { refuseUntrustedAction } from './untrusted.ts';
import {
  createCalendarEvent,
  createReminder,
  findDuplicateCalendarEvent,
  listReminders,
  updateCalendarEvent,
  updateReminderDue,
  type CalendarEvent,
} from '../va/store.ts';
import { convertWallTime } from '../va/timezone.ts';
import {
  getContent,
  markFounderApproved,
  setContentState,
  recentPublishedBodies,
  markContentPrepared,
  contentProvenance,
} from '../db/content.ts';
import { gate } from '../content/gate.ts';
import { prepareContentBody } from '../content/prepare.ts';

export type ApprovalState =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'executed'
  | 'failed';

export interface ApprovalRow {
  id: number;
  action_type: string;
  title: string;
  summary: string;
  preview: string | null;
  payload: string;
  state: ApprovalState;
  autonomy: string;
  channel: string;
  idempotency_key: string | null;
  expires_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  result: string | null;
  error: string | null;
  created_at: string;
}

const DEFAULT_TTL_HOURS = 48;

function all<T>(sql: string, ...params: unknown[]): T[] {
  return db().prepare(sql).all(...(params as never[])) as unknown as T[];
}

function one<T>(sql: string, ...params: unknown[]): T {
  return db().prepare(sql).get(...(params as never[])) as unknown as T;
}

function run(sql: string, ...params: unknown[]): number {
  const r = db().prepare(sql).run(...(params as never[]));
  return Number(r.changes);
}

export function ensureApprovalsTable(): void {
  db().exec(`
    CREATE TABLE IF NOT EXISTS approvals (
      id              INTEGER PRIMARY KEY,
      action_type     TEXT NOT NULL,
      title           TEXT NOT NULL,
      summary         TEXT NOT NULL,
      preview         TEXT,
      payload         TEXT NOT NULL DEFAULT '{}',
      state           TEXT NOT NULL DEFAULT 'pending',
      autonomy        TEXT NOT NULL,
      channel         TEXT NOT NULL DEFAULT 'dashboard',
      idempotency_key TEXT,
      expires_at      TEXT,
      decided_at      TEXT,
      decided_by      TEXT,
      result          TEXT,
      error           TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_approvals_state ON approvals (state, expires_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_approvals_idem
      ON approvals (idempotency_key) WHERE idempotency_key IS NOT NULL;
  `);
}

export function expireStaleApprovals(nowIso = new Date().toISOString()): number {
  ensureApprovalsTable();
  const rows = all<ApprovalRow>(
    `SELECT * FROM approvals WHERE state = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?`,
    nowIso,
  );
  for (const row of rows) {
    run(
      `UPDATE approvals SET state = 'expired', decided_at = ?, decided_by = 'system' WHERE id = ? AND state = 'pending'`,
      nowIso,
      row.id,
    );
    writeAudit({
      actionType: row.action_type,
      target: row.title,
      inputSummary: row.summary,
      result: 'expired',
      approvalId: row.id,
      approvedBy: 'system',
    });
  }
  return rows.length;
}

export function listPendingApprovals(limit = 40): ApprovalRow[] {
  ensureApprovalsTable();
  expireStaleApprovals();
  return all<ApprovalRow>(
    `SELECT * FROM approvals WHERE state = 'pending' ORDER BY id DESC LIMIT ?`,
    limit,
  );
}

export function getApproval(id: number): ApprovalRow | undefined {
  ensureApprovalsTable();
  return all<ApprovalRow>(`SELECT * FROM approvals WHERE id = ?`, id)[0];
}

export interface ActionRequest {
  actionType: string;
  title: string;
  summary: string;
  preview?: string | null;
  payload: Record<string, unknown>;
  /** Optional natural-language source for boundary checks. */
  sourceText?: string;
  idempotencyKey?: string | null;
  channel?: string;
  ttlHours?: number;
}

export interface ActionOutcome {
  ok: boolean;
  status: 'executed' | 'pending' | 'blocked' | 'escalated' | 'duplicate';
  reply: string;
  approval?: ApprovalRow;
  detail?: unknown;
}

/**
 * Route an action through hard boundaries and autonomy.
 * Never accepts decidedBy from a voice path at execute time.
 */
export async function requestAction(req: ActionRequest): Promise<ActionOutcome> {
  ensureApprovalsTable();
  expireStaleApprovals();

  const untrusted = refuseUntrustedAction({
    channel: req.channel,
    sourceText: req.sourceText ?? `${req.title}\n${req.summary}`,
  });
  if (untrusted.refuse) {
    writeAudit({
      actionType: req.actionType,
      target: req.title,
      inputSummary: req.summary,
      result: 'blocked',
      detail: { untrusted: true },
    });
    return { ok: false, status: 'blocked', reply: untrusted.reply };
  }

  const boundary = checkHardBoundary(req.sourceText ?? `${req.title}\n${req.summary}`, req.actionType);
  if (isHardBlocked(boundary)) {
    writeAudit({
      actionType: req.actionType,
      target: req.title,
      inputSummary: req.summary,
      result: 'blocked',
      detail: { code: boundary.code },
    });
    return {
      ok: false,
      status: 'blocked',
      reply: `${boundary.reason} I escalated this for a human.`,
      detail: { boundary },
    };
  }

  let level: AutonomyLevel = autonomyFor(req.actionType);
  if (boundary.level === 'approval_required' && level === 'auto') {
    level = 'approval_required';
  }
  if (level === 'blocked') {
    writeAudit({
      actionType: req.actionType,
      target: req.title,
      inputSummary: req.summary,
      result: 'blocked',
      detail: { autonomy: level },
    });
    return {
      ok: false,
      status: 'blocked',
      reply: `“${req.actionType}” is blocked in your autonomy settings.`,
    };
  }

  if (req.idempotencyKey) {
    const existing = all<ApprovalRow>(
      `SELECT * FROM approvals WHERE idempotency_key = ? ORDER BY id DESC LIMIT 1`,
      req.idempotencyKey,
    )[0];
    if (existing) {
      if (existing.state === 'executed') {
        return {
          ok: true,
          status: 'duplicate',
          reply: 'That action already ran. I did not run it again.',
          approval: existing,
        };
      }
      if (existing.state === 'pending') {
        return {
          ok: true,
          status: 'pending',
          reply: 'That is already waiting for your approval.',
          approval: existing,
        };
      }
    }
  }

  if (level === 'auto') {
    const executed = await executePayload(req.actionType, req.payload);
    writeAudit({
      actionType: req.actionType,
      target: req.title,
      inputSummary: req.summary,
      result: executed.ok ? 'ok' : 'fail',
      approvedBy: 'auto',
      detail: executed.detail,
    });
    return {
      ok: executed.ok,
      status: executed.ok ? 'executed' : 'blocked',
      reply: executed.reply,
      detail: executed.detail,
    };
  }

  const expires = new Date(Date.now() + (req.ttlHours ?? DEFAULT_TTL_HOURS) * 3600_000).toISOString();
  const row = one<ApprovalRow>(
    `INSERT INTO approvals
       (action_type, title, summary, preview, payload, state, autonomy, channel, idempotency_key, expires_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
     RETURNING *`,
    req.actionType,
    req.title,
    req.summary,
    req.preview ?? null,
    JSON.stringify(req.payload),
    level,
    req.channel ?? 'dashboard',
    req.idempotencyKey ?? null,
    expires,
  );

  writeAudit({
    actionType: req.actionType,
    target: req.title,
    inputSummary: req.summary,
    result: 'pending',
    approvalId: row.id,
    detail: { preview: req.preview ?? null },
    sensitive: boundary.code === 'confidential',
  });

  return {
    ok: true,
    status: 'pending',
    reply: [
      'I need your approval before I do that.',
      '',
      row.preview ? `Final content:\n${row.preview}` : row.summary,
      '',
      'Approve, edit, or reject from the card below (or the Approvals panel). Voice cannot approve.',
    ].join('\n'),
    approval: row,
  };
}

/**
 * Decide an approval. `decidedBy` must be a UI channel such as `dashboard`.
 * Voice / transcript paths are rejected in code.
 */
export async function decideApproval(opts: {
  id: number;
  decision: 'approved' | 'rejected';
  decidedBy: string;
  editedPreview?: string | null;
  editedPayload?: Record<string, unknown> | null;
}): Promise<ActionOutcome> {
  ensureApprovalsTable();
  expireStaleApprovals();

  if (opts.decidedBy === 'voice' || opts.decidedBy.startsWith('voice')) {
    return {
      ok: false,
      status: 'blocked',
      reply: 'Voice cannot approve actions. Tap Approve on the card that shows the exact content.',
    };
  }

  const row = getApproval(opts.id);
  if (!row) return { ok: false, status: 'blocked', reply: 'No such approval item.' };
  if (row.state !== 'pending') {
    return { ok: false, status: 'blocked', reply: `That item is already ${row.state}.`, approval: row };
  }

  if (opts.decision === 'rejected') {
    run(
      `UPDATE approvals SET state = 'rejected', decided_at = ?, decided_by = ? WHERE id = ?`,
      new Date().toISOString(),
      opts.decidedBy,
      opts.id,
    );
    writeAudit({
      actionType: row.action_type,
      target: row.title,
      inputSummary: row.summary,
      result: 'rejected',
      approvedBy: opts.decidedBy,
      approvalId: row.id,
    });
    return {
      ok: true,
      status: 'blocked',
      reply: 'Rejected. I will not run that action.',
      approval: getApproval(opts.id),
    };
  }

  let payload = JSON.parse(row.payload || '{}') as Record<string, unknown>;
  if (opts.editedPayload) payload = { ...payload, ...opts.editedPayload };
  let preview = row.preview;
  if (opts.editedPreview != null) {
    preview = opts.editedPreview;
    if (row.action_type === 'content.publish') {
      payload = { ...payload, body: opts.editedPreview };
    }
  }

  run(
    `UPDATE approvals SET
       state = 'approved', decided_at = ?, decided_by = ?,
       preview = COALESCE(?, preview), payload = ?
     WHERE id = ? AND state = 'pending'`,
    new Date().toISOString(),
    opts.decidedBy,
    preview,
    JSON.stringify(payload),
    opts.id,
  );

  const executed = await executePayload(row.action_type, payload);
  run(
    `UPDATE approvals SET state = ?, result = ?, error = ? WHERE id = ?`,
    executed.ok ? 'executed' : 'failed',
    executed.reply.slice(0, 1000),
    executed.ok ? null : executed.reply.slice(0, 500),
    opts.id,
  );
  writeAudit({
    actionType: row.action_type,
    target: row.title,
    inputSummary: preview ?? row.summary,
    result: executed.ok ? 'ok' : 'fail',
    approvedBy: opts.decidedBy,
    approvalId: row.id,
    detail: executed.detail,
  });

  return {
    ok: executed.ok,
    status: executed.ok ? 'executed' : 'blocked',
    reply: executed.ok ? `Approved and done. ${executed.reply}` : `Approved, but it failed: ${executed.reply}`,
    approval: getApproval(opts.id),
    detail: executed.detail,
  };
}

async function executePayload(
  actionType: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; reply: string; detail?: unknown }> {
  switch (actionType) {
    case 'calendar.create':
    case 'calendar.reschedule':
      return executeCalendar(payload, actionType === 'calendar.reschedule');
    case 'content.publish':
      return executeContentQueue(payload);
    case 'workspace.write':
      return {
        ok: false,
        reply: 'Workspace writes stay locked until WORKSPACE_MCP_WRITES is enabled and gated end-to-end.',
      };
    case 'email.send':
      return { ok: false, reply: 'Email send through the approval queue is not wired yet beyond reminders.' };
    default:
      return { ok: false, reply: `No executor for action type “${actionType}”.` };
  }
}

async function executeCalendar(
  payload: Record<string, unknown>,
  reschedule: boolean,
): Promise<{ ok: boolean; reply: string; detail?: unknown }> {
  const title = String(payload.title ?? '').trim();
  const startLocal = String(payload.start ?? '');
  const timezone = payload.timezone ? String(payload.timezone) : null;
  if (!title || !startLocal) {
    return { ok: false, reply: 'Calendar payload missing title or start.' };
  }
  const start = convertWallTime({ isoOrLocal: startLocal, sourceTz: timezone });
  if (!start.ok) return { ok: false, reply: start.error ?? 'could not parse that time' };

  const endAt = payload.end
    ? (() => {
        const end = convertWallTime({ isoOrLocal: String(payload.end), sourceTz: timezone });
        return end.ok ? end.utcIso : null;
      })()
    : new Date(new Date(start.utcIso).getTime() + 60 * 60_000).toISOString();

  let event: CalendarEvent;
  const movingId = payload.eventId != null ? Number(payload.eventId) : NaN;
  if (reschedule && Number.isFinite(movingId)) {
    event = updateCalendarEvent(movingId, {
      title,
      startAt: start.utcIso,
      endAt,
      timezone: start.homeTz,
      sourceTz: start.sourceTz,
      location: payload.location != null ? String(payload.location) : undefined,
      notes: payload.notes != null ? String(payload.notes) : undefined,
    })!;
  } else {
    const dup = findDuplicateCalendarEvent(title, start.utcIso);
    if (dup) {
      return {
        ok: true,
        reply: `Already on your calendar: “${dup.title}” (${dup.start_at}).`,
        detail: { event: dup, duplicate: true },
      };
    }
    event = createCalendarEvent({
      title,
      startAt: start.utcIso,
      endAt,
      timezone: start.homeTz,
      location: payload.location != null ? String(payload.location) : null,
      notes: payload.notes != null ? String(payload.notes) : null,
      sourceTz: start.sourceTz,
    });
  }

  const minutes = Number(payload.remind_minutes_before ?? 60);
  const due = new Date(new Date(start.utcIso).getTime() - minutes * 60_000).toISOString();
  const existing = listReminders(40).find((r) => r.related_event_id === event.id && r.state === 'scheduled');
  if (existing) updateReminderDue(existing.id, due, `Upcoming: ${title}`);
  else {
    createReminder({
      title: `Upcoming: ${title}`,
      body: `Starts ${start.homeLocal}`,
      dueAt: due,
      relatedEventId: event.id,
    });
  }

  return {
    ok: true,
    reply: `${reschedule ? 'Moved' : 'Added'} “${event.title}” for ${start.homeLocal} (${start.homeTz}).`,
    detail: { event, start },
  };
}

function executeContentQueue(
  payload: Record<string, unknown>,
): { ok: boolean; reply: string; detail?: unknown } {
  const id = Number(payload.contentId);
  const item = getContent(id);
  if (!item) return { ok: false, reply: `No content #${id}.` };
  if (item.state === 'published') return { ok: true, reply: `Content #${id} is already published.` };

  let body = payload.body != null ? String(payload.body) : item.body;
  const prepared = prepareContentBody({ platform: item.platform, kind: item.kind, body });
  if (prepared.changed) {
    markContentPrepared(id, prepared.body);
    body = prepared.body;
  } else {
    markContentPrepared(id, body);
  }

  const check = gate({
    platform: item.platform as never,
    kind: item.kind as 'post' | 'dm' | 'comment' | 'reply',
    body,
    templateId: item.template_id,
    provenance: 'founder_approved',
    recentBodies: recentPublishedBodies(item.account_id),
  });
  if (!check.pass) {
    setContentState(id, 'blocked', { violations: check.violations });
    return { ok: false, reply: `cannot queue: ${check.violations.join(' | ')}` };
  }
  markFounderApproved(id);
  setContentState(id, 'queued');
  return {
    ok: true,
    reply: `Queued content #${id} for publish.`,
    detail: { contentId: id, provenance: contentProvenance(getContent(id)?.meta) },
  };
}

export function newIdempotencyKey(prefix: string): string {
  return `${prefix}-${randomBytes(8).toString('hex')}`;
}

export function approvalToCard(row: ApprovalRow): {
  id: number;
  title: string;
  summary: string;
  preview: string | null;
  actionType: string;
  expiresAt: string | null;
} {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    preview: row.preview,
    actionType: row.action_type,
    expiresAt: row.expires_at,
  };
}

/** Create or reuse a pending approval for a prepared content draft. */
export function ensureContentApproval(contentId: number): ApprovalRow {
  ensureApprovalsTable();
  const item = getContent(contentId);
  if (!item) throw new Error(`no content #${contentId}`);
  const prepared = prepareContentBody(item);
  if (prepared.changed) markContentPrepared(contentId, prepared.body);
  const fresh = getContent(contentId)!;
  const pending = listPendingApprovals(80).find((a) => {
    if (a.action_type !== 'content.publish') return false;
    try {
      return Number(JSON.parse(a.payload).contentId) === contentId;
    } catch {
      return false;
    }
  });
  if (pending) {
    run(
      `UPDATE approvals SET preview = ?, summary = ?, payload = ? WHERE id = ?`,
      fresh.body,
      `${fresh.platform} post #${fresh.id}`,
      JSON.stringify({ contentId: fresh.id, body: fresh.body }),
      pending.id,
    );
    return getApproval(pending.id)!;
  }
  return one<ApprovalRow>(
    `INSERT INTO approvals
       (action_type, title, summary, preview, payload, state, autonomy, channel, expires_at)
     VALUES ('content.publish', ?, ?, ?, ?, 'pending', 'approval_required', 'dashboard', ?)
     RETURNING *`,
    `Queue ${fresh.platform} #${fresh.id}`,
    `${fresh.platform} post #${fresh.id} · approve to queue (engine must be on to publish)`,
    fresh.body,
    JSON.stringify({ contentId: fresh.id, body: fresh.body }),
    new Date(Date.now() + DEFAULT_TTL_HOURS * 3600_000).toISOString(),
  );
}
