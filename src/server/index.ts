import { initSchema } from '../db/index.ts';
import { startServer } from './http.ts';
import { engine } from '../engine/scheduler.ts';
import { closeAllSessions } from '../browser/session.ts';
import { ensureVaTables } from '../va/store.ts';
import { startReminderLoop, stopReminderLoop } from '../va/reminders.ts';
import { ensureApprovalsTable, expireStaleApprovals } from '../guardrails/approvals.ts';
import { ensureAuditTable } from '../guardrails/audit.ts';
import { ensureMemoryTable, hydrateSessionFromHistory } from '../va/memory.ts';
import { ensureConversations } from '../va/conversations.ts';
import { ensureKbTable, loadKnowledgeFiles } from '../va/knowledge.ts';
import { ensureAlertsTable } from '../va/alerts.ts';
import { ensureVocabTable } from '../voice/vocab.ts';

initSchema();
ensureVaTables();
ensureApprovalsTable();
ensureAuditTable();
ensureMemoryTable();
ensureConversations();
ensureVocabTable();
ensureKbTable();
ensureAlertsTable();
loadKnowledgeFiles();
hydrateSessionFromHistory(10);
expireStaleApprovals();
startServer();
startReminderLoop();

// The social engine does not auto-start. You press the button (or POST /api/engine/start).
// Reminder email loop starts with the server so Ask-box reminders still fire.
console.log('Social engine is stopped. Start it from Settings in the UI when you are ready.');
console.log('Reminder loop is running.');

let shuttingDown = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    console.log(`\n${sig}: finishing the current action, then closing the browser…`);
    stopReminderLoop();
    await engine.stop();
    await closeAllSessions();
    process.exit(0);
  });
}
