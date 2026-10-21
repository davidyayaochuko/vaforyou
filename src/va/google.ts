import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { google } from 'googleapis';
import { env } from '../config/env.ts';
import { homeTimezone } from './timezone.ts';

const tokenPath = () => join(dirname(env.dbPath), 'google-token.json');

export function googleConfigured(): boolean {
  return Boolean(env.googleClientId && env.googleClientSecret);
}

export function googleConnected(): boolean {
  return existsSync(tokenPath());
}

function oauthClient(redirectUri?: string) {
  return new google.auth.OAuth2(
    env.googleClientId,
    env.googleClientSecret,
    redirectUri || `http://${env.bindHost}:${env.port}/api/google/callback`,
  );
}

export function googleAuthUrl(): string {
  if (!googleConfigured()) {
    throw new Error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first');
  }
  const client = oauthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'openid',
      'email',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.readonly',
    ],
  });
}

export async function exchangeGoogleCode(code: string): Promise<{ email?: string }> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  mkdirSync(dirname(tokenPath()), { recursive: true });
  writeFileSync(tokenPath(), JSON.stringify(tokens, null, 2), { mode: 0o600 });

  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const me = await oauth2.userinfo.get().catch(() => null);
  return { email: me?.data?.email ?? undefined };
}

function loadAuthedClient() {
  if (!googleConfigured() || !googleConnected()) return null;
  const client = oauthClient();
  const tokens = JSON.parse(readFileSync(tokenPath(), 'utf8'));
  client.setCredentials(tokens);
  client.on('tokens', (fresh) => {
    const merged = { ...tokens, ...fresh };
    writeFileSync(tokenPath(), JSON.stringify(merged, null, 2), { mode: 0o600 });
  });
  return client;
}

export async function createGoogleEvent(opts: {
  title: string;
  startUtc: string;
  endUtc?: string | null;
  description?: string | null;
  location?: string | null;
}): Promise<{ ok: true; id: string; htmlLink?: string } | { ok: false; error: string }> {
  const auth = loadAuthedClient();
  if (!auth) return { ok: false, error: 'Google Calendar is not connected' };

  try {
    const calendar = google.calendar({ version: 'v3', auth });
    const start = new Date(opts.startUtc);
    const end = opts.endUtc ? new Date(opts.endUtc) : new Date(start.getTime() + 60 * 60_000);
    const tz = homeTimezone();

    const res = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: opts.title,
        description: opts.description ?? undefined,
        location: opts.location ?? undefined,
        start: { dateTime: start.toISOString(), timeZone: tz },
        end: { dateTime: end.toISOString(), timeZone: tz },
        reminders: {
          useDefault: false,
          overrides: [{ method: 'popup', minutes: 60 }, { method: 'email', minutes: 60 }],
        },
      },
    });

    return { ok: true, id: res.data.id!, htmlLink: res.data.htmlLink ?? undefined };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export function googleStatus() {
  return {
    configured: googleConfigured(),
    connected: googleConnected(),
  };
}
