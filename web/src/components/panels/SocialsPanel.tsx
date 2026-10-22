import { useCallback } from 'react';
import { fetchAccounts, fetchHealth } from '../../lib/api';
import { appMeta } from '../../lib/dock';
import { Glyph } from '../Icon';
import { PanelState, TryChips, useLive } from './shared';

const STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'mut' }> = {
  ok: { label: 'Connected', tone: 'ok' },
  logged_out: { label: 'Needs login', tone: 'warn' },
  checkpoint: { label: 'Needs a check', tone: 'warn' },
  unknown: { label: 'Not checked yet', tone: 'mut' },
};

export default function SocialsPanel() {
  const load = useCallback(async () => {
    const [accounts, health] = await Promise.all([fetchAccounts(), fetchHealth()]);
    return { accounts, engineOn: !!health.engine?.running };
  }, []);
  const { data, error, loading } = useLive(load, { every: 30_000 });

  return (
    <div className="app-panel">
      <div className={`engine-strip${data?.engineOn ? ' is-on' : ''}`}>
        <span className="status-dot" data-on={data?.engineOn ? '1' : '0'} />
        <span>
          Social engine is <strong>{data?.engineOn ? 'on' : 'off'}</strong>.{' '}
          {data?.engineOn
            ? 'Approved posts publish on schedule.'
            : 'Nothing posts while it is off. Start it from the classic dashboard.'}
        </span>
      </div>
      <PanelState
        loading={loading}
        error={error}
        empty={!data?.accounts.length}
        emptyIcon="socials"
        emptyTitle="No social accounts yet."
        emptyBody="Run npm run login to connect LinkedIn, X or Bluesky. Funke never types your password."
      >
        <ul className="plist">
          {(data?.accounts ?? []).map((a) => {
            const st = STATUS[a.status] ?? { label: a.status, tone: 'mut' as const };
            return (
              <li key={a.id} className="prow">
                <span className="prow-avatar" aria-hidden>
                  {a.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="prow-main">
                  <span className="prow-title">{a.name}</span>
                  {a.platform ? <span className="prow-meta">{a.platform}</span> : null}
                </span>
                <span className={`pill pill--${st.tone}`}>{st.label}</span>
              </li>
            );
          })}
        </ul>
      </PanelState>
      <a className="panel-link" href="http://127.0.0.1:4310/" target="_blank" rel="noreferrer">
        <Glyph name="export" size={12} /> Open the classic dashboard for drafts, queue and engine controls
      </a>
      <TryChips asks={appMeta('socials').tryAsks} />
    </div>
  );
}
