/**
 * Daily digest: actions taken, pending approvals, upcoming meetings, overdue tasks.
 */

import { getSetting, setSetting } from '../db/index.ts';
import { listJobs } from '../db/content.ts';
import { listPendingApprovals } from '../guardrails/approvals.ts';
import { searchAudit } from '../guardrails/audit.ts';
import {
  listOpenFollowUps,
  listReminders,
  listUpcomingEvents,
} from './store.ts';
import { homeTimezone } from './timezone.ts';
import { DateTime } from 'luxon';
import { emailConfigured, sendEmail } from './email.ts';
import { env } from '../config/env.ts';
import { raiseAlert } from './alerts.ts';

export interface DailySummary {
  at: string;
  timezone: string;
  pendingApprovals: number;
  upcomingMeetings: { title: string; when: string }[];
  overdueReminders: { title: string; due: string }[];
  openFollowUps: { who: string; what: string }[];
  recentActions: { action: string; result: string }[];
  failedJobs: number;
  text: string;
}

export function buildDailySummary(): DailySummary {
  const tz = homeTimezone();
  const now = DateTime.now().setZone(tz);
  const pending = listPendingApprovals(50);
  const events = listUpcomingEvents(8).map((e) => ({
    title: e.title,
    when: e.start_at,
  }));
  const overdueReminders = listReminders(40)
    .filter((r) => r.state === 'scheduled' && r.due_at <= new Date().toISOString())
    .slice(0, 8)
    .map((r) => ({ title: r.title, due: r.due_at }));
  const followups = listOpenFollowUps(8).map((f) => ({ who: f.who, what: f.what }));
  const audit = searchAudit({ limit: 12 }).filter((a) => a.result === 'ok' || a.result === 'fail');
  const failedJobs = listJobs().filter((j) => j.state === 'failed' || j.state === 'disabled').length;

  const lines = [
    `Daily summary · ${now.toFormat('ccc d LLL yyyy')} (${tz})`,
    '',
    `Pending approvals: ${pending.length}`,
    pending.length
      ? pending.slice(0, 5).map((p) => `  · #${p.id} ${p.title}`).join('\n')
      : '  · none',
    '',
    `Upcoming meetings: ${events.length}`,
    events.length
      ? events.map((e) => `  · ${e.title} (${e.when})`).join('\n')
      : '  · none soon',
    '',
    `Overdue reminders: ${overdueReminders.length}`,
    overdueReminders.length
      ? overdueReminders.map((r) => `  · ${r.title}`).join('\n')
      : '  · none',
    '',
    `Open follow-ups: ${followups.length}`,
    followups.length
      ? followups.map((f) => `  · ${f.who}: ${f.what}`).join('\n')
      : '  · none',
    '',
    `Failed/disabled jobs: ${failedJobs}`,
    '',
    'Recent actions:',
    audit.length
      ? audit.slice(0, 8).map((a) => `  · ${a.action_type} → ${a.result}`).join('\n')
      : '  · quiet day',
  ];

  return {
    at: now.toUTC().toISO()!,
    timezone: tz,
    pendingApprovals: pending.length,
    upcomingMeetings: events,
    overdueReminders,
    openFollowUps: followups,
    recentActions: audit.map((a) => ({ action: a.action_type, result: a.result })),
    failedJobs,
    text: lines.join('\n'),
  };
}

/** Local hour (0-23) in HOME_TIMEZONE when the digest should fire. */
export function summaryHour(): number {
  const n = Number(process.env.DAILY_SUMMARY_HOUR ?? '8');
  return Number.isFinite(n) ? Math.min(23, Math.max(0, Math.floor(n))) : 8;
}

/**
 * Send or surface the digest at most once per local calendar day.
 * Returns the summary when it ran, null when it was not due.
 */
export async function maybeSendDailySummary(force = false): Promise<DailySummary | null> {
  const tz = homeTimezone();
  const today = DateTime.now().setZone(tz).toISODate();
  const last = getSetting<string | null>('daily_summary_last_date', null);
  const hour = DateTime.now().setZone(tz).hour;

  if (!force) {
    if (last === today) return null;
    if (hour < summaryHour()) return null;
  }

  const summary = buildDailySummary();
  setSetting('daily_summary_last_date', today);
  setSetting('daily_summary_last', {
    at: summary.at,
    text: summary.text,
  });

  raiseAlert({
    kind: 'daily_summary',
    message: `Daily summary ready (${summary.pendingApprovals} approvals, ${summary.upcomingMeetings.length} meetings)`,
    detail: { text: summary.text },
  });

  if (emailConfigured() && env.notifyEmail) {
    await sendEmail({
      subject: `Funke daily summary · ${today}`,
      text: summary.text,
    });
  }

  return summary;
}

export function lastDailySummary(): { at: string; text: string } | null {
  return getSetting<{ at: string; text: string } | null>('daily_summary_last', null);
}

/** Chat-facing daily summary (no email side effects). */
export function formatDailySummary(): string {
  return buildDailySummary().text;
}
