/**
 * Funke voice engine for the web shell.
 *
 * Talk: mic → voice-activity detection → one recording per utterance
 * (each needs its own container header, or Groq rejects mid-stream chunks)
 * → /api/voice/transcribe → /api/ask → optional speech.
 * Speak: Azure TTS via /api/voice/speak when configured, browser voices otherwise.
 *
 * Voice never approves. Approvals are only decided by on-screen buttons.
 */
import { api, askFunkeDetailed } from './api';

export type VoiceState = 'idle' | 'listening' | 'hearing' | 'thinking' | 'speaking';

export type VoiceSnapshot = {
  state: VoiceState;
  talkOn: boolean;
  speakOn: boolean;
  transcript: string;
  reply: string;
  notice: string;
};

export type VoiceTurn = { user: string; reply: string; source: 'voice' };

type Listener = (s: VoiceSnapshot) => void;

const SPEAK_KEY = 'funke-speak';
const THRESHOLD = 0.045;
const SILENCE_MS = 1100;
const IDLE_STOP_MS = 60_000;

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

class VoiceEngine {
  private snap: VoiceSnapshot;
  private listeners = new Set<Listener>();
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Uint8Array | null = null;
  private raf = 0;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private speechStarted = false;
  private quietSince = 0;
  private lastActivity = 0;
  private audio: HTMLAudioElement | null = null;
  private ttsProvider: 'azure' | 'browser' | null = null;
  private smoothed = 0;

  constructor() {
    let speakOn = false;
    try {
      speakOn = localStorage.getItem(SPEAK_KEY) === '1';
    } catch {
      /* ignore */
    }
    this.snap = { state: 'idle', talkOn: false, speakOn, transcript: '', reply: '', notice: '' };
  }

  get snapshot(): VoiceSnapshot {
    return this.snap;
  }

  /** 0..1 loudness for the orb. Synthesised while Funke is speaking. */
  get level(): number {
    if (this.snap.state === 'speaking') {
      const t = performance.now() / 1000;
      return 0.4 + Math.abs(Math.sin(t * 7.3)) * 0.25 + Math.abs(Math.sin(t * 3.1)) * 0.15;
    }
    if (this.snap.state === 'thinking') return 0.18;
    return this.smoothed;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snap);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<VoiceSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((fn) => fn(this.snap));
  }

  setSpeakOn(on: boolean) {
    try {
      localStorage.setItem(SPEAK_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (!on) this.stopSpeaking();
    this.set({ speakOn: on, notice: on ? 'Replies will be read aloud.' : '' });
  }

  async toggleTalk() {
    if (this.snap.talkOn) this.stopTalk();
    else await this.startTalk();
  }

  async startTalk() {
    if (this.snap.talkOn) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.set({ notice: 'This browser cannot use the microphone.' });
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      const denied = /Permission|NotAllowed|denied/i.test(String(err));
      this.set({
        notice: denied
          ? 'Microphone access was blocked. Allow it in the address bar, then try Talk again.'
          : 'I could not open the microphone.',
      });
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.buf = new Uint8Array(this.analyser.fftSize);
    src.connect(this.analyser);
    this.speechStarted = false;
    this.quietSince = 0;
    this.lastActivity = Date.now();
    this.set({
      talkOn: true,
      state: 'listening',
      transcript: '',
      reply: '',
      notice: 'Listening. Speak naturally. Voice can’t approve.',
    });
    this.loop();
  }

  stopTalk() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    } catch {
      /* ignore */
    }
    this.recorder = null;
    this.chunks = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.analyser = null;
    this.smoothed = 0;
    this.stopSpeaking();
    this.set({ talkOn: false, state: 'idle', notice: '' });
  }

  private rms(): number {
    if (!this.analyser || !this.buf) return 0;
    this.analyser.getByteTimeDomainData(this.buf as Uint8Array<ArrayBuffer>);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const v = (this.buf[i]! - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / this.buf.length);
  }

  private loop = () => {
    if (!this.snap.talkOn) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = Date.now();
    const rms = this.rms();
    const target = Math.min(1, rms / 0.18);
    this.smoothed += (target - this.smoothed) * 0.25;

    if (this.snap.state === 'speaking' && rms > THRESHOLD * 1.6) {
      this.stopSpeaking();
      this.speechStarted = false;
      this.quietSince = 0;
      this.set({ state: 'listening' });
      return;
    }
    if (this.snap.state !== 'listening' && this.snap.state !== 'hearing') return;

    if (rms > THRESHOLD) {
      if (!this.speechStarted) this.beginRecording();
      this.speechStarted = true;
      this.quietSince = 0;
      this.lastActivity = now;
      if (this.snap.state !== 'hearing') this.set({ state: 'hearing' });
    } else if (this.speechStarted) {
      if (!this.quietSince) this.quietSince = now;
      if (now - this.quietSince >= SILENCE_MS) {
        this.speechStarted = false;
        this.quietSince = 0;
        void this.captureUtterance();
      }
    } else if (now - this.lastActivity >= IDLE_STOP_MS) {
      this.stopTalk();
      this.set({ notice: 'I paused Talk after a quiet minute. Tap Talk to continue.' });
    }
  };

  private beginRecording() {
    if (!this.stream) return;
    this.chunks = [];
    const mime = pickMime();
    try {
      this.recorder = mime ? new MediaRecorder(this.stream, { mimeType: mime }) : new MediaRecorder(this.stream);
    } catch {
      this.recorder = new MediaRecorder(this.stream);
    }
    this.recorder.ondataavailable = (ev) => {
      if (ev.data?.size) this.chunks.push(ev.data);
    };
    try {
      this.recorder.start();
    } catch {
      this.recorder = null;
    }
  }

  private endRecording(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const rec = this.recorder;
      if (!rec || rec.state === 'inactive') return resolve(null);
      rec.onstop = () => {
        const blob = new Blob(this.chunks.slice(), { type: rec.mimeType || pickMime() || 'audio/webm' });
        this.chunks = [];
        this.recorder = null;
        resolve(blob.size >= 800 ? blob : null);
      };
      try {
        rec.stop();
      } catch {
        this.recorder = null;
        resolve(null);
      }
    });
  }

  private async captureUtterance() {
    this.set({ state: 'thinking', notice: 'Transcribing…' });
    const blob = await this.endRecording();
    if (!blob) {
      this.set({ state: 'listening', notice: 'I barely caught that. Try a little louder.' });
      return;
    }
    try {
      const data = await api<{ text?: string }>('/api/voice/transcribe', 'POST', {
        audioBase64: await blobToBase64(blob),
        mimeType: blob.type || 'audio/webm',
      });
      const text = (data.text ?? '').trim();
      if (!text) {
        this.set({ state: 'listening', notice: 'I heard silence. Go ahead.' });
        return;
      }
      await this.ask(text);
    } catch (err) {
      this.set({
        state: this.snap.talkOn ? 'listening' : 'idle',
        notice: err instanceof Error ? err.message : 'Transcription failed.',
      });
    }
  }

  /** Send a spoken ask, publish the turn to Chat, and read the reply when allowed. */
  async ask(text: string) {
    this.set({ state: 'thinking', transcript: text, reply: '', notice: '' });
    try {
      const { reply, approvals } = await askFunkeDetailed(text);
      const turn: VoiceTurn = { user: text, reply, source: 'voice' };
      pendingTurns().push(turn);
      window.dispatchEvent(new CustomEvent<VoiceTurn>('funke:turn', { detail: turn }));
      this.set({
        reply,
        notice: approvals.length ? 'Something needs your approval. Tap Approvals.' : '',
      });
      if (this.snap.talkOn || this.snap.speakOn) await this.speak(reply, approvals.length > 0);
    } catch (err) {
      this.set({ notice: err instanceof Error ? err.message : 'I could not reach Funke.' });
    } finally {
      this.set({ state: this.snap.talkOn ? 'listening' : 'idle' });
      this.lastActivity = Date.now();
    }
  }

  private async provider(): Promise<'azure' | 'browser'> {
    if (this.ttsProvider) return this.ttsProvider;
    try {
      const info = await api<{ provider?: string }>('/api/voice/tts');
      this.ttsProvider = info.provider === 'azure' ? 'azure' : 'browser';
    } catch {
      this.ttsProvider = 'browser';
    }
    return this.ttsProvider;
  }

  async speak(text: string, hasApproval = false) {
    if (!text.trim()) return;
    this.stopSpeaking();
    const prev = this.snap.state;
    this.set({ state: 'speaking' });
    try {
      if ((await this.provider()) === 'azure') {
        const data = await api<{ audioBase64?: string; mimeType?: string }>('/api/voice/speak', 'POST', {
          text,
          hasApproval,
        });
        if (data.audioBase64) {
          await this.playBase64(data.audioBase64, data.mimeType || 'audio/mpeg');
          return;
        }
      }
      let spoken = text;
      try {
        const prep = await api<{ spoken?: string }>('/api/voice/prepare', 'POST', { text, hasApproval });
        if (prep.spoken) spoken = prep.spoken;
      } catch {
        /* speak the raw text */
      }
      await this.speakBrowser(spoken);
    } catch {
      /* speaking is best-effort */
    } finally {
      if (this.snap.state === 'speaking') {
        this.set({ state: this.snap.talkOn ? 'listening' : prev === 'speaking' ? 'idle' : prev });
      }
    }
  }

  private playBase64(b64: string, mime: string): Promise<void> {
    return new Promise((resolve) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      const audio = new Audio(url);
      this.audio = audio;
      const done = () => {
        URL.revokeObjectURL(url);
        if (this.audio === audio) this.audio = null;
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      audio.onpause = done;
      void audio.play().catch(done);
    });
  }

  private speakBrowser(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      const voices = speechSynthesis.getVoices();
      u.voice =
        voices.find((v) => v.lang === 'en-NG') ??
        voices.find((v) => /en-GB/i.test(v.lang)) ??
        voices.find((v) => /^en/i.test(v.lang)) ??
        null;
      u.rate = 1.02;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
    });
  }

  stopSpeaking() {
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) speechSynthesis.cancel();
  }
}

/** Voice turns not yet written into a chat thread (Chat may be closed while you talk). */
export function pendingTurns(): VoiceTurn[] {
  const w = window as unknown as { __funkeTurns?: VoiceTurn[] };
  return (w.__funkeTurns ??= []);
}

let engine: VoiceEngine | null = null;

/** Shared engine across islands (orb, chat). Browser only. */
export function voice(): VoiceEngine {
  if (!engine) engine = new VoiceEngine();
  return engine;
}
