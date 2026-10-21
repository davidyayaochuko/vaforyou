/**
 * Voice helpers (no mic required for unit checks).
 *   npm run voice:smoke
 */
export {};
process.env.DB_PATH = `/tmp/funke-voice-${Date.now()}.db`;

const { spokenSummary, spokenLine, prepareForSpeech, numberToWords, isApprovalPrompt, pickDefaultBrowserVoiceUri } =
  await import('../src/voice/tts.ts');
const { decodeAudioBase64, sttStatus, suggestCorrections } = await import('../src/voice/stt.ts');
const { ensureVocabTable, addVocab, whisperPromptHint, pronunciationMap } = await import('../src/voice/vocab.ts');
const { decideApproval, ensureApprovalsTable, requestAction } = await import('../src/guardrails/approvals.ts');
const { ensureAuditTable } = await import('../src/guardrails/audit.ts');
const { initSchema } = await import('../src/db/index.ts');
const { ensureVaTables } = await import('../src/va/store.ts');

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
  ensureVocabTable();

  console.log('\n1. Spoken line matches display contract');
  const short = spokenSummary('Hello there.');
  check('short unchanged', short === 'Hello there.');
  const longSrc =
    `${'Meeting notes about Spendprofile. '.repeat(20)}\n\nSecond paragraph with more detail.`;
  const long = spokenLine(longSrc);
  check('long is summary', long.isSummary && /Details are on screen/i.test(long.spoken), long.spoken.slice(0, 80));
  check(
    'display spoken === tts string',
    long.spoken === spokenSummary(longSrc),
  );
  const appr = spokenLine('I need your approval before I do that.\nVoice cannot approve.', {
    hasApproval: true,
  });
  check('approval short form', /approval on screen/i.test(appr.spoken) && appr.isSummary);

  console.log('\n2. Speech formatting');
  const prep = prepareForSpeech('Pay ₦50,000 at 3pm. See https://example.com and **bold**.');
  check('naira words', /fifty thousand naira/i.test(prep), prep);
  check('time words', /three p\.m\./i.test(prep), prep);
  check('link words', /\blink\b/i.test(prep) && !/https/i.test(prep), prep);
  check('no markdown stars', !/\*\*/.test(prep), prep);
  check('number helper', numberToWords(50_000) === 'fifty thousand');

  console.log('\n3. Vocabulary + pronunciation');
  addVocab('Adaeze', 'name', 'ah-dah-EH-zeh');
  const hint = whisperPromptHint();
  check('whisper prompt has places', /Ikeja|Lekki|Adaeze/i.test(hint), hint.slice(0, 120));
  const map = pronunciationMap();
  check('pronunciation map', /ah-dah-EH-zeh/i.test(map.Adaeze || ''), map.Adaeze);
  const spokenName = prepareForSpeech('Call Adaeze tomorrow', map);
  check('name pronounced', /ah-dah-EH-zeh/i.test(spokenName), spokenName);
  check(
    'suggest corrections',
    suggestCorrections('Adaez', ['Adaeze', 'Adanna', 'Lagos']).includes('Adaeze'),
  );

  console.log('\n4. STT helpers');
  const status = sttStatus();
  check('stt status has provider', ['groq', 'browser', 'none'].includes(status.provider), status.provider);
  check('storesAudio false', status.storesAudio === false);
  const decoded = decodeAudioBase64('data:audio/webm;base64,AAAA');
  check('decode data url', decoded.bytes.length > 0 && decoded.mimeType.includes('audio'));

  console.log('\n5. Browser voice ranking');
  const uri = pickDefaultBrowserVoiceUri([
    { voiceURI: 'a', name: 'Samantha', lang: 'en-US' },
    { voiceURI: 'b', name: 'Microsoft Ezinne Online (Natural) - English (Nigeria)', lang: 'en-NG' },
  ]);
  check('prefers en-NG', uri === 'b', uri);

  console.log('\n6. Voice cannot approve');
  check('approval prompt detected', isApprovalPrompt('I need your approval before I do that.\nVoice cannot approve.'));
  const pending = await requestAction({
    actionType: 'calendar.create',
    title: 'Voice test',
    summary: 'Add voice test',
    preview: 'Add voice test',
    payload: { title: 'Voice test', start: '2026-10-23T10:00:00', timezone: 'Africa/Lagos' },
    idempotencyKey: `voice-cal-${Date.now()}`,
  });
  const voice = await decideApproval({
    id: pending.approval!.id,
    decision: 'approved',
    decidedBy: 'voice',
  });
  check('voice decide blocked', !voice.ok && /Voice cannot approve/i.test(voice.reply), voice.reply);

  console.log(failed ? `\nFAIL — ${failed} checks` : '\nPASS — voice');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
