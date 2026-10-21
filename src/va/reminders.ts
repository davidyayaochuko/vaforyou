import { sendEmail, emailConfigured } from './email.ts';
import {
  claimReminderForSend,
  dueReminders,
  markReminderFailed,
  markReminderSent,
  releaseReminderClaim,
} from './store.ts';

let timer: ReturnType<typeof setInterval> | null = null;
const logLines: string[] = [];

function log(line: string): void {
  const stamped = `${new Date().toISOString().slice(11, 19)} reminder ${line}`;
  logLines.push(stamped);
  if (logLines.length > 100) logLines.shift();
  console.log(stamped);
}

export function reminderTail(n = 20): string[] {
  return logLines.slice(-n);
}

export async function processDueReminders(): Promise<number> {
  const due = dueReminders();
  let sent = 0;

  for (const r of due) {
    if (!emailConfigured()) {
      // Keep scheduled so configuring email later still delivers, but surface in logs.
      log(`#${r.id} due but email not configured. Left scheduled.`);
      continue;
    }

    const claimed = claimReminderForSend(r.id);
    if (!claimed) continue;

    const out = await sendEmail({
      subject: `VA reminder: ${claimed.title}`,
      text: [claimed.title, claimed.body, `Due at (UTC): ${claimed.due_at}`, 'Sent by vaforyou'].filter(Boolean).join('\n\n'),
    });

    if (out.ok) {
      markReminderSent(claimed.id);
      sent++;
      log(`#${claimed.id} emailed: ${claimed.title}`);
    } else {
      releaseReminderClaim(claimed.id, out.error);
      log(`#${claimed.id} failed: ${out.error}`);
    }
  }

  return sent;
}

/** Independent of the social engine so reminders fire while the browser worker is stopped. */
export function startReminderLoop(everyMs = 30_000): void {
  if (timer) return;
  log('loop started');
  void processDueReminders();
  timer = setInterval(() => {
    void processDueReminders();
    void import('../guardrails/approvals.ts').then((m) => m.expireStaleApprovals()).catch(() => undefined);
    void import('./alerts.ts').then((m) => m.scanForAlerts()).catch(() => undefined);
    void import('./summary.ts').then((m) => m.maybeSendDailySummary()).catch(() => undefined);
  }, everyMs);
}

export function stopReminderLoop(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  log('loop stopped');
}
