import { icons, iconFaces, type IconName } from '../lib/icons';

type GlyphProps = {
  name: IconName;
  size?: number;
  className?: string;
};

/** Plain filled glyph. */
export function Glyph({ name, size = 18, className = '' }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d={icons[name]} fillRule="evenodd" />
    </svg>
  );
}

type TileProps = {
  name: IconName;
  size?: number;
  face?: string;
  className?: string;
  label?: string;
};

/**
 * Soft “fluffy” app tile: continuous corner, gradient face,
 * specular highlight, soft drop shadow.
 */
export function IconTile({
  name,
  size = 50,
  face,
  className = '',
  label,
}: TileProps) {
  const colors = iconFaces[face ?? name] ?? iconFaces.funke!;
  const radius = Math.round(size * 0.22);

  return (
    <span
      className={`icon-tile ${className}`.trim()}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: `linear-gradient(160deg, ${colors.from} 0%, ${colors.to} 100%)`,
      }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className="icon-tile-sheen" aria-hidden />
      <span className="icon-tile-glyph">
        <Glyph name={name} size={Math.round(size * 0.48)} />
      </span>
    </span>
  );
}
