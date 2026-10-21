import { DateTime } from 'luxon';
import { env } from '../config/env.ts';

/** Common abbreviations people type. Prefer IANA when the model returns it. */
const ABBREV: Record<string, string> = {
  WAT: 'Africa/Lagos',
  GMT: 'Etc/GMT',
  UTC: 'UTC',
  EST: 'America/New_York',
  EDT: 'America/New_York',
  ET: 'America/New_York',
  CST: 'America/Chicago',
  CDT: 'America/Chicago',
  CT: 'America/Chicago',
  MST: 'America/Denver',
  MDT: 'America/Denver',
  PST: 'America/Los_Angeles',
  PDT: 'America/Los_Angeles',
  PT: 'America/Los_Angeles',
  BST: 'Europe/London',
  CET: 'Europe/Berlin',
  CEST: 'Europe/Berlin',
};

export function homeTimezone(): string {
  return env.homeTimezone || 'Africa/Lagos';
}

export function resolveTimezone(raw: string | null | undefined, fallback = homeTimezone()): string {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const upper = trimmed.toUpperCase();
  if (ABBREV[upper]) return ABBREV[upper];

  const lower = trimmed.toLowerCase();
  if (/central/.test(lower)) return 'America/Chicago';
  if (/eastern/.test(lower)) return 'America/New_York';
  if (/pacific/.test(lower)) return 'America/Los_Angeles';
  if (/mountain/.test(lower)) return 'America/Denver';
  if (/lagos|west africa|wat/.test(lower)) return 'Africa/Lagos';
  if (/london|bst|uk/.test(lower)) return 'Europe/London';

  if (DateTime.now().setZone(trimmed).isValid) return trimmed;
  return fallback;
}

/**
 * Parse a wall time that was stated in `sourceTz` and return:
 * - utcIso for storage / reminders
 * - homeLocal for confirmation in the user's calendar timezone
 */
export function convertWallTime(opts: {
  isoOrLocal: string;
  sourceTz?: string | null;
  homeTz?: string;
}): {
  ok: boolean;
  utcIso: string;
  homeLocal: string;
  sourceLocal: string;
  sourceTz: string;
  homeTz: string;
  error?: string;
} {
  const homeTz = opts.homeTz ?? homeTimezone();
  const sourceTz = resolveTimezone(opts.sourceTz, homeTz);
  const raw = opts.isoOrLocal.trim();

  let dt: DateTime;
  if (/Z$|[+-]\d{2}:\d{2}$/.test(raw)) {
    dt = DateTime.fromISO(raw, { setZone: true });
  } else {
    dt = DateTime.fromISO(raw, { zone: sourceTz });
    if (!dt.isValid) {
      dt = DateTime.fromSQL(raw, { zone: sourceTz });
    }
  }

  if (!dt.isValid) {
    return {
      ok: false,
      utcIso: '',
      homeLocal: '',
      sourceLocal: '',
      sourceTz,
      homeTz,
      error: dt.invalidReason ?? 'could not parse that time',
    };
  }

  const utc = dt.toUTC();
  const home = utc.setZone(homeTz);
  const source = utc.setZone(sourceTz);

  return {
    ok: true,
    utcIso: utc.toISO()!,
    homeLocal: home.toFormat("ccc d LLL yyyy, HH:mm ZZZZ"),
    sourceLocal: source.toFormat("ccc d LLL yyyy, HH:mm ZZZZ"),
    sourceTz,
    homeTz,
  };
}

export function nowUtcIso(): string {
  return DateTime.utc().toISO()!;
}
