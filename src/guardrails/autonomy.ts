import { getSetting, setSetting } from '../db/index.ts';

/**
 * Per-action autonomy. Safe defaults: risky writes need approval; payments and
 * outreach stay blocked. Configurable via settings; Phase 0a ships defaults.
 */
export type AutonomyLevel = 'auto' | 'approval_required' | 'blocked';

export const ACTION_TYPES = [
  'content.publish',
  'calendar.create',
  'calendar.reschedule',
  'calendar.cancel',
  'email.send',
  'workspace.write',
  'workspace.read',
  'slack.send',
  'slack.read',
  'document.write',
  'outreach.run',
  'engage.feed',
  'payment.any',
  'contract.any',
  'hiring.any',
  'confidential.share',
] as const;

export type ActionType = (typeof ACTION_TYPES)[number] | string;

const DEFAULTS: Record<string, AutonomyLevel> = {
  'content.publish': 'approval_required',
  'calendar.create': 'approval_required',
  'calendar.reschedule': 'approval_required',
  'calendar.cancel': 'approval_required',
  'email.send': 'approval_required',
  // Writes are allowed into the queue when WORKSPACE_MCP_WRITES=true; never auto.
  'workspace.write': 'approval_required',
  'workspace.read': 'auto',
  'slack.send': 'approval_required',
  'slack.read': 'auto',
  'document.write': 'approval_required',
  'outreach.run': 'blocked',
  'engage.feed': 'blocked',
  'payment.any': 'blocked',
  'contract.any': 'blocked',
  'hiring.any': 'blocked',
  'confidential.share': 'approval_required',
};

export function defaultAutonomy(): Record<string, AutonomyLevel> {
  return { ...DEFAULTS };
}

export function loadAutonomy(): Record<string, AutonomyLevel> {
  const stored = getSetting<Record<string, AutonomyLevel>>('autonomy', {});
  return { ...DEFAULTS, ...stored };
}

export function saveAutonomy(patch: Record<string, AutonomyLevel>): Record<string, AutonomyLevel> {
  const next = { ...loadAutonomy(), ...patch };
  for (const [key, level] of Object.entries(next)) {
    if (!['auto', 'approval_required', 'blocked'].includes(level)) {
      throw new Error(`invalid autonomy level for ${key}: ${level}`);
    }
  }
  // Hard blocks cannot be weakened to auto through settings.
  next['payment.any'] = 'blocked';
  next['contract.any'] = 'blocked';
  next['hiring.any'] = 'blocked';
  // Workspace MCP writes always need a human tap; never silent send.
  if (next['workspace.write'] === 'auto') next['workspace.write'] = 'approval_required';
  // Slack sends always need a human tap; never silent send.
  if (next['slack.send'] === 'auto') next['slack.send'] = 'approval_required';
  setSetting('autonomy', next);
  return next;
}

export function autonomyFor(actionType: ActionType): AutonomyLevel {
  const map = loadAutonomy();
  if (map[actionType]) return map[actionType]!;
  const prefix = String(actionType).split('.')[0] ?? '';
  if (prefix === 'payment' || prefix === 'contract' || prefix === 'hiring') return 'blocked';
  return map[`${prefix}.any` as string] ?? 'approval_required';
}
