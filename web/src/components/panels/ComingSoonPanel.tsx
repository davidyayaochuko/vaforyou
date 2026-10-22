import type { AppMeta } from '../../lib/dock';
import { Glyph, IconTile } from '../Icon';
import { TryChips } from './shared';

export default function ComingSoonPanel({ app }: { app: AppMeta }) {
  return (
    <div className="app-panel soon">
      <div className="soon-hero">
        <IconTile name={app.icon} face={app.key} size={64} className="soon-tile" />
        <div>
          <span className="pill pill--mut">Coming soon</span>
          <h3>{app.title}</h3>
          <p>{app.blurb}</p>
        </div>
      </div>
      {app.plans?.length ? (
        <ul className="soon-plans">
          {app.plans.map((p) => (
            <li key={p}>
              <Glyph name="sparkle" size={12} />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {app.tryAsks?.length ? <p className="soon-try">You can already try this in Chat:</p> : null}
      <TryChips asks={app.tryAsks} />
    </div>
  );
}
