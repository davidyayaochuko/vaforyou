/**
 * Silero VAD wrapper for Talk.
 * Replaces RMS energy thresholds with a real speech model (browser ONNX).
 * Loaded dynamically so Astro SSR never evaluates onnxruntime.
 * Assets load from jsDelivr so we do not vendor multi-MB WASM into the repo.
 */

const ORT_VERSION = '1.22.0';
const VAD_VERSION = '0.0.31';

const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const VAD_BASE = `https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@${VAD_VERSION}/dist/`;

export type SileroVadHandle = {
  pause: () => void;
  start: () => void;
  destroy: () => Promise<void>;
};

/** Encode mono Float32 PCM (-1..1) as WAV base64 (no data: prefix). Safe for long clips. */
export function float32ToWavBase64(samples: Float32Array, sampleRate = 16_000): string {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  const bytes = new Uint8Array(buffer);
  const chunk = 0x2000; // 8k — avoid spread call-stack overflow on long speech
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    const end = Math.min(i + chunk, bytes.length);
    for (let j = i; j < end; j++) binary += String.fromCharCode(bytes[j]!);
  }
  return btoa(binary);
}

export async function createSileroVad(opts: {
  stream: MediaStream;
  onSpeechStart: () => void;
  onSpeechEnd: (audio: Float32Array) => void;
  onMisfire?: () => void;
}): Promise<SileroVadHandle> {
  const { MicVAD } = await import('@ricky0123/vad-web');
  const stream = opts.stream;
  const vad = await MicVAD.new({
    model: 'v5',
    baseAssetPath: VAD_BASE,
    onnxWASMBasePath: ORT_BASE,
    getStream: async () => stream,
    pauseStream: async () => undefined,
    resumeStream: async () => stream,
    onSpeechStart: opts.onSpeechStart,
    onSpeechEnd: opts.onSpeechEnd,
    onVADMisfire: opts.onMisfire,
    redemptionMs: 1200,
    minSpeechMs: 360,
    preSpeechPadMs: 600,
  });
  vad.start();
  return {
    pause: () => vad.pause(),
    start: () => vad.start(),
    destroy: async () => {
      try {
        vad.pause();
      } catch {
        /* ignore */
      }
    },
  };
}
