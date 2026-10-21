/**
 * Seed an isolated Funke DB for real-world usage testing.
 * Usage: DB_PATH=/tmp/funke-usage.db npx tsx scripts/usage-seed.ts
 *
 * Never touches production pilot.db. Engine stays off. No OAuth.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const dbPath = process.env.DB_PATH;
if (!dbPath) {
  console.error('Set DB_PATH to an isolated sqlite file');
  process.exit(1);
}
mkdirSync(dirname(dbPath), { recursive: true });

const { upsertAccount, setAccountStatus, initSchema } = await import('../src/db/index.ts');
const {
  ensureVaTables,
  createCalendarEvent,
  createReminder,
  createFollowUp,
} = await import('../src/va/store.ts');
const { remember } = await import('../src/va/memory.ts');

initSchema();
ensureVaTables();

const TZ = 'Africa/Lagos';
/** Documented "session now" for relative-date narration. Wall clock still runs. */
const ANCHOR = '2026-10-21T08:00:00.000Z'; // Wed morning WAT-ish

function iso(dayOffset: number, hourWAT: number, minute = 0): string {
  // WAT = UTC+1
  const d = new Date(ANCHOR);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  d.setUTCHours(hourWAT - 1, minute, 0, 0);
  return d.toISOString();
}

function endIso(start: string, hours = 1): string {
  const d = new Date(start);
  d.setUTCHours(d.getUTCHours() + hours);
  return d.toISOString();
}

// Social accounts (dry-run only; no live profiles required for chat drafts)
const li = upsertAccount('personal-linkedin', `/tmp/funke-usage-profiles/personal-linkedin`, undefined, 'linkedin');
setAccountStatus(li.id, 'ok', 'usage-test-li');
const company = upsertAccount('company-page', `/tmp/funke-usage-profiles/company-page`, undefined, 'linkedin');
setAccountStatus(company.id, 'ok', 'usage-test-co');
const x = upsertAccount('brand-x', `/tmp/funke-usage-profiles/brand-x`, undefined, 'x');
setAccountStatus(x.id, 'ok', 'usage-test-x');

const meetings = [
  { title: 'Standup with Eng', day: 0, h: 9, loc: 'Google Meet', notes: 'Daily sync' },
  { title: 'Investor update with Amaka', day: 0, h: 11, loc: 'Zoom', notes: 'Q3 numbers' },
  { title: 'Client call: Tunde (Adire Co)', day: 0, h: 14, loc: 'Phone', notes: 'Order #482' },
  { title: 'Interview: Chioma Okafor', day: 1, h: 10, loc: 'Google Meet', notes: 'PM role' },
  { title: 'Board prep with Ngozi', day: 1, h: 15, loc: 'Office', notes: null },
  { title: 'Content review (SMM)', day: 2, h: 11, loc: 'Slack huddle', notes: 'Week plan' },
  { title: 'Sales call: Bola Ventures', day: 2, h: 16, loc: 'Zoom', notes: 'Follow-up proposal' },
  { title: 'Travel: Lagos → Accra', day: 3, h: 7, loc: 'Murtala airport', notes: 'Flight' },
  { title: 'Accra partner lunch', day: 3, h: 13, loc: 'Accra (GMT)', notes: 'Partner: Kofi' },
  { title: 'Weekly wrap', day: 4, h: 16, loc: 'Google Meet', notes: 'EOW review' },
];

for (const m of meetings) {
  const start = iso(m.day, m.h);
  createCalendarEvent({
    title: m.title,
    startAt: start,
    endAt: endIso(start, m.title.startsWith('Travel') ? 3 : 1),
    timezone: TZ,
    location: m.loc,
    notes: m.notes,
    sourceTz: TZ,
  });
}

// Overdue + upcoming reminders
createReminder({ title: 'Pay NEPA bill', body: 'Disco account ending 4421', dueAt: iso(-2, 9) });
createReminder({ title: 'Send rent to landlord', body: 'October rent', dueAt: iso(-1, 10) });
createReminder({ title: 'Call Mama', body: 'Sunday check-in', dueAt: iso(2, 18) });
createReminder({ title: 'School fees installment', body: 'Second term', dueAt: iso(5, 9) });
createReminder({ title: 'Follow up Tunde on Friday', body: 'Call about posting more', dueAt: iso(2, 15) });

createFollowUp({
  who: 'Tunde Adebayo',
  what: 'Discuss content cadence for Adire Co',
  dueAt: iso(2, 15),
});
createFollowUp({
  who: 'Amaka Okeke',
  what: 'Send investor deck v2',
  dueAt: iso(0, 17),
});

remember({
  scope: 'contact',
  contact: 'Tunde Adebayo',
  key: 'profile',
  value: 'Runs Adire Co fashion brand in Lagos. Prefers WhatsApp. Order lead times 5-7 days.',
});
remember({
  scope: 'contact',
  contact: 'Ngozi Eze',
  key: 'profile',
  value: 'Board member. Formal tone. Africa/Lagos.',
});
remember({
  scope: 'contact',
  contact: 'Chioma Okafor',
  key: 'profile',
  value: 'PM candidate. Interview Thursday 10am.',
});
remember({
  scope: 'preference',
  key: 'timezone_voice',
  value: 'Prefer Africa/Lagos timezone. Founder voice: direct, no hype, short paragraphs.',
});
remember({
  scope: 'fact',
  key: 'company_pricing',
  value:
    'Company: Crew. Product: outreach automation for founders. Public price for Starter is NGN 45000/mo; Pro is NGN 120000/mo. Delivery of onboarding is 3 business days.',
});
remember({
  scope: 'task',
  key: 'hiring_pm',
  value: 'Draft hiring post for Product Manager (Lagos, hybrid).',
});

// Soft "emails" as memory facts (no mailbox mock)
remember({
  scope: 'fact',
  key: 'inbox_bola',
  value:
    'Inbox note: Bola Ventures asked for proposal revision by Friday. Unverified competitor claim: RivalCo raised $2M (mark unverified if used).',
});
remember({
  scope: 'fact',
  key: 'engagement_stats',
  value:
    'Past LinkedIn post "Why founders should batch outreach" got 842 reactions, 63 comments. Past X post on hiring got 120 likes.',
});

console.log(JSON.stringify({
  ok: true,
  dbPath,
  anchor: ANCHOR,
  timezone: TZ,
  accounts: ['personal-linkedin', 'company-page', 'brand-x'],
  meetings: meetings.length,
}, null, 2));
