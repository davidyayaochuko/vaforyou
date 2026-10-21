/**
 * Monitoring alerts: errors, failed jobs, unusual spikes.
 * Surfaced through the same channel as approvals (dashboard Ok tab).
 */

import { db, recentLog } from '../db/index.ts';
import { listJobs } from '../db/content.ts';

export interface AlertRow {
  id: number;
  kind: string;
  message: string;
  detail: string;
  state: string;
  created_at: string;
}

function all<T>(sql: string, ...params: unknown[]): T[] {
  return db().prepare(sql).all(...(params as never[])) as unknown as T[];
}

function one<T>(sql: string, ...params: unknown[]): T {
  return db().prepare(sql).get(...(params as never[])) as unknown as T;
}

export function ensureAlertsTable(): void {
  db().exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id         INTEGER PRIMARY KEY,
      kind       TEXT NOT NULL,
      message    TEXT NOT NULL,
      detail     TEXT NOT NULL DEFAULT '{}',
      state      TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_state ON alerts (state, created_at DESC);
  `);
}

export function raiseAlert(opts: {
  kind: string;
  message: string;
  detail?: unknown;
}): AlertRow {
  ensureAlertsTable();
  // Dedup identical open alerts in the last hour.
  const recent = all<AlertRow>(
    `SELECT * FROM alerts
      WHERE state = 'open' AND kind = ? AND message = ?
        AND created_at >= datetime('now', '-1 hour')
      LIMIT 1`,
    opts.kind,
    opts.message,
  )[0];
  if (recent) return recent;
  return one<AlertRow>(
    `INSERT INTO alerts (kind, message, detail) VALUES (?, ?, ?) RETURNING *`,
    opts.kind,
    opts.message.slice(0, 400),
    JSON.stringify(opts.detail ?? {}),
  );
}

export function listOpenAlerts(limit = 40): AlertRow[] {
  ensureAlertsTable();
  return all<AlertRow>(
    `SELECT * FROM alerts WHERE state = 'open' ORDER BY id DESC LIMIT ?`,
    limit,
  );
}

export function ackAlert(id: number): boolean {
  ensureAlertsTable();
  const r = db()
    .prepare(`UPDATE alerts SET state = 'acked' WHERE id = ? AND state = 'open'`)
    .run(id);
  return Number(r.changes) > 0;
}

/** Scan engine health and raise alerts when something looks wrong. */
export function scanForAlerts(): AlertRow[] {
  ensureAlertsTable();
  const raised: AlertRow[] = [];

  const failed = listJobs().filter((j) => j.state === 'failed' || j.state === 'disabled');
  if (failed.length > 0) {
    raised.push(
      raiseAlert({
        kind: 'failed_jobs',
        message: `${failed.length} job(s) failed or disabled`,
        detail: { ids: failed.slice(0, 10).map((j) => j.id) },
      }),
    );
  }

  const recent = recentLog(80);
  const hourAgo = Date.now() - 3600_000;
  const lastHour = recent.filter((row) => {
    const at = String(row.created_at ?? '');
    const ms = Date.parse(at.includes('T') ? at : at.replace(' ', 'T') + 'Z');
    return Number.isFinite(ms) && ms >= hourAgo && Number(row.counted) === 1;
  });
  if (lastHour.length >= 40) {
    raised.push(
      raiseAlert({
        kind: 'activity_spike',
        message: `Unusual activity: ${lastHour.length} counted actions in the last hour`,
        detail: { count: lastHour.length },
      }),
    );
  }

  return raised;
}
