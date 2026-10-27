import type { IconName } from './icons';

/** Items that sit on the dock itself. */
export type DockKey = 'apps' | 'chat' | 'calendar' | 'approvals';

/** Surfaces reachable from the Apps launcher (or deep link). */
export type AppKey =
  | 'chat'
  | 'tasks'
  | 'calendar'
  | 'approvals'
  | 'mail'
  | 'meetings'
  | 'notes'
  | 'socials'
  | 'settings'
  | 'slack';

/** Any open panel id (dock + launcher destinations). */
export type PanelKey = 'apps' | AppKey;

export const DOCK_KEYS: DockKey[] = ['apps', 'chat', 'calendar', 'approvals'];

export type AppGroup = 'Everyday' | 'Communication' | 'Coming soon';

export type AppMeta = {
  key: AppKey;
  title: string;
  blurb: string;
  icon: IconName;
  group: AppGroup;
  live: boolean;
  /** What the finished app will do (shown on coming-soon panels). */
  plans?: string[];
  /** Things to try in Chat today. */
  tryAsks?: string[];
};

export const APPS: AppMeta[] = [
  {
    key: 'chat',
    title: 'Chat',
    blurb: 'Ask Funke in plain English. Approve before anything queues.',
    icon: 'chat',
    group: 'Everyday',
    live: true,
  },
  {
    key: 'tasks',
    title: 'Today',
    blurb: 'Tasks, meetings, and approvals for the day.',
    icon: 'tasks',
    group: 'Everyday',
    live: true,
    tryAsks: [
      'What’s on my plate?',
      'Prioritise my day',
      'Remind me tomorrow at 9am to send the deck',
      'Chase Bola on Friday about the invoice',
    ],
  },
  {
    key: 'calendar',
    title: 'Calendar',
    blurb: 'Upcoming meetings, in your home timezone.',
    icon: 'calendar',
    group: 'Everyday',
    live: true,
    tryAsks: ['Book a call with Chioma Thursday at 3pm', 'What meetings do I have tomorrow?'],
  },
  {
    key: 'approvals',
    title: 'Approvals',
    blurb: 'Everything waiting on you. Voice can’t approve.',
    icon: 'approvals',
    group: 'Everyday',
    live: true,
  },
  {
    key: 'socials',
    title: 'Socials',
    blurb: 'LinkedIn, X and Bluesky accounts and the social engine.',
    icon: 'socials',
    group: 'Communication',
    live: true,
    tryAsks: ['Draft a LinkedIn post about our launch', 'What’s waiting to be posted?'],
  },
  {
    key: 'settings',
    title: 'Settings',
    blurb: 'Social engine, Google Calendar, voice and memory.',
    icon: 'settings',
    group: 'Everyday',
    live: true,
  },
  {
    key: 'mail',
    title: 'Mail',
    blurb: 'Inbox triage and drafted replies.',
    icon: 'mail',
    group: 'Coming soon',
    live: false,
    plans: [
      'Morning digest: needs you, FYI, noise.',
      'Replies drafted in your voice. Sending always needs Approve.',
      'Turn any email into a task or calendar event.',
    ],
    tryAsks: ['Search my Gmail for the contract from Bola Ventures'],
  },
  {
    key: 'meetings',
    title: 'Meetings',
    blurb: 'Prep briefs, notes, and action items.',
    icon: 'meetings',
    group: 'Coming soon',
    live: false,
    plans: [
      'A brief before every meeting: who, last notes, open follow-ups.',
      'Funke joins Zoom or Meet to take notes, and announces itself.',
      'Action items land in Tasks with owners and dates.',
    ],
    tryAsks: ['Paste a Zoom invite and I’ll add it to your calendar'],
  },
  {
    key: 'notes',
    title: 'Notes',
    blurb: 'Quick notes, memory, and docs.',
    icon: 'notes',
    group: 'Coming soon',
    live: false,
    plans: [
      'Quick notes with search and tags.',
      'Voice notes: talk, transcribe, keep the text.',
      'Search Google Docs and Drive.',
    ],
    tryAsks: ['Remember that Chioma prefers WhatsApp', 'What do you know about Bola Ventures?'],
  },
  {
    key: 'slack',
    title: 'Slack',
    blurb: 'Summaries, drafted replies, reminders from Slack.',
    icon: 'slack',
    group: 'Coming soon',
    live: false,
    plans: [
      'Catch up on unread threads and mentions in one summary.',
      'Draft replies. Sending needs Approve.',
      'DM Funke in Slack to create a task or reminder.',
    ],
  },
];

export const APP_KEYS: AppKey[] = APPS.map((a) => a.key);

export const PANEL_KEYS: PanelKey[] = ['apps', ...APP_KEYS];

const LEGACY: Record<string, PanelKey> = { accounts: 'socials', pipeline: 'socials' };

export function normalizePanelKey(v: string | null | undefined): PanelKey | null {
  if (!v) return null;
  if ((PANEL_KEYS as string[]).includes(v)) return v as PanelKey;
  return LEGACY[v] ?? null;
}

export function isPanelKey(v: string | null | undefined): v is PanelKey {
  return !!v && (PANEL_KEYS as string[]).includes(v);
}

export function isDockKey(v: string | null | undefined): v is DockKey {
  return !!v && (DOCK_KEYS as string[]).includes(v);
}

export function appMeta(key: AppKey): AppMeta {
  return APPS.find((a) => a.key === key)!;
}
