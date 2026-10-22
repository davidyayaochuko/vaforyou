import { APPS, type AppGroup, type AppKey } from '../lib/dock';
import { IconTile } from './Icon';

type Props = {
  onOpenApp: (key: AppKey) => void;
};

const GROUPS: AppGroup[] = ['Everyday', 'Communication', 'Coming soon'];

/** Launcher: a grid of everything Funke can do, grouped by area. */
export default function AppsPanel({ onOpenApp }: Props) {
  return (
    <div className="apps-panel">
      <p className="apps-lead">What do you want to do?</p>
      {GROUPS.map((group) => {
        const apps = APPS.filter((a) => a.group === group);
        if (!apps.length) return null;
        return (
          <section key={group} className="apps-group">
            <h4 className="apps-group-title">{group}</h4>
            <ul className="apps-grid">
              {apps.map((app, i) => (
                <li key={app.key} style={{ animationDelay: `${i * 35}ms` }}>
                  <button
                    type="button"
                    className={`apps-cell${app.live ? '' : ' is-soon'}`}
                    onClick={() => onOpenApp(app.key)}
                    title={app.blurb}
                  >
                    <IconTile name={app.icon} face={app.key} size={56} className="apps-cell-tile" />
                    <span className="apps-cell-title">{app.title}</span>
                    <span className="apps-cell-blurb">{app.blurb}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
