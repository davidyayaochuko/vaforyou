/**
 * Escalation classifier. Soft hand-off for topics that are not hard-blocked
 * but must not be handled alone (complaints, legal, sensitive, out of scope).
 */

export type EscalationCode =
  | 'complaint'
  | 'legal'
  | 'financial'
  | 'sensitive'
  | 'out_of_scope'
  | 'low_confidence'
  | 'none';

export interface EscalationHit {
  escalate: boolean;
  code: EscalationCode;
  reason: string;
}

const COMPLAINT =
  /\b(complain(t|ing)?|furious|outraged|lawsuit threat|this is unacceptable|demand(ing)? (a )?refund|hostile|harass(ment|ed)?|defamat(e|ion)|i('ll| will) sue)\b/i;

const LEGAL =
  /\b(legal (advice|opinion|counsel)|attorney|solicitor|litigation|subpoena|court (case|order)|regulatory (filing|complaint)|gdpr (complaint|breach)|ndpa (complaint|breach))\b/i;

const FINANCIAL =
  /\b(tax (advice|filing|return)|invest(ment|ing) advice|stock tip|loan agreement|credit (line|facility)|audit (opinion|response)|invoice dispute|write.?off)\b/i;

const SENSITIVE =
  /\b(medical (advice|diagnosis)|mental health crisis|suicide|self.?harm|abuse (report|allegation)|whistleblow|password|otp|one.?time (code|password)|ssn|bvn)\b/i;

const OUT_OF_SCOPE =
  /\b(hack(ing)? (into|their)|bypass (security|2fa|mfa)|scrape (competitor|private)|buy (followers|likes)|fake (engagement|reviews)|deepfake|doxx?\b)\b/i;

const LOW_CONFIDENCE_CUES =
  /\b(maybe|not sure|i guess|whatever you think|you decide|figure it out|just do something)\b/i;

/**
 * Detect whether the user message should be escalated to a human instead of
 * Funke acting or inventing an answer.
 */
export function checkEscalation(text: string): EscalationHit {
  const t = text.trim();
  if (!t) return { escalate: false, code: 'none', reason: '' };

  if (COMPLAINT.test(t)) {
    return {
      escalate: true,
      code: 'complaint',
      reason:
        'That sounds like a complaint or heated situation. I will not reply or act on it alone. A human should take it from here.',
    };
  }
  if (LEGAL.test(t)) {
    return {
      escalate: true,
      code: 'legal',
      reason:
        'Legal topics need a human. I can draft notes for them, but I will not give legal advice or file anything.',
    };
  }
  if (FINANCIAL.test(t)) {
    return {
      escalate: true,
      code: 'financial',
      reason:
        'Financial or tax advice is out of my lane. I flagged this for a human.',
    };
  }
  if (SENSITIVE.test(t)) {
    return {
      escalate: true,
      code: 'sensitive',
      reason:
        'That is sensitive. I will not handle credentials, medical, or safety topics on my own.',
    };
  }
  if (OUT_OF_SCOPE.test(t)) {
    return {
      escalate: true,
      code: 'out_of_scope',
      reason:
        'That request is outside what I am allowed to do. A human needs to decide whether anything happens next.',
    };
  }
  if (LOW_CONFIDENCE_CUES.test(t) && t.length < 40) {
    return {
      escalate: true,
      code: 'low_confidence',
      reason:
        'I am not sure what you want. Tell me the outcome in one short sentence, or ask a human to decide.',
    };
  }

  return { escalate: false, code: 'none', reason: '' };
}
