/** Items that sit on the dock itself. */
export type DockKey = 'apps' | 'chat';

/** Surfaces reachable from the Apps launcher (or deep link). */
export type AppKey = 'chat' | 'calendar' | 'approvals' | 'accounts' | 'pipeline';

/** Any open panel id (dock + launcher destinations). */
export type PanelKey = DockKey | AppKey;

export const DOCK_KEYS: DockKey[] = ['apps', 'chat'];

export const APP_KEYS: AppKey[] = [
  'chat',
  'calendar',
  'approvals',
  'accounts',
  'pipeline',
];

export const PANEL_KEYS: PanelKey[] = ['apps', ...APP_KEYS];

export function isPanelKey(v: string | null | undefined): v is PanelKey {
  return !!v && (PANEL_KEYS as string[]).includes(v);
}

export type AppMeta = {
  key: AppKey;
  title: string;
  blurb: string;
  /** Flat face fill for list / launcher icon */
  color: string;
};

export const APPS: AppMeta[] = [
  {
    key: 'chat',
    title: 'Chat',
    blurb: 'Ask Funke in plain English. Approve before anything queues.',
    color: '#2f6b4f',
  },
  {
    key: 'calendar',
    title: 'Calendar',
    blurb: 'Local calendar and reminders.',
    color: '#2a6f97',
  },
  {
    key: 'approvals',
    title: 'Approvals',
    blurb: 'Pending actions. Voice cannot approve.',
    color: '#d97706',
  },
  {
    key: 'accounts',
    title: 'Accounts',
    blurb: 'Connected social accounts and voice prefs.',
    color: '#6d28d9',
  },
  {
    key: 'pipeline',
    title: 'Pipeline',
    blurb: 'Drafts, queue, and publish pipeline.',
    color: '#0f766e',
  },
];
