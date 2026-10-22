import { useCallback, useEffect, useState } from 'react';
import {
  DOCK_KEYS,
  appMeta,
  isDockKey,
  normalizePanelKey,
  type AppKey,
  type DockKey,
  type PanelKey,
} from '../lib/dock';
import AppsPanel from './AppsPanel';
import ChatPanel from './ChatPanel';
import { Glyph } from './Icon';
import TasksPanel from './panels/TasksPanel';
import CalendarPanel from './panels/CalendarPanel';
import ApprovalsPanel from './panels/ApprovalsPanel';
import SocialsPanel from './panels/SocialsPanel';
import ComingSoonPanel from './panels/ComingSoonPanel';

function panelFromUrl(): PanelKey | null {
  if (typeof window === 'undefined') return null;
  return normalizePanelKey(new URLSearchParams(window.location.search).get('panel'));
}

function writePanelUrl(next: PanelKey | null) {
  const url = new URL(window.location.href);
  if (next) url.searchParams.set('panel', next);
  else url.searchParams.delete('panel');
  window.history.replaceState({}, '', url);
}

/** Which dock icon lights up: its own key, or Apps for launcher-only destinations. */
function dockHighlightFor(open: PanelKey | null): DockKey | null {
  if (!open) return null;
  return isDockKey(open) ? open : 'apps';
}

function title(key: PanelKey): string {
  return key === 'apps' ? 'Apps' : appMeta(key).title;
}

function Body({ open, onOpen, onClose }: { open: PanelKey; onOpen: (k: PanelKey) => void; onClose: () => void }) {
  switch (open) {
    case 'apps':
      return <AppsPanel onOpenApp={(k: AppKey) => onOpen(k)} />;
    case 'chat':
      return <ChatPanel onClose={onClose} />;
    case 'tasks':
      return <TasksPanel />;
    case 'calendar':
      return <CalendarPanel />;
    case 'approvals':
      return <ApprovalsPanel />;
    case 'socials':
      return <SocialsPanel />;
    default:
      return <ComingSoonPanel app={appMeta(open)} />;
  }
}

export default function PanelHost() {
  const [open, setOpen] = useState<PanelKey | null>(null);

  const go = useCallback((next: PanelKey | null) => {
    setOpen(next);
    writePanelUrl(next);
  }, []);

  useEffect(() => {
    setOpen(panelFromUrl());
  }, []);

  useEffect(() => {
    const onClick = (e: Event) => {
      const btn = (e.target as HTMLElement | null)?.closest?.('[data-dock]') as HTMLElement | null;
      if (!btn) return;
      const key = normalizePanelKey(btn.getAttribute('data-dock'));
      if (!key) return;
      setOpen((prev) => {
        const resolved = prev === key ? null : key;
        writePanelUrl(resolved);
        return resolved;
      });
    };
    const onOpenEvent = (e: Event) => {
      const key = normalizePanelKey((e as CustomEvent<{ panel?: string }>).detail?.panel);
      if (key) go(key);
    };
    document.addEventListener('click', onClick);
    window.addEventListener('funke:open', onOpenEvent);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener('funke:open', onOpenEvent);
    };
  }, [go]);

  useEffect(() => {
    const highlight = dockHighlightFor(open);
    document.querySelectorAll('[data-dock]').forEach((el) => {
      if (!el.classList.contains('dock-item')) return;
      const key = el.getAttribute('data-dock');
      const active = key === highlight;
      el.classList.toggle('is-open', active);
      if (active) el.setAttribute('aria-current', 'true');
      else el.removeAttribute('aria-current');
    });
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        go(null);
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        go(open === 'chat' ? null : 'chat');
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= DOCK_KEYS.length) {
        e.preventDefault();
        const key = DOCK_KEYS[n - 1]!;
        go(open === key ? null : key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, go]);

  if (!open) return null;

  const isLauncherChild = open !== 'apps' && !isDockKey(open);
  const wide = open === 'chat' ? ' panel-window--chat' : open === 'apps' ? ' panel-window--apps' : ' panel-window--app';

  return (
    <div
      className="panel-host"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) go(null);
      }}
    >
      <div
        className={`panel-window${wide}`}
        role="dialog"
        aria-modal="true"
        aria-label={title(open)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="panel-titlebar">
          <div className="traffic">
            <button type="button" className="traffic-btn traffic-close" aria-label="Close window" onClick={() => go(null)}>
              <Glyph name="close" size={7} />
            </button>
            <span className="traffic-btn traffic-min" aria-hidden="true" />
            <span className="traffic-btn traffic-zoom" aria-hidden="true" />
          </div>
          {isLauncherChild ? (
            <button type="button" className="panel-back" onClick={() => go('apps')} aria-label="Back to Apps">
              <Glyph name="chevron" size={11} className="flip-x" />
              <span>Apps</span>
            </button>
          ) : null}
          <h2 className="panel-title">{title(open)}</h2>
        </div>
        <div className={`panel-body panel-body--${open === 'chat' ? 'chat' : open === 'apps' ? 'apps' : 'app'}`}>
          <Body open={open} onOpen={go} onClose={() => go(null)} />
        </div>
      </div>
    </div>
  );
}
