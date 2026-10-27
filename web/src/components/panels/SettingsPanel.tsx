import { useCallback, useState } from 'react';
import {
  addVocab,
  fetchGoogleStatus,
  fetchHealth,
  fetchMemory,
  fetchVocab,
  fetchVoiceStatus,
  forgetAllMemory,
  forgetMemory,
  googleConnectUrl,
  removeVocab,
  startEngine,
  stopEngine,
} from '../../lib/api';
import { Glyph } from '../Icon';
import { PanelState, useLive } from './shared';

const PROVIDER: Record<string, string> = {
  groq: 'Groq Whisper',
  xai: 'xAI',
  azure: 'Azure Speech',
  browser: 'Your browser',
  none: 'Off',
};

export default function SettingsPanel() {
  const load = useCallback(async () => {
    const [health, google, voice, vocab, memory] = await Promise.all([
      fetchHealth(),
      fetchGoogleStatus(),
      fetchVoiceStatus(),
      fetchVocab(),
      fetchMemory(),
    ]);
    return { engine: health.engine ?? {}, google, voice, vocab, memory };
  }, []);
  const { data, error, loading, refresh } = useLive(load, { every: 30_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [term, setTerm] = useState('');
  const [say, setSay] = useState('');
  const [confirmForget, setConfirmForget] = useState(false);

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    setToast('');
    try {
      await fn();
      if (done) setToast(done);
      await refresh();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const connectGoogle = () =>
    run('google', async () => {
      window.location.href = await googleConnectUrl();
    });

  const engineOn = !!data?.engine.running;

  return (
    <div className="app-panel">
      {toast ? (
        <p className="panel-toast" role="status">
          {toast}
        </p>
      ) : null}
      <PanelState loading={loading} error={error} empty={false} emptyTitle="">
        <section className="plist-section">
          <h4>Social engine</h4>
          <div className={`engine-strip${engineOn ? ' is-on' : ''}`}>
            <span className="status-dot" data-on={engineOn ? '1' : '0'} />
            <span>
              The engine is <strong>{engineOn ? 'on' : 'off'}</strong>.{' '}
              {engineOn
                ? 'Approved posts and scheduled jobs run within your daily caps.'
                : 'Nothing posts while it is off. It never starts on its own.'}
            </span>
          </div>
          <div className="panel-toolbar">
            {engineOn ? (
              <button
                type="button"
                className="panel-btn"
                disabled={busy === 'engine'}
                onClick={() => void run('engine', stopEngine, 'Engine stopped after the current action.')}
              >
                {busy === 'engine' ? 'Stopping…' : 'Stop engine'}
              </button>
            ) : (
              <button
                type="button"
                className="panel-btn panel-btn--accent"
                disabled={busy === 'engine'}
                onClick={() => void run('engine', startEngine, 'Engine started.')}
              >
                {busy === 'engine' ? 'Starting…' : 'Start engine'}
              </button>
            )}
          </div>
        </section>

        <section className="plist-section">
          <h4>Google Calendar</h4>
          <ul className="plist">
            <li className="prow">
              <span className="prow-main">
                <span className="prow-title">
                  {data?.google.connected ? 'Connected' : data?.google.configured ? 'Not connected' : 'Not set up'}
                </span>
                <span className="prow-meta">
                  {data?.google.connected
                    ? 'Funke can add approved meetings to your calendar.'
                    : data?.google.configured
                      ? 'Connect once so Funke can add approved meetings.'
                      : 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env first. See the README.'}
                </span>
              </span>
              {data?.google.configured ? (
                <button type="button" className="prow-action" disabled={busy === 'google'} onClick={() => void connectGoogle()}>
                  {data.google.connected ? 'Reconnect' : 'Connect'}
                </button>
              ) : null}
            </li>
          </ul>
        </section>

        <section className="plist-section">
          <h4>Voice</h4>
          <ul className="plist">
            <li className="prow">
              <span className="prow-main">
                <span className="prow-title">Listening</span>
                <span className="prow-meta">{PROVIDER[data?.voice.stt.provider ?? ''] ?? data?.voice.stt.provider}</span>
              </span>
            </li>
            <li className="prow">
              <span className="prow-main">
                <span className="prow-title">Speaking</span>
                <span className="prow-meta">{PROVIDER[data?.voice.tts.provider ?? ''] ?? data?.voice.tts.provider}</span>
              </span>
            </li>
          </ul>
          <p className="panel-note">Providers come from your .env file. Restart the server after changing them.</p>
        </section>

        <section className="plist-section">
          <h4>
            Words Funke should know <span>{data?.vocab.length ?? 0}</span>
          </h4>
          <form
            className="quick-ask-row"
            onSubmit={(e) => {
              e.preventDefault();
              const t = term.trim();
              if (!t) return;
              void run('vocab', () => addVocab(t, say.trim()), `Added "${t}".`).then(() => {
                setTerm('');
                setSay('');
              });
            }}
          >
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Name or term" aria-label="Name or term" />
            <input
              value={say}
              onChange={(e) => setSay(e.target.value)}
              placeholder="Say it like (optional)"
              aria-label="Pronunciation"
            />
            <button type="submit" className="mac-btn mac-btn-primary" disabled={!term.trim() || busy === 'vocab'}>
              Add
            </button>
          </form>
          {data?.vocab.length ? (
            <ul className="plist">
              {data.vocab.map((v) => (
                <li key={v.id} className="prow">
                  <span className="prow-main">
                    <span className="prow-title">{v.term}</span>
                    {v.pronunciation ? <span className="prow-meta">Said like {v.pronunciation}</span> : null}
                  </span>
                  <button
                    type="button"
                    className="prow-action"
                    aria-label={`Remove ${v.term}`}
                    disabled={busy === `v${v.id}`}
                    onClick={() => void run(`v${v.id}`, () => removeVocab(v.id))}
                  >
                    <Glyph name="trash" size={12} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="plist-section">
          <h4>
            What Funke remembers <span>{data?.memory.length ?? 0}</span>
          </h4>
          {data?.memory.length ? (
            <ul className="plist">
              {data.memory.map((m) => (
                <li key={m.id} className="prow">
                  <span className="prow-main">
                    <span className="prow-title">{m.value}</span>
                    <span className="prow-meta">
                      {m.scope}
                      {m.contact ? ` · ${m.contact}` : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="prow-action"
                    aria-label="Forget this"
                    disabled={busy === `m${m.id}`}
                    onClick={() => void run(`m${m.id}`, () => forgetMemory(m.id))}
                  >
                    Forget
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="panel-note">Nothing yet. Tell Funke "remember that…" in Chat.</p>
          )}
          {data?.memory.length ? (
            <div className="panel-toolbar">
              {confirmForget ? (
                <>
                  <button
                    type="button"
                    className="panel-btn panel-btn--accent"
                    disabled={busy === 'forget-all'}
                    onClick={() =>
                      void run('forget-all', forgetAllMemory, 'Memory cleared. Chat history and approvals are kept.').then(() =>
                        setConfirmForget(false),
                      )
                    }
                  >
                    Yes, forget everything
                  </button>
                  <button type="button" className="panel-btn" onClick={() => setConfirmForget(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" className="panel-btn" onClick={() => setConfirmForget(true)}>
                  Forget everything
                </button>
              )}
            </div>
          ) : null}
        </section>
      </PanelState>
    </div>
  );
}
