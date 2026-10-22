import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { askFunkeDetailed, openChatWith } from '../../lib/api';
import { Glyph } from '../Icon';
import type { IconName } from '../../lib/icons';

/** Load once, refresh on an interval and on named window events. */
export function useLive<T>(load: () => Promise<T>, opts: { every?: number; events?: string[] } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setData(await load());
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void refresh();
    const id = opts.every ? window.setInterval(() => void refresh(), opts.every) : 0;
    const evs = opts.events ?? [];
    const on = () => void refresh();
    evs.forEach((e) => window.addEventListener(e, on));
    return () => {
      if (id) window.clearInterval(id);
      evs.forEach((e) => window.removeEventListener(e, on));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  return { data, error, loading, refresh };
}

export function PanelState({
  loading,
  error,
  empty,
  emptyIcon = 'sparkle',
  emptyTitle,
  emptyBody,
  children,
}: {
  loading: boolean;
  error: string;
  empty: boolean;
  emptyIcon?: IconName;
  emptyTitle: string;
  emptyBody?: string;
  children: ReactNode;
}) {
  if (loading) {
    return (
      <div className="pstate" aria-busy="true">
        <span className="pstate-spinner" aria-hidden />
        <span>Loading…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="pstate pstate--error" role="alert">
        <strong>Funke’s server isn’t answering.</strong>
        <span>{error}</span>
        <code>npm run start</code>
      </div>
    );
  }
  if (empty) {
    return (
      <div className="pstate pstate--empty">
        <span className="pstate-icon">
          <Glyph name={emptyIcon} size={20} />
        </span>
        <strong>{emptyTitle}</strong>
        {emptyBody ? <span>{emptyBody}</span> : null}
      </div>
    );
  }
  return <>{children}</>;
}

/** One-line ask box scoped to a panel ("Tell Funke what to schedule"). */
export function QuickAsk({
  placeholder,
  onDone,
}: {
  placeholder: string;
  onDone?: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState('');

  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setReply('');
    try {
      const out = await askFunkeDetailed(t);
      setReply(out.reply);
      setText('');
      onDone?.();
    } catch (err) {
      setReply(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="quick-ask">
      <form
        className="quick-ask-row"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Glyph name="sparkle" size={14} className="quick-ask-icon" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          disabled={busy}
        />
        <button type="submit" className="mac-btn mac-btn-primary" disabled={!text.trim() || busy}>
          {busy ? 'Working…' : 'Ask'}
        </button>
      </form>
      {reply ? <p className="quick-ask-reply">{reply}</p> : null}
    </div>
  );
}

export function TryChips({ asks }: { asks?: string[] }) {
  if (!asks?.length) return null;
  return (
    <div className="try-chips" aria-label="Try in Chat">
      {asks.map((a) => (
        <button key={a} type="button" className="chip" onClick={() => openChatWith(a)}>
          {a}
        </button>
      ))}
    </div>
  );
}

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function parseWhen(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso.includes('T') || iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

export function dayLabel(d: Date): string {
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(d) - start(today)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return dayFmt.format(d);
}

export function timeLabel(d: Date): string {
  return timeFmt.format(d);
}

export function isPast(d: Date | null): boolean {
  return !!d && d.getTime() < Date.now();
}
