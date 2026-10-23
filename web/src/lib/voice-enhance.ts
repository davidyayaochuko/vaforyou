/**
 * Mic open helpers for Talk.
 *
 * Important: Silero VAD and MediaRecorder need the *raw* getUserMedia stream.
 * Routing through an RNNoise MediaStreamDestination often yields silence or
 * broken VAD in Chromium, which is why Talk felt dead after enhance landed.
 *
 * RNNoise stays available as an opt-in experiment (`funke-voice-enhance=rnnoise`)
 * but defaults to off. Browser echoCancellation / noiseSuppression stay on.
 */

const ENHANCE_KEY = 'funke-voice-enhance';

export type EnhanceMode = 'rnnoise' | 'off';

export function getEnhanceMode(): EnhanceMode {
  try {
    const v = localStorage.getItem(ENHANCE_KEY);
    if (v === 'rnnoise') return 'rnnoise';
  } catch {
    /* ignore */
  }
  // Default off: reliable Talk first. Opt in for RNNoise experiments.
  return 'off';
}

export function setEnhanceMode(mode: EnhanceMode): void {
  try {
    localStorage.setItem(ENHANCE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export type EnhancedMic = {
  /** Stream for Silero / MediaRecorder / analyser. Prefer raw. */
  stream: MediaStream;
  raw: MediaStream;
  destroy: () => void;
  /** True when live RNNoise graph is active (experimental). */
  rnnoise: boolean;
};

/**
 * Open the mic. Always returns a usable raw stream for VAD.
 * Experimental RNNoise wraps a *second* stream only when explicitly enabled
 * and the graph starts cleanly; otherwise we keep raw.
 */
export async function openEnhancedMic(ctx: AudioContext): Promise<EnhancedMic> {
  const wantRnnoise = getEnhanceMode() === 'rnnoise';
  const raw = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      autoGainControl: true,
      noiseSuppression: true,
      channelCount: 1,
    },
  });

  const destroyRaw = () => raw.getTracks().forEach((t) => t.stop());

  if (!wantRnnoise) {
    return { stream: raw, raw, destroy: destroyRaw, rnnoise: false };
  }

  try {
    if (ctx.state === 'suspended') await ctx.resume();
    if (Math.abs(ctx.sampleRate - 48_000) > 100) {
      console.warn('[funke voice] skip RNNoise: need 48 kHz AudioContext, got', ctx.sampleRate);
      return { stream: raw, raw, destroy: destroyRaw, rnnoise: false };
    }

    const { RnnoiseWorkletNode, loadRnnoise } = await import('@sapphi-red/web-noise-suppressor');
    const [{ default: rnnoiseWorkletUrl }, { default: rnnoiseWasmUrl }, { default: rnnoiseSimdWasmUrl }] =
      await Promise.all([
        import('@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'),
        import('@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'),
        import('@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'),
      ]);

    const wasmBinary = await loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl });
    await ctx.audioWorklet.addModule(rnnoiseWorkletUrl);

    // Re-open without browser NS so RNNoise is the only suppressor.
    destroyRaw();
    const raw2 = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        autoGainControl: true,
        noiseSuppression: false,
        channelCount: 1,
      },
    });

    const source = ctx.createMediaStreamSource(raw2);
    const rnnoise = new RnnoiseWorkletNode(ctx, { wasmBinary, maxChannels: 1 });
    const dest = ctx.createMediaStreamDestination();
    source.connect(rnnoise);
    rnnoise.connect(dest);
    // Keep the graph pulled so destination tracks stay live.
    const monitor = ctx.createGain();
    monitor.gain.value = 0;
    rnnoise.connect(monitor);
    monitor.connect(ctx.destination);

    return {
      // Still use RAW for Silero — destination streams break VAD in practice.
      // RNNoise graph stays warm for future Whisper-side use / experiments.
      stream: raw2,
      raw: raw2,
      rnnoise: true,
      destroy: () => {
        try {
          source.disconnect();
          rnnoise.disconnect();
          monitor.disconnect();
          rnnoise.destroy();
        } catch {
          /* ignore */
        }
        raw2.getTracks().forEach((t) => t.stop());
      },
    };
  } catch (err) {
    console.warn('[funke voice] RNNoise unavailable; raw mic', err);
    return { stream: raw, raw, destroy: destroyRaw, rnnoise: false };
  }
}
