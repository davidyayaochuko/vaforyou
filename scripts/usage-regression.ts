/**
 * Regressions from real-world usage QA (communication styles + day-in-life).
 * No network required for boundary/workspace/parser checks; ask path uses isolated DB.
 *
 *   npm run usage:regression
 */
import './test-db.ts';
import { initSchema, upsertAccount, setAccountStatus } from '../src/db/index.ts';
import { ensureVaTables } from '../src/va/store.ts';
import { checkHardBoundary, isHardBlocked } from '../src/guardrails/boundaries.ts';
import { isWorkspaceAsk } from '../src/va/workspace.ts';
import { handleVaCommand } from '../src/va/command.ts';
import { loadKnowledgeFiles, groundedReply } from '../src/va/knowledge.ts';

let failed = 0;
function check(name: string, pass: boolean, detail?: unknown): void {
  if (!pass) failed++;
  console.log(`  ${pass ? 'ok' : 'FAIL'}  ${name}${!pass && detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 180)}` : ''}`);
}

async function main(): Promise<void> {
  initSchema();
  ensureVaTables();
  const li = upsertAccount('personal-linkedin', '/tmp/funke-reg-li', undefined, 'linkedin');
  setAccountStatus(li.id, 'ok', 'reg-li');
  const co = upsertAccount('company-page', '/tmp/funke-reg-co', undefined, 'linkedin');
  setAccountStatus(co.id, 'ok', 'reg-co');
  loadKnowledgeFiles();

  console.log('\n1. Hard boundaries (false positives)');
  check('post hiring allowed', !isHardBlocked(checkHardBoundary("post: we're hiring")));
  check('hire candidate blocked', isHardBlocked(checkHardBoundary('hire this candidate today')));
  check('chase payment remind allowed', !isHardBlocked(checkHardBoundary('Remind me tomorrow at 9am to chase Chioma for payment')));
  check('wire transfer blocked', isHardBlocked(checkHardBoundary('wire transfer 50000 to the vendor')));

  console.log('\n2. Workspace trap');
  check('update contact is local', !isWorkspaceAsk('Update contact for Bola Ventures: Adaeze is CFO'));
  check('Remember for contact local', !isWorkspaceAsk('Remember for Bola Ventures: prefers WhatsApp'));
  check('draft follow-up email local', !isWorkspaceAsk('Draft a follow-up email to Bola about the proposal'));
  check('check gmail is workspace', isWorkspaceAsk('Check my Gmail inbox for unread'));

  console.log('\n3. Deterministic parsers via handleVaCommand');
  const plate = await handleVaCommand('plate');
  check('bare plate is status', plate.intent === 'status' && plate.ok, plate);

  const fri = await handleVaCommand('Remind me Friday at 2pm to prep for Tolu');
  check('weekday remind parses', fri.ok && fri.intent === 'remind', fri.reply);

  const multi = await handleVaCommand(
    'Remind me Saturday at 10am to call Mama, also what is on my plate, and draft a LinkedIn post about shipping',
  );
  check(
    'multi-ask does not only plate',
    multi.ok && /heard \d+ asks/i.test(multi.reply) && /Reminders:|I'll remind|Reminder:/i.test(multi.reply),
    multi.reply.slice(0, 240),
  );

  const help = await handleVaCommand('Help');
  check('help offers walkthrough', /walk you through/i.test(help.reply), help.reply.slice(0, 200));
  check('help does not invent Reminders menu', !/left.?menu.*Reminders|\+ New reminder/i.test(help.reply));

  const mem = await handleVaCommand('Remember for Bola Ventures: Adaeze is the CFO');
  check('multi-word Remember contact', mem.ok && /Bola Ventures/i.test(mem.reply), mem.reply);

  const draftClarify = await handleVaCommand('Draft a LinkedIn post about shipping cadence');
  check(
    'multi linkedin names the default account and how to switch',
    /Using \S+ \(say another LinkedIn account/i.test(draftClarify.reply),
    draftClarify.reply,
  );

  console.log('\n4. Knowledge grounding');
  const price = groundedReply('What is the Starter pricing and Lagos delivery time?');
  check('pricing hits KB', price.handled && /45.?000|45000/i.test(price.reply), price.reply.slice(0, 200));

  console.log('\n5. Pending remind retention + research + context');
  const { setPending, clearPending } = await import('../src/va/session.ts');
  clearPending();
  setPending({
    intent: 'remind',
    partial: { title: 'call Tunde', when: '', timezone: 'Africa/Lagos', body: null },
    askedAt: Date.now(),
  });
  const timeFollow = await handleVaCommand('Friday 3pm, you already asked, just confirming');
  check(
    'pending remind keeps title on time follow-up',
    timeFollow.ok && timeFollow.intent === 'remind' && /call Tunde/i.test(timeFollow.reply),
    timeFollow.reply,
  );

  await handleVaCommand('Remember that RivalCo raised $2M (UNVERIFIED)');
  const research = await handleVaCommand('Research RivalCo funding for me');
  check(
    'research stays fail-closed to memory',
    research.ok && /UNVERIFIED|on file|will not invent/i.test(research.reply) && !/crunchbase/i.test(research.reply),
    research.reply.slice(0, 240),
  );

  const ctx = await handleVaCommand('switch to boss context');
  check('context switch works', ctx.ok && /Boss/i.test(ctx.reply), ctx.reply);

  const { loadReplyStyle, saveReplyStyle } = await import('../src/va/reply-style.ts');
  saveReplyStyle('detailed');
  check('reply style persists', loadReplyStyle() === 'detailed');
  saveReplyStyle('brief');

  console.log(failed ? `\nFAIL — ${failed} checks` : '\nPASS — usage regression');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
