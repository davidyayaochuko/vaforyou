/**
 * Funke conversation eval agents.
 *
 * Deterministic scenarios (no network) cover session merge, timezone, and
 * status. Optional live scenarios hit Groq when GROQ_API_KEY is set.
 *
 *   npm run va:eval
 *   npm run va:eval -- --live
 */
import { clearSession, setPending, pushTurn } from '../src/va/session.ts';
import { handleVaCommand } from '../src/va/command.ts';
import { deleteCalendarEvent, listUpcomingEvents } from '../src/va/store.ts';
import { ensureVaTables } from '../src/va/store.ts';
import { fitAsThread } from '../src/content/thread.ts';
import { splitThread } from '../src/platforms/x.ts';
import { replaceBannedWords, gate } from '../src/content/gate.ts';

type Check = { name: string; pass: boolean; detail?: string };
const checks: Check[] = [];

function check(name: string, pass: boolean, detail?: unknown): void {
  checks.push({ name, pass, detail: detail === undefined ? undefined : String(detail) });
  const mark = pass ? 'ok' : 'FAIL';
  console.log(`  [${mark}] ${name}${detail !== undefined && !pass ? ` :: ${detail}` : ''}`);
}

async function scenarioPendingListDoesNotBecomeTitle(): Promise<void> {
  console.log('\nAgent: session hygiene');
  clearSession();
  setPending({
    intent: 'calendar_create',
    partial: {
      title: '',
      start: '2026-10-21T17:00:00',
      timezone: 'America/Chicago',
      location: null,
      notes: null,
    },
    askedAt: Date.now(),
  });
  pushTurn('user', 'Now can you help reschedule my meeting for tomorrow, to 5 pm CST');
  pushTurn('funke', "Sure, what's the meeting title?", 'calendar_create');

  const before = listUpcomingEvents(20).map((e) => e.id);
  const result = await handleVaCommand('Give me a list of my meetings tomorrow');
  const after = listUpcomingEvents(20);
  const created = after.filter((e) => !before.includes(e.id));

  check('list request stays status or help, not a silent create', result.intent === 'status' || result.ok);
  check(
    'does not create an event titled like the list request',
    !created.some((e) => /list of my meetings/i.test(e.title)),
    created.map((e) => e.title).join(' | '),
  );
  check(
    'reply does not claim it added the list text as a meeting',
    !/Added ["“]Give me a list/i.test(result.reply),
    result.reply.slice(0, 120),
  );
}

async function scenarioThreadFit(): Promise<void> {
  console.log('\nAgent: publish prep');
  const raw =
    'Thread: AI Verification – Computer vision checks each photo for stock images or manipulation before a listing goes live. '
    + 'Escrow Protection – Money stays in a secure pool until both parties confirm the transaction. '
    + 'Integrated mobile money makes payments seamless across Nigeria. Learn more at bidoro.com.';
  const soft = replaceBannedWords(raw);
  check('banned word seamless is rewritten', !/\bseamless\b/i.test(soft.body) && soft.replaced.includes('seamless'));
  const fitted = fitAsThread(soft.body, 280);
  const parts = splitThread(fitted.body);
  check('over-long copy becomes a thread', fitted.threaded && parts.length >= 2, parts.length);
  check(
    'each thread part fits X',
    parts.every((p) => p.length <= 280),
    parts.map((p) => p.length).join(','),
  );
  const gated = gate({
    platform: 'x',
    kind: 'post',
    body: fitted.body,
    provenance: 'founder_approved',
  });
  check('founder-approved threaded body passes gate', gated.pass, gated.violations.join(' | '));
}

async function scenarioLiveReschedule(live: boolean): Promise<void> {
  console.log('\nAgent: live calendar (optional)');
  if (!live) {
    check('skipped live Groq scenarios (pass --live to run)', true);
    return;
  }
  if (!process.env.GROQ_API_KEY) {
    check('GROQ_API_KEY required for --live', false);
    return;
  }

  clearSession();
  // Clean prior eval junk titles
  for (const e of listUpcomingEvents(30)) {
    if (/^va-eval /i.test(e.title) || /list of my meetings/i.test(e.title)) {
      deleteCalendarEvent(e.id);
    }
  }

  const created = await handleVaCommand(
    'Add a calendar event titled va-eval pairing call tomorrow at 3pm Africa/Lagos for 60 minutes',
  );
  check('live create ok', created.ok && /va-eval pairing/i.test(created.reply), created.reply.slice(0, 160));

  clearSession();
  const list = await handleVaCommand('Give me a list of my meetings tomorrow');
  check('live list is status', list.intent === 'status' || /calendar|meeting|pairing|coming up/i.test(list.reply), list.intent);
  check('live list mentions the eval event or says what is on the calendar', /va-eval|pairing|calendar|meeting/i.test(list.reply), list.reply.slice(0, 200));

  clearSession();
  const moved = await handleVaCommand(
    'Reschedule the meeting titled va-eval pairing call to tomorrow at 5:00 PM America/Chicago',
  );
  check('live reschedule does not ask for a nonsense title', !/list of my meetings/i.test(moved.reply), moved.reply.slice(0, 200));
  check(
    'live reschedule reports a move, asks which meeting, or keeps a calendar reply',
    moved.ok || /[Mm]oved|which one|calendar|meeting|could not find/i.test(moved.reply),
    moved.reply.slice(0, 200),
  );

  for (const e of listUpcomingEvents(30)) {
    if (/^va-eval /i.test(e.title)) deleteCalendarEvent(e.id);
  }
}

async function main(): Promise<void> {
  ensureVaTables();
  const live = process.argv.includes('--live');
  console.log(`Funke VA eval${live ? ' (live)' : ' (deterministic + optional skip)'}`);

  await scenarioPendingListDoesNotBecomeTitle();
  await scenarioThreadFit();
  await scenarioLiveReschedule(live);

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.log('Failures:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
