import { useEffect, useState } from 'react';
import {
  APPS,
  DOCK_KEYS,
  isPanelKey,
  type AppKey,
  type DockKey,
  type PanelKey,
} from '../lib/dock';
import AppsPanel from './AppsPanel';
import ChatPanel from './ChatPanel';

const TITLES: Record<PanelKey, string> = {
  apps: 'Apps',
  chat: 'Chat',
  calendar: 'Calendar',
  approvals: 'Approvals',
  accounts: 'Accounts',
  pipeline: 'Pipeline',
};

function panelFromUrl(): PanelKey | null {
  if (typeof window === 'undefined') return null;
  const p = new URLSearchParams(window.location.search).get('panel');
  return isPanelKey(p) ? p : null;
}

function writePanelUrl(next: PanelKey | null) {
  const url = new URL(window.location.href);
  if (next) url.searchParams.set('panel', next);
  else url.searchParams.delete('panel');
  window.history.replaceState({}, '', url);
}

function dockHighlightFor(open: PanelKey | null): DockKey | null {
  if (!open) return null;
  if (open === 'apps') return 'apps';
  if (open === 'chat') return 'chat';
  // Launcher destinations keep Apps marked open
  return 'apps';
}

export default function PanelHost() {
  const [open, setOpen] = useState<PanelKey | null>(null);

  const close = () => {
    setOpen(null);
    writePanelUrl(null);
  };

  const openPanel = (key: PanelKey) => {
    setOpen(key);
    writePanelUrl(key);
  };

  useEffect(() => {
    setOpen(panelFromUrl());
  }, []);

  useEffect(() => {
    const onClick = (e: Event) => {
      const btn = (e.target as HTMLElement | null)?.closest?.('[data-dock]') as HTMLElement | null;
      if (!btn) return;
      const key = btn.getAttribute('data-dock');
      if (!key || !(DOCK_KEYS as string[]).includes(key)) return;
      const dockKey = key as DockKey;
      setOpen((prev) => {
        // Chat toggles itself. Apps toggles closed if Apps or any launcher app is open.
        let resolved: PanelKey | null = dockKey;
        if (dockKey === 'chat') {
          resolved = prev === 'chat' ? null : 'chat';
        } else {
          const appsSurfaceOpen = prev === 'apps' || (prev !== null && prev !== 'chat');
          resolved = appsSurfaceOpen ? null : 'apps';
        }
        writePanelUrl(resolved);
        return resolved;
      });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    const highlight = dockHighlightFor(open);
    document.querySelectorAll('[data-dock]').forEach((el) => {
      const key = el.getAttribute('data-dock');
      const active = key === highlight;
      el.classList.toggle('is-open', active);
      el.classList.toggle('is-active', key === open);
      if (active) el.setAttribute('aria-current', 'true');
      else el.removeAttribute('aria-current');
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const appMeta = APPS.find((a) => a.key === open);

  return (
    <div
      className="panel-host"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={`panel-window${open === 'chat' ? ' panel-window--chat' : ''}${open === 'apps' ? ' panel-window--apps' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={TITLES[open]}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="panel-titlebar">
          <div className="traffic" aria-hidden="true">
            <button type="button" className="traffic-btn traffic-close" aria-label="Close" onClick={close} />
            <button type="button" className="traffic-btn traffic-min" tabIndex={-1} />
            <button type="button" className="traffic-btn traffic-zoom" tabIndex={-1} />
          </div>
          <h2 className="panel-title">{TITLES[open]}</h2>
        </div>

        {open === 'apps' ? (
          <div className="panel-body panel-body--apps">
            <AppsPanel
              onOpenApp={(key: AppKey) => {
                openPanel(key);
              }}
            />
          </div>
        ) : open === 'chat' ? (
          <div className="panel-body panel-body--chat">
            <ChatPanel onClose={close} />
          </div>
        ) : (
          <div className="panel-body">
            <p>{appMeta?.blurb ?? ''}</p>
            <ul className="panel-list">
              <li>
                <span>Status</span>
                <span className="mut">Shell ready</span>
              </li>
              <li>
                <span>Wiring</span>
                <span className="mut">Next</span>
              </li>
            </ul>
            <div className="panel-actions">
              <button type="button" className="mac-btn" onClick={() => openPanel('apps')}>
                All apps
              </button>
              <button type="button" className="mac-btn" onClick={close}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
