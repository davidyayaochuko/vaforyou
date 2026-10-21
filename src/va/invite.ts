import { DateTime } from 'luxon';
import { resolveTimezone, homeTimezone, convertWallTime } from './timezone.ts';

export interface ParsedInvite {
  title: string;
  startLocal: string;
  endLocal?: string | null;
  sourceTz: string;
  location?: string | null;
  notes?: string | null;
  joinUrl?: string | null;
  passcode?: string | null;
  meetingId?: string | null;
}

/** Map phrases from Zoom/Google invites to IANA zones. */
export function detectInviteTimezone(text: string): string | null {
  const t = text.replace(/\s+/g, ' ');
  const lower = t.toLowerCase();

  const patterns: [RegExp, string][] = [
    [/central\s+time\s*\(us\s+and\s+canada\)/i, 'America/Chicago'],
    [/eastern\s+time\s*\(us\s+and\s+canada\)/i, 'America/New_York'],
    [/pacific\s+time\s*\(us\s+and\s+canada\)/i, 'America/Los_Angeles'],
    [/mountain\s+time\s*\(us\s+and\s+canada\)/i, 'America/Denver'],
    [/\bcentral\s+time\b/i, 'America/Chicago'],
    [/\beastern\s+time\b/i, 'America/New_York'],
    [/\bpacific\s+time\b/i, 'America/Los_Angeles'],
    [/\bmountain\s+time\b/i, 'America/Denver'],
    [/\bwest\s+africa\s+time\b|\bWAT\b/, 'Africa/Lagos'],
    [/\bGMT\b(?!\+)/, 'Etc/GMT'],
    [/\bUTC\b/, 'UTC'],
    [/\bEST\b|\bEDT\b|\bET\b/, 'America/New_York'],
    [/\bCST\b|\bCDT\b|\bCT\b/, 'America/Chicago'],
    [/\bPST\b|\bPDT\b|\bPT\b/, 'America/Los_Angeles'],
  ];

  for (const [re, zone] of patterns) {
    if (re.test(t) || re.test(lower)) return zone;
  }
  return null;
}

/**
 * Best-effort parse of Zoom / calendar invite paste.
 * Returns null when it does not look like an invite.
 */
export function parseMeetingInvite(text: string): ParsedInvite | null {
  const looksLike =
    /zoom\.us\/j\//i.test(text) ||
    /scheduled Zoom meeting/i.test(text) ||
    (/Topic:/i.test(text) && /Time:/i.test(text) && /Meeting ID:/i.test(text));
  if (!looksLike) return null;

  const title =
    /Topic:\s*(.+)/i.exec(text)?.[1]?.trim() ||
    /Subject:\s*(.+)/i.exec(text)?.[1]?.trim() ||
    'Meeting';

  const timeLine =
    /Time:\s*(.+)/i.exec(text)?.[1]?.trim() ||
    /When:\s*(.+)/i.exec(text)?.[1]?.trim() ||
    '';

  const joinUrl =
    /(https:\/\/[\w.-]*zoom\.us\/j\/[^\s]+)/i.exec(text)?.[1]?.trim() ||
    /(https:\/\/meet\.google\.com\/[^\s]+)/i.exec(text)?.[1]?.trim() ||
    null;

  const passcode =
    /Passcode:\s*(\S+)/i.exec(text)?.[1]?.trim() ||
    /Password:\s*(\S+)/i.exec(text)?.[1]?.trim() ||
    null;

  const meetingId =
    /Meeting ID:\s*([0-9\s]+)/i.exec(text)?.[1]?.replace(/\s+/g, ' ').trim() || null;

  const sourceTz =
    detectInviteTimezone(timeLine) ||
    detectInviteTimezone(text) ||
    homeTimezone();

  const startLocal = parseInviteWallClock(timeLine, sourceTz);
  if (!startLocal) return null;

  const notes = [
    joinUrl ? `Join: ${joinUrl}` : null,
    meetingId ? `Meeting ID: ${meetingId}` : null,
    passcode ? `Passcode: ${passcode}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    title,
    startLocal,
    endLocal: null,
    sourceTz: resolveTimezone(sourceTz),
    location: joinUrl ? 'Zoom' : null,
    notes: notes || text.slice(0, 1500),
    joinUrl,
    passcode,
    meetingId,
  };
}

/** "Oct 21, 2026 01:00 PM Central Time (US and Canada)" → 2026-10-21T13:00:00 in zone */
function parseInviteWallClock(timeLine: string, zone: string): string | null {
  if (!timeLine) return null;

  // Strip trailing zone prose so DateTime can parse the clock part.
  const cleaned = timeLine
    .replace(/\s*(Central|Eastern|Pacific|Mountain)\s+Time(?:\s*\([^)]*\))?/gi, '')
    .replace(/\s*\([^)]*US and Canada[^)]*\)/gi, '')
    .replace(/\b(WAT|EST|EDT|CST|CDT|PST|PDT|GMT|UTC)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const formats = [
    'LLL d, yyyy h:mm a',
    'LLL d, yyyy hh:mm a',
    'LLLL d, yyyy h:mm a',
    'd LLL yyyy h:mm a',
    'yyyy-LL-dd HH:mm',
    'yyyy-LL-dd\'T\'HH:mm',
  ];

  for (const fmt of formats) {
    const dt = DateTime.fromFormat(cleaned, fmt, { zone });
    if (dt.isValid) return dt.toFormat("yyyy-LL-dd'T'HH:mm:ss");
  }

  // Fallback: ISO fragment if present
  const iso = /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2})/.exec(cleaned)?.[1];
  if (iso) {
    const dt = DateTime.fromISO(iso.replace(' ', 'T'), { zone });
    if (dt.isValid) return dt.toFormat("yyyy-LL-dd'T'HH:mm:ss");
  }

  return null;
}

export function inviteToCalendarFields(invite: ParsedInvite) {
  const start = convertWallTime({
    isoOrLocal: invite.startLocal,
    sourceTz: invite.sourceTz,
  });
  return { invite, start };
}
