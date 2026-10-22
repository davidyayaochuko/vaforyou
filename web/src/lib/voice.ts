/**
 * Funke voice engine for the web shell.
 *
 * Two talk modes:
 * - hold (push-to-talk): Space / orb press starts, release submits and closes the mic.
 * - conversation (Cursor-style): Talk button stays open. Pause to send, reply plays,
 *   then listening resumes so you can keep going without re-triggering.
 *
 * Pipeline: mic → VAD → one MediaRecorder per utterance → transcribe → ask → optional TTS.
 * Voice never approves. Approvals are only decided by on-screen buttons.
 */
import { api, askFunkeDetailed } from './api';

export type VoiceState = 'idle' | 'listening' | 'hearing' | 'thinking' | 'speaking';
/** How the current mic session was opened. Null when the mic is off. */
export type TalkMode = 'hold' | 'conversation';

export type VoiceSnapshot = {
  state: VoiceState;
  talkOn: boolean;
  /** Active session style while talkOn; null when idle. */
  talkMode: TalkMode | null;
  speakOn: boolean;
  transcript: string;
  reply: string;
  notice: string;
};

export type VoiceTurn = { user: string; reply: string; source: 'voice' };

type Listener = (s: VoiceSnapshot) => void;

const SPEAK_KEY = 'funke-speak';
const THRESHOLD = 0.045;
/** Pause length before an utterance is cut and sent (conversation is a touch snappier). */
const SILENCE_HOLD_MS = 1100;
const SILENCE_CONVERSATION_MS = 850;
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
  /** True while releaseTalk is finalizing an utterance (blocks re-entrant start/stop). */
  private releasing = false;
  /** Release arrived while startTalk was still opening the mic. */
  private pendingRelease = false;

  constructor() {
    let speakOn = false;
    try {
      speakOn = localStorage.getItem(SPEAK_KEY) === '1';
    } catch {
      /* ignore */
    }
    this.snap = {
      state: 'idle',
      talkOn: false,
      talkMode: null,
      speakOn,
      transcript: '',
      reply: '',
      notice: '',
    };
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

  /**
   * Continuous conversation toggle (does not replace push-to-talk).
   * - idle → open conversation
   * - conversation → stop
   * - hold (Space/orb in progress) → upgrade to conversation so both modes coexist:
   *   finish this thought hands-free without releasing to end the mic
   */
  async toggleTalk() {
    if (this.snap.talkMode === 'conversation') {
      this.stopTalk();
      return;
    }
    if (this.snap.talkMode === 'hold') {
      this.set({
        talkMode: 'conversation',
        notice: 'Switched to conversation. Pause to send. Tap Talk to stop.',
      });
      return;
    }
    await this.startTalk('conversation');
  }

  /**
   * Push-to-talk release (hold mode only): finalize any in-progress utterance,
   * send it, then close the mic. No-op in conversation mode so Space/orb
   * cannot accidentally end an open back-and-forth.
   */
  async releaseTalk() {
    if (this.releasing) return;
    if (!this.snap.talkOn) {
      // Press was so short that getUserMedia has not finished yet.
      this.pendingRelease = true;
      return;
    }
    if (this.snap.talkMode !== 'hold') return;
    this.pendingRelease = false;
    this.releasing = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    try {
      const recording =
        this.speechStarted || (!!this.recorder && this.recorder.state !== 'inactive');
      if (recording) {
        this.speechStarted = false;
        this.quietSince = 0;
        await this.captureUtterance();
      }
    } finally {
      this.releasing = false;
      this.stopTalk();
    }
  }

  async startTalk(mode: TalkMode = 'conversation') {
    if (this.releasing) return;
    if (this.snap.talkOn) {
      // Already in a session. Do not demote conversation to hold mid-turn.
      return;
    }
    this.pendingRelease = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.set({ notice: 'This browser cannot use the microphone.' });
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      this.pendingRelease = false;
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
      talkMode: mode,
      state: 'listening',
      transcript: '',
      reply: '',
      notice:
        mode === 'hold'
          ? 'Listening. Release to send. Voice can’t approve.'
          : 'Conversation on. Pause when you finish a thought. Tap Talk to stop.',
    });
    this.loop();
    if (this.pendingRelease && mode === 'hold') {
      this.pendingRelease = false;
      await this.releaseTalk();
    } else {
      this.pendingRelease = false;
    }
  }

  stopTalk() {
    this.pendingRelease = false;
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
    this.set({ talkOn: false, talkMode: null, state: 'idle', notice: '' });
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
      const silenceMs =
        this.snap.talkMode === 'conversation' ? SILENCE_CONVERSATION_MS : SILENCE_HOLD_MS;
      if (now - this.quietSince >= silenceMs) {
        this.speechStarted = false;
        this.quietSince = 0;
        void this.captureUtterance();
      }
    } else if (
      this.snap.talkMode === 'conversation' &&
      now - this.lastActivity >= IDLE_STOP_MS
    ) {
      this.stopTalk();
      this.set({ notice: 'I paused the conversation after a quiet minute. Tap Talk to continue.' });
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
      const approvalNote = approvals.length ? 'Something needs your approval. Tap Approvals.' : '';
      this.set({ reply, notice: approvalNote });
      // Conversation always hears the reply; hold uses an open mic or Speak toggle.
      const shouldSpeak =
        this.snap.talkMode === 'conversation' || this.snap.talkOn || this.snap.speakOn;
      if (shouldSpeak) await this.speak(reply, approvals.length > 0);
    } catch (err) {
      this.set({ notice: err instanceof Error ? err.message : 'I could not reach Funke.' });
    } finally {
      // Cursor-style: after the reply, open the ear again without the user tapping Talk.
      this.speechStarted = false;
      this.quietSince = 0;
      this.lastActivity = Date.now();
      if (this.snap.talkOn) {
        const keepNotice = this.snap.notice.includes('approval')
          ? this.snap.notice
          : this.snap.talkMode === 'conversation'
            ? 'Your turn. Keep talking, or tap Talk to stop.'
            : this.snap.notice;
        this.set({ state: 'listening', notice: keepNotice });
      } else {
        this.set({ state: 'idle' });
      }
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
