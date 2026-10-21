import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAccounts } from '../db/index.ts';
import { createContent } from '../db/content.ts';
import { getPlatform } from '../platforms/index.ts';
import { openSession } from '../browser/session.ts';
import { buildAiClient } from '../ai/client.ts';
import { env } from '../config/env.ts';

export interface VoiceSample {
  platform: string;
  account: string;
  url: string;
  excerpt: string;
}

export interface VoiceProfile {
  learnedAt: string;
  samples: number;
  summary: string;
  themes: string[];
  voiceMarkdown: string;
  drafts: { platform: string; account: string; body: string; imageBrief: string | null }[];
}

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const voicePath = () => join(root, 'instructions', 'VOICE.md');
const profilePath = () => join(dirname(env.dbPath), 'voice-profile.json');

export function voiceLearned(): boolean {
  return existsSync(voicePath());
}

export function readVoiceMarkdown(): string {
  if (!existsSync(voicePath())) return '';
  return readFileSync(voicePath(), 'utf8');
}

async function collectSamples(limitPerAccount = 8): Promise<VoiceSample[]> {
  const accounts = listAccounts().filter((a) => a.platform === 'linkedin' || a.platform === 'x');
  const samples: VoiceSample[] = [];

  for (const account of accounts) {
    const adapter = getPlatform(account.platform as 'linkedin' | 'x');
    if (!adapter.myRecentPosts) continue;
    const session = await openSession(account, { headless: false });
    try {
      const posts = await adapter.myRecentPosts(session.page, limitPerAccount);
      for (const post of posts) {
        if (!post.excerpt?.trim()) continue;
        samples.push({
          platform: account.platform === 'x' ? 'twitter' : 'linkedin',
          account: account.name,
          url: post.url,
          excerpt: post.excerpt.replace(/\s+/g, ' ').slice(0, 500),
        });
      }
    } finally {
      await session.close();
    }
  }

  return samples;
}

function parseJsonBlock(raw: string): Record<string, unknown> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)?.[1];
  const text = (fenced ?? raw).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('model did not return JSON');
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}

export function loadSavedVoice(): VoiceProfile | null {
  if (!existsSync(profilePath())) return null;
  try {
    const saved = JSON.parse(readFileSync(profilePath(), 'utf8')) as VoiceProfile & { samples?: number | unknown[] };
    const count = Array.isArray(saved.samples) ? saved.samples.length : Number(saved.samples ?? 0);
    const drafts = Array.isArray(saved.drafts)
      ? saved.drafts.map((d) => {
          const row = d as VoiceProfile['drafts'][number];
          return {
            platform: String(row.platform ?? 'linkedin'),
            account: String(row.account ?? ''),
            body: String(row.body ?? ''),
            imageBrief: row.imageBrief ? String(row.imageBrief) : null,
          };
        }).filter((d) => d.body)
      : [];
    return {
      learnedAt: saved.learnedAt,
      samples: count,
      summary: saved.summary,
      themes: saved.themes ?? [],
      voiceMarkdown: saved.voiceMarkdown || readVoiceMarkdown(),
      drafts,
    };
  } catch {
    return null;
  }
}

/** Read the saved profile. This never opens a browser. */
export async function learnVoiceFromPages(): Promise<VoiceProfile & { cached?: boolean }> {
  const saved = loadSavedVoice();
  if (saved) return { ...saved, cached: true };
  throw new Error('No saved voice yet. Use Refresh voice from my pages once to read LinkedIn and Twitter.');
}

/** Re-read LinkedIn and Twitter. Only call this when the person asks to refresh. */
export async function refreshVoiceFromPages(): Promise<VoiceProfile> {
  const samples = await collectSamples(8);
  if (samples.length === 0) {
    throw new Error(
      'I could not read posts from LinkedIn or Twitter. Make sure both accounts are logged in, then try again.',
    );
  }

  const ai = buildAiClient();
  const listing = samples
    .map((s, i) => `[${i + 1}] ${s.platform} (${s.account})\n${s.excerpt}`)
    .join('\n\n');

  const raw = await ai.text({
    system: [
      'You study a person\'s own public posts and describe their voice.',
      'Do not invent metrics, employers, or products that are not in the samples.',
      'Return ONLY JSON with this shape:',
      '{',
      '  "summary": "2-4 sentences",',
      '  "themes": ["theme", "..."],',
      '  "dos": ["rule", "..."],',
      '  "donts": ["rule", "..."],',
      '  "templates": [{"platform":"linkedin|twitter","name":"...","skeleton":"short shape with {{slots}}"}],',
      '  "drafts": [{"platform":"linkedin|twitter","body":"a post in their voice, not a copy of an old post","imageBrief":"what image to pair, or empty string"}]',
      '}',
      'Write 4 templates and 4 drafts. Mix short posts and one image-led post (imageBrief filled, body is the caption).',
      'No em dashes. No emoji. No hashtags.',
    ].join('\n'),
    prompt: `Their recent posts:\n\n${listing}`,
    maxTokens: 2_500,
  });

  const parsed = parseJsonBlock(raw);
  const themes = Array.isArray(parsed.themes) ? parsed.themes.map(String) : [];
  const dos = Array.isArray(parsed.dos) ? parsed.dos.map(String) : [];
  const donts = Array.isArray(parsed.donts) ? parsed.donts.map(String) : [];
  const summary = String(parsed.summary ?? '').trim();

  const markdown = [
    '# Voice learned from your pages',
    '',
    `Learned ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC from ${samples.length} recent posts.`,
    '',
    summary,
    '',
    '## Themes',
    ...themes.map((t) => `- ${t}`),
    '',
    '## Do',
    ...dos.map((t) => `- ${t}`),
    '',
    '## Do not',
    ...donts.map((t) => `- ${t}`),
    '',
    'Use this voice for chat and drafts. Instruction files still win when they conflict.',
    '',
  ].join('\n');

  writeFileSync(voicePath(), markdown);

  const draftsRaw = Array.isArray(parsed.drafts) ? parsed.drafts : [];
  const drafts: VoiceProfile['drafts'] = [];
  const accounts = listAccounts();

  for (const item of draftsRaw) {
    const row = item as { platform?: string; body?: string; imageBrief?: string };
    const platformName = String(row.platform ?? 'linkedin').toLowerCase();
    const platform = platformName === 'twitter' || platformName === 'x' ? 'x' : 'linkedin';
    const account = accounts.find((a) => a.platform === platform);
    const body = String(row.body ?? '').trim();
    if (!account || !body) continue;
    const imageBrief = String(row.imageBrief ?? '').trim() || null;
    createContent({
      accountId: account.id,
      platform,
      kind: 'post',
      body,
      state: 'drafted',
      meta: { via: 'voice_learn', imageBrief },
    });
    drafts.push({
      platform: platform === 'x' ? 'twitter' : 'linkedin',
      account: account.name,
      body,
      imageBrief,
    });
  }

  const profile: VoiceProfile = {
    learnedAt: new Date().toISOString(),
    samples: samples.length,
    summary,
    themes,
    voiceMarkdown: markdown,
    drafts,
  };

  mkdirSync(dirname(profilePath()), { recursive: true });
  writeFileSync(profilePath(), JSON.stringify({
    ...profile,
    templates: parsed.templates ?? [],
    samples: samples.map((s) => ({ platform: s.platform, excerpt: s.excerpt.slice(0, 180) })),
  }, null, 2));

  return profile;
}
