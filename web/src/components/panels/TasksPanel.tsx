import { useCallback } from 'react';
import { fetchVaStatus } from '../../lib/api';
import { appMeta } from '../../lib/dock';
import { Glyph } from '../Icon';
import { PanelState, QuickAsk, TryChips, dayLabel, isPast, parseWhen, timeLabel, useLive } from './shared';

type Row = {
  key: string;
  kind: 'reminder' | 'follow-up';
  title: string;
  when: Date | null;
  state: string;
};

const OPEN_STATES = new Set(['scheduled', 'pending', 'open', 'due', 'snoozed']);

export default function TasksPanel() {
  const load = useCallback(async () => {
    const s = await fetchVaStatus();
    const rows: Row[] = [
      ...(s.reminders ?? []).map((r) => ({
        key: `r${r.id}`,
        kind: 'reminder' as const,
        title: r.title,
        when: parseWhen(r.due_at),
        state: r.state,
      })),
      ...(s.followups ?? []).map((f) => ({
        key: `f${f.id}`,
        kind: 'follow-up' as const,
        title: `${f.who}: ${f.what}`,
        when: parseWhen(f.due_at),
        state: f.state,
      })),
    ];
    rows.sort((a, b) => (a.when?.getTime() ?? Infinity) - (b.when?.getTime() ?? Infinity));
    return rows;
  }, []);

  const { data, error, loading, refresh } = useLive(load, { every: 30_000, events: ['funke:turn'] });
  const open = (data ?? []).filter((r) => OPEN_STATES.has(r.state) || !r.state);
  const overdue = open.filter((r) => isPast(r.when));
  const upcoming = open.filter((r) => !isPast(r.when));
  const done = (data ?? []).filter((r) => !open.includes(r)).slice(0, 5);

  const section = (title: string, rows: Row[], tone?: 'warn') =>
    rows.length ? (
      <section className="plist-section">
        <h4 className={tone === 'warn' ? 'is-warn' : ''}>
          {title} <span>{rows.length}</span>
        </h4>
        <ul className="plist">
          {rows.map((r) => (
            <li key={r.key} className={`prow${isPast(r.when) && OPEN_STATES.has(r.state) ? ' is-overdue' : ''}`}>
              <span className={`prow-dot prow-dot--${r.kind}`} aria-hidden />
              <span className="prow-main">
                <span className="prow-title">{r.title}</span>
                <span className="prow-meta">
                  {r.kind === 'reminder' ? 'Reminder' : 'Follow-up'}
                  {r.when ? ` · ${dayLabel(r.when)}, ${timeLabel(r.when)}` : ''}
                </span>
              </span>
              {!OPEN_STATES.has(r.state) && r.state ? (
                <span className="prow-badge">
                  <Glyph name="check" size={10} /> {r.state}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  return (
    <div className="app-panel">
      <QuickAsk placeholder="Remind me tomorrow at 9am to…" onDone={() => void refresh()} />
      <PanelState
        loading={loading}
        error={error}
        empty={!data?.length}
        emptyIcon="tasks"
        emptyTitle="Nothing on your plate."
        emptyBody="Tell Funke what to remember, and it shows up here."
      >
        {section('Overdue', overdue, 'warn')}
        {section('Coming up', upcoming)}
        {section('Recently done', done)}
      </PanelState>
      <TryChips asks={appMeta('tasks').tryAsks} />
    </div>
  );
}
