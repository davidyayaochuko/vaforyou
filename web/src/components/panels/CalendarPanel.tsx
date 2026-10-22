import { useCallback } from 'react';
import { fetchVaStatus, type CalendarEvent } from '../../lib/api';
import { appMeta } from '../../lib/dock';
import { Glyph } from '../Icon';
import { PanelState, QuickAsk, TryChips, dayLabel, isPast, parseWhen, timeLabel, useLive } from './shared';

type Group = { label: string; items: { ev: CalendarEvent; start: Date; end: Date | null }[] };

export default function CalendarPanel() {
  const load = useCallback(async () => {
    const s = await fetchVaStatus();
    return { events: s.events ?? [], tz: s.homeTimezone ?? '' };
  }, []);
  const { data, error, loading, refresh } = useLive(load, { every: 60_000, events: ['funke:turn'] });

  const groups: Group[] = [];
  for (const ev of data?.events ?? []) {
    const start = parseWhen(ev.start_at);
    if (!start) continue;
    const label = dayLabel(start);
    let g = groups.find((x) => x.label === label);
    if (!g) groups.push((g = { label, items: [] }));
    g.items.push({ ev, start, end: parseWhen(ev.end_at) });
  }

  return (
    <div className="app-panel">
      <QuickAsk placeholder="Book a call with Chioma Thursday at 3pm…" onDone={() => void refresh()} />
      {data?.tz ? (
        <p className="panel-note">
          <Glyph name="clock" size={11} /> Times shown in your browser’s timezone. Home timezone: {data.tz}.
        </p>
      ) : null}
      <PanelState
        loading={loading}
        error={error}
        empty={!groups.length}
        emptyIcon="calendar"
        emptyTitle="No meetings coming up."
        emptyBody="Paste an invite into Chat or ask Funke to book something."
      >
        {groups.map((g) => (
          <section key={g.label} className="plist-section">
            <h4>{g.label}</h4>
            <ul className="plist">
              {g.items.map(({ ev, start, end }) => (
                <li key={ev.id} className={`prow prow--event${isPast(end ?? start) ? ' is-past' : ''}`}>
                  <span className="prow-time">
                    <strong>{timeLabel(start)}</strong>
                    {end ? <span>{timeLabel(end)}</span> : null}
                  </span>
                  <span className="prow-bar" aria-hidden />
                  <span className="prow-main">
                    <span className="prow-title">{ev.title}</span>
                    {ev.location ? <span className="prow-meta">{ev.location}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </PanelState>
      <TryChips asks={appMeta('calendar').tryAsks} />
    </div>
  );
}
