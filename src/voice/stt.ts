/**
 * Pluggable speech-to-text.
 * Prefer Groq Whisper when GROQ_API_KEY is set (free).
 * Else xAI Grok Voice Transcribe when XAI_API_KEY / GROK_API_KEY is set.
 * Else the browser Web Speech API.
 * Audio is held only in memory for the request, then discarded.
 */

import { env } from '../config/env.ts';
import { whisperPromptHint } from './vocab.ts';

export type SttProvider = 'groq' | 'xai' | 'browser' | 'none';

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
  xaiConfigured: boolean;
  model: string;
  storesAudio: boolean;
  note: string;
} {
  const groqConfigured = Boolean(env.groqApiKey);
  const xaiConfigured = Boolean(env.xaiApiKey);
  const pref = (process.env.STT_PROVIDER || 'auto').toLowerCase();
  let provider: SttProvider = 'none';

  if (pref === 'browser') provider = 'browser';
  else if (pref === 'groq') provider = groqConfigured ? 'groq' : 'none';
  else if (pref === 'xai' || pref === 'grok') provider = xaiConfigured ? 'xai' : 'none';
  else {
    // auto: free Groq Whisper first, then xAI STT (same key as Grok chat), then browser
    if (groqConfigured) provider = 'groq';
    else if (xaiConfigured) provider = 'xai';
    else provider = 'browser';
  }

  if (provider === 'none' && pref !== 'browser') {
    provider = 'browser';
  }

  const model =
    provider === 'groq' ? env.groqSttModel
    : provider === 'xai' ? env.xaiSttModel
    : '';

  return {
    provider,
    groqConfigured,
    xaiConfigured,
    model,
    storesAudio: false,
    note:
      provider === 'groq'
        ? 'Audio is sent to Groq Whisper, then discarded. Chat may still use xAI when AI_PROVIDER=xai.'
        : provider === 'xai'
          ? 'Audio is sent to xAI Grok Voice Transcribe, then discarded. Same XAI_API_KEY as chat.'
          : provider === 'browser'
            ? 'Using the browser Web Speech API. Add GROQ_API_KEY (free Whisper) or rely on XAI_API_KEY for server STT.'
            : 'No STT provider configured.',
  };
}

function logprobToConfidence(avg: number): number {
  const c = 1 + avg / 1.2;
  return Math.min(1, Math.max(0, c));
}

function audioMeta(opts: { bytes: Buffer; mimeType?: string; filename?: string }): {
  mime: string;
  filename: string;
} {
  const mime = opts.mimeType || 'audio/webm';
  const ext = mime.includes('mp4') || mime.includes('m4a')
    ? 'm4a'
    : mime.includes('wav')
      ? 'wav'
      : mime.includes('mpeg') || mime.includes('mp3')
        ? 'mp3'
        : 'webm';
  return { mime, filename: opts.filename || `speech.${ext}` };
}

async function transcribeGroq(opts: {
  bytes: Buffer;
  mimeType?: string;
  filename?: string;
}): Promise<SttResult> {
  const { mime, filename } = audioMeta(opts);
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

/** xAI Grok Voice Transcribe — https://api.x.ai/v1/stt */
async function transcribeXai(opts: {
  bytes: Buffer;
  mimeType?: string;
  filename?: string;
}): Promise<SttResult> {
  const { mime, filename } = audioMeta(opts);
  const form = new FormData();
  // Option fields before file (xAI docs).
  form.append('model', env.xaiSttModel);
  form.append('language', 'en');
  form.append('format', 'true');
  try {
    const hint = whisperPromptHint(200);
    for (const term of hint.split(/[,\n]/).map((t) => t.trim()).filter((t) => t.length > 1).slice(0, 20)) {
      form.append('keyterm', term.slice(0, 50));
    }
  } catch {
    for (const term of ['Funke', 'Lagos', 'Ikeja', 'Lekki', 'Adaeze']) {
      form.append('keyterm', term);
    }
  }
  form.append('file', new Blob([new Uint8Array(opts.bytes)], { type: mime }), filename);

  const res = await fetch('https://api.x.ai/v1/stt', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.xaiApiKey}` },
    body: form,
  });

  const raw = await res.text();
  if (!res.ok) {
    let msg = `xAI transcription failed (${res.status}).`;
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

  type XaiStt = {
    text?: string;
    transcript?: string;
    words?: { text?: string; word?: string; start?: number; end?: number }[];
  };
  let parsed: XaiStt = {};
  try {
    parsed = JSON.parse(raw) as XaiStt;
  } catch {
    const text = raw.trim();
    if (!text) throw new Error('I heard silence. Try again a bit closer to the mic.');
    return { text, provider: 'xai' };
  }

  const text = String(parsed.text ?? parsed.transcript ?? '').trim();
  if (!text) throw new Error('I heard silence. Try again a bit closer to the mic.');

  const words: SttWord[] | undefined = parsed.words?.length
    ? parsed.words
        .map((w) => {
          const word = String(w.text ?? w.word ?? '').trim();
          if (!word) return null;
          return { word, start: w.start, end: w.end } as SttWord;
        })
        .filter((w): w is SttWord => !!w)
    : undefined;

  return { text, provider: 'xai', words };
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
  if (status.provider !== 'groq' && status.provider !== 'xai') {
    throw new Error(
      status.xaiConfigured || status.groqConfigured
        ? 'Server STT is set to browser-only. Use the mic with Web Speech, or set STT_PROVIDER=auto.'
        : 'No STT key. Add XAI_API_KEY (Grok Voice Transcribe) or GROQ_API_KEY (Whisper), or use browser speech.',
    );
  }
  if (!opts.bytes.length) throw new Error('Empty audio. Hold the mic and speak, then release.');
  if (opts.bytes.length > 25 * 1024 * 1024) {
    throw new Error('That recording is too large. Try a shorter clip.');
  }

  if (status.provider === 'xai') return transcribeXai(opts);
  return transcribeGroq(opts);
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
        const d = Math.abs(vl.length - t.length);
        if (d <= 2) score = 40 - d * 10;
      }
      return { v, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.v);
}
