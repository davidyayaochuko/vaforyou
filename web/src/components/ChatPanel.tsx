import { useEffect, useMemo, useRef, useState } from 'react';
import { askFunkeDetailed } from '../lib/api';
import { pendingTurns, voice, type VoiceSnapshot, type VoiceTurn } from '../lib/voice';
import { Glyph } from './Icon';

const SUGGESTIONS = [
  'What’s on my plate today?',
  'Remind me tomorrow at 9am to send the deck',
  'Draft a LinkedIn post about our launch',
  'What did I miss?',
];

type Role = 'user' | 'assistant';

type Message = {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  via?: 'voice';
};

type Thread = {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
};

const STORAGE_KEY = 'funke-chat-shell-v1';

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function seedThreads(): Thread[] {
  const now = Date.now();
  return [
    {
      id: 't_welcome',
      title: 'Getting started',
      updatedAt: now - 60_000,
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content:
            'Hi. What’s on your plate? Reminders, drafts, and calendar are fair game. Nothing publishes without your approval.',
          createdAt: now - 60_000,
        },
      ],
    },
  ];
}

function loadThreads(): Thread[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedThreads();
    const parsed = JSON.parse(raw) as Thread[];
    if (!Array.isArray(parsed) || parsed.length === 0) return seedThreads();
    return parsed;
  } catch {
    return seedThreads();
  }
}

function titleFromMessages(messages: Message[]) {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) return 'New chat';
  const t = firstUser.content.trim().replace(/\s+/g, ' ');
  return t.length > 42 ? `${t.slice(0, 42)}…` : t;
}

function exportMarkdown(thread: Thread) {
  const lines = [`# ${thread.title}`, '', `Exported ${new Date().toISOString()}`, ''];
  for (const m of thread.messages) {
    lines.push(`## ${m.role === 'user' ? 'You' : 'Funke'}`, '', m.content, '');
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${thread.title.replace(/[^\w\- ]+/g, '').trim() || 'funke-chat'}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

type Props = {
  onClose?: () => void;
};

export default function ChatPanel({ onClose }: Props) {
  const [threads, setThreads] = useState<Thread[]>(() =>
    typeof window === 'undefined' ? seedThreads() : loadThreads(),
  );
  const [activeId, setActiveId] = useState<string>(() => threads[0]?.id ?? '');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [voiceSnap, setVoiceSnap] = useState<VoiceSnapshot | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  useEffect(() => voice().subscribe(setVoiceSnap), []);

  // Prefill from other panels ("Try in Chat" chips).
  useEffect(() => {
    const w = window as unknown as { __funkePrefill?: string };
    const take = () => {
      if (w.__funkePrefill) {
        setDraft(w.__funkePrefill);
        w.__funkePrefill = undefined;
        window.setTimeout(() => inputRef.current?.focus(), 30);
      }
    };
    take();
    window.addEventListener('funke:open', take);
    return () => window.removeEventListener('funke:open', take);
  }, []);

  // Voice turns from the orb land in the open thread.
  useEffect(() => {
    const onTurn = () => {
      const queue = pendingTurns();
      if (!queue.length) return;
      const turns: VoiceTurn[] = queue.splice(0, queue.length);
      const id = activeIdRef.current;
      const now = Date.now();
      setThreads((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          const messages: Message[] = [
            ...t.messages,
            ...turns.flatMap((turn, i): Message[] => [
              { id: uid('m'), role: 'user', content: turn.user, createdAt: now + i * 2, via: 'voice' },
              { id: uid('m'), role: 'assistant', content: turn.reply, createdAt: now + i * 2 + 1 },
            ]),
          ];
          return {
            ...t,
            updatedAt: now,
            title: t.title === 'New chat' || t.title === 'Getting started' ? titleFromMessages(messages) : t.title,
            messages,
          };
        }),
      );
    };
    onTurn();
    window.addEventListener('funke:turn', onTurn);
    return () => window.removeEventListener('funke:turn', onTurn);
  }, []);

  const active = useMemo(
    () => threads.find((t) => t.id === activeId) ?? threads[0] ?? null,
    [threads, activeId],
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
    } catch {
      /* ignore quota */
    }
  }, [threads]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [active?.messages.length, activeId]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  const updateActive = (fn: (t: Thread) => Thread) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === activeId ? fn({ ...t, updatedAt: Date.now() }) : t)),
    );
  };

  const newChat = () => {
    const thread: Thread = {
      id: uid('t'),
      title: 'New chat',
      updatedAt: Date.now(),
      messages: [
        {
          id: uid('m'),
          role: 'assistant',
          content: 'Hi. What’s on your plate? Reminders, drafts and calendar are fair game. Nothing publishes without your approval.',
          createdAt: Date.now(),
        },
      ],
    };
    setThreads((prev) => [thread, ...prev]);
    setActiveId(thread.id);
    setDraft('');
    setEditingId(null);
    setMenuOpen(false);
  };

  const deleteChat = (id: string) => {
    setThreads((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        const fresh = seedThreads()[0]!;
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveId(next[0]!.id);
      return next;
    });
    setMenuOpen(false);
  };

  const patchThread = (id: string, fn: (t: Thread) => Thread) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === id ? fn({ ...t, updatedAt: Date.now() }) : t)),
    );
  };

  const send = async (override?: string) => {
    const text = (override ?? draft).trim();
    if (!text || !active || sending) return;
    const threadId = active.id;
    const userMsg: Message = {
      id: uid('m'),
      role: 'user',
      content: text,
      createdAt: Date.now(),
    };
    patchThread(threadId, (t) => {
      const messages = [...t.messages, userMsg];
      return {
        ...t,
        title:
          t.title === 'New chat' || t.title === 'Getting started'
            ? titleFromMessages(messages)
            : t.title,
        messages,
      };
    });
    setDraft('');
    setSending(true);
    try {
      const { reply: replyText, approvals } = await askFunkeDetailed(text);
      if (voice().snapshot.speakOn) void voice().speak(replyText, approvals.length > 0);
      patchThread(threadId, (t) => ({
        ...t,
        messages: [
          ...t.messages,
          { id: uid('m'), role: 'assistant', content: replyText, createdAt: Date.now() },
        ],
      }));
    } catch (err) {
      patchThread(threadId, (t) => ({
        ...t,
        messages: [
          ...t.messages,
          {
            id: uid('m'),
            role: 'assistant',
            content:
              err instanceof Error
                ? `I couldn’t reach the Funke server (${err.message}). Is npm run start up on :4310?`
                : 'I couldn’t reach the Funke server. Is npm run start up on :4310?',
            createdAt: Date.now(),
          },
        ],
      }));
    } finally {
      setSending(false);
    }
  };

  const retryAssistant = async (msgId: string) => {
    if (sending || !active) return;
    const idx = active.messages.findIndex((m) => m.id === msgId);
    if (idx < 0 || active.messages[idx]?.role !== 'assistant') return;
    const prior = [...active.messages.slice(0, idx)].reverse().find((m) => m.role === 'user');
    if (!prior) return;
    setSending(true);
    try {
      const { reply: replyText } = await askFunkeDetailed(prior.content);
      updateActive((t) => {
        const next = [...t.messages];
        next[idx] = { ...next[idx]!, content: replyText, createdAt: Date.now() };
        return { ...t, messages: next };
      });
    } catch (err) {
      updateActive((t) => {
        const next = [...t.messages];
        next[idx] = {
          ...next[idx]!,
          content:
            err instanceof Error
              ? `Retry failed (${err.message}).`
              : 'Retry failed. Check that the server is running.',
          createdAt: Date.now(),
        };
        return { ...t, messages: next };
      });
    } finally {
      setSending(false);
    }
  };

  const startEdit = (msg: Message) => {
    if (msg.role !== 'user') return;
    setEditingId(msg.id);
    setEditDraft(msg.content);
  };

  const saveEdit = () => {
    if (!editingId) return;
    const text = editDraft.trim();
    if (!text) return;
    updateActive((t) => ({
      ...t,
      messages: t.messages.map((m) => (m.id === editingId ? { ...m, content: text } : m)),
      title: titleFromMessages(
        t.messages.map((m) => (m.id === editingId ? { ...m, content: text } : m)),
      ),
    }));
    setEditingId(null);
    setEditDraft('');
  };

  const copyMsg = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      /* ignore */
    }
  };

  if (!active) return null;

  const sorted = [...threads].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="chat-layout">
      <aside className={`chat-sidebar${sidebarOpen ? ' is-open' : ''}`} aria-label="Previous chats">
        <div className="chat-sidebar-head">
          <span className="chat-sidebar-label">Chats</span>
          <button type="button" className="chat-icon-btn" aria-label="New chat" title="New chat" onClick={newChat}>
            <Glyph name="plus" />
          </button>
        </div>
        <ul className="chat-thread-list">
          {sorted.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className={`chat-thread${t.id === active.id ? ' is-active' : ''}`}
                onClick={() => {
                  setActiveId(t.id);
                  setEditingId(null);
                  setMenuOpen(false);
                }}
              >
                <span className="chat-thread-title">{t.title}</span>
                <span className="chat-thread-meta">
                  {new Date(t.updatedAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </button>
              <button
                type="button"
                className="chat-thread-del"
                aria-label={`Delete ${t.title}`}
                title="Delete"
                onClick={() => deleteChat(t.id)}
              >
                <Glyph name="trash" size={12} />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="chat-main">
        <div className="chat-toolbar">
          <button
            type="button"
            className="chat-icon-btn"
            aria-label={sidebarOpen ? 'Hide chat list' : 'Show chat list'}
            title="Chats"
            aria-pressed={sidebarOpen}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <Glyph name="sidebar" />
          </button>
          <div className="chat-toolbar-title">
            <h3>{active.title}</h3>
            <p>Ask Funke in plain English. Approve before anything queues.</p>
          </div>
          <div className="chat-toolbar-actions" ref={menuRef}>
            <button
              type="button"
              className="chat-icon-btn"
              aria-label="Export chat"
              title="Export Markdown"
              onClick={() => exportMarkdown(active)}
            >
              <Glyph name="export" />
            </button>
            <button
              type="button"
              className="chat-icon-btn"
              aria-label="Delete chat"
              title="Delete chat"
              onClick={() => deleteChat(active.id)}
            >
              <Glyph name="trash" />
            </button>
            <button
              type="button"
              className={`chat-icon-btn${menuOpen ? ' is-on' : ''}`}
              aria-label="More"
              aria-expanded={menuOpen}
              title="More"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <Glyph name="more" />
            </button>
            {menuOpen ? (
              <div className="chat-menu" role="menu">
                <button type="button" role="menuitem" onClick={newChat}>
                  New chat
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    exportMarkdown(active);
                    setMenuOpen(false);
                  }}
                >
                  Export Markdown…
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="is-danger"
                  onClick={() => deleteChat(active.id)}
                >
                  Delete chat
                </button>
                {onClose ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onClose();
                    }}
                  >
                    Close window
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="chat-messages" ref={listRef}>
          {active.messages.map((m) => (
            <article key={m.id} className={`chat-bubble chat-bubble--${m.role}`}>
              <header className="chat-bubble-head">
                <span>
                  {m.role === 'assistant' ? 'Funke' : 'You'}
                  {m.via === 'voice' ? (
                    <span className="chat-via" title="Spoken">
                      <Glyph name="mic" size={9} />
                    </span>
                  ) : null}
                </span>
                <time dateTime={new Date(m.createdAt).toISOString()}>
                  {new Date(m.createdAt).toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </time>
              </header>

              {editingId === m.id ? (
                <div className="chat-edit">
                  <textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    rows={3}
                    aria-label="Edit message"
                  />
                  <div className="chat-edit-actions">
                    <button type="button" className="mac-btn" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                    <button type="button" className="mac-btn mac-btn-primary" onClick={saveEdit}>
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <p className="chat-bubble-body">{m.content}</p>
              )}

              {editingId !== m.id ? (
                <div className="chat-bubble-actions">
                  <button type="button" className="chat-mini" onClick={() => copyMsg(m.content)} title="Copy">
                    <Glyph name="copy" size={12} />
                    <span>Copy</span>
                  </button>
                  {m.role === 'user' ? (
                    <button type="button" className="chat-mini" onClick={() => startEdit(m)} title="Edit">
                      <Glyph name="edit" size={12} />
                      <span>Edit</span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="chat-mini"
                        onClick={() => void voice().speak(m.content)}
                        title="Read aloud"
                      >
                        <Glyph name="speak" size={12} />
                        <span>Read</span>
                      </button>
                      <button
                        type="button"
                        className="chat-mini"
                        onClick={() => void retryAssistant(m.id)}
                        title="Retry"
                      >
                        <Glyph name="retry" size={12} />
                        <span>Retry</span>
                      </button>
                    </>
                  )}
                </div>
              ) : null}
            </article>
          ))}
        </div>

        {active.messages.every((m) => m.role === 'assistant') ? (
          <div className="chat-suggest" aria-label="Suggestions">
            {SUGGESTIONS.map((q) => (
              <button key={q} type="button" className="chip" onClick={() => void send(q)} disabled={sending}>
                {q}
              </button>
            ))}
          </div>
        ) : null}

        <div className="chat-composer">
          <label className="sr-only" htmlFor="chatAsk">
            Message to Funke
          </label>
          <textarea
            ref={inputRef}
            id="chatAsk"
            rows={2}
            placeholder="Ask Funke anything…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            disabled={sending}
          />
          <div className="chat-composer-bar">
            <button
              type="button"
              className={`chat-mic${voiceSnap?.talkOn ? ' is-on' : ''}`}
              aria-pressed={!!voiceSnap?.talkOn}
              aria-label={voiceSnap?.talkOn ? 'Stop talking' : 'Talk to Funke'}
              title={voiceSnap?.talkOn ? 'Stop talking' : 'Talk'}
              onClick={() => void voice().toggleTalk()}
            >
              <Glyph name="mic" size={13} />
            </button>
            <span className="chat-composer-hint">
              {sending
                ? 'Funke is thinking…'
                : voiceSnap?.talkOn
                  ? voiceSnap.state === 'hearing'
                    ? 'Hearing you…'
                    : voiceSnap.state === 'thinking'
                      ? 'Working on it…'
                      : 'Listening. Your words appear here.'
                  : 'Enter to send · Shift+Enter for newline'}
            </span>
            <button
              type="button"
              className="mac-btn mac-btn-primary chat-send"
              aria-label="Send"
              disabled={!draft.trim() || sending}
              onClick={() => void send()}
            >
              <Glyph name="send" size={13} />
              <span>{sending ? '…' : 'Send'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
