import { Glyph } from './Icon';

type Props = {
  onSpeak?: () => void;
  onTalk?: () => void;
  speakActive?: boolean;
  talkActive?: boolean;
};

/** Segmented control under the orb: Speak · Talk · Chat */
export default function ActionCluster({
  onSpeak,
  onTalk,
  speakActive = false,
  talkActive = false,
}: Props) {
  return (
    <div className="action-cluster" role="toolbar" aria-label="Voice and chat">
      <button
        type="button"
        className={`action-btn${speakActive ? ' is-active' : ''}`}
        aria-pressed={speakActive}
        aria-label="Speak: read replies aloud"
        title="Read replies aloud"
        onClick={onSpeak}
      >
        <Glyph name="speak" size={13} />
        <span>Speak</span>
      </button>

      <button
        type="button"
        className={`action-btn${talkActive ? ' is-active' : ''}`}
        aria-pressed={talkActive}
        aria-label={talkActive ? 'Stop conversation' : 'Talk: start continuous conversation (Space or orb also toggles)'}
        title={
          talkActive
            ? 'Stop conversation'
            : 'Start conversation. Pause when you finish a thought. Press Space, the orb, or Talk again to stop.'
        }
        onClick={onTalk}
      >
        <Glyph name="mic" size={13} />
        <span>{talkActive ? 'In call' : 'Talk'}</span>
      </button>

      <button
        type="button"
        className="action-btn"
        data-dock="chat"
        aria-label="Open Chat"
        title="Open chat"
      >
        <Glyph name="chat" size={13} />
        <span>Chat</span>
      </button>
    </div>
  );
}
