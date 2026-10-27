import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join as joinPath, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.ts';
import { engine } from '../engine/scheduler.ts';
import { loadWorkflow, validateWorkflow, WorkflowSchema } from '../engine/workflow.ts';
import { describeActions } from '../actions/index.ts';
import {
  campaignFunnel,
  getCampaign,
  listAccounts,
  listCampaigns,
  listSteps,
  listSuppressed,
  recentLog,
  setCampaignStatus,
  suppress,
  upsertLead,
  enrollLead,
  getAccountByName,
} from '../db/index.ts';
import {
  loadLimits,
  loadPacing,
  loadWorkingHours,
  quotaSnapshot,
  saveLimits,
  savePacing,
  saveWorkingHours,
  setGloballyPaused,
  isGloballyPaused,
} from '../engine/limits.ts';
import { importCsv } from '../sources/csv.ts';
import { harvestSearch } from '../sources/search.ts';
import { openSession } from '../browser/session.ts';
import { normalizeProfileUrl, publicIdOf } from '../util/url.ts';
import { describePlatforms, isPlatformId } from '../platforms/index.ts';
import { loadTemplates } from '../content/templates.ts';
import { gate } from '../content/gate.ts';
import { prepareContentBody } from '../content/prepare.ts';
import { features, outreachBlockedMessage, engageBlockedMessage } from '../config/features.ts';
import { generate, loadInstructions } from '../content/generate.ts';
import { buildAiClient } from '../ai/client.ts';
import {
  createContent, getContent, listContent, setContentState, recentPublishedBodies,
  contentProvenance, markFounderApproved, reviseContent,
  contentStageCounts, markContentPrepared,
  templateUsage, listJobs, createJob, setJobState, deleteJob, recentFeedActions,
} from '../db/content.ts';
import {
  listPendingApprovals,
  approvalToCard,
  expireStaleApprovals,
  ensureContentApproval,
  decideApproval,
} from '../guardrails/approvals.ts';
import { searchAudit } from '../guardrails/audit.ts';
import { loadAutonomy, saveAutonomy } from '../guardrails/autonomy.ts';

type Handler = (
  body: Record<string, unknown>,
  query: URLSearchParams,
) => Promise<unknown> | unknown;

const routes = new Map<string, Handler>();
const get = (path: string, h: Handler) => routes.set(`GET ${path}`, h);
const post = (path: string, h: Handler) => routes.set(`POST ${path}`, h);

/* ------------------------------------------------------------------ routes */

get('/api/health', () => ({
  ok: true,
  engine: engine.status(),
  // Ask the client what it is. Guessing from a key name reported 'mock' while
  // Groq was really generating.
  ai: buildAiClient().kind,
}));

get('/api/actions', () => describeActions());

get('/api/accounts', () => listAccounts());

get('/api/campaigns', () =>
  listCampaigns().map((c) => ({
    ...c,
    steps: listSteps(c.id).map((s) => ({ position: s.position, action: s.action })),
    funnel: campaignFunnel(c.id),
  })),
);

get('/api/campaign', (_b, q) => {
  const id = Number(q.get('id'));
  const campaign = getCampaign(id);
  if (!campaign) throw new HttpError(404, 'no such campaign');
  return { campaign, steps: listSteps(id), funnel: campaignFunnel(id) };
});

post('/api/campaign/validate', (body) => {
  const doc = WorkflowSchema.parse(body.workflow ?? body);
  return { issues: validateWorkflow(doc) };
});

post('/api/campaign/load', (body) => loadWorkflow(body.workflow ?? body));

post('/api/campaign/status', (body) => {
  const id = Number(body.id);
  const status = String(body.status) as 'running' | 'paused' | 'draft' | 'done';
  if (!getCampaign(id)) throw new HttpError(404, 'no such campaign');
  if (!['running', 'paused', 'draft', 'done'].includes(status)) {
    throw new HttpError(400, 'status must be running | paused | draft | done');
  }
  if (status === 'running' && !features.outreachEnabled) {
    throw new HttpError(403, outreachBlockedMessage());
  }
  setCampaignStatus(id, status);
  return { id, status };
});

post('/api/leads/add', (body) => {
  const campaignId = body.campaignId ? Number(body.campaignId) : undefined;
  const urls = Array.isArray(body.urls) ? (body.urls as string[]) : [];
  let added = 0;
  let enrolled = 0;
  const rejected: string[] = [];
  for (const raw of urls) {
    const url = normalizeProfileUrl(raw);
    if (!url) {
      rejected.push(raw);
      continue;
    }
    const lead = upsertLead({
      profile_url: url,
      public_id: publicIdOf(url) ?? undefined,
      source: String(body.source ?? 'manual'),
    });
    added++;
    if (campaignId && enrollLead(campaignId, lead.id)) enrolled++;
  }
  return { added, enrolled, rejected };
});

post('/api/leads/import-csv', (body) =>
  importCsv(String(body.path), {
    campaignId: body.campaignId ? Number(body.campaignId) : undefined,
    source: body.source ? String(body.source) : undefined,
  }),
);

post('/api/leads/harvest', async (body) => {
  const accountName = String(body.account);
  const account = getAccountByName(accountName);
  if (!account) throw new HttpError(404, `no account named "${accountName}"`);
  const session = await openSession(account);
  return harvestSearch(session.page, {
    url: String(body.url),
    maxPages: body.maxPages ? Number(body.maxPages) : undefined,
    maxLeads: body.maxLeads ? Number(body.maxLeads) : undefined,
    campaignId: body.campaignId ? Number(body.campaignId) : undefined,
    source: body.source ? String(body.source) : 'search',
    onLog: (l) => engine.log(l),
  });
});

get('/api/log', (_b, q) => recentLog(Number(q.get('limit') ?? 100)));
get('/api/engine/tail', (_b, q) => engine.tail(Number(q.get('n') ?? 80)));

post('/api/engine/start', () => {
  engine.start();
  return engine.status();
});
post('/api/engine/stop', async () => {
  await engine.stop();
  return engine.status();
});
post('/api/engine/pause', (body) => {
  setGloballyPaused(body.paused !== false);
  return { paused: isGloballyPaused() };
});

get('/api/limits', (_b, q) => {
  const accounts = listAccounts();
  const wanted = q.get('account');
  const selected = wanted ? accounts.filter((a) => a.name === wanted) : accounts;
  return {
    limits: loadLimits(),
    workingHours: loadWorkingHours(),
    pacing: loadPacing(),
    // One budget block per connected account, since caps differ by platform.
    usage: selected.map((a) => ({
      account: a.name,
      platform: a.platform,
      status: a.status,
      quota: quotaSnapshot(a.id, a.platform),
    })),
  };
});

post('/api/limits', (body) => {
  if (body.limits) saveLimits(body.limits as never);
  if (body.workingHours) saveWorkingHours(body.workingHours as never);
  if (body.pacing) savePacing(body.pacing as never);
  return { limits: loadLimits(), workingHours: loadWorkingHours(), pacing: loadPacing() };
});

/* ── multi-platform: templates, content, jobs ───────────────────────────── */

get('/api/platforms', () => describePlatforms());

get('/api/templates', (_b, q) => {
  const platform = q.get('platform');
  const all = [...loadTemplates(true).values()];
  return platform ? all.filter((t) => t.platform === platform) : all;
});

get('/api/instructions', (_b, q) => {
  const platform = q.get('platform') ?? 'linkedin';
  if (!isPlatformId(platform)) throw new HttpError(400, `unknown platform "${platform}"`);
  return { platform, text: loadInstructions(platform) };
});

/** Gate an arbitrary body without generating or publishing anything. */
post('/api/content/check', (body) => {
  const platform = String(body.platform ?? '');
  if (!isPlatformId(platform)) throw new HttpError(400, `unknown platform "${platform}"`);
  return gate({
    platform,
    kind: (String(body.kind ?? 'post') as 'post' | 'dm' | 'comment' | 'reply'),
    body: String(body.body ?? ''),
    templateId: body.templateId ? String(body.templateId) : null,
  });
});

/** Generate + gate a draft. Saves it as `drafted`; does NOT queue or publish. */
post('/api/content/draft', async (body) => {
  const platform = String(body.platform ?? '');
  if (!isPlatformId(platform)) throw new HttpError(400, `unknown platform "${platform}"`);
  const account = getAccountByName(String(body.account));
  if (!account) throw new HttpError(404, `no account "${String(body.account)}"`);

  const result = await generate({
    ai: buildAiClient(),
    platform,
    kind: (String(body.kind ?? 'post') as 'post' | 'dm' | 'comment' | 'reply'),
    brief: String(body.brief ?? ''),
    facts: body.facts ? String(body.facts) : undefined,
    templateId: body.templateId ? String(body.templateId) : undefined,
    usage: templateUsage(account.id),
    recentBodies: recentPublishedBodies(account.id),
    onLog: (l) => engine.log(l),
  });

  const row = createContent({
    accountId: account.id,
    platform,
    kind: String(body.kind ?? 'post'),
    templateId: result.templateId,
    targetRef: body.targetRef ? String(body.targetRef) : null,
    body: result.body,
    state: result.ok ? 'drafted' : 'blocked',
    violations: result.violations,
    meta: { brief: String(body.brief ?? '') },
  });
  return { content: row, gate: { pass: result.ok, violations: result.violations } };
});

get('/api/content', (_b, q) => listContent(Number(q.get('limit') ?? 60)));

get('/api/approvals', () => {
  expireStaleApprovals();
  return listPendingApprovals(60).map(approvalToCard);
});

post('/api/approvals/ensure-content', (body) => {
  const row = ensureContentApproval(Number(body.contentId ?? body.id));
  return approvalToCard(row);
});

post('/api/approvals/decide', async (body) => {
  const decidedBy = String(body.decidedBy ?? 'dashboard');
  if (decidedBy === 'voice' || decidedBy.startsWith('voice')) {
    throw new HttpError(403, 'Voice cannot approve actions. Use the on-screen Approve button.');
  }
  const outcome = await decideApproval({
    id: Number(body.id),
    decision: String(body.decision) === 'rejected' ? 'rejected' : 'approved',
    decidedBy,
    editedPreview: body.preview != null ? String(body.preview) : null,
    editedPayload: body.payload && typeof body.payload === 'object'
      ? (body.payload as Record<string, unknown>)
      : null,
  });
  return {
    ...outcome,
    approval: outcome.approval ? approvalToCard(outcome.approval) : null,
  };
});

get('/api/audit', (_b, q) =>
  searchAudit({
    q: q.get('q') ?? undefined,
    actionType: q.get('actionType') ?? undefined,
    limit: Number(q.get('limit') ?? 50),
  }),
);

get('/api/autonomy', () => loadAutonomy());
post('/api/autonomy', (body) => {
  const patch = (body.patch ?? body) as Record<string, 'auto' | 'approval_required' | 'blocked'>;
  return saveAutonomy(patch);
});

get('/api/reply-style', async () => {
  const { loadReplyStyle } = await import('../va/reply-style.ts');
  return { style: loadReplyStyle() };
});

post('/api/reply-style', async (body) => {
  const { saveReplyStyle, loadReplyStyle } = await import('../va/reply-style.ts');
  if (body.style != null) saveReplyStyle(String(body.style));
  return { style: loadReplyStyle() };
});

get('/api/context', async () => {
  const { activeContext, contextLabel, listKnownContexts } = await import('../va/contexts.ts');
  return {
    active: activeContext(),
    label: contextLabel(),
    known: listKnownContexts(),
  };
});

post('/api/context', async (body) => {
  const { setActiveContext, contextLabel, listKnownContexts, rememberContext } = await import('../va/contexts.ts');
  const id = setActiveContext(String(body.id ?? body.context ?? 'personal'));
  rememberContext(id);
  return { active: id, label: contextLabel(id), known: listKnownContexts() };
});

get('/api/onboarding', async () => {
  const { getSetting } = await import('../db/index.ts');
  return { done: Boolean(getSetting<boolean>('onboarding_done', false)) };
});

post('/api/onboarding', async (body) => {
  const { getSetting, setSetting } = await import('../db/index.ts');
  if (body.done === true || body.done === 'true') setSetting('onboarding_done', true);
  if (body.done === false || body.reset === true) setSetting('onboarding_done', false);
  return { done: Boolean(getSetting<boolean>('onboarding_done', false)) };
});

get('/api/chat/history', async (_b, q) => {
  const { chatHistoryForUi } = await import('../va/memory.ts');
  const { getActiveConversation } = await import('../va/conversations.ts');
  const conv = getActiveConversation();
  return {
    conversation: conv,
    messages: chatHistoryForUi(Number(q.get('limit') ?? 200)),
  };
});

get('/api/conversations', async (_b, q) => {
  const { listConversations, undoWindowMs } = await import('../va/conversations.ts');
  return {
    conversations: listConversations({
      archived: q.get('archived') === '1',
      q: q.get('q') ?? undefined,
      limit: Number(q.get('limit') ?? 80),
    }),
    undoWindowMs: undoWindowMs(),
  };
});

post('/api/conversations/new', async () => {
  const { startNewConversation } = await import('../va/conversations.ts');
  return startNewConversation();
});

post('/api/conversations/open', async (body) => {
  const { setActiveConversation } = await import('../va/conversations.ts');
  const id = Number(body.id);
  if (!Number.isFinite(id)) throw new HttpError(400, 'id required');
  return setActiveConversation(id);
});

post('/api/conversations/rename', async (body) => {
  const { renameConversation } = await import('../va/conversations.ts');
  const id = Number(body.id);
  if (!Number.isFinite(id)) throw new HttpError(400, 'id required');
  return renameConversation(id, String(body.title ?? ''));
});

post('/api/conversations/archive', async (body) => {
  const { archiveConversation } = await import('../va/conversations.ts');
  const id = Number(body.id);
  if (!Number.isFinite(id)) throw new HttpError(400, 'id required');
  return archiveConversation(id);
});

post('/api/conversations/unarchive', async (body) => {
  const { unarchiveConversation } = await import('../va/conversations.ts');
  const id = Number(body.id);
  if (!Number.isFinite(id)) throw new HttpError(400, 'id required');
  return unarchiveConversation(id);
});

post('/api/conversations/clear', async (body) => {
  const {
    clearConversation,
    getActiveConversation,
    pendingApprovalsInConversation,
  } = await import('../va/conversations.ts');
  const id = Number(body.id ?? getActiveConversation().id);
  if (!Number.isFinite(id)) throw new HttpError(400, 'id required');
  const pending = pendingApprovalsInConversation(id);
  if (pending.length && !body.confirmPending) {
    return {
      needsConfirm: true,
      pendingApprovals: pending,
      warning:
        `${pending.length} pending approval(s) stay in the Approvals tab. Clearing chat does not cancel them. Your activity log is kept separately for safety.`,
    };
  }
  return clearConversation(id);
});

post('/api/conversations/delete', async (body) => {
  const {
    softDeleteConversation,
    pendingApprovalsInConversation,
  } = await import('../va/conversations.ts');
  const { listPendingApprovals } = await import('../guardrails/approvals.ts');
  const id = Number(body.id);
  if (!Number.isFinite(id)) throw new HttpError(400, 'id required');
  const pending = pendingApprovalsInConversation(id);
  const allPending = listPendingApprovals(80);
  const otherPendingCount = allPending.filter((a) => !pending.some((p) => p.id === a.id)).length;
  if (pending.length && !body.confirmPending) {
    return {
      needsConfirm: true,
      pendingApprovals: pending,
      otherPendingCount,
      warning:
        `This chat references ${pending.length} pending approval(s). They will stay in Approvals (not cancelled or approved). Confirm to delete the chat only. Your activity log is kept separately for safety.`,
    };
  }
  const result = softDeleteConversation(id);
  return { ...result, otherPendingCount };
});

post('/api/conversations/delete-all', async (body) => {
  const { deleteAllConversations } = await import('../va/conversations.ts');
  return deleteAllConversations(String(body.confirm ?? ''));
});

post('/api/conversations/undo', async (body) => {
  const { undo } = await import('../va/conversations.ts');
  return undo(String(body.token ?? ''));
});

post('/api/conversations/export', async (body) => {
  const { exportConversation } = await import('../va/conversations.ts');
  const id = Number(body.id);
  if (!Number.isFinite(id)) throw new HttpError(400, 'id required');
  const format = body.format === 'json' ? 'json' : 'md';
  return exportConversation(id, format);
});

post('/api/messages/delete', async (body) => {
  const { deleteMessage } = await import('../va/conversations.ts');
  const id = Number(body.id);
  if (!Number.isFinite(id)) throw new HttpError(400, 'id required');
  return deleteMessage(id);
});

get('/api/memory', async (_b, q) => {
  const { recall } = await import('../va/memory.ts');
  return recall({
    scope: q.get('scope') ?? undefined,
    contact: q.get('contact') ?? undefined,
    limit: Number(q.get('limit') ?? 40),
  });
});

post('/api/memory', async (body) => {
  const { remember } = await import('../va/memory.ts');
  return remember({
    scope: (String(body.scope ?? 'fact') as 'preference' | 'contact' | 'task' | 'fact'),
    key: String(body.key ?? 'note'),
    value: String(body.value ?? ''),
    contact: body.contact != null ? String(body.contact) : null,
  });
});

post('/api/memory/forget', async (body) => {
  const { forget } = await import('../va/memory.ts');
  const id = Number(body.id);
  if (!Number.isFinite(id)) throw new HttpError(400, 'id required');
  return { ok: forget(id) };
});

post('/api/memory/forget-all', async (body) => {
  const { forgetAllMemory } = await import('../va/memory.ts');
  if (String(body.confirm ?? '') !== 'FORGET ALL') {
    throw new HttpError(
      400,
      'Type FORGET ALL to confirm. This deletes preferences and contacts Funke stored. Chat, audit log, and approvals stay.',
    );
  }
  return forgetAllMemory();
});

get('/api/kb', async (_b, q) => {
  const { listKb, loadKnowledgeFiles } = await import('../va/knowledge.ts');
  loadKnowledgeFiles();
  return listKb(q.get('kind') ?? undefined, Number(q.get('limit') ?? 100));
});

get('/api/va/summary', async (_b, q) => {
  const { buildDailySummary, lastDailySummary, maybeSendDailySummary } = await import('../va/summary.ts');
  if (q.get('send') === '1') {
    const sent = await maybeSendDailySummary(true);
    return sent ?? lastDailySummary();
  }
  return { current: buildDailySummary(), last: lastDailySummary() };
});

get('/api/alerts', async (_b, q) => {
  const { listOpenAlerts, scanForAlerts } = await import('../va/alerts.ts');
  if (q.get('scan') === '1') scanForAlerts();
  return listOpenAlerts(Number(q.get('limit') ?? 40));
});

post('/api/alerts/ack', async (body) => {
  const { ackAlert } = await import('../va/alerts.ts');
  const id = Number(body.id);
  if (!Number.isFinite(id)) throw new HttpError(400, 'id required');
  return { ok: ackAlert(id), id };
});

get('/api/voice/stt', async () => {
  const { sttStatus } = await import('../voice/stt.ts');
  return sttStatus();
});

get('/api/voice/tts', async () => {
  const { azureTtsStatus } = await import('../voice/azure-tts.ts');
  const { xaiTtsStatus } = await import('../voice/xai-tts.ts');
  const { env } = await import('../config/env.ts');
  const azure = azureTtsStatus();
  const xai = xaiTtsStatus();
  const pref = (env.ttsProvider || 'auto').toLowerCase();
  let provider: 'azure' | 'xai' | 'browser' = 'browser';
  if (pref === 'azure' && azure.configured) provider = 'azure';
  else if ((pref === 'xai' || pref === 'grok') && xai.configured) provider = 'xai';
  else if (pref === 'browser') provider = 'browser';
  else if (azure.configured) provider = 'azure';
  else if (xai.configured) provider = 'xai';
  else provider = 'browser';
  return {
    provider,
    azure,
    xai,
    browserDefaultLang: 'en-NG',
    note:
      provider === 'azure'
        ? azure.note
        : provider === 'xai'
          ? xai.note
          : 'Browser speechSynthesis. Prefer female en-NG (Ezinne) when available. Text stays on this machine for browser TTS.',
  };
});

/** Exact spoken string for TTS + on-screen caption (parity). */
post('/api/voice/prepare', async (body) => {
  const { spokenLine, splitSentences } = await import('../voice/tts.ts');
  const { pronunciationMap } = await import('../voice/vocab.ts');
  const line = spokenLine(String(body.text ?? ''), {
    hasApproval: Boolean(body.hasApproval),
    pronunciation: pronunciationMap(),
  });
  return { ...line, sentences: splitSentences(line.spoken) };
});

post('/api/voice/speak', async (body) => {
  const { spokenLine } = await import('../voice/tts.ts');
  const { pronunciationMap } = await import('../voice/vocab.ts');
  const { azureTtsConfigured, synthesizeAzureSpeech } = await import('../voice/azure-tts.ts');
  const { xaiTtsConfigured, synthesizeXaiSpeech } = await import('../voice/xai-tts.ts');
  const { env } = await import('../config/env.ts');
  const pref = (env.ttsProvider || 'auto').toLowerCase();
  let engine: 'azure' | 'xai' | null = null;
  if (pref === 'azure' && azureTtsConfigured()) engine = 'azure';
  else if ((pref === 'xai' || pref === 'grok') && xaiTtsConfigured()) engine = 'xai';
  else if (pref === 'auto' && azureTtsConfigured()) engine = 'azure';
  else if (pref === 'auto' && xaiTtsConfigured()) engine = 'xai';
  if (!engine) {
    throw new HttpError(
      400,
      'No server TTS. Browser speech will be used, or set XAI_API_KEY / AZURE_SPEECH_KEY.',
    );
  }
  const useAzure = engine === 'azure';
  const line = spokenLine(String(body.text ?? ''), {
    hasApproval: Boolean(body.hasApproval),
    pronunciation: pronunciationMap(),
  });
  if (!line.spoken) throw new HttpError(400, 'Nothing to speak.');
  const voice = body.voice != null ? String(body.voice) : undefined;
  const rate = body.rate != null ? String(body.rate) : undefined;
  const audio = useAzure
    ? await synthesizeAzureSpeech({ text: line.spoken, voice, rate })
    : await synthesizeXaiSpeech({ text: line.spoken, voice });
  return {
    ...line,
    provider: useAzure ? 'azure' : 'xai',
    voice: audio.voice,
    mimeType: audio.mimeType,
    audioBase64: audio.bytes.toString('base64'),
    storesAudio: false,
  };
});

get('/api/voice/vocab', async () => {
  const { listVocab, whisperPromptHint } = await import('../voice/vocab.ts');
  return { terms: listVocab(200), whisperPrompt: whisperPromptHint() };
});

post('/api/voice/vocab', async (body) => {
  const { addVocab } = await import('../voice/vocab.ts');
  return addVocab(
    String(body.term ?? ''),
    String(body.kind ?? 'term'),
    body.pronunciation != null ? String(body.pronunciation) : null,
  );
});

post('/api/voice/vocab/delete', async (body) => {
  const { removeVocab } = await import('../voice/vocab.ts');
  const id = Number(body.id);
  if (!Number.isFinite(id)) throw new HttpError(400, 'id required');
  return { ok: removeVocab(id) };
});

/**
 * Transcribe mic audio. JSON body with base64 only (no disk write).
 * Never approves actions. Transcript is returned for the user to edit before send.
 */
post('/api/voice/transcribe', async (body) => {
  const { decodeAudioBase64, transcribeAudio, sttStatus } = await import('../voice/stt.ts');
  const status = sttStatus();
  // Server STT: Groq Whisper or xAI Grok Voice Transcribe (same XAI_API_KEY as chat).
  if (status.provider !== 'groq' && status.provider !== 'xai') {
    throw new HttpError(
      400,
      status.note
        + ' Use the browser mic fallback, or set STT_PROVIDER=auto with XAI_API_KEY or GROQ_API_KEY.',
    );
  }
  const b64 = String(body.audioBase64 ?? body.audio ?? '');
  const { bytes, mimeType } = decodeAudioBase64(b64);
  const mime = body.mimeType != null ? String(body.mimeType) : mimeType;
  try {
    const result = await transcribeAudio({ bytes, mimeType: mime });
    return {
      ...result,
      storesAudio: false,
      // Explicit: this endpoint never decides approvals.
      canApprove: false,
    };
  } finally {
    bytes.fill(0);
  }
});

/** Stage counts, engine status, and the next drafts waiting for a person. */
get('/api/content/pipeline', () => {
  const stages = contentStageCounts();
  const waiting = listContent(80).filter((c) => c.state === 'drafted' || c.state === 'blocked');
  const queued = listContent(80).filter((c) => c.state === 'queued').slice(0, 8);
  const published = listContent(80).filter((c) => c.state === 'published').slice(0, 5);
  const jobs = listJobs().filter((j) => j.state === 'ready').slice(0, 8);
  const eng = engine.status();
  const stage =
    !eng.running ? 'engine_off'
    : (stages.queued ?? 0) > 0 ? 'publishing_queue'
    : waiting.length > 0 ? 'awaiting_approval'
    : (stages.published ?? 0) > 0 ? 'idle_after_publish'
    : 'idle';
  return {
    stage,
    stageLabel: {
      engine_off: 'Engine off. Approve drafts, then start the management engine.',
      awaiting_approval: 'Waiting on you. Approve or edit drafts before anything publishes.',
      publishing_queue: 'Engine on. Queued posts are waiting for a publish tick.',
      idle_after_publish: 'Engine on. Nothing queued. Recent posts already went out.',
      idle: 'Engine on. No drafts and no queue yet.',
    }[stage],
    engine: eng,
    stages,
    waiting: waiting.slice(0, 20).map((c) => ({
      id: c.id,
      platform: c.platform,
      state: c.state,
      preview: c.body.slice(0, 160),
    })),
    queued: queued.map((c) => ({
      id: c.id,
      platform: c.platform,
      preview: c.body.slice(0, 120),
    })),
    published: published.map((c) => ({
      id: c.id,
      platform: c.platform,
      preview: c.body.slice(0, 120),
    })),
    jobs: jobs.map((j) => ({
      id: j.id,
      kind: j.kind,
      account: j.account_name,
      runAt: j.run_at,
    })),
  };
});

/**
 * Normalize a draft for the gate (banned words, auto-thread) and save that text.
 * The person must Approve this exact body. Queueing will not rewrite again.
 */
post('/api/content/prepare', (body) => {
  const id = Number(body.id);
  const item = getContent(id);
  if (!item) throw new HttpError(404, 'no such content');
  if (item.state === 'published') throw new HttpError(400, 'published posts cannot be prepared');
  const prepared = prepareContentBody(item);
  markContentPrepared(id, prepared.body);
  const saved = getContent(id)!;
  const check = gate({
    platform: saved.platform as never,
    kind: saved.kind as 'post' | 'dm' | 'comment' | 'reply',
    body: saved.body,
    templateId: saved.template_id,
    provenance: 'founder_approved',
    recentBodies: recentPublishedBodies(saved.account_id),
  });
  return {
    content: saved,
    changed: prepared.changed,
    note: prepared.note
      || (prepared.changed ? 'Updated the draft for the gate.' : 'No changes needed. This is the final text.'),
    gate: { pass: check.pass, violations: check.violations },
  };
});

/** Edit a draft. Returns to drafted if it was queued or blocked. */
post('/api/content/body', (body) => {
  const id = Number(body.id);
  const item = getContent(id);
  if (!item) throw new HttpError(404, 'no such content');
  if (item.state === 'published') throw new HttpError(400, 'published posts cannot be edited here');
  const text = String(body.body ?? '').trim();
  if (!text) throw new HttpError(400, 'body is empty');
  const saved = reviseContent(id, text);
  if (!saved) throw new HttpError(404, 'no such content');
  const check = gate({
    platform: saved.platform as never,
    kind: saved.kind as 'post' | 'dm' | 'comment' | 'reply',
    body: saved.body,
    templateId: saved.template_id,
    provenance: 'founder_approved',
  });
  return {
    content: saved,
    gate: { pass: check.pass, violations: check.violations },
    note: check.pass
      ? 'Saved. Approve again when you are happy with it.'
      : `Saved, but the gate still flags: ${check.violations.join(' | ')}`,
  };
});

/** Move a draft into the publish queue, or block it. Re-gated at publish time too. */
post('/api/content/state', (body) => {
  const id = Number(body.id);
  const item = getContent(id);
  if (!item) throw new HttpError(404, 'no such content');
  const state = String(body.state);
  if (!['queued', 'blocked', 'skipped', 'drafted'].includes(state)) {
    throw new HttpError(400, 'state must be queued | blocked | skipped | drafted');
  }
  if (state === 'queued') {
    // Freeze the body: prepare must have already produced the final text the
    // person saw. Nothing rewrites after Approve.
    const again = prepareContentBody(item);
    if (again.changed) {
      markContentPrepared(id, again.body);
      throw new HttpError(
        409,
        'I updated this draft for the gate. Refresh approvals and Approve the final text you see.',
      );
    }
    const provenance = body.approved === true ? 'founder_approved' : contentProvenance(item.meta);
    const check = gate({
      platform: item.platform as never,
      kind: item.kind as 'post' | 'dm' | 'comment' | 'reply',
      body: item.body,
      templateId: item.template_id,
      provenance,
      recentBodies: recentPublishedBodies(item.account_id),
    });
    if (!check.pass) {
      setContentState(id, 'blocked', { violations: check.violations });
      throw new HttpError(400, `cannot queue: ${check.violations.join(' | ')}`);
    }
    if (body.approved === true) markFounderApproved(id);
  }
  setContentState(id, state as never);
  return getContent(id);
});

get('/api/jobs', () => listJobs());

post('/api/jobs', (body) => {
  const account = getAccountByName(String(body.account));
  if (!account) throw new HttpError(404, `no account "${String(body.account)}"`);
  const kind = String(body.kind);
  if (kind === 'engage_feed' && !features.engageFeedEnabled) {
    throw new HttpError(403, engageBlockedMessage());
  }
  return createJob({
    accountId: account.id,
    kind,
    payload: body.payload ?? {},
    recurrence: body.recurrence ? String(body.recurrence) : null,
    runAt: body.runAt ? String(body.runAt) : undefined,
  });
});

post('/api/jobs/state', (body) => {
  const id = Number(body.id);
  if (body.remove === true) {
    deleteJob(id);
    return { id, deleted: true };
  }
  setJobState(id, String(body.state) as never);
  return { id, state: body.state };
});

get('/api/feed', (_b, q) => recentFeedActions(Number(q.get('limit') ?? 40)));

/* ── personal VA: Ask box, calendar, reminders ──────────────────────────── */

post('/api/ask', async (body) => {
  const { handleVaCommand } = await import('../va/command.ts');
  const text = String(body.text ?? body.message ?? '').trim();
  if (!text) throw new HttpError(400, 'text is required');
  return handleVaCommand(text);
});

get('/api/va/status', async () => {
  const {
    listUpcomingEvents,
    listReminders,
    listOpenFollowUps,
    listOpenTasks,
    listDoneTasks,
    recentVaTurns,
  } = await import('../va/store.ts');
  const { emailConfigured } = await import('../va/email.ts');
  const { homeTimezone } = await import('../va/timezone.ts');
  const { googleStatus } = await import('../va/google.ts');
  const { listPendingApprovals } = await import('../guardrails/approvals.ts');
  return {
    homeTimezone: homeTimezone(),
    emailConfigured: emailConfigured(),
    google: googleStatus(),
    workspace: {
      configured: Boolean(env.workspaceMcpCommand),
      command: env.workspaceMcpCommand || null,
    },
    events: listUpcomingEvents(20),
    reminders: listReminders(30),
    followups: listOpenFollowUps(30),
    tasks: listOpenTasks(40),
    tasksDone: listDoneTasks(8),
    approvalsPending: listPendingApprovals(20).length,
    turns: recentVaTurns(15),
  };
});

/** Ranked today plate: tasks + upcoming meetings + pending approvals count. */
get('/api/va/today', async () => {
  const { listUpcomingEvents, listOpenTasks, prioritiseOpenTasks } = await import('../va/store.ts');
  const { homeTimezone } = await import('../va/timezone.ts');
  const { listPendingApprovals } = await import('../guardrails/approvals.ts');
  const tasks = listOpenTasks(40);
  const events = listUpcomingEvents(12);
  const approvals = listPendingApprovals(20);
  return {
    homeTimezone: homeTimezone(),
    tasks,
    events,
    approvals: approvals.map((a) => ({
      id: a.id,
      title: a.title,
      summary: a.summary,
      actionType: a.action_type,
    })),
    ranked: prioritiseOpenTasks().map((t) => t.id),
  };
});

post('/api/va/tasks/complete', async (body) => {
  const { completeTask } = await import('../va/store.ts');
  const id = Number(body.id);
  if (!Number.isFinite(id)) throw new HttpError(400, 'id is required');
  const task = completeTask(id);
  if (!task) throw new HttpError(404, 'task not found');
  return { ok: true, task };
});

post('/api/va/tasks/snooze', async (body) => {
  const { snoozeTask } = await import('../va/store.ts');
  const id = Number(body.id);
  const until = String(body.until ?? '').trim();
  if (!Number.isFinite(id) || !until) throw new HttpError(400, 'id and until are required');
  const task = snoozeTask(id, until);
  if (!task) throw new HttpError(404, 'task not found');
  return { ok: true, task };
});

post('/api/va/tasks/prioritise', async () => {
  const { prioritiseOpenTasks } = await import('../va/store.ts');
  return { ok: true, tasks: prioritiseOpenTasks() };
});

function voiceReply(profile: { cached?: boolean; samples: number; summary: string; themes: string[]; drafts: { body: string }[] }, cached: boolean) {
  if (cached) {
    return [
      'Using the voice I already saved. I did not reopen LinkedIn or Twitter.',
      '',
      profile.summary,
      '',
      profile.themes.length ? `Themes: ${profile.themes.join(', ')}.` : '',
      'Use Refresh voice from my pages when you want me to read your pages again.',
    ].filter(Boolean).join('\n');
  }
  return [
    `I read ${profile.samples} of your recent posts and saved a voice profile.`,
    '',
    profile.summary,
    '',
    profile.themes.length ? `Themes: ${profile.themes.join(', ')}.` : '',
    profile.drafts.length
      ? `I drafted ${profile.drafts.length} posts in that voice. They are saved as drafts, not published. Image ideas are captions plus a brief, not generated pictures yet.`
      : 'I saved the voice notes. Drafts need another pass if the model returned none.',
    '',
    'You can still edit instructions/FUNKE.md by hand. Learned voice lives in instructions/VOICE.md and is used alongside it.',
  ].filter(Boolean).join('\n');
}

post('/api/voice/learn', async () => {
  const { learnVoiceFromPages } = await import('../va/voice.ts');
  const profile = await learnVoiceFromPages();
  return {
    ok: true,
    samples: profile.samples,
    summary: profile.summary,
    themes: profile.themes,
    drafts: profile.drafts.map((d) => ({
      platform: d.platform,
      imageBrief: d.imageBrief,
      preview: d.body.slice(0, 280),
    })),
    cached: true,
    reply: voiceReply(profile, true),
  };
});

post('/api/voice/refresh', async () => {
  const { refreshVoiceFromPages } = await import('../va/voice.ts');
  const profile = await refreshVoiceFromPages();
  return {
    ok: true,
    samples: profile.samples,
    summary: profile.summary,
    themes: profile.themes,
    drafts: profile.drafts.map((d) => ({
      platform: d.platform,
      imageBrief: d.imageBrief,
      preview: d.body.slice(0, 280),
    })),
    cached: false,
    reply: voiceReply(profile, false),
  };
});

get('/api/voice', async () => {
  const { voiceLearned, readVoiceMarkdown } = await import('../va/voice.ts');
  return { learned: voiceLearned(), markdown: readVoiceMarkdown().slice(0, 2000) };
});

get('/api/google/start', async () => {
  const { googleAuthUrl, googleConfigured } = await import('../va/google.ts');
  if (!googleConfigured()) {
    throw new HttpError(
      400,
      `Google Calendar is not connected yet. Chat, reminders, and drafts still work without it. ` +
        `To connect later: add Google OAuth client id and secret to your .env file, with redirect ` +
        `http://127.0.0.1:${env.port}/api/google/callback (see docs/DATA.md).`,
    );
  }
  return { url: googleAuthUrl() };
});

get('/api/suppression', () => listSuppressed());
post('/api/suppression', (body) => {
  const url = normalizeProfileUrl(String(body.url));
  if (!url) throw new HttpError(400, 'not a LinkedIn profile URL');
  suppress(url, String(body.reason ?? 'manual'));
  return { url, suppressed: true };
});

/* ------------------------------------------------------------------ server */

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Bearer check, in constant time.
 *
 * `===` on strings returns as soon as two bytes differ, which leaks the token a
 * character at a time to anyone who can measure the difference. timingSafeEqual
 * needs equal lengths, so length is compared first and separately (that much is
 * public anyway).
 */
function authorized(req: IncomingMessage): boolean {
  // No token set is only survivable because the server is bound to loopback;
  // startServer() refuses to start otherwise.
  if (!env.apiToken) return true;
  return (
    safeEqual(req.headers.authorization ?? '', `Bearer ${env.apiToken}`) ||
    safeEqual(readCookie(req, SESSION_COOKIE), env.apiToken)
  );
}

function safeEqual(got: string, expected: string): boolean {
  if (got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/**
 * The UI authenticates with an HttpOnly cookie instead of a token baked into
 * the page, so page scripts (and anything injected into them) never see it.
 * SameSite=Strict keeps other sites from riding it.
 */
const SESSION_COOKIE = 'funke_session';

function readCookie(req: IncomingMessage, name: string): string {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

function sessionCookie(): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(env.apiToken)}; HttpOnly; SameSite=Strict; Path=/`;
}

/** Loopback Host headers only, so a DNS-rebound page cannot collect the session cookie. */
function loopbackHostHeader(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return isLoopback(host);
}

/* ------------------------------------------------------------------ UI */

const UI_DIR = resolvePath(fileURLToPath(new URL('../../web/dist', import.meta.url)));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
};

/** Map a URL path onto a file inside web/dist, or null if it is not one. */
function uiFile(pathname: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const candidates = [rel, joinPath(rel, 'index.html'), `${rel.replace(/\/$/, '')}.html`];
  for (const c of candidates) {
    const abs = resolvePath(UI_DIR, `.${c}`);
    if (abs !== UI_DIR && !abs.startsWith(UI_DIR + sep)) return null;
    try {
      if (statSync(abs).isFile()) return abs;
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

const UI_MISSING = `<!doctype html><meta charset="utf-8"><title>Funke</title>
<body style="font:16px/1.5 system-ui;padding:40px;background:#0f1410;color:#f4f1ea">
<h1>The Funke UI is not built yet</h1>
<p>Run <code>npm run build</code> in the project folder, then reload this page.</p>
</body>`;

/** Is this address reachable only from this machine? */
function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'body must be JSON');
  }
}

function send(res: ServerResponse, status: number, payload: unknown, contentType = 'application/json') {
  const body = contentType === 'application/json' ? JSON.stringify(payload, null, 2) : String(payload);
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
  res.end(body);
}

/**
 * Serve the built UI from web/dist. Pages hand the browser its session cookie;
 * hashed assets are public build output and need no auth.
 */
function serveUi(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!existsSync(UI_DIR)) return send(res, 503, UI_MISSING, 'text/html; charset=utf-8');
  const file = uiFile(url.pathname);
  if (!file) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const headers: Record<string, string> = { 'content-type': type };

  if (type.startsWith('text/html')) {
    if (isLoopback(env.bindHost)) {
      if (!loopbackHostHeader(req)) return send(res, 403, 'Open Funke at http://localhost', 'text/plain; charset=utf-8');
    } else if (!authorized(req)) {
      const offered = url.searchParams.get('token') ?? '';
      if (!env.apiToken || !safeEqual(offered, env.apiToken)) {
        return send(res, 401, 'Open this page once as /?token=<API_TOKEN>', 'text/plain; charset=utf-8');
      }
      res.writeHead(302, { location: url.pathname, 'set-cookie': sessionCookie(), 'cache-control': 'no-store' });
      return res.end();
    }
    if (env.apiToken) headers['set-cookie'] = sessionCookie();
    headers['cache-control'] = 'no-store';
  } else {
    headers['cache-control'] = url.pathname.startsWith('/_astro/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  }

  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
}

export function startServer(): void {
  // Fail closed. The UI pages hand out a session cookie that unlocks an API
  // able to publish to real accounts, so an unauthenticated server that
  // anything but this machine can reach is not a warning, it is a refusal.
  if (!isLoopback(env.bindHost)) {
    if (!env.bindAllowNonLoopback) {
      console.error(
        `refusing to start: BIND_HOST is ${env.bindHost}. ` +
          'Default is 127.0.0.1 only. To bind elsewhere you must set BIND_ALLOW_NON_LOOPBACK=true ' +
          'and a non-empty API_TOKEN (see .env.example).',
      );
      process.exit(1);
    }
    if (!env.apiToken || env.apiToken.length < 24) {
      console.error(
        'refusing to start: non-loopback BIND_HOST requires BIND_ALLOW_NON_LOOPBACK=true ' +
          'and an API_TOKEN of at least 24 characters.',
      );
      process.exit(1);
    }
    console.warn(
      `WARNING: bound to ${env.bindHost} with BIND_ALLOW_NON_LOOPBACK=true. ` +
        'Anyone who can reach this host and the API token can publish to your accounts.',
    );
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${env.port}`);

    if (!url.pathname.startsWith('/api/') && (req.method === 'GET' || req.method === 'HEAD')) {
      return serveUi(req, res, url);
    }

    // Google OAuth redirect has no Bearer header. Loopback-only is the safety.
    if (url.pathname === '/api/google/callback' && req.method === 'GET') {
      try {
        const code = url.searchParams.get('code');
        if (!code) return send(res, 400, { error: 'missing code' });
        const { exchangeGoogleCode } = await import('../va/google.ts');
        const out = await exchangeGoogleCode(code);
        const email = out.email ? ` (${out.email})` : '';
        return send(
          res,
          200,
          `<!doctype html><meta charset="utf-8"><title>Funke</title>
           <body style="font:16px/1.5 system-ui;padding:40px;background:#0f1410;color:#f4f1ea">
           <h1>Google connected${email}</h1>
           <p>Funke can write events to your calendar now.</p>
           <p><a href="/?panel=settings" style="color:#c4f061">Back to Funke</a></p>
           <script>setTimeout(()=>location.href='/?panel=settings',1500)</script>
           </body>`,
          'text/html; charset=utf-8',
        );
      } catch (err) {
        return send(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (!authorized(req)) {
      return send(res, 401, { error: 'set Authorization: Bearer <API_TOKEN>' });
    }

    const key = `${req.method} ${url.pathname}`;
    const handler = routes.get(key);
    if (!handler) return send(res, 404, { error: `no route ${key}` });

    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const result = await handler(body, url.searchParams);
      send(res, 200, result ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      send(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  server.listen(env.port, env.bindHost, () => {
    console.log(`Funke                     http://localhost:${env.port}`);
    if (!existsSync(UI_DIR)) console.log('UI                        not built yet. Run `npm run build`.');
    console.log(`bound to                  ${env.bindHost}${isLoopback(env.bindHost) ? ' (this machine only)' : '  ← REACHABLE FROM THE NETWORK'}`);
    // Ask the client what it actually is. This line used to guess from
    // ANTHROPIC_API_KEY alone, so adding Groq made it report 'mock' while
    // generation was really running on Groq: the one line whose whole job is
    // to tell you which provider you are on, quietly lying about it.
    console.log(`AI provider               ${buildAiClient().kind}`);
    if (!env.apiToken) {
      console.log('WARNING: API_TOKEN is empty. Nothing but this machine can reach the');
      console.log('         server, but anything running on it can. `npm run setup` fixes this.');
    }
  });
}
