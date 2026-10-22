type Props = {
  onSpeak?: () => void;
  onTalk?: () => void;
  speakActive?: boolean;
  talkActive?: boolean;
};

/** macOS segmented control under the orb: Speak · Talk · Chat */
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
        aria-label="Speak — read replies aloud"
        title="Speak"
        onClick={onSpeak}
      >
        Speak
      </button>

      <button
        type="button"
        className={`action-btn${talkActive ? ' is-active' : ''}`}
        aria-pressed={talkActive}
        aria-label="Talk — conversation mode"
        title="Talk"
        onClick={onTalk}
      >
        {talkActive ? 'Listening' : 'Talk'}
      </button>

      <button
        type="button"
        className="action-btn"
        data-dock="chat"
        aria-label="Open Chat"
        title="Chat"
      >
        Chat
      </button>
    </div>
  );
}
