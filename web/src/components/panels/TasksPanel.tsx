import { useCallback, useState } from 'react';
import {
  completeTask,
  fetchToday,
  prioritiseTasks,
  type CalendarEvent,
  type VaTask,
} from '../../lib/api';
import { appMeta } from '../../lib/dock';
import { Glyph } from '../Icon';
import { PanelState, QuickAsk, TryChips, dayLabel, isPast, parseWhen, timeLabel, useLive } from './shared';

function kindLabel(kind: string): string {
  if (kind === 'reminder') return 'Reminder';
  if (kind === 'follow_up') return 'Follow-up';
  return 'Task';
}

export default function TasksPanel() {
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(() => fetchToday(), []);
  const { data, error, loading, refresh } = useLive(load, {
    every: 30_000,
    events: ['funke:turn', 'funke:approvals-changed'],
  });

  const tasks = data?.tasks ?? [];
  const events = data?.events ?? [];
  const approvals = data?.approvals ?? [];
  const overdue = tasks.filter((t) => isPast(parseWhen(t.due_at)));
  const upcoming = tasks.filter((t) => !isPast(parseWhen(t.due_at)));

  const onComplete = async (id: number) => {
    setBusy(`c${id}`);
    try {
      await completeTask(id);
      setToast('Marked done.');
      await refresh();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Could not complete.');
    } finally {
      setBusy(null);
    }
  };

  const onPrioritise = async () => {
    setBusy('rank');
    try {
      await prioritiseTasks();
      setToast('Reordered by due date and importance.');
      await refresh();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Could not prioritise.');
    } finally {
      setBusy(null);
    }
  };

  const taskRows = (title: string, rows: VaTask[], tone?: 'warn') =>
    rows.length ? (
      <section className="plist-section">
        <h4 className={tone === 'warn' ? 'is-warn' : ''}>
          {title} <span>{rows.length}</span>
        </h4>
        <ul className="plist">
          {rows.map((t) => {
            const when = parseWhen(t.due_at);
            return (
              <li key={t.id} className={`prow${isPast(when) ? ' is-overdue' : ''}`}>
                <span className={`prow-dot prow-dot--${t.kind === 'follow_up' ? 'follow-up' : 'reminder'}`} aria-hidden />
                <span className="prow-main">
                  <span className="prow-title">{t.title}</span>
                  <span className="prow-meta">
                    {kindLabel(t.kind)}
                    {when ? ` · ${dayLabel(when)}, ${timeLabel(when)}` : ''}
                  </span>
                </span>
                <button
                  type="button"
                  className="prow-action"
                  disabled={busy === `c${t.id}`}
                  onClick={() => void onComplete(t.id)}
                >
                  <Glyph name="check" size={12} /> Done
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    ) : null;

  const meetingRows = (rows: CalendarEvent[]) =>
    rows.length ? (
      <section className="plist-section">
        <h4>
          Meetings <span>{rows.length}</span>
        </h4>
        <ul className="plist">
          {rows.slice(0, 8).map((e) => {
            const when = parseWhen(e.start_at);
            return (
              <li key={e.id} className="prow">
                <span className="prow-dot prow-dot--meeting" aria-hidden />
                <span className="prow-main">
                  <span className="prow-title">{e.title}</span>
                  <span className="prow-meta">
                    {when ? `${dayLabel(when)}, ${timeLabel(when)}` : 'When TBA'}
                    {e.location ? ` · ${e.location}` : ''}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    ) : null;

  const empty = !tasks.length && !events.length && !approvals.length;

  return (
    <div className="app-panel">
      <QuickAsk placeholder="Remind me tomorrow at 9am to…" onDone={() => void refresh()} />
      <div className="panel-toolbar">
        <button type="button" className="panel-btn" disabled={busy === 'rank' || !tasks.length} onClick={() => void onPrioritise()}>
          Prioritise my day
        </button>
        {approvals.length ? (
          <button
            type="button"
            className="panel-btn panel-btn--accent"
            onClick={() => window.dispatchEvent(new CustomEvent('funke:open', { detail: { panel: 'approvals' } }))}
          >
            {approvals.length} waiting on you
          </button>
        ) : null}
      </div>
      {toast ? (
        <p className="panel-toast" role="status">
          {toast}
        </p>
      ) : null}
      <PanelState
        loading={loading}
        error={error}
        empty={empty}
        emptyIcon="tasks"
        emptyTitle="Nothing on your plate."
        emptyBody="Tell Funke what to remember, and it shows up here with today’s meetings."
      >
        {approvals.length ? (
          <section className="plist-section">
            <h4 className="is-warn">
              Approvals <span>{approvals.length}</span>
            </h4>
            <ul className="plist">
              {approvals.slice(0, 5).map((a) => (
                <li key={a.id} className="prow">
                  <span className="prow-dot prow-dot--approval" aria-hidden />
                  <span className="prow-main">
                    <span className="prow-title">{a.title}</span>
                    <span className="prow-meta">{a.summary}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {taskRows('Overdue', overdue, 'warn')}
        {meetingRows(events)}
        {taskRows('Coming up', upcoming)}
      </PanelState>
      <TryChips asks={appMeta('tasks').tryAsks} />
    </div>
  );
}
