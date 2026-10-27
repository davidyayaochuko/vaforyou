import { useEffect, useState } from 'react';
import VoiceOrb, { type OrbMode } from './VoiceOrb';
import ActionCluster from './ActionCluster';
import { voice, type VoiceSnapshot, type VoiceState } from '../lib/voice';

type Props = {
  size?: number;
};

function orbMode(state: VoiceState): OrbMode {
  if (state === 'listening' || state === 'hearing') return 'listening';
  if (state === 'thinking') return 'thinking';
  if (state === 'speaking') return 'speaking';
  return 'idle';
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning.';
  if (h < 17) return 'Good afternoon.';
  return 'Good evening.';
}

function headline(s: VoiceSnapshot): string {
  switch (s.state) {
    case 'listening':
      return 'I’m listening. Keep going.';
    case 'hearing':
      return 'Go on…';
    case 'thinking':
      return 'Thinking…';
    case 'speaking':
      return 'Speaking. Talk over me anytime.';
    default:
      return `${greeting()} I’m Funke.`;
  }
}

function idleHint(): string {
  return 'Press Space, tap the orb, or tap Talk to start. Pause when you finish a thought. Press again to stop. Or open Chat.';
}

function canUseTalkShortcut(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return false;
  if (el?.isContentEditable) return false;
  if (document.querySelector('.panel-host')) return false;
  return true;
}

export default function OrbStage({ size = 400 }: Props) {
  const [snap, setSnap] = useState<VoiceSnapshot | null>(null);

  useEffect(() => {
    const v = voice(); // also publishes window.__funkeVoice for debugging
    return v.subscribe(setSnap);
  }, []);

  // Space toggles conversation: press once to open the mic, again to close. No hold.
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      if (!canUseTalkShortcut(e.target)) return;
      e.preventDefault();
      void voice().toggleTalk();
    };
    window.addEventListener('keydown', onDown);
    return () => window.removeEventListener('keydown', onDown);
  }, []);

  const s = snap ?? voice().snapshot;
  const mode = orbMode(s.state);
  const caption = s.state === 'thinking' || s.state === 'speaking' ? s.reply || s.transcript : s.transcript;
  const inConversation = s.talkOn && s.talkMode === 'conversation';
  const singing = s.state === 'speaking' && s.lyricLines.length > 0;
  const lyricIndex = Math.min(s.lyricIndex, Math.max(0, s.lyricLines.length - 1));
  const lyricPast = lyricIndex > 0 ? s.lyricLines[lyricIndex - 1] : '';
  const lyricNow = s.lyricLines[lyricIndex] ?? '';
  const lyricNext = lyricIndex < s.lyricLines.length - 1 ? s.lyricLines[lyricIndex + 1] : '';

  return (
    <div className={`orb-stage orb-stage--${mode}`}>
      <button
        type="button"
        className="orb-hit"
        aria-label={inConversation ? 'Stop conversation' : 'Start conversation'}
        aria-pressed={s.talkOn}
        onClick={() => void voice().toggleTalk()}
      >
        <VoiceOrb mode={mode} size={size} levelSource={() => voice().level} />
      </button>

      <div className="orb-copy" aria-live="off">
        <p className="orb-label">{headline(s)}</p>
        {singing ? (
          <div className="lyric">
            <p className="lyric-line is-past" aria-hidden="true">{lyricPast}</p>
            <p className="lyric-line is-now" aria-live="polite" key={lyricIndex}>{lyricNow}</p>
            <p className="lyric-line is-next" aria-hidden="true">{lyricNext}</p>
          </div>
        ) : caption ? (
          <p className="orb-caption" title={caption}>
            {s.state === 'thinking' || s.state === 'speaking' ? caption : `“${caption}”`}
          </p>
        ) : (
          <p className="orb-sub">
            {s.notice ||
              (inConversation
                ? 'Pause when you finish a thought. I’ll answer, then listen again. Press Space or Talk to stop.'
                : idleHint())}
          </p>
        )}
        {caption && s.notice ? <p className="orb-sub">{s.notice}</p> : null}
      </div>

      <ActionCluster
        speakActive={s.speakOn}
        talkActive={inConversation}
        onSpeak={() => voice().setSpeakOn(!s.speakOn)}
        onTalk={() => void voice().toggleTalk()}
      />
    </div>
  );
}
