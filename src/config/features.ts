import { env } from './env.ts';

/**
 * Safe-by-default feature flags. High-risk capabilities stay off until a person
 * opts in through .env. Phase 0a will move more of this into an autonomy matrix.
 */
export const features = {
  /** LinkedIn outreach funnel (invite / message campaigns). Default off. */
  outreachEnabled: env.outreachEnabled,
  /** Feed likes/comments on other people's posts. Default off. */
  engageFeedEnabled: env.engageFeedEnabled,
  /**
   * Workspace MCP write tools (send mail, create/delete Drive files, etc.).
   * Default off until the generic approval queue exists. Read tools still work.
   */
  workspaceMcpWrites: env.workspaceMcpWrites,
};

export function outreachBlockedMessage(): string {
  return (
    'The outreach funnel is off by default. Set OUTREACH_ENABLED=true in .env only if you ' +
    'understand the risk, then restart. Prefer posting your own approved content instead.'
  );
}

export function engageBlockedMessage(): string {
  return (
    'Feed engagement (likes and comments on other people\'s posts) is off by default. ' +
    'Set ENGAGE_FEED_ENABLED=true in .env only if you want it, then restart.'
  );
}
