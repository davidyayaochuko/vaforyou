/**
 * Phase 0a guardrail checks. No network, no browser.
 *   npm run guardrails
 */
import { initSchema } from '../src/db/index.ts';
import { ensureVaTables } from '../src/va/store.ts';
import { checkHardBoundary, isHardBlocked } from '../src/guardrails/boundaries.ts';
import { autonomyFor, loadAutonomy, saveAutonomy, defaultAutonomy } from '../src/guardrails/autonomy.ts';
import {
  ensureApprovalsTable,
  requestAction,
  decideApproval,
} from '../src/guardrails/approvals.ts';
import { ensureAuditTable, searchAudit, maskSummary } from '../src/guardrails/audit.ts';
import { features } from '../src/config/features.ts';

let failed = 0;
function check(name: string, pass: boolean, detail?: unknown): void {
  if (!pass) failed++;
  console.log(`  ${pass ? 'ok' : 'FAIL'}  ${name}${!pass && detail !== undefined ? ` :: ${detail}` : ''}`);
}

async function main(): Promise<void> {
  process.env.DB_PATH = process.env.DB_PATH || `/tmp/funke-guardrails-${Date.now()}.db`;
  initSchema();
  ensureVaTables();
  ensureApprovalsTable();
  ensureAuditTable();

  console.log('\n1. Hard boundaries');
  check('payment is blocked', isHardBlocked(checkHardBoundary('please pay the vendor 50000 naira')));
  check('contract is blocked', isHardBlocked(checkHardBoundary('sign the contract with Acme')));
  check('hiring decision is blocked', isHardBlocked(checkHardBoundary('hire this candidate today')));
  check('hiring draft post is allowed', !isHardBlocked(checkHardBoundary("post: we're hiring")));
  check('open roles draft is allowed', !isHardBlocked(checkHardBoundary('draft a LinkedIn post about open roles on the team')));
  check('payment transfer is blocked', isHardBlocked(checkHardBoundary('transfer funds to the vendor now')));
  check('payment chase remind is allowed', !isHardBlocked(checkHardBoundary('remind me to chase Chioma for payment')));
  check('confidential needs approval', checkHardBoundary('forward the confidential client data externally').level === 'approval_required');
  check('normal remind is ok', checkHardBoundary('remind me tomorrow at 9am to call Ada').level === 'ok');

  console.log('\n2. Autonomy defaults');
  const defaults = defaultAutonomy();
  check('payment.any blocked', defaults['payment.any'] === 'blocked');
  check('content.publish needs approval', defaults['content.publish'] === 'approval_required');
  check('workspace.write needs approval', defaults['workspace.write'] === 'approval_required');
  check('autonomyFor payment', autonomyFor('payment.transfer') === 'blocked');
  const saved = saveAutonomy({ 'calendar.create': 'approval_required', 'workspace.write': 'auto' });
  check('cannot weaken payment to auto', saved['payment.any'] === 'blocked');
  check('cannot set workspace.write to auto', saved['workspace.write'] === 'approval_required');
  check('loadAutonomy merges', loadAutonomy()['calendar.create'] === 'approval_required');

  console.log('\n3. Approval queue + voice ban');
  const pending = await requestAction({
    actionType: 'calendar.create',
    title: 'Calendar: Guardrail test',
    summary: 'Add Guardrail test tomorrow 3pm',
    preview: 'Add “Guardrail test”\nWhen: tomorrow 3pm',
    payload: {
      title: 'Guardrail test',
      start: '2026-10-22T15:00:00',
      timezone: 'Africa/Lagos',
    },
    idempotencyKey: `guardrail-cal-${Date.now()}`,
  });
  check('calendar create becomes pending', pending.status === 'pending' && !!pending.approval, pending.status);

  const voice = await decideApproval({
    id: pending.approval!.id,
    decision: 'approved',
    decidedBy: 'voice',
  });
  check('voice cannot approve', !voice.ok && /Voice cannot approve/i.test(voice.reply), voice.reply);

  const ok = await decideApproval({
    id: pending.approval!.id,
    decision: 'approved',
    decidedBy: 'dashboard',
  });
  check('dashboard can approve and execute', ok.ok && ok.status === 'executed', ok.reply);

  const blockedPay = await requestAction({
    actionType: 'payment.any',
    title: 'Pay invoice',
    summary: 'transfer funds to vendor',
    payload: {},
    sourceText: 'transfer funds to the vendor now',
  });
  check('payment request blocked', blockedPay.status === 'blocked', blockedPay.reply);

  const wsPending = await requestAction({
    actionType: 'workspace.write',
    title: 'Workspace: send_gmail_message',
    summary: 'Send a test mail',
    preview: 'Tool: send_gmail_message\nto: nobody@example.com\nsubject: guardrail',
    payload: {
      tool: 'send_gmail_message',
      arguments: { to: 'nobody@example.com', subject: 'guardrail', body: 'no' },
    },
    idempotencyKey: `guardrail-ws-${Date.now()}`,
  });
  check('workspace.write becomes pending', wsPending.status === 'pending' && !!wsPending.approval, wsPending.status);

  const wsVoice = await decideApproval({
    id: wsPending.approval!.id,
    decision: 'approved',
    decidedBy: 'voice',
  });
  check('voice cannot approve workspace.write', !wsVoice.ok && /Voice cannot approve/i.test(wsVoice.reply), wsVoice.reply);

  // Force the flag off even if the developer .env enabled writes.
  features.workspaceMcpWrites = false;
  const wsDash = await decideApproval({
    id: wsPending.approval!.id,
    decision: 'approved',
    decidedBy: 'dashboard',
  });
  check(
    'workspace.write fails closed when writes flag off',
    !wsDash.ok && /WORKSPACE_MCP_WRITES=false/i.test(wsDash.reply),
    wsDash.reply,
  );

  console.log('\n4. Audit + masking');
  const masked = maskSummary('email me at boss@company.com with key gsk_abcdefghijklmnop');
  check('mask email', masked.includes('[email]'));
  check('mask secret', masked.includes('[secret]'));
  const audit = searchAudit({ limit: 20 });
  check('audit has rows', audit.length > 0, audit.length);

  console.log(failed ? `\nFAIL — ${failed} checks` : '\nPASS — guardrails');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
