/**
 * Pluggable speech-to-text. Default: Groq Whisper (same key as chat).
 * Audio is held only in memory for the request, then discarded.
 */

import { env } from '../config/env.ts';
import { whisperPromptHint } from './vocab.ts';

export type SttProvider = 'groq' | 'browser' | 'none';

export interface SttWord {
  word: string;
  start?: number;
  end?: number;
  /** Relative confidence 0..1 derived from segment avg_logprob when available. */
  confidence?: number;
  lowConfidence?: boolean;
}

export interface SttResult {
  text: string;
  provider: SttProvider;
  language?: string;
  words?: SttWord[];
  /** Segment-level avg_logprob values from Whisper verbose_json. */
  segments?: { text: string; avgLogprob: number; start?: number; end?: number }[];
}

export function sttStatus(): {
  provider: SttProvider;
  groqConfigured: boolean;
  model: string;
  storesAudio: boolean;
  note: string;
} {
  const groqConfigured = Boolean(env.groqApiKey);
  const pref = (process.env.STT_PROVIDER || 'auto').toLowerCase();
  let provider: SttProvider = 'none';
  if (pref === 'browser') provider = 'browser';
  else if (pref === 'groq' || pref === 'auto') {
    provider = groqConfigured ? 'groq' : 'browser';
  }
  return {
    provider,
    groqConfigured,
    model: env.groqSttModel,
    storesAudio: false,
    note:
      provider === 'groq'
        ? 'Audio is sent to Groq for transcription, then discarded. Nothing is saved on disk.'
        : provider === 'browser'
          ? 'Using the browser Web Speech API. Audio goes to the browser vendor; support varies.'
          : 'No STT provider configured.',
  };
}

function logprobToConfidence(avg: number): number {
  // avg_logprob closer to 0 is better; map typical range [-1.2, 0] → [0, 1]
  const c = 1 + avg / 1.2;
  return Math.min(1, Math.max(0, c));
}

/**
 * Transcribe in-memory audio. Never writes the bytes to disk.
 */
export async function transcribeAudio(opts: {
  bytes: Buffer;
  mimeType?: string;
  filename?: string;
}): Promise<SttResult> {
  const status = sttStatus();
  if (status.provider !== 'groq') {
    throw new Error(
      status.groqConfigured
        ? 'Server STT is set to browser-only. Use the mic with Web Speech, or set STT_PROVIDER=groq.'
        : 'No Groq key for transcription. Add GROQ_API_KEY, or use the browser speech fallback in the UI.',
    );
  }
  if (!opts.bytes.length) throw new Error('Empty audio. Hold the mic and speak, then release.');
  if (opts.bytes.length > 25 * 1024 * 1024) {
    throw new Error('That recording is too large. Try a shorter clip.');
  }

  const mime = opts.mimeType || 'audio/webm';
  const ext = mime.includes('mp4') || mime.includes('m4a')
    ? 'm4a'
    : mime.includes('wav')
      ? 'wav'
      : mime.includes('mpeg') || mime.includes('mp3')
        ? 'mp3'
        : 'webm';
  const filename = opts.filename || `speech.${ext}`;

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(opts.bytes)], { type: mime }), filename);
  form.append('model', env.groqSttModel);
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  form.append('language', 'en');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  try {
    form.append('prompt', whisperPromptHint(700));
  } catch {
    form.append(
      'prompt',
      'Nigerian English. Names and places: Ikeja, Lekki, Yaba, Ojuelegba, Adaeze, Funke, Lagos.',
    );
  }

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.groqApiKey}` },
    body: form,
  });

  const raw = await res.text();
  if (!res.ok) {
    let msg = `Transcription failed (${res.status}).`;
    try {
      const j = JSON.parse(raw) as { error?: { message?: string } };
      if (j.error?.message) msg = j.error.message;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }

  type Verbose = {
    text?: string;
    words?: { word: string; start?: number; end?: number }[];
    segments?: {
      text?: string;
      start?: number;
      end?: number;
      avg_logprob?: number;
    }[];
  };

  let parsed: Verbose = {};
  try {
    parsed = JSON.parse(raw) as Verbose;
  } catch {
    const text = raw.trim();
    if (!text) throw new Error('I heard silence. Try again a bit closer to the mic.');
    return { text, provider: 'groq' };
  }

  const text = String(parsed.text ?? '').trim();
  if (!text) throw new Error('I heard silence. Try again a bit closer to the mic.');

  const segments = (parsed.segments || []).map((s) => ({
    text: String(s.text || '').trim(),
    avgLogprob: typeof s.avg_logprob === 'number' ? s.avg_logprob : -0.3,
    start: s.start,
    end: s.end,
  }));

  const words: SttWord[] = [];
  if (parsed.words?.length) {
    for (const w of parsed.words) {
      const word = String(w.word || '').trim();
      if (!word) continue;
      // Attach nearest segment confidence
      let conf = 0.75;
      if (typeof w.start === 'number' && segments.length) {
        const seg =
          segments.find((s) => (s.start ?? 0) <= (w.start ?? 0) && (s.end ?? 99) >= (w.start ?? 0))
          || segments[0]!;
        conf = logprobToConfidence(seg.avgLogprob);
      }
      words.push({
        word,
        start: w.start,
        end: w.end,
        confidence: conf,
        lowConfidence: conf < 0.55,
      });
    }
  } else {
    // Fallback: mark whole low-confidence segments
    for (const seg of segments) {
      const conf = logprobToConfidence(seg.avgLogprob);
      for (const word of seg.text.split(/\s+/).filter(Boolean)) {
        words.push({ word, confidence: conf, lowConfidence: conf < 0.55 });
      }
    }
  }

  return {
    text,
    provider: 'groq',
    words: words.length ? words : undefined,
    segments: segments.length ? segments : undefined,
  };
}

/** Decode a data-URL or raw base64 payload into bytes (no disk). */
export function decodeAudioBase64(input: string): { bytes: Buffer; mimeType: string } {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('No audio attached.');
  const dataUrl = raw.match(/^data:([^;]+);base64,(.+)$/s);
  if (dataUrl) {
    return {
      mimeType: dataUrl[1] || 'audio/webm',
      bytes: Buffer.from(dataUrl[2]!, 'base64'),
    };
  }
  return { mimeType: 'audio/webm', bytes: Buffer.from(raw, 'base64') };
}

/** Suggest vocabulary matches for a mistyped/misheard token. */
export function suggestCorrections(token: string, vocabTerms: string[], limit = 5): string[] {
  const t = token.toLowerCase().replace(/[^a-z0-9']/g, '');
  if (!t) return [];
  const scored = vocabTerms
    .map((v) => {
      const vl = v.toLowerCase();
      let score = 0;
      if (vl === t) score = 100;
      else if (vl.startsWith(t) || t.startsWith(vl)) score = 80;
      else if (vl.includes(t) || t.includes(vl)) score = 50;
      else {
        // cheap edit distance cap
        const d = Math.abs(vl.length - t.length);
        if (d <= 2) score = 40 - d * 10;
      }
      return { v, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.v);
}
