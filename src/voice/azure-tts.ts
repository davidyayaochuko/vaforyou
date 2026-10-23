/**
 * Optional Azure Neural TTS (en-NG-EzinneNeural / en-NG-AbeoNeural).
 * Text is sent to Azure only when the operator sets keys. Audio is not stored.
 */

import { env } from '../config/env.ts';

export function azureTtsConfigured(): boolean {
  return Boolean(env.azureSpeechKey && env.azureSpeechRegion);
}

export function azureTtsStatus(): {
  configured: boolean;
  region: string;
  defaultVoice: string;
  note: string;
} {
  return {
    configured: azureTtsConfigured(),
    region: env.azureSpeechRegion || '',
    defaultVoice: env.azureTtsVoice || 'en-NG-EzinneNeural',
    note: azureTtsConfigured()
      ? 'Text is sent to Azure Speech for neural Nigerian English audio, then discarded. Free F0 tier is typically 500k characters/month; confirm on your Azure SKU.'
      : 'Azure TTS not configured. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION to enable en-NG neural voices.',
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Synthesize speech. Returns mp3 bytes in memory (never written to disk).
 */
export async function synthesizeAzureSpeech(opts: {
  text: string;
  voice?: string;
  rate?: string;
}): Promise<{ mimeType: string; bytes: Buffer; voice: string }> {
  if (!azureTtsConfigured()) {
    throw new Error('Azure Speech is not configured.');
  }
  // Default Ezinne (female). Slightly slower + soft pitch lift for a calmer delivery.
  const voice = opts.voice || env.azureTtsVoice || 'en-NG-EzinneNeural';
  const rate = opts.rate || '0.95';
  const chunks = String(opts.text || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const body = (chunks.length ? chunks : [opts.text])
    .map((s) => `${escapeXml(s)}<break time='220ms'/>`)
    .join(' ');
  const ssml =
    `<speak version='1.0' xml:lang='en-NG'>` +
    `<voice name='${escapeXml(voice)}'>` +
    `<prosody rate='${escapeXml(rate)}' pitch='+4%'>${body}</prosody>` +
    `</voice></speak>`;

  const url =
    `https://${env.azureSpeechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': env.azureSpeechKey,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'FunkeVA',
    },
    body: ssml,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Azure TTS failed (${res.status}). ${errText.slice(0, 160)}`);
  }
  const ab = await res.arrayBuffer();
  return { mimeType: 'audio/mpeg', bytes: Buffer.from(ab), voice };
}
