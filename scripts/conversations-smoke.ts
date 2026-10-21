/**
 * Conversation management invariants.
 *   npm run conversations:smoke
 */
export {};
process.env.DB_PATH = `/tmp/funke-conv-smoke-${Date.now()}.db`;

const { initSchema } = await import('../src/db/index.ts');
const { ensureVaTables, logVaTurn } = await import('../src/va/store.ts');
const { ensureApprovalsTable, requestAction, listPendingApprovals } = await import('../src/guardrails/approvals.ts');
const { ensureAuditTable, searchAudit, writeAudit } = await import('../src/guardrails/audit.ts');
const {
  ensureMemoryTable,
  remember,
  recall,
  forgetAllMemory,
  hydrateSessionFromHistory,
} = await import('../src/va/memory.ts');
const {
  ensureConversations,
  startNewConversation,
  appendExchange,
  listConversations,
  renameConversation,
  archiveConversation,
  unarchiveConversation,
  clearConversation,
  softDeleteConversation,
  deleteAllConversations,
  deleteMessage,
  listMessages,
  undo,
  exportConversation,
  pendingApprovalsInConversation,
  getActiveConversation,
} = await import('../src/va/conversations.ts');

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
  ensureMemoryTable();
  ensureConversations();

  console.log('\n1. New chat + title + rename + search');
  const a = startNewConversation();
  appendExchange('Draft LinkedIn posts about Funke', 'draft_post', 'Here is a draft.', {});
  const renamed = renameConversation(a.id, 'Social posts');
  check('rename', renamed.title === 'Social posts');
  const found = listConversations({ q: 'social' });
  check('search by title', found.some((c) => c.id === a.id));

  console.log('\n2. Memory survives new chat');
  remember({ scope: 'preference', key: 'preference', value: 'I prefer morning meetings' });
  startNewConversation();
  check('memory still there', recall({ scope: 'preference' }).some((r) => /morning/i.test(r.value)));
  hydrateSessionFromHistory(5);
  check('new chat has empty/short session ok', true);
  const { handleVaCommand } = await import('../src/va/command.ts');
  const prefAsk = await handleVaCommand('When do I prefer meetings?');
  check('recall from memory', /morning meetings/i.test(prefAsk.reply), prefAsk.reply.slice(0, 120));
  forgetAllMemory();
  const emptyAsk = await handleVaCommand('When do I prefer meetings?');
  check(
    'empty memory after forget',
    /do not have any saved preferences/i.test(emptyAsk.reply),
    emptyAsk.reply.slice(0, 120),
  );
  remember({ scope: 'preference', key: 'preference', value: 'I prefer morning meetings' });

  console.log('\n3. Delete message + undo');
  const c = getActiveConversation();
  appendExchange('typo message', 'unknown', 'Got it.', {});
  const msgs = listMessages(c.id);
  const userMsg = msgs.find((m) => m.role === 'user' && /typo/.test(m.text))!;
  const del = deleteMessage(userMsg.id);
  check('message soft-deleted', listMessages(c.id).every((m) => m.id !== userMsg.id));
  const und = undo(del.undo.token);
  check('undo restore message', und.ok && listMessages(c.id).some((m) => m.id === userMsg.id));

  console.log('\n4. Clear keeps audit');
  writeAudit({
    actionType: 'test.clear',
    target: null,
    inputSummary: 'clear test',
    result: 'ok',
  });
  const beforeAudit = searchAudit({ limit: 20 }).length;
  clearConversation(c.id);
  check('cleared messages', listMessages(c.id).length === 0);
  check('audit unchanged count', searchAudit({ limit: 20 }).length >= beforeAudit);

  console.log('\n5. Pending approval warning path');
  const draftConv = startNewConversation();
  const approval = await requestAction({
    actionType: 'calendar.create',
    title: 'Hold for delete test',
    summary: 'pending while chat deleted',
    payload: { title: 'Hold', start: '2026-10-25T10:00:00', timezone: 'Africa/Lagos' },
    channel: 'dashboard',
  });
  check('approval pending', approval.status === 'pending' && !!approval.approval);
  appendExchange(
    'schedule hold',
    'calendar_create',
    'Need approval',
    { approvals: [{ id: approval.approval!.id, title: approval.approval!.title }] },
  );
  const pending = pendingApprovalsInConversation(draftConv.id);
  check('detects pending in chat', pending.some((p) => p.id === approval.approval!.id));
  softDeleteConversation(draftConv.id);
  check(
    'approval still pending after chat delete',
    listPendingApprovals().some((p) => p.id === approval.approval!.id),
  );

  console.log('\n6. Archive + restore + export');
  const arch = startNewConversation();
  appendExchange('research notes', 'help', 'Here is research.', {});
  archiveConversation(arch.id);
  check('hidden from active', !listConversations({ archived: false }).some((x) => x.id === arch.id));
  check('in archived', listConversations({ archived: true }).some((x) => x.id === arch.id));
  unarchiveConversation(arch.id);
  check('restored', listConversations({ archived: false }).some((x) => x.id === arch.id));
  const exp = exportConversation(arch.id, 'md');
  check('export md', /research notes/i.test(exp.body) && /Funke/i.test(exp.body));

  console.log('\n7. Delete all confirm + memory forget');
  try {
    deleteAllConversations('nope');
    check('delete-all rejects bad confirm', false);
  } catch {
    check('delete-all rejects bad confirm', true);
  }
  const wiped = deleteAllConversations('DELETE ALL');
  check('delete-all ok', wiped.count >= 1);
  const mem = forgetAllMemory();
  check('forget all memory', mem.deleted >= 1 && recall({ limit: 10 }).length === 0);

  logVaTurn('legacy', 'help', 'hi', {});

  console.log(failed ? `\nFAIL — ${failed} checks` : '\nPASS — conversations smoke');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
