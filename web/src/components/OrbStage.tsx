import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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
      return s.talkMode === 'conversation' ? 'I’m listening. Keep going.' : 'I’m listening.';
    case 'hearing':
      return 'Go on…';
    case 'thinking':
      return 'Thinking…';
    case 'speaking':
      return s.talkMode === 'conversation'
        ? 'Speaking. Talk over me anytime.'
        : 'Speaking. Talk over me to interrupt.';
    default:
      return `${greeting()} I’m Funke.`;
  }
}

function idleHint(): string {
  return 'Hold Space or the orb to send one line. Tap Talk for a continuous conversation. Or open Chat.';
}

function canUseHoldShortcut(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return false;
  if (el?.isContentEditable) return false;
  if (document.querySelector('.panel-host')) return false;
  return true;
}

export default function OrbStage({ size = 400 }: Props) {
  const [snap, setSnap] = useState<VoiceSnapshot | null>(null);
  const spaceHeld = useRef(false);
  const orbHeld = useRef(false);

  useEffect(() => voice().subscribe(setSnap), []);

  // Space: push-to-talk only when not already in a conversation session.
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      if (!canUseHoldShortcut(e.target)) return;
      e.preventDefault();
      const live = voice().snapshot;
      if (live.talkOn && live.talkMode === 'conversation') return;
      if (spaceHeld.current) return;
      spaceHeld.current = true;
      void voice().startTalk('hold');
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (!spaceHeld.current) return;
      spaceHeld.current = false;
      e.preventDefault();
      void voice().releaseTalk();
    };
    const onBlur = () => {
      if (!spaceHeld.current) return;
      spaceHeld.current = false;
      void voice().releaseTalk();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const onOrbPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const live = voice().snapshot;
    // Conversation already owns the mic. A click should not start a hold session.
    if (live.talkOn && live.talkMode === 'conversation') return;
    orbHeld.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    void voice().startTalk('hold');
  };

  const onOrbPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!orbHeld.current) return;
    orbHeld.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    void voice().releaseTalk();
  };

  const s = snap ?? voice().snapshot;
  const mode = orbMode(s.state);
  const caption = s.state === 'thinking' || s.state === 'speaking' ? s.reply || s.transcript : s.transcript;
  const holding = spaceHeld.current || orbHeld.current;
  const inConversation = s.talkOn && s.talkMode === 'conversation';

  return (
    <div className={`orb-stage orb-stage--${mode}`}>
      <button
        type="button"
        className="orb-hit"
        aria-label={
          inConversation
            ? 'Conversation active. Use Talk to stop.'
            : holding
              ? 'Release to send'
              : 'Hold to talk'
        }
        aria-pressed={s.talkOn}
        onPointerDown={onOrbPointerDown}
        onPointerUp={onOrbPointerUp}
        onPointerCancel={onOrbPointerUp}
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
              (inConversation
                ? 'Pause when you finish a thought. I’ll answer, then listen again.'
                : s.talkOn
                  ? 'Release Space or the orb to send. Voice can’t approve.'
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
