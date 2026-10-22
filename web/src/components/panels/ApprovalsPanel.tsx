import { useCallback, useState } from 'react';
import { decideApproval, fetchApprovals, type ApprovalCard } from '../../lib/api';
import { Glyph } from '../Icon';
import { PanelState, useLive } from './shared';

function kindLabel(actionType: string): string {
  const [area] = actionType.split('.');
  switch (area) {
    case 'content':
      return 'Post';
    case 'calendar':
      return 'Calendar';
    case 'email':
      return 'Email';
    case 'reminder':
      return 'Reminder';
    default:
      return area ? area[0]!.toUpperCase() + area.slice(1) : 'Action';
  }
}

function Card({ card, onDone }: { card: ApprovalCard; onDone: (msg: string) => void }) {
  const [busy, setBusy] = useState<'approved' | 'rejected' | null>(null);
  const [open, setOpen] = useState(false);

  const decide = async (decision: 'approved' | 'rejected') => {
    setBusy(decision);
    try {
      const out = await decideApproval(card.id, decision);
      onDone(out.reply || (decision === 'approved' ? 'Approved.' : 'Rejected.'));
    } catch (err) {
      onDone(err instanceof Error ? err.message : 'That did not go through.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="acard">
      <div className="acard-head">
        <span className="acard-kind">{kindLabel(card.actionType)}</span>
        <h4>{card.title}</h4>
      </div>
      <p className="acard-summary">{card.summary}</p>
      {card.preview ? (
        <>
          <button type="button" className="acard-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? 'Hide preview' : 'Show preview'}
          </button>
          {open ? <pre className="acard-preview">{card.preview}</pre> : null}
        </>
      ) : null}
      <div className="acard-actions">
        <button type="button" className="mac-btn" disabled={!!busy} onClick={() => void decide('rejected')}>
          {busy === 'rejected' ? 'Rejecting…' : 'Reject'}
        </button>
        <button
          type="button"
          className="mac-btn mac-btn-primary mac-btn-go"
          disabled={!!busy}
          onClick={() => void decide('approved')}
        >
          <Glyph name="check" size={12} />
          <span>{busy === 'approved' ? 'Approving…' : 'Approve'}</span>
        </button>
      </div>
    </li>
  );
}

export default function ApprovalsPanel() {
  const load = useCallback(() => fetchApprovals(), []);
  const { data, error, loading, refresh } = useLive(load, {
    every: 20_000,
    events: ['funke:approvals-changed', 'funke:turn'],
  });
  const [toast, setToast] = useState('');

  return (
    <div className="app-panel">
      <p className="panel-note">
        <Glyph name="approvals" size={11} /> Nothing leaves Funke until you approve it here. Voice can’t approve.
      </p>
      {toast ? (
        <p className="panel-toast" role="status">
          {toast}
        </p>
      ) : null}
      <PanelState
        loading={loading}
        error={error}
        empty={!data?.length}
        emptyIcon="approvals"
        emptyTitle="You’re all caught up."
        emptyBody="Drafts and actions that need a yes from you will wait here."
      >
        <ul className="acards">
          {(data ?? []).map((c) => (
            <Card
              key={c.id}
              card={c}
              onDone={(msg) => {
                setToast(msg);
                void refresh();
              }}
            />
          ))}
        </ul>
      </PanelState>
    </div>
  );
}
