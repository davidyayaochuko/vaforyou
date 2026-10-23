/**
 * xAI Grok Text-to-Speech (same XAI_API_KEY as chat / STT).
 * POST https://api.x.ai/v1/tts → raw audio bytes (mp3 by default).
 */
import { env } from '../config/env.ts';

export function xaiTtsConfigured(): boolean {
  return Boolean(env.xaiApiKey);
}

export function xaiTtsStatus(): {
  configured: boolean;
  voice: string;
  note: string;
} {
  return {
    configured: xaiTtsConfigured(),
    voice: env.xaiTtsVoice || 'ara',
    note: xaiTtsConfigured()
      ? 'Text is sent to xAI Grok TTS, then discarded. Same XAI_API_KEY as chat.'
      : 'xAI TTS not configured. Set XAI_API_KEY.',
  };
}

export async function synthesizeXaiSpeech(opts: {
  text: string;
  voice?: string;
}): Promise<{ bytes: Buffer; mimeType: string; voice: string }> {
  if (!xaiTtsConfigured()) {
    throw new Error('XAI_API_KEY is not set.');
  }
  const voice = opts.voice || env.xaiTtsVoice || 'ara';
  const text = opts.text.trim().slice(0, 4000);
  if (!text) throw new Error('Nothing to speak.');

  const res = await fetch('https://api.x.ai/v1/tts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.xaiApiKey}`,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      voice_id: voice,
      language: 'en',
      text_normalization: true,
      output_format: { codec: 'mp3', sample_rate: 24000, bit_rate: 128000 },
    }),
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    let msg = `xAI TTS failed (${res.status}).`;
    try {
      const j = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
      if (typeof j.error === 'string') msg = j.error;
      else if (j.error && typeof j.error === 'object' && j.error.message) msg = j.error.message;
      else if (j.message) msg = j.message;
    } catch {
      if (raw.trim()) msg = raw.trim().slice(0, 240);
    }
    throw new Error(msg);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('xAI TTS returned empty audio.');
  const mimeType = res.headers.get('content-type') || 'audio/mpeg';
  return { bytes: buf, mimeType, voice };
}
