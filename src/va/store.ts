import { db } from '../db/index.ts';

export interface CalendarEvent {
  id: number;
  title: string;
  start_at: string;
  end_at: string | null;
  timezone: string;
  location: string | null;
  notes: string | null;
  source_tz: string | null;
  google_event_id: string | null;
  created_at: string;
}

export interface Reminder {
  id: number;
  title: string;
  body: string | null;
  due_at: string;
  channel: string;
  state: string;
  related_event_id: number | null;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface FollowUp {
  id: number;
  who: string;
  what: string;
  due_at: string | null;
  channel: string | null;
  state: string;
  created_at: string;
}

export interface VaTask {
  id: number;
  title: string;
  kind: string;
  due_at: string | null;
  state: string;
  priority: number;
  who: string | null;
  source: string;
  reminder_id: number | null;
  followup_id: number | null;
  snooze_until: string | null;
  completed_at: string | null;
  created_at: string;
}

function all<T>(sql: string, ...params: unknown[]): T[] {
  return db().prepare(sql).all(...(params as never[])) as unknown as T[];
}

function one<T>(sql: string, ...params: unknown[]): T {
  return db().prepare(sql).get(...(params as never[])) as unknown as T;
}

export function ensureVaTables(): void {
  db().exec(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id              INTEGER PRIMARY KEY,
      title           TEXT NOT NULL,
      start_at        TEXT NOT NULL,
      end_at          TEXT,
      timezone        TEXT NOT NULL,
      location        TEXT,
      notes           TEXT,
      source_tz       TEXT,
      google_event_id TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id               INTEGER PRIMARY KEY,
      title            TEXT NOT NULL,
      body             TEXT,
      due_at           TEXT NOT NULL,
      channel          TEXT NOT NULL DEFAULT 'email',
      state            TEXT NOT NULL DEFAULT 'scheduled',
      related_event_id INTEGER REFERENCES calendar_events(id) ON DELETE SET NULL,
      last_error       TEXT,
      sent_at          TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders (state, due_at);

    CREATE TABLE IF NOT EXISTS followups (
      id         INTEGER PRIMARY KEY,
      who        TEXT NOT NULL,
      what       TEXT NOT NULL,
      due_at     TEXT,
      channel    TEXT,
      state      TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS va_tasks (
      id           INTEGER PRIMARY KEY,
      title        TEXT NOT NULL,
      kind         TEXT NOT NULL DEFAULT 'task',
      due_at       TEXT,
      state        TEXT NOT NULL DEFAULT 'open',
      priority     INTEGER NOT NULL DEFAULT 0,
      who          TEXT,
      source       TEXT NOT NULL DEFAULT 'chat',
      reminder_id  INTEGER REFERENCES reminders(id) ON DELETE SET NULL,
      followup_id  INTEGER REFERENCES followups(id) ON DELETE SET NULL,
      snooze_until TEXT,
      completed_at TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_va_tasks_open ON va_tasks (state, due_at);

    CREATE TABLE IF NOT EXISTS va_turns (
      id         INTEGER PRIMARY KEY,
      input      TEXT NOT NULL,
      intent     TEXT NOT NULL,
      reply      TEXT NOT NULL,
      detail     TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  migrateRemindersAndFollowupsIntoTasks();
}

export function createCalendarEvent(row: {
  title: string;
  startAt: string;
  endAt?: string | null;
  timezone: string;
  location?: string | null;
  notes?: string | null;
  sourceTz?: string | null;
}): CalendarEvent {
  return one<CalendarEvent>(
    `INSERT INTO calendar_events (title, start_at, end_at, timezone, location, notes, source_tz)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
    row.title,
    row.startAt,
    row.endAt ?? null,
    row.timezone,
    row.location ?? null,
    row.notes ?? null,
    row.sourceTz ?? null,
  );
}

export function listUpcomingEvents(limit = 20): CalendarEvent[] {
  return all<CalendarEvent>(
    `SELECT * FROM calendar_events
     WHERE start_at >= datetime('now', '-1 day')
     ORDER BY start_at ASC
     LIMIT ?`,
    limit,
  );
}

export function getCalendarEvent(id: number): CalendarEvent | undefined {
  return all<CalendarEvent>(`SELECT * FROM calendar_events WHERE id = ?`, id)[0];
}

export function deleteCalendarEvent(id: number): void {
  db().prepare(`DELETE FROM reminders WHERE related_event_id = ?`).run(id);
  db().prepare(`DELETE FROM calendar_events WHERE id = ?`).run(id);
}

export function updateCalendarEvent(
  id: number,
  patch: {
    title?: string;
    startAt?: string;
    endAt?: string | null;
    timezone?: string;
    location?: string | null;
    notes?: string | null;
    sourceTz?: string | null;
    googleEventId?: string | null;
  },
): CalendarEvent | undefined {
  const cur = getCalendarEvent(id);
  if (!cur) return undefined;
  db()
    .prepare(
      `UPDATE calendar_events SET
         title = ?, start_at = ?, end_at = ?, timezone = ?,
         location = ?, notes = ?, source_tz = ?, google_event_id = ?
       WHERE id = ?`,
    )
    .run(
      patch.title ?? cur.title,
      patch.startAt ?? cur.start_at,
      patch.endAt === undefined ? cur.end_at : patch.endAt,
      patch.timezone ?? cur.timezone,
      patch.location === undefined ? cur.location : patch.location,
      patch.notes === undefined ? cur.notes : patch.notes,
      patch.sourceTz === undefined ? cur.source_tz : patch.sourceTz,
      patch.googleEventId === undefined ? cur.google_event_id : patch.googleEventId,
      id,
    );
  return getCalendarEvent(id);
}

export function updateReminderDue(id: number, dueAt: string, title?: string): void {
  if (title) {
    db().prepare(`UPDATE reminders SET due_at = ?, title = ?, state = 'scheduled' WHERE id = ?`).run(dueAt, title, id);
  } else {
    db().prepare(`UPDATE reminders SET due_at = ?, state = 'scheduled' WHERE id = ?`).run(dueAt, id);
  }
}

export function createReminder(row: {
  title: string;
  body?: string | null;
  dueAt: string;
  channel?: string;
  relatedEventId?: number | null;
}): Reminder {
  const reminder = one<Reminder>(
    `INSERT INTO reminders (title, body, due_at, channel, related_event_id)
     VALUES (?, ?, ?, ?, ?)
     RETURNING *`,
    row.title,
    row.body ?? null,
    row.dueAt,
    row.channel ?? 'email',
    row.relatedEventId ?? null,
  );
  upsertTaskFromReminder(reminder);
  return reminder;
}

export function listReminders(limit = 30): Reminder[] {
  return all<Reminder>(`SELECT * FROM reminders ORDER BY due_at ASC LIMIT ?`, limit);
}

export function dueReminders(nowIso = new Date().toISOString()): Reminder[] {
  return all<Reminder>(
    `SELECT * FROM reminders
     WHERE state = 'scheduled' AND due_at <= ?
     ORDER BY due_at ASC
     LIMIT 20`,
    nowIso,
  );
}

/** Atomically move scheduled → sending so two loops cannot email the same reminder. */
export function claimReminderForSend(id: number): Reminder | undefined {
  const result = db()
    .prepare(`UPDATE reminders SET state = 'sending' WHERE id = ? AND state = 'scheduled'`)
    .run(id);
  if (Number(result.changes) < 1) return undefined;
  return all<Reminder>(`SELECT * FROM reminders WHERE id = ?`, id)[0];
}

export function markReminderSent(id: number): void {
  db()
    .prepare(
      `UPDATE reminders SET state = 'sent', sent_at = datetime('now'), last_error = NULL WHERE id = ?`,
    )
    .run(id);
}

export function markReminderFailed(id: number, error: string): void {
  db()
    .prepare(`UPDATE reminders SET state = 'failed', last_error = ? WHERE id = ?`)
    .run(error.slice(0, 500), id);
}

/** Put a failed/sending reminder back on the schedule so it can retry. */
export function releaseReminderClaim(id: number, error?: string): void {
  db()
    .prepare(
      `UPDATE reminders SET state = 'scheduled', last_error = COALESCE(?, last_error)
       WHERE id = ? AND state = 'sending'`,
    )
    .run(error ? error.slice(0, 500) : null, id);
}

/** Same title + start within a 2-minute window counts as a duplicate create. */
export function findDuplicateCalendarEvent(
  title: string,
  startAt: string,
): CalendarEvent | undefined {
  const startMs = Date.parse(startAt);
  if (!Number.isFinite(startMs)) return undefined;
  const windowMs = 2 * 60_000;
  return listUpcomingEvents(40).find((e) => {
    if (e.title.trim().toLowerCase() !== title.trim().toLowerCase()) return false;
    const other = Date.parse(e.start_at);
    return Number.isFinite(other) && Math.abs(other - startMs) <= windowMs;
  });
}

export function createFollowUp(row: {
  who: string;
  what: string;
  dueAt?: string | null;
  channel?: string | null;
}): FollowUp {
  const follow = one<FollowUp>(
    `INSERT INTO followups (who, what, due_at, channel) VALUES (?, ?, ?, ?) RETURNING *`,
    row.who,
    row.what,
    row.dueAt ?? null,
    row.channel ?? null,
  );
  upsertTaskFromFollowUp(follow);
  return follow;
}

function migrateRemindersAndFollowupsIntoTasks(): void {
  const missingReminders = all<Reminder>(
    `SELECT r.* FROM reminders r
     LEFT JOIN va_tasks t ON t.reminder_id = r.id
     WHERE t.id IS NULL`,
  );
  for (const r of missingReminders) upsertTaskFromReminder(r, 'migrate');

  const missingFollowups = all<FollowUp>(
    `SELECT f.* FROM followups f
     LEFT JOIN va_tasks t ON t.followup_id = f.id
     WHERE t.id IS NULL`,
  );
  for (const f of missingFollowups) upsertTaskFromFollowUp(f, 'migrate');
}

function upsertTaskFromReminder(r: Reminder, source = 'chat'): void {
  const existing = all<VaTask>(`SELECT * FROM va_tasks WHERE reminder_id = ? LIMIT 1`, r.id)[0];
  const state =
    r.state === 'sent' || r.state === 'cancelled' ? 'done'
    : r.state === 'failed' ? 'open'
    : r.state === 'scheduled' || r.state === 'sending' ? 'open'
    : 'open';
  if (existing) {
    db().prepare(
      `UPDATE va_tasks SET title = ?, due_at = ?, state = CASE WHEN state = 'done' THEN state ELSE ? END
       WHERE id = ?`,
    ).run(r.title, r.due_at, state, existing.id);
    return;
  }
  db().prepare(
    `INSERT INTO va_tasks (title, kind, due_at, state, source, reminder_id)
     VALUES (?, 'reminder', ?, ?, ?, ?)`,
  ).run(r.title, r.due_at, state, source, r.id);
}

function upsertTaskFromFollowUp(f: FollowUp, source = 'chat'): void {
  const existing = all<VaTask>(`SELECT * FROM va_tasks WHERE followup_id = ? LIMIT 1`, f.id)[0];
  const title = `${f.who}: ${f.what}`;
  const state = f.state === 'open' ? 'open' : 'done';
  if (existing) {
    db().prepare(
      `UPDATE va_tasks SET title = ?, who = ?, due_at = ?, state = CASE WHEN state = 'done' THEN state ELSE ? END
       WHERE id = ?`,
    ).run(title, f.who, f.due_at, state, existing.id);
    return;
  }
  db().prepare(
    `INSERT INTO va_tasks (title, kind, due_at, state, who, source, followup_id)
     VALUES (?, 'follow_up', ?, ?, ?, ?, ?)`,
  ).run(title, f.due_at, state, f.who, source, f.id);
}

export function createTask(row: {
  title: string;
  kind?: string;
  dueAt?: string | null;
  who?: string | null;
  source?: string;
  priority?: number;
}): VaTask {
  return one<VaTask>(
    `INSERT INTO va_tasks (title, kind, due_at, who, source, priority)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING *`,
    row.title.trim(),
    row.kind ?? 'task',
    row.dueAt ?? null,
    row.who ?? null,
    row.source ?? 'chat',
    row.priority ?? 0,
  );
}

export function listOpenTasks(limit = 40): VaTask[] {
  return all<VaTask>(
    `SELECT * FROM va_tasks
     WHERE state IN ('open', 'snoozed')
     ORDER BY priority DESC,
       CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,
       due_at ASC,
       id ASC
     LIMIT ?`,
    limit,
  );
}

export function listDoneTasks(limit = 10): VaTask[] {
  return all<VaTask>(
    `SELECT * FROM va_tasks WHERE state = 'done' ORDER BY COALESCE(completed_at, created_at) DESC LIMIT ?`,
    limit,
  );
}

export function getTask(id: number): VaTask | undefined {
  return all<VaTask>(`SELECT * FROM va_tasks WHERE id = ?`, id)[0];
}

export function completeTask(id: number): VaTask | undefined {
  db().prepare(
    `UPDATE va_tasks SET state = 'done', completed_at = datetime('now') WHERE id = ? AND state != 'done'`,
  ).run(id);
  const task = getTask(id);
  if (task?.followup_id) {
    db().prepare(`UPDATE followups SET state = 'done' WHERE id = ?`).run(task.followup_id);
  }
  return task;
}

export function snoozeTask(id: number, untilIso: string): VaTask | undefined {
  db().prepare(
    `UPDATE va_tasks SET state = 'snoozed', snooze_until = ?, due_at = ? WHERE id = ?`,
  ).run(untilIso, untilIso, id);
  return getTask(id);
}

export function setTaskPriorities(orderedIds: number[]): void {
  const n = orderedIds.length;
  const stmt = db().prepare(`UPDATE va_tasks SET priority = ? WHERE id = ?`);
  orderedIds.forEach((id, i) => stmt.run(n - i, id));
}

/** Rank open tasks: overdue first, then due soon, then priority, never drop any. */
export function prioritiseOpenTasks(): VaTask[] {
  const open = listOpenTasks(80);
  const now = Date.now();
  const scored = open.map((t) => {
    const due = t.due_at ? Date.parse(t.due_at) : NaN;
    let score = t.priority * 10;
    if (Number.isFinite(due)) {
      const hours = (due - now) / 3_600_000;
      if (hours < 0) score += 1000 + Math.min(500, -hours);
      else if (hours < 24) score += 200 - hours;
      else score += Math.max(0, 100 - hours / 24);
    }
    if (t.kind === 'follow_up') score += 15;
    return { t, score };
  });
  scored.sort((a, b) => b.score - a.score);
  setTaskPriorities(scored.map((s) => s.t.id));
  return listOpenTasks(80);
}

export function listOpenFollowUps(limit = 30): FollowUp[] {
  return all<FollowUp>(
    `SELECT * FROM followups WHERE state = 'open' ORDER BY COALESCE(due_at, created_at) ASC LIMIT ?`,
    limit,
  );
}

export function logVaTurn(input: string, intent: string, reply: string, detail: unknown): void {
  // Legacy flat log. New chat UI reads va_messages via conversations.ts;
  // command.ts dual-writes through logChatExchange().
  db()
    .prepare(`INSERT INTO va_turns (input, intent, reply, detail) VALUES (?, ?, ?, ?)`)
    .run(input, intent, reply, JSON.stringify(detail ?? {}));
}

export function recentVaTurns(limit = 20): {
  id: number;
  input: string;
  intent: string;
  reply: string;
  created_at: string;
}[] {
  return all(
    `SELECT id, input, intent, reply, created_at FROM va_turns ORDER BY id DESC LIMIT ?`,
    limit,
  );
}
