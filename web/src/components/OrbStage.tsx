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
      return 'I’m listening.';
    case 'hearing':
      return 'Go on…';
    case 'thinking':
      return 'Thinking…';
    case 'speaking':
      return 'Speaking. Talk over me to interrupt.';
    default:
      return `${greeting()} I’m Funke.`;
  }
}

export default function OrbStage({ size = 400 }: Props) {
  const [snap, setSnap] = useState<VoiceSnapshot | null>(null);

  useEffect(() => voice().subscribe(setSnap), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (document.querySelector('.panel-host')) return;
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        void voice().toggleTalk();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const s = snap ?? voice().snapshot;
  const mode = orbMode(s.state);
  const caption = s.state === 'thinking' || s.state === 'speaking' ? s.reply || s.transcript : s.transcript;

  return (
    <div className={`orb-stage orb-stage--${mode}`}>
      <button
        type="button"
        className="orb-hit"
        aria-label={s.talkOn ? 'Stop talking' : 'Start talking'}
        aria-pressed={s.talkOn}
        onClick={() => void voice().toggleTalk()}
      >
        <VoiceOrb mode={mode} size={size} levelSource={() => voice().level} />
      </button>

      <div className="orb-copy" aria-live="polite">
        <p className="orb-label">{headline(s)}</p>
        {caption ? (
          <p className="orb-caption" title={caption}>
            {s.state === 'thinking' || s.state === 'speaking' ? caption : `“${caption}”`}
          </p>
        ) : (
          <p className="orb-sub">
            {s.notice ||
              (s.talkOn
                ? 'Speak naturally. Voice can’t approve.'
                : 'Tap the orb or press Space to talk. Or open Chat.')}
          </p>
        )}
        {caption && s.notice ? <p className="orb-sub">{s.notice}</p> : null}
      </div>

      <ActionCluster
        speakActive={s.speakOn}
        talkActive={s.talkOn}
        onSpeak={() => voice().setSpeakOn(!s.speakOn)}
        onTalk={() => void voice().toggleTalk()}
      />
    </div>
  );
}
