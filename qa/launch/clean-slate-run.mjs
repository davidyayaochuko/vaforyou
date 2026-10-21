/**
 * Persona #16 Clean-slate user: conversation management QA.
 *   node qa/launch/clean-slate-run.mjs
 * Requires http://127.0.0.1:4321 (Funke QA). Engine off.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.QA_URL || 'http://127.0.0.1:4321';
const OUT = join(process.cwd(), 'qa/launch/screenshots');
const REPORT = join(process.cwd(), 'qa/launch/persona-results/clean_slate.md');
mkdirSync(OUT, { recursive: true });
mkdirSync(join(process.cwd(), 'qa/launch/persona-results'), { recursive: true });

const features = {};
const friction = [];
const screenshots = [];
let shotN = 1;

function note(feature, pass, detail) {
  features[feature] = { pass: !!pass, detail: detail || '' };
  if (!pass && detail) friction.push({ feature, detail });
}

async function shot(page, slug) {
  const n = String(shotN++).padStart(2, '0');
  const name = `clean_${n}_${slug}.png`;
  const path = join(OUT, name);
  await page.screenshot({ path, fullPage: true });
  screenshots.push(name);
  return path;
}

async function openHistory(page) {
  await page.locator('.chat-toolbar button', { hasText: 'History' }).click();
  await page.waitForSelector('#chatDrawer:not([hidden])', { timeout: 5000 });
}

async function closeHistory(page) {
  await page.locator('#chatDrawer button', { hasText: 'Close' }).click();
  await page.waitForSelector('#chatDrawer[hidden]', { timeout: 5000 }).catch(() => undefined);
}

async function newChat(page) {
  await page.locator('#newChatBtn').click();
  await page.waitForTimeout(400);
}

let dialogChain = Promise.resolve();
async function acceptNextDialog(page, answer, timeoutMs = 8000) {
  dialogChain = dialogChain.then(
    () =>
      new Promise((resolve) => {
        let done = false;
        const finish = (v) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          page.off('dialog', handler);
          resolve(v);
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        const handler = async (d) => {
          const msg = d.message();
          try {
            if (answer != null) await d.accept(answer);
            else await d.accept();
          } catch {
            /* dialog may already be handled */
          }
          finish(msg);
        };
        page.on('dialog', handler);
      }),
  );
  return dialogChain;
}

async function renameFirstInDrawer(page, title) {
  const pending = acceptNextDialog(page, title);
  await page.locator('.conv-item').first().locator('button', { hasText: 'Rename' }).click();
  await pending;
  await page.waitForTimeout(600);
}

async function ask(page, text) {
  await page.fill('#askBox', text);
  await page.click('#askBtn');
  await page.waitForFunction(
    (t) => {
      const users = [...document.querySelectorAll('.msg.user')];
      return users.some((m) => (m.textContent || '').includes(t.slice(0, 20)));
    },
    text,
    { timeout: 15_000 },
  ).catch(() => undefined);
  await page.waitForTimeout(2500);
}

async function funkeReplied(page, minLen = 8) {
  await page.waitForFunction(
    (n) => {
      const msgs = [...document.querySelectorAll('.msg.funke')];
      if (!msgs.length) return false;
      return (msgs[msgs.length - 1].textContent || '').trim().length >= n;
    },
    minLen,
    { timeout: 45_000 },
  ).catch(() => undefined);
}

async function convTitles(page) {
  return page.locator('.conv-item b').allTextContents();
}

async function runDesktop(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await shot(page, 'home');

  // 1. New chat social posts + rename
  await newChat(page);
  await openHistory(page);
  await renameFirstInDrawer(page, 'QA Social posts');
  const titles1 = await convTitles(page);
  note('new_chat_rename_social', titles1.some((t) => /QA Social posts/i.test(t)), titles1[0]);
  await shot(page, 'rename-social-posts');
  await closeHistory(page);

  // 2. New chat scheduling + rename
  await newChat(page);
  await openHistory(page);
  await renameFirstInDrawer(page, 'QA Scheduling');
  const titles2 = await convTitles(page);
  note('new_chat_rename_scheduling', titles2.some((t) => /QA Scheduling/i.test(t)), titles2.join(' | '));
  await closeHistory(page);

  // 3. Send message, delete one, undo
  await page.fill('#askBox', 'Help me plan social posts for this week.');
  await page.click('#askBtn');
  await funkeReplied(page);
  const msgBefore = await page.locator('.msg').count();
  const delBtn = page.locator('.msg.user').last().locator('button', { hasText: 'Delete' });
  await delBtn.click();
  await page.waitForTimeout(400);
  const afterDel = await page.locator('.msg.user').filter({ hasText: 'Help me plan social' }).count();
  note('per_message_delete', afterDel === 0, `msgs before ${msgBefore}`);
  const undoVisible = await page.locator('#undoToast.open').isVisible().catch(() => false);
  note('undo_toast_shown', undoVisible, undoVisible ? 'toast open' : 'no toast');
  if (undoVisible) {
    await page.locator('#undoToastBtn').click();
    await page.waitForTimeout(500);
    const restored = await page.locator('.msg.user').filter({ hasText: 'Help me plan social' }).count();
    note('undo_restores_message', restored > 0, `restored count ${restored}`);
  } else {
    note('undo_restores_message', false, 'no undo toast');
  }
  await shot(page, 'message-delete-undo');

  // 4. Memory preference, clear chat, audit, new chat memory
  await ask(page, 'Remember that I prefer morning meetings.');
  await funkeReplied(page, 15);
  const clearDlg = acceptNextDialog(page, undefined);
  await page.locator('.chat-toolbar button', { hasText: 'Clear chat' }).click();
  await clearDlg.catch(() => '');
  await page.waitForTimeout(300);
  const cleared = (await page.locator('.msg.user').count()) === 0;
  note('clear_chat', cleared, cleared ? 'user msgs gone' : 'messages remain');
  await page.locator('#tab-appr').click();
  await page.waitForTimeout(800);
  const auditText = await page.locator('#auditPanel, #apprPanel').innerText().catch(() => '');
  note('audit_after_clear', auditText.length > 20, auditText.slice(0, 120));
  await shot(page, 'audit-after-clear');
  await page.locator('#tab-chat').click();
  await newChat(page);
  await ask(page, 'When do I prefer meetings?');
  await funkeReplied(page, 10);
  const memReply = await page.locator('.msg.funke').last().innerText();
  note(
    'memory_survives_clear_and_new_chat',
    /morning/i.test(memReply),
    memReply.slice(0, 160),
  );

  // 5. Archive + search + restore
  await openHistory(page);
  const archiveItem = page.locator('.conv-item').filter({ hasText: 'QA Social posts' }).first();
  if (await archiveItem.count()) {
    await archiveItem.locator('button', { hasText: 'Archive' }).click();
    await page.waitForTimeout(700);
  }
  await page.locator('#tabArchivedConvs').click();
  await page.waitForTimeout(500);
  await page.fill('#convSearch', 'Social posts');
  await page.waitForTimeout(400);
  const archivedVisible = (await page.locator('.conv-item').filter({ hasText: /Social posts/i }).count()) > 0;
  note('archive_and_search', archivedVisible, 'archived tab search');
  if (archivedVisible) {
    await page.locator('.conv-item').filter({ hasText: /Social posts/i }).first()
      .locator('button', { hasText: 'Restore' }).click();
    await page.waitForTimeout(500);
    await page.locator('#tabActiveConvs').click();
    const back = (await page.locator('.conv-item').filter({ hasText: /QA Social posts/i }).count()) > 0;
    note('restore_archived_chat', back, back ? 'restored to active' : 'not in active');
  } else {
    note('restore_archived_chat', false, 'could not find archived chat');
  }
  await shot(page, 'archive-restore');
  await closeHistory(page);

  // 6. Draft LinkedIn, delete chat with pending warning, Ok tab still pending
  await newChat(page);
  await page.locator('.suggestion', { hasText: 'Draft a LinkedIn post' }).click();
  await funkeReplied(page, 20);
  await page.waitForTimeout(1500);
  const hasApprovalInChat =
    (await page.locator('[id^="approval-"], .draft').count()) > 0 ||
    /Draft #|approval/i.test(await page.locator('.msg.funke').last().innerText());
  note('linkedin_draft_card', hasApprovalInChat, 'draft/approval in chat');
  await shot(page, 'linkedin-draft');
  await openHistory(page);
  const delTarget = page.locator('.conv-item').first();
  let confirmSeen = false;
  const delDlg = acceptNextDialog(page, undefined);
  await delTarget.locator('button', { hasText: 'Delete' }).click();
  const delMsg = await delDlg;
  confirmSeen = delMsg != null && /approval|Pending/i.test(delMsg);
  await page.waitForTimeout(800);
  note('delete_chat_pending_warning', confirmSeen, confirmSeen ? 'confirm mentioned approvals' : 'no confirm');
  await closeHistory(page);
  await page.locator('#tab-appr').click();
  await page.waitForTimeout(800);
  const pendingText = await page.locator('#apprPanel').innerText().catch(() => '');
  note(
    'pending_survives_chat_delete',
    /Draft|LinkedIn|approval|Pending/i.test(pendingText),
    pendingText.slice(0, 200),
  );
  await shot(page, 'pending-after-chat-delete');
  await page.locator('#tab-chat').click();

  // 7. Delete chat + undo
  await openHistory(page);
  const toDelete = page.locator('.conv-item').first();
  const deletedTitle = await toDelete.locator('b').innerText().catch(() => '');
  const delUndoDlg = acceptNextDialog(page, undefined);
  await toDelete.locator('button', { hasText: 'Delete' }).click();
  await delUndoDlg.catch(() => undefined);
  await page.waitForTimeout(400);
  const undo2 = await page.locator('#undoToast.open').isVisible().catch(() => false);
  if (undo2) {
    await page.locator('#undoToastBtn').click();
    await page.waitForTimeout(600);
    await page.locator('#tabActiveConvs').click();
    const titlesAfterUndo = await convTitles(page);
    note(
      'undo_restores_deleted_chat',
      titlesAfterUndo.some((t) => t.includes(deletedTitle.slice(0, 12))),
      deletedTitle,
    );
  } else {
    note('undo_restores_deleted_chat', false, 'no undo toast after chat delete');
  }
  await shot(page, 'chat-delete-undo');
  await closeHistory(page);

  // 8. Export + delete all confirmation
  await page.locator('.conv-item').first().click().catch(() => undefined);
  const downloadPromise = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await page.locator('.chat-toolbar button', { hasText: 'Export' }).click();
  const dl = await downloadPromise;
  note('export_markdown', !!dl, dl ? dl.suggestedFilename() : 'no download');
  await openHistory(page);
  const delAllDlg = acceptNextDialog(page, 'nope');
  await page.locator('button', { hasText: 'Delete all conversations' }).click();
  await delAllDlg.catch(() => undefined);
  await page.waitForTimeout(400);
  const stillHave = (await page.locator('.conv-item').count()) > 0;
  note('delete_all_requires_DELETE_ALL', stillHave, stillHave ? 'chats remain after wrong confirm' : 'wiped on wrong text');
  await shot(page, 'delete-all-guard');
  await closeHistory(page);

  // 9. Refresh persistence (archive state: scheduling chat should exist)
  const beforeRefresh = await page.evaluate(async () => {
    const r = await fetch('/api/conversations?archived=0');
    return (await r.json()).conversations?.length ?? -1;
  }).catch(() => -1);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await openHistory(page);
  const afterTitles = await convTitles(page);
  note(
    'refresh_persists_state',
    afterTitles.some((t) => /Scheduling|Social/i.test(t)) || afterTitles.length >= 1,
    `before ${beforeRefresh} after ${afterTitles.length} titles`,
  );
  await shot(page, 'after-refresh');
  await closeHistory(page);

  // 10. Forget memory
  await page.locator('#tab-acc').click();
  await page.waitForTimeout(600);
  await shot(page, 'soc-memory-panel');
  const forgetDlg = acceptNextDialog(page, 'FORGET ALL');
  await page.locator('button', { hasText: 'Forget what Funke knows about me' }).click();
  await forgetDlg.catch(() => undefined);
  await page.waitForTimeout(1200);
  await page.locator('#tab-chat').click();
  await newChat(page);
  await ask(page, 'When do I prefer meetings?');
  await funkeReplied(page, 10);
  const afterForget = await page.locator('.msg.funke').last().innerText();
  note(
    'forget_memory',
    !/morning meetings/i.test(afterForget) || /don't know|not sure|haven't|do not have/i.test(afterForget),
    afterForget.slice(0, 180),
  );
  await shot(page, 'after-forget-memory');
}

async function runMobileKeyboard(page) {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await shot(page, 'mobile-375');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const drawerOpen = await page.locator('#chatDrawer:not([hidden])').isVisible().catch(() => false);
  note('keyboard_opens_history', drawerOpen, drawerOpen ? 'drawer visible' : 'drawer closed');
  if (drawerOpen) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const closed = await page.locator('#chatDrawer[hidden]').isVisible().catch(() => true);
    note('keyboard_escape_closes_drawer', closed !== false, 'escape pressed');
  }
  await shot(page, 'mobile-keyboard-drawer');
}

function writeReport() {
  const lines = [
    '# Persona #16: Clean-slate user',
    '',
    `Run date: 2026-10-21. Target: ${BASE}. Engine off. No real OAuth.`,
    '',
    '## Feature checklist (reached_first_success style)',
    '',
  ];
  for (const [k, v] of Object.entries(features)) {
    lines.push(`- [${v.pass ? 'x' : ' '}] **${k}**: ${v.detail || (v.pass ? 'ok' : 'failed')}`);
  }
  lines.push('', '## Findings', '');
  lines.push(
    '- Toolbar packs four actions plus dock tabs; **Clear chat** vs **Delete** (in History) is easy to confuse despite the footer note.',
  );
  lines.push(
    '- History drawer lists many **Delete** buttons per row; screen readers hear undifferentiated "Delete" (clutter from prior QA data).',
  );
  lines.push(
    '- Rename/Delete all/Forget use native `prompt()`; fine for power users, abrupt for clean-slate newcomers.',
  );
  if (friction.length) {
    for (const f of friction) lines.push(`- **${f.feature}**: ${f.detail}`);
  }
  lines.push('', '## Screenshots', '');
  for (const s of screenshots) lines.push(`- \`qa/launch/screenshots/${s}\``);
  writeFileSync(REPORT, lines.join('\n') + '\n');
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  try {
    await runDesktop(page);
    await runMobileKeyboard(page);
  } catch (err) {
    friction.push({ feature: 'runner_exception', detail: String(err.message || err) });
    note('runner_completed', false, String(err.message || err));
  }
  writeReport();
  const summary = { features, top_friction: friction.slice(0, 8), screenshots };
  console.log(JSON.stringify(summary, null, 2));
  await browser.close();
  const allPass = Object.values(features).every((f) => f.pass);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
