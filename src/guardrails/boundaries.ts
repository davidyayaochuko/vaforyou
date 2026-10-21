/**
 * Hard boundaries enforced in code. The model cannot bypass these by wording.
 * BLOCKED actions never execute and never enter an auto path.
 */

export type BoundaryLevel = 'blocked' | 'approval_required' | 'ok';

export type BoundaryCode =
  | 'contract'
  | 'payment'
  | 'hiring'
  | 'confidential'
  | 'public_statement'
  | 'none';

export interface BoundaryHit {
  level: BoundaryLevel;
  code: BoundaryCode;
  reason: string;
}

const CONTRACT =
  /\b(sign(ing)? (the |this |a )?(contract|agreement|nda|msa|sow)|accept(ing)? (the |these )?terms|make (a |an )?binding (commitment|promise)|legally bind)\b/i;

/** Real money movement. Chase/remind about a payment owed is not a transfer. */
const PAYMENT_TRANSFER =
  /\b(transfer(ring)? (funds?|money)|wire (transfer|money)|initiate (a )?payment|make a (payment|transfer)|venmo|paypal|stripe checkout|crypto (withdraw|send)|send (them |him |her )?(₦|naira|\$|usd|gbp|eur)\s*\d)\b/i;

const PAYMENT_PAY_SOMEONE =
  /\bpay(ing|ment)?\b.{0,40}\b(vendor|invoice|supplier|contractor|landlord|them|him|her)\b/i;

/** Employment decisions. Drafting a hiring *post* is allowed. */
const HIRING_DECISION =
  /\b(hire (this|the|that|our)?\s*(candidate|person|them)|hired|fire(d|ing)?|terminat(e|ion)|lay.?off|disciplinary (action|hearing)|reject (the |this )?candidate|make (the |an )?offer|extend an offer)\b/i;

const CONTENT_DRAFT =
  /\b(post\s*:|draft|write|compose)\b[\s\S]{0,80}\b(post|update|linkedin|twitter|\bx\b)\b|\b(linkedin|twitter|\bx\b)\b[\s\S]{0,40}\b(post|draft|about)\b|\b(we're|we are|open roles?|hiring post|job (ad|advert|post))\b/i;

const REMIND_OR_CHASE =
  /\b(remind( me)?|chase|follow[- ]?up|nudge)\b/i;

const CONFIDENTIAL_A =
  /\b(forward|share|send|email|post).{0,40}\b(confidential|client data|salary|ssn|bvn|passport|nda.?protected|trade secret)\b/i;
const CONFIDENTIAL_B =
  /\b(confidential|client data|salary spreadsheet|bvn|passport number).{0,40}\b(forward|share|send|email|post|external)\b/i;

/**
 * Detect hard-boundary intent in natural language or an action type.
 * Public statements beyond templates are handled by the content gate + approval queue.
 */
export function checkHardBoundary(text: string, actionType?: string): BoundaryHit {
  const t = text.trim();
  const action = (actionType ?? '').toLowerCase();

  if (action.startsWith('payment.') || action === 'payment') {
    return {
      level: 'blocked',
      code: 'payment',
      reason: 'Payments and transfers are blocked. I cannot move money or start a payment.',
    };
  }

  // Reminders / chase about money are not payment execution.
  const paymentLike = PAYMENT_TRANSFER.test(t) || PAYMENT_PAY_SOMEONE.test(t);
  if (paymentLike && !REMIND_OR_CHASE.test(t)) {
    return {
      level: 'blocked',
      code: 'payment',
      reason: 'Payments and transfers are blocked. I cannot move money or start a payment.',
    };
  }

  if (action.startsWith('contract.') || CONTRACT.test(t)) {
    return {
      level: 'blocked',
      code: 'contract',
      reason: 'Signing contracts or making binding legal commitments is blocked. A human has to do that.',
    };
  }

  if (action.startsWith('hiring.')) {
    return {
      level: 'blocked',
      code: 'hiring',
      reason: 'Hiring, firing, and disciplinary decisions are blocked. I can draft or schedule, but a human decides.',
    };
  }

  // "post: we're hiring" / draft about open roles is content, not a hire decision.
  if (HIRING_DECISION.test(t) && !CONTENT_DRAFT.test(t)) {
    return {
      level: 'blocked',
      code: 'hiring',
      reason: 'Hiring, firing, and disciplinary decisions are blocked. I can draft or schedule, but a human decides.',
    };
  }

  if (action.startsWith('confidential.') || CONFIDENTIAL_A.test(t) || CONFIDENTIAL_B.test(t)) {
    return {
      level: 'approval_required',
      code: 'confidential',
      reason: 'Sharing confidential company or client data externally needs your explicit approval, with the data shown first.',
    };
  }

  if (action === 'content.publish' || action === 'content.queue') {
    return {
      level: 'approval_required',
      code: 'public_statement',
      reason: 'Public posts need approval of the exact final text.',
    };
  }

  return { level: 'ok', code: 'none', reason: '' };
}

/** True when this boundary must never auto-run, even if autonomy is set to auto. */
export function isHardBlocked(hit: BoundaryHit): boolean {
  return hit.level === 'blocked';
}
