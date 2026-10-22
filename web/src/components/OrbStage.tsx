import { useState } from 'react';
import VoiceOrb, { type OrbMode } from './VoiceOrb';
import ActionCluster from './ActionCluster';

type Props = {
  size?: number;
};

export default function OrbStage({ size = 420 }: Props) {
  const [mode, setMode] = useState<OrbMode>('idle');
  const [speakOn, setSpeakOn] = useState(false);
  const [talkOn, setTalkOn] = useState(false);

  const activeMode: OrbMode = talkOn ? 'listening' : mode;
  const level = talkOn ? 0.72 : mode === 'listening' ? 0.45 : mode === 'speaking' ? 0.58 : 0.08;

  return (
    <div className="orb-stage">
      <button
        type="button"
        aria-label={`Voice orb, ${talkOn ? 'listening' : mode}. Click to cycle preview.`}
        onClick={() => {
          if (talkOn) return;
          const order: OrbMode[] = ['idle', 'listening', 'speaking'];
          const i = order.indexOf(mode);
          setMode(order[(i + 1) % order.length]!);
        }}
        style={{
          display: 'block',
          padding: 0,
          border: 0,
          background: 'transparent',
          cursor: talkOn ? 'default' : 'pointer',
          borderRadius: '50%',
        }}
      >
        <VoiceOrb mode={activeMode} size={size} level={level} />
      </button>

      <p className="orb-label">
        {talkOn
          ? 'Listening…'
          : mode === 'speaking'
            ? 'Speaking'
            : mode === 'listening'
              ? 'Ready to hear you'
              : 'Click the orb to preview'}
      </p>

      <ActionCluster
        speakActive={speakOn}
        talkActive={talkOn}
        onSpeak={() => setSpeakOn((v) => !v)}
        onTalk={() => {
          setTalkOn((v) => {
            const next = !v;
            setMode(next ? 'listening' : 'idle');
            return next;
          });
        }}
      />
    </div>
  );
}
