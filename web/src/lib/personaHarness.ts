/**
 * Browser harness: each adult persona exercises Spacebar toggle
 * and Talk continuous conversation against the live Funke UI.
 */
import { voice } from './voice';

type TurnOut = {
  turn: number;
  user: string;
  modePath: string;
  ok: boolean;
  ms?: number;
  reply?: string;
  replyPreview?: string;
  issue?: string;
  talkModeAfter?: string | null;
  resumedListening?: boolean;
  notice?: string;
};

type PersonaReport = {
  id: string;
  name: string;
  field: string;
  style: string;
  ptt: TurnOut[];
  continuous: TurnOut[];
};

export type HarnessReport = {
  startedAt: string;
  finishedAt?: string;
  fixesApplied: string[];
  personas: PersonaReport[];
  issues: { persona: string; mode: string; turn: number; issue: string }[];
};

function clip(s: string, n = 220): string {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n - 1) + '…';
}

export async function runPersonaHarness(): Promise<{
  ok: boolean;
  issueCount: number;
  personas: { id: string; name: string; pttOk: string; contOk: string }[];
  issues: HarnessReport['issues'];
  error?: string;
}> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (pred: () => boolean, ms = 15000, step = 100) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (pred()) return true;
      await sleep(step);
    }
    return pred();
  };

  (window as unknown as { __funkeMuteSpeak?: boolean }).__funkeMuteSpeak = true;
  const v = voice();

  const talkBtn = () =>
    [...document.querySelectorAll('.action-btn')].find((b) =>
      /Talk|In call/i.test(b.textContent || ''),
    ) as HTMLButtonElement | undefined;

  const spaceToggle = () => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }),
    );
  };

  const personas = [
    {
      id: 'A',
      name: 'Amara Okonkwo',
      field: 'Corporate law / in-house counsel',
      style: 'fast, wordy',
      ptt: [
        'Hey Funke so basically I need you to remind me tomorrow at eight am sharp to review the vendor DPA before the nine thirty call with procurement and also flag anything that looks like unlimited liability because last time legal got blindsided and I do not want a repeat of that mess okay?',
        'Also what is already on my plate for tomorrow morning before ten so I do not double book myself while I am already drowning in redlines?',
      ],
      continuous: [
        'Okay keep listening, first thing, draft a short LinkedIn post about why contract review speed matters for startups but do not publish it yet I just want a draft.',
        'Make it warmer, less corporate jargon, more founder-to-founder, still professional though.',
        'And remind me Friday at four pm to follow up with Chioma about the NDA markup.',
        'What meetings do I have coming up in the next couple of days?',
      ],
    },
    {
      id: 'B',
      name: 'Samuel Wright',
      field: 'Primary care / family physician',
      style: 'slow, deliberate',
      ptt: [
        'Funke. Please remind me. Tomorrow. At six in the morning. To call the lab. About Mrs. Adeyemi results.',
        'Also. Tell me what reminders I already have. Open ones only.',
      ],
      continuous: [
        'I would like to schedule a call. With the clinic manager. On Thursday. At three in the afternoon.',
        'If Thursday at three is busy. Try Friday at the same time.',
        'Please read back. What you understood. About that appointment.',
        'And draft a calm LinkedIn note to myself about preparing for that call. Do not publish.',
      ],
    },
    {
      id: 'C',
      name: 'Priya Mehta',
      field: 'Startup product / growth',
      style: 'in a hurry',
      ptt: ['Funke plate now. Quick.', 'Remind me in twenty minutes. Ship the landing copy.'],
      continuous: [
        'Draft LinkedIn. Launch week. Short. Punchy. No fluff.',
        'Shorter.',
        'Remind me tomorrow at nine am to ship the landing copy.',
        'Anything waiting on my approval?',
      ],
    },
    {
      id: 'D',
      name: 'Elena Vasquez',
      field: 'Museum curation / cultural heritage',
      style: 'calm, unhurried',
      ptt: [
        'Good evening Funke. When you have a moment, would you mind showing me what is already on my calendar for this week?',
        'And gently remind me on Sunday evening at seven to pack the textile samples for Monday walkthrough.',
      ],
      continuous: [
        'I would love a soft draft of a LinkedIn post about the Basotho blanket exhibition. Warm travel-journal tone. Nothing published yet.',
        'That is lovely. Soften the ending a little more.',
        'Could you also note a follow-up with the Lagos gallery contact next Tuesday afternoon?',
        'Thank you. What should I prioritize tomorrow if I only have a quiet morning?',
      ],
    },
  ];

  const report: HarnessReport = {
    startedAt: new Date().toISOString(),
    fixesApplied: [
      'draft_post accepts bluesky/bsky',
      'askFunkeDetailed retries on rate-limit replies',
      'window.__funkeVoice + mute speak for harness',
    ],
    personas: [],
    issues: [],
  };

  const isBad = (reply: string) =>
    /rate limit|busy right now|could not form a reply|Request failed|Microphone access was blocked/i.test(
      reply || '',
    );

  async function runPtt(text: string): Promise<Omit<TurnOut, 'turn' | 'user'>> {
    if (v.snapshot.talkOn) v.stopTalk();
    await sleep(200);
    spaceToggle();
    const opened = await waitFor(() => v.snapshot.talkMode === 'conversation', 8000);
    if (!opened) {
      return {
        modePath: 'spacebar-toggle',
        ok: false,
        talkModeAfter: v.snapshot.talkMode,
        notice: v.snapshot.notice,
        reply: '',
        issue: 'Space keydown did not start conversation',
      };
    }
    const t0 = Date.now();
    await v.ask(text);
    const ms = Date.now() - t0;
    const reply = v.snapshot.reply || v.snapshot.notice || '';
    spaceToggle();
    await waitFor(() => !v.snapshot.talkOn, 5000);
    if (v.snapshot.talkOn) v.stopTalk();
    return {
      modePath: 'spacebar-toggle',
      ok: !isBad(reply) && !!reply,
      ms,
      talkModeAfter: v.snapshot.talkMode,
      reply,
      replyPreview: clip(reply),
    };
  }

  async function startConversation() {
    if (v.snapshot.talkMode === 'conversation') return true;
    if (v.snapshot.talkOn) v.stopTalk();
    await sleep(200);
    const btn = talkBtn();
    if (!btn) return false;
    btn.click();
    return waitFor(() => v.snapshot.talkMode === 'conversation', 10000);
  }

  async function stopConversation() {
    if (v.snapshot.talkMode !== 'conversation') {
      if (v.snapshot.talkOn) v.stopTalk();
      return;
    }
    const btn = talkBtn();
    if (btn) btn.click();
    await waitFor(() => !v.snapshot.talkOn, 5000);
    if (v.snapshot.talkOn) v.stopTalk();
  }

  async function runContinuous(text: string): Promise<Omit<TurnOut, 'turn' | 'user'>> {
    const t0 = Date.now();
    await v.ask(text);
    const ms = Date.now() - t0;
    const reply = v.snapshot.reply || v.snapshot.notice || '';
    const stillOn = v.snapshot.talkMode === 'conversation';
    return {
      modePath: 'talk-continuous',
      ok: !isBad(reply) && !!reply,
      ms,
      resumedListening: stillOn && (v.snapshot.state === 'listening' || v.snapshot.state === 'speaking'),
      talkModeAfter: v.snapshot.talkMode,
      reply,
      replyPreview: clip(reply),
    };
  }

  for (const p of personas) {
    const entry: PersonaReport = {
      id: p.id,
      name: p.name,
      field: p.field,
      style: p.style,
      ptt: [],
      continuous: [],
    };

    for (let i = 0; i < p.ptt.length; i++) {
      if (i) await sleep(3500);
      const out = await runPtt(p.ptt[i]!);
      entry.ptt.push({ turn: i + 1, user: p.ptt[i]!, ...out });
      if (!out.ok) {
        report.issues.push({
          persona: p.name,
          mode: 'spacebar-toggle',
          turn: i + 1,
          issue: out.issue || clip(out.reply || '', 160),
        });
      }
    }

    await sleep(4000);
    const started = await startConversation();
    if (!started) {
      report.issues.push({
        persona: p.name,
        mode: 'talk-continuous',
        turn: 0,
        issue: 'Talk button did not start conversation',
      });
    }

    for (let i = 0; i < p.continuous.length; i++) {
      if (i) await sleep(3500);
      if (v.snapshot.talkMode !== 'conversation') await startConversation();
      const out = await runContinuous(p.continuous[i]!);
      entry.continuous.push({ turn: i + 1, user: p.continuous[i]!, ...out });
      if (!out.ok) {
        report.issues.push({
          persona: p.name,
          mode: 'talk-continuous',
          turn: i + 1,
          issue: clip(out.reply || '', 160),
        });
      }
      if (out.ok && out.resumedListening === false) {
        report.issues.push({
          persona: p.name,
          mode: 'talk-continuous',
          turn: i + 1,
          issue: 'Conversation did not resume listening after reply',
        });
      }
    }

    await stopConversation();
    report.personas.push(entry);
    await sleep(4000);
  }

  report.finishedAt = new Date().toISOString();
  (window as unknown as { __funkePersonaReport?: HarnessReport }).__funkePersonaReport = report;
  return {
    ok: report.issues.length === 0,
    issueCount: report.issues.length,
    personas: report.personas.map((p) => ({
      id: p.id,
      name: p.name,
      pttOk: `${p.ptt.filter((t) => t.ok).length}/${p.ptt.length}`,
      contOk: `${p.continuous.filter((t) => t.ok).length}/${p.continuous.length}`,
    })),
    issues: report.issues,
  };
}

export function installPersonaHarness() {
  (window as unknown as { __funkePersonaHarness?: typeof runPersonaHarness }).__funkePersonaHarness =
    runPersonaHarness;
  return runPersonaHarness;
}
