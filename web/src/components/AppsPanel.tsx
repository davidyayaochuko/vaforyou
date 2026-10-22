import { APPS, type AppKey } from '../lib/dock';
import { icons, type IconName } from '../lib/icons';

type Props = {
  onOpenApp: (key: AppKey) => void;
};

function Glyph({ name }: { name: IconName }) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d={icons[name]} fillRule="evenodd" />
    </svg>
  );
}

/** Launcher: list of things Funke can do. Picking one opens that panel. */
export default function AppsPanel({ onOpenApp }: Props) {
  return (
    <div className="apps-panel">
      <p className="apps-lead">What do you want to do?</p>
      <ul className="apps-list">
        {APPS.map((app) => (
          <li key={app.key}>
            <button
              type="button"
              className="apps-row"
              onClick={() => onOpenApp(app.key)}
            >
              <span className="apps-row-icon" style={{ background: app.color }} aria-hidden>
                <Glyph name={app.key} />
              </span>
              <span className="apps-row-copy">
                <span className="apps-row-title">{app.title}</span>
                <span className="apps-row-blurb">{app.blurb}</span>
              </span>
              <span className="apps-row-chev" aria-hidden>
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
