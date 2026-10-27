/**
 * Launch-path regressions found in first-time QA.
 *   npm run launch:smoke
 */
import './test-db.ts';
import { initSchema, upsertAccount, getAccountByName } from '../src/db/index.ts';
import { createContent } from '../src/db/content.ts';
import { ensureVaTables } from '../src/va/store.ts';
import {
  ensureApprovalsTable,
  ensureContentApproval,
  decideApproval,
  listPendingApprovals,
} from '../src/guardrails/approvals.ts';
import { ensureAuditTable } from '../src/guardrails/audit.ts';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

let failed = 0;
function check(name: string, pass: boolean, detail?: unknown): void {
  if (!pass) failed++;
  console.log(`  ${pass ? 'ok' : 'FAIL'}  ${name}${!pass && detail !== undefined ? ` :: ${detail}` : ''}`);
}

async function main(): Promise<void> {
  initSchema();
  ensureVaTables();
  ensureApprovalsTable();
  ensureAuditTable();

  const profiles = join(dirname(process.env.DB_PATH!), 'profiles');
  mkdirSync(profiles, { recursive: true });
  upsertAccount('linkedin', join(profiles, 'linkedin'), undefined, 'linkedin');
  const account = getAccountByName('linkedin')!;
  check('seed account', !!account.id);

  console.log('\n1. Draft content gets an approval card');
  const row = createContent({
    accountId: account.id,
    platform: 'linkedin',
    kind: 'post',
    templateId: null,
    body: 'We shipped reconcile honesty this week. The number that mattered was twelve trials finished without a silent fail.',
    state: 'drafted',
    violations: [],
    meta: { via: 'va_ask', brief: 'reconcile honesty' },
  });
  const approval = ensureContentApproval(row.id);
  check('ensureContentApproval pending', approval.state === 'pending', approval.state);
  check('preview is final body', (approval.preview || '').includes('reconcile honesty'));
  check('listed in pending', listPendingApprovals().some((a) => a.id === approval.id));

  console.log('\n2. Double approve is safe');
  const first = await decideApproval({
    id: approval.id,
    decision: 'approved',
    decidedBy: 'dashboard',
  });
  check('first approve ok', first.ok && first.status === 'executed', first.reply);
  const second = await decideApproval({
    id: approval.id,
    decision: 'approved',
    decidedBy: 'dashboard',
  });
  check('second approve refused', !second.ok || second.status === 'blocked', second.reply);

  console.log('\n3. Voice still cannot approve a fresh card');
  const row2 = createContent({
    accountId: account.id,
    platform: 'linkedin',
    kind: 'post',
    templateId: null,
    body: 'Second draft for voice ban check with a concrete number: 12.',
    state: 'drafted',
    violations: [],
    meta: { via: 'va_ask' },
  });
  const a2 = ensureContentApproval(row2.id);
  const voice = await decideApproval({ id: a2.id, decision: 'approved', decidedBy: 'voice' });
  check('voice blocked', !voice.ok && /Voice cannot approve/i.test(voice.reply), voice.reply);

  console.log(failed ? `\nFAIL: ${failed} checks` : '\nPASS: launch smoke');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
