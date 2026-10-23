/**
 * Funke voice engine for the web shell.
 *
 * Talk is conversation-first (Cursor-style): Space, orb, or Talk toggles the mic open.
 * Pause to send, reply plays, then listening resumes. Press again to stop.
 * Hold (push-to-talk) remains in the API for harness/compat; the UI no longer uses it.
 *
 * Pipeline: mic → Silero VAD (fallback: RMS) → /api/voice/transcribe → ask → TTS when available.
 * Voice never approves. Approvals are only decided by on-screen buttons.
 */
import { api, askFunkeDetailed } from './api';
import { getEnhanceMode, openEnhancedMic, type EnhancedMic } from './voice-enhance';
import { createSileroVad, float32ToWavBase64, type SileroVadHandle } from './voice-silero';

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
  /** Lines she is speaking, revealed in time with the audio. */
  lyricLines: string[];
  lyricIndex: number;
};

export type VoiceTurn = { user: string; reply: string; source: 'voice' };

type Listener = (s: VoiceSnapshot) => void;

const SPEAK_KEY = 'funke-speak';
const THRESHOLD = 0.045;
/** Pause length before an utterance is cut and sent (conversation is a touch snappier). */
const SILENCE_HOLD_MS = 1100;
const SILENCE_CONVERSATION_MS = 850;
const IDLE_STOP_MS = 60_000;
/** Ignore mic echo while Funke is speaking (speakers → mic). */
const BARGE_IN_GRACE_MS = 2800;

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

/** Minimal Web Speech types (Chromium). Not in every TS lib. */
type BrowserSpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: {
    resultIndex: number;
    results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
  }) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

function speechRecognitionCtor(): (new () => BrowserSpeechRec) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => BrowserSpeechRec;
    webkitSpeechRecognition?: new () => BrowserSpeechRec;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function waitForVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve([]);
    const ready = () => resolve(speechSynthesis.getVoices().slice());
    const existing = speechSynthesis.getVoices();
    if (existing.length) return resolve(existing.slice());
    speechSynthesis.addEventListener('voiceschanged', ready, { once: true });
    // Safari sometimes never fires voiceschanged after an empty first read.
    window.setTimeout(ready, 400);
  });
}

/** Female-first ranking aligned with src/voice/tts.ts rankBrowserVoice. */
function rankFunkeVoice(name: string, lang: string): number {
  const n = `${name} ${lang}`.toLowerCase();
  let score = 0;
  if (/en-ng|nigeria/.test(n)) score += 100;
  if (/ezinne/.test(n)) score += 90;
  if (/abeo/.test(n)) score -= 60;
  if (
    /female|woman|girl|ezinne|samantha|karen|moira|fiona|tessa|veena|raveena|zira|susan|hazel|serena|aria|jenny|sara|emma|ava|allison|kathy|victoria|martha|helen|catherine|sonia|lekha|neerja/.test(
      n,
    )
  ) {
    score += 55;
  }
  if (
    /male|\bman\b|boy|abeo|daniel|david|fred|jorge|thomas|mark|george|james|ravi|sean|alex(?!a)|tom\b|lee\b/.test(
      n,
    )
  ) {
    score -= 45;
  }
  if (/en-gb/.test(n)) score += 18;
  else if (/en-za|en-in|en-au|en-ie/.test(n)) score += 12;
  else if (/en-us/.test(n)) score += 8;
  if (/natural|neural|online|premium|enhanced/.test(n)) score += 8;
  return score;
}

function pickFunkeVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  return [...voices].sort((a, b) => rankFunkeVoice(b.name, b.lang) - rankFunkeVoice(a.name, a.lang))[0] ?? null;
}

function splitSpokenSentences(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const parts = t.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [t];
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Break speech into short lyric lines (about one breath each). */
function lyricLinesFrom(text: string): string[] {
  const sentences = splitSpokenSentences(text);
  const lines: string[] = [];
  const max = 42;
  for (const sentence of sentences.length ? sentences : [text.trim()]) {
    const words = sentence.split(/\s+/).filter(Boolean);
    let cur = '';
    for (const word of words) {
      const next = cur ? `${cur} ${word}` : word;
      if (next.length > max && cur) {
        lines.push(cur);
        cur = word;
      } else {
        cur = next;
      }
    }
    if (cur) lines.push(cur);
  }
  return lines.filter(Boolean);
}

/** Which lyric line matches playback progress (0..1), weighted by length. */
function lyricIndexAt(lines: string[], progress: number): number {
  if (lines.length <= 1) return 0;
  const weights = lines.map((line) => Math.max(8, line.length));
  const total = weights.reduce((sum, n) => sum + n, 0);
  const target = Math.min(0.999, Math.max(0, progress)) * total;
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    acc += weights[i]!;
    if (target < acc) return i;
  }
  return lines.length - 1;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
  /** Output context resumed inside the Talk click so later TTS is allowed to play. */
  private outCtx: AudioContext | null = null;
  private speakSource: AudioBufferSourceNode | null = null;
  private ttsProvider: 'azure' | 'xai' | 'browser' | null = null;
  /** When speaking started — grace period before barge-in can cut her off. */
  private speakingSince = 0;
  /** Bumped on cancel so in-flight sentence loops stop. */
  private speakToken = 0;
  /** null until first /api/voice/stt probe. Server = Groq Whisper or xAI STT. */
  private sttProvider: 'server' | 'browser' | null = null;
  private browserRec: BrowserSpeechRec | null = null;
  /** Restart Web Speech after onend while talk stays open. */
  private browserRecWanted = false;
  private smoothed = 0;
  /** True while releaseTalk is finalizing an utterance (blocks re-entrant start/stop). */
  private releasing = false;
  /** Release arrived while startTalk was still opening the mic. */
  private pendingRelease = false;
  /** Silero VAD when Groq STT is live; null falls back to RMS + MediaRecorder. */
  private silero: SileroVadHandle | null = null;
  /** True while a Silero utterance is being transcribed / answered. */
  private sileroBusy = false;
  /** Mic + optional RNNoise graph; owns raw track teardown. */
  private enhanced: EnhancedMic | null = null;
  /** Drives lyricIndex from playback progress. */
  private lyricTimer = 0;
  private activeLyricLines: string[] = [];

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
      lyricLines: [],
      lyricIndex: 0,
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
   * Conversation toggle (Space, orb, Talk).
   * - idle → open conversation
   * - conversation → stop
   * - hold (legacy API) → upgrade to conversation
   */
  /**
   * Must run synchronously inside the click / keydown that starts Talk.
   * Browsers block audio.play() after the ask + TTS round trip unless an
   * AudioContext was resumed during that gesture.
   */
  unlockOutput() {
    const AC =
      window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!this.outCtx || this.outCtx.state === 'closed') this.outCtx = new AC();
    void this.outCtx.resume();
    try {
      const buf = this.outCtx.createBuffer(1, 1, this.outCtx.sampleRate);
      const src = this.outCtx.createBufferSource();
      src.buffer = buf;
      src.connect(this.outCtx.destination);
      src.start();
    } catch {
      /* already running */
    }
  }

  async toggleTalk() {
    this.unlockOutput();
    if (this.snap.talkMode === 'conversation') {
      this.stopTalk();
      return;
    }
    if (this.snap.talkMode === 'hold') {
      this.set({
        talkMode: 'conversation',
        notice: 'Conversation on. Pause to send. Press Space or Talk to stop.',
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
      if (this.sttProvider === 'browser') {
        const pending = this.snap.transcript.trim();
        const wasHearing = this.snap.state === 'hearing' || this.snap.state === 'listening';
        this.stopBrowserRec(true);
        // Hold mode is non-continuous; flush whatever we caught if ask() did not already run.
        if (pending && wasHearing && this.snap.state !== 'thinking') {
          await this.ask(pending);
        }
      } else if (this.silero) {
        // Silero submits on speech end; hold-release just closes the mic.
      } else {
        const recording =
          this.speechStarted || (!!this.recorder && this.recorder.state !== 'inactive');
        if (recording) {
          this.speechStarted = false;
          this.quietSince = 0;
          await this.captureUtterance();
        }
      }
    } finally {
      this.releasing = false;
      this.stopTalk();
    }
  }

  private async resolveStt(): Promise<'server' | 'browser'> {
    if (this.sttProvider) return this.sttProvider;
    try {
      const info = await api<{ provider?: string }>('/api/voice/stt');
      // provider comes from server sttStatus(): groq | xai | browser | none
      this.sttProvider = info.provider === 'groq' || info.provider === 'xai' ? 'server' : 'browser';
    } catch {
      this.sttProvider = 'browser';
    }
    return this.sttProvider;
  }

  async startTalk(mode: TalkMode = 'conversation') {
    this.unlockOutput();
    if (this.releasing) return;
    if (this.snap.talkOn) {
      // Already in a session. Do not demote conversation to hold mid-turn.
      return;
    }
    this.pendingRelease = false;
    const stt = await this.resolveStt();

    // No server STT (Groq / xAI): Chromium Web Speech fallback.
    if (stt === 'browser') {
      const SR = speechRecognitionCtor();
      if (!SR) {
        this.set({
          notice:
            'This browser has no speech recognition. Chat can use XAI_API_KEY; for Talk add that key (Grok Voice Transcribe) or GROQ_API_KEY, or try Chrome.',
        });
        return;
      }
      this.speechStarted = false;
      this.quietSince = 0;
      this.lastActivity = Date.now();
      this.browserRecWanted = true;
      this.set({
        talkOn: true,
        talkMode: mode,
        state: 'listening',
        transcript: '',
        reply: '',
        notice:
          mode === 'hold'
            ? 'Listening (browser). Release to send. Voice can’t approve.'
            : 'Conversation on (browser mic). Pause when you finish. Press Space or Talk to stop.',
      });
      this.startBrowserRec();
      if (this.pendingRelease && mode === 'hold') {
        this.pendingRelease = false;
        await this.releaseTalk();
      } else {
        this.pendingRelease = false;
      }
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      this.set({ notice: 'This browser cannot use the microphone.' });
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    // RNNoise wants 48 kHz; request it when enhance is on.
    const want48 = getEnhanceMode() === 'rnnoise';
    try {
      this.ctx = want48 ? new Ctx({ sampleRate: 48_000 }) : new Ctx();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.enhanced = await openEnhancedMic(this.ctx);
      this.stream = this.enhanced.stream;
    } catch (err) {
      this.pendingRelease = false;
      void this.ctx?.close().catch(() => undefined);
      this.ctx = null;
      this.enhanced = null;
      const denied = /Permission|NotAllowed|denied/i.test(String(err));
      this.set({
        notice: denied
          ? 'Microphone access was blocked. Allow it in the address bar, then try Talk again.'
          : 'I could not open the microphone.',
      });
      return;
    }
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.buf = new Uint8Array(this.analyser.fftSize);
    src.connect(this.analyser);
    this.speechStarted = false;
    this.quietSince = 0;
    this.lastActivity = Date.now();
    this.sileroBusy = false;

    let sileroOk = false;
    try {
      this.silero = await createSileroVad({
        stream: this.stream,
        onSpeechStart: () => {
          if (!this.snap.talkOn || this.sileroBusy) return;
          this.lastActivity = Date.now();
          // Do not barge-in on speaker echo. VAD is paused during speak(); this is a backstop.
          if (this.snap.state === 'speaking') {
            if (Date.now() - this.speakingSince < BARGE_IN_GRACE_MS) return;
            this.stopSpeaking();
            this.set({ state: 'listening' });
            return;
          }
          if (this.snap.state === 'listening' || this.snap.state === 'hearing') {
            this.set({ state: 'hearing' });
          }
        },
        onSpeechEnd: (audio) => {
          if (!this.snap.talkOn || this.sileroBusy) return;
          if (this.snap.state === 'thinking' || this.snap.state === 'speaking') return;
          void this.captureSileroUtterance(audio);
        },
        onMisfire: () => {
          if (this.snap.state === 'hearing') this.set({ state: 'listening' });
        },
      });
      sileroOk = true;
    } catch (err) {
      this.silero = null;
      console.warn('[funke voice] Silero VAD unavailable; using energy VAD', err);
    }

    const listenHint = sileroOk ? 'Listening.' : 'Listening (basic VAD).';
    this.set({
      talkOn: true,
      talkMode: mode,
      state: 'listening',
      transcript: '',
      reply: '',
      notice:
        mode === 'hold'
          ? `${listenHint} Release to send. Voice can’t approve.`
          : `${listenHint} Pause when you finish a thought. Press Space or Talk to stop.`,
    });
    this.loop();
    if (this.pendingRelease && mode === 'hold') {
      this.pendingRelease = false;
      await this.releaseTalk();
    } else {
      this.pendingRelease = false;
    }
  }

  private startBrowserRec() {
    if (!this.browserRecWanted || !this.snap.talkOn) return;
    if (this.snap.state === 'thinking' || this.snap.state === 'speaking') return;
    const SR = speechRecognitionCtor();
    if (!SR) return;
    this.stopBrowserRec(false);
    const rec = new SR();
    rec.lang = 'en-NG';
    rec.continuous = this.snap.talkMode === 'conversation';
    rec.interimResults = true;
    rec.onresult = (ev) => {
      this.lastActivity = Date.now();
      let interim = '';
      let finalText = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const row = ev.results[i]!;
        const bit = row[0]?.transcript?.trim() ?? '';
        if (!bit) continue;
        if (row.isFinal) finalText = finalText ? `${finalText} ${bit}` : bit;
        else interim = interim ? `${interim} ${bit}` : bit;
      }
      if (interim && !finalText) {
        this.set({ state: 'hearing', transcript: interim });
      }
      if (finalText) {
        this.set({ state: 'hearing', transcript: finalText });
        void this.ask(finalText);
      }
    };
    rec.onerror = (ev) => {
      const err = ev.error || '';
      if (err === 'aborted' || err === 'no-speech') return;
      this.set({
        notice:
          err === 'not-allowed'
            ? 'Mic permission denied. Allow the mic in the address bar, then try Talk again.'
            : 'Could not hear that. Try again, or add GROQ_API_KEY for Whisper.',
      });
    };
    rec.onend = () => {
      this.browserRec = null;
      if (!this.browserRecWanted || !this.snap.talkOn) return;
      if (this.snap.state === 'thinking' || this.snap.state === 'speaking') return;
      // Chromium ends recognition periodically; restart while Talk stays open.
      window.setTimeout(() => this.startBrowserRec(), 120);
    };
    this.browserRec = rec;
    try {
      rec.start();
    } catch {
      this.browserRec = null;
    }
  }

  private stopBrowserRec(clearWanted: boolean) {
    if (clearWanted) this.browserRecWanted = false;
    const rec = this.browserRec;
    this.browserRec = null;
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try {
      rec.stop();
    } catch {
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    }
  }

  stopTalk() {
    this.pendingRelease = false;
    this.sileroBusy = false;
    const silero = this.silero;
    this.silero = null;
    void silero?.destroy().catch(() => undefined);
    this.stopBrowserRec(true);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    } catch {
      /* ignore */
    }
    this.recorder = null;
    this.chunks = [];
    this.stream = null;
    const enhanced = this.enhanced;
    this.enhanced = null;
    enhanced?.destroy();
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

    // Barge-in only when she is not mid server-TTS. Speaker bleed was cutting her off
    // before a full word, which is why Talk looked silent.
    if (
      this.snap.state === 'speaking'
      && !this.speakSource
      && Date.now() - this.speakingSince > BARGE_IN_GRACE_MS
      && rms > THRESHOLD * 4.5
    ) {
      this.stopSpeaking();
      this.speechStarted = false;
      this.quietSince = 0;
      this.set({ state: 'listening' });
      return;
    }
    if (this.snap.state !== 'listening' && this.snap.state !== 'hearing') return;

    // Silero owns utterance boundaries; this loop only drives the orb + idle timeout.
    if (this.silero) {
      if (rms > THRESHOLD) this.lastActivity = now;
      if (
        this.snap.talkMode === 'conversation' &&
        !this.sileroBusy &&
        now - this.lastActivity >= IDLE_STOP_MS
      ) {
        this.stopTalk();
        this.set({ notice: 'I paused the conversation after a quiet minute. Press Space or Talk to continue.' });
      }
      return;
    }

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
      this.set({ notice: 'I paused the conversation after a quiet minute. Press Space or Talk to continue.' });
    }
  };

  private async captureSileroUtterance(audio: Float32Array) {
    if (this.sileroBusy || !this.snap.talkOn) return;
    this.sileroBusy = true;
    this.silero?.pause();
    this.set({ state: 'thinking', notice: 'Transcribing…' });
    try {
      if (audio.length < 1600) {
        this.set({ state: 'listening', notice: 'I barely caught that. Try a little louder.' });
        return;
      }
      const audioBase64 = float32ToWavBase64(audio, 16_000);
      this.set({ state: 'thinking', notice: 'Transcribing…' });
      const data = await api<{ text?: string }>(
        '/api/voice/transcribe',
        'POST',
        { audioBase64, mimeType: 'audio/wav' },
        { timeoutMs: 30_000 },
      );
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
    } finally {
      this.sileroBusy = false;
      this.lastActivity = Date.now();
      // ask()/speak() own Silero resume while thinking/speaking.
      if (
        this.snap.talkOn
        && this.silero
        && (this.snap.state === 'listening' || this.snap.state === 'hearing')
      ) {
        try {
          this.silero.start();
        } catch {
          /* ignore */
        }
      }
    }
  }

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
      const data = await api<{ text?: string }>(
        '/api/voice/transcribe',
        'POST',
        {
          audioBase64: await blobToBase64(blob),
          mimeType: blob.type || 'audio/webm',
        },
        { timeoutMs: 30_000 },
      );
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
    // Pause browser recognition so TTS / barge-in do not re-hear Funke.
    if (this.sttProvider === 'browser') this.stopBrowserRec(false);
    try {
      this.silero?.pause();
    } catch {
      /* ignore */
    }
    this.set({ state: 'thinking', transcript: text, reply: '', notice: 'Thinking…' });
    try {
      const { reply, approvals } = await askFunkeDetailed(text);
      const turn: VoiceTurn = { user: text, reply, source: 'voice' };
      pendingTurns().push(turn);
      window.dispatchEvent(new CustomEvent<VoiceTurn>('funke:turn', { detail: turn }));
      const approvalNote = approvals.length ? 'Something needs your approval. Tap Approvals.' : '';
      this.set({ reply, notice: approvalNote || 'Speaking…' });
      // Always speak after a Talk turn unless the harness muted TTS.
      const mute =
        typeof window !== 'undefined' &&
        !!(window as unknown as { __funkeMuteSpeak?: boolean }).__funkeMuteSpeak;
      if (!mute) await this.speak(reply, approvals.length > 0);
    } catch (err) {
      this.set({ notice: err instanceof Error ? err.message : 'I could not reach Funke.' });
    } finally {
      // Cursor-style: after the reply, open the ear again without the user tapping Talk.
      this.speechStarted = false;
      this.quietSince = 0;
      this.lastActivity = Date.now();
      if (this.snap.talkOn) {
        const failed = /could not|failed|blocked|too long|empty audio/i.test(this.snap.notice);
        const keepNotice = this.snap.notice.includes('approval') || failed
          ? this.snap.notice
          : this.snap.talkMode === 'conversation'
            ? 'Your turn. Keep talking, or press Space / Talk to stop.'
            : this.snap.notice;
        this.set({ state: 'listening', notice: keepNotice });
        if (this.sttProvider === 'browser') {
          this.browserRecWanted = true;
          this.startBrowserRec();
        } else if (this.silero) {
          try {
            this.silero.start();
          } catch {
            /* ignore */
          }
        }
      } else {
        this.set({ state: 'idle' });
      }
    }
  }

  private async provider(): Promise<'azure' | 'xai' | 'browser'> {
    if (this.ttsProvider) return this.ttsProvider;
    try {
      const info = await api<{ provider?: string }>('/api/voice/tts');
      this.ttsProvider =
        info.provider === 'azure' ? 'azure'
        : info.provider === 'xai' ? 'xai'
        : 'browser';
    } catch {
      this.ttsProvider = 'browser';
    }
    return this.ttsProvider;
  }

  async speak(text: string, hasApproval = false) {
    if (!text.trim()) return;
    this.stopSpeaking();
    const token = this.speakToken;
    const prev = this.snap.state;
    this.speakingSince = Date.now();
    // Pause VAD for the whole utterance so speaker bleed cannot cut her off.
    try {
      this.silero?.pause();
    } catch {
      /* ignore */
    }
    this.set({ state: 'speaking', notice: this.snap.notice.includes('approval') ? this.snap.notice : 'Speaking…' });
    try {
      const tts = await this.provider();
      if (tts === 'azure' || tts === 'xai') {
        const data = await api<{ audioBase64?: string; mimeType?: string; spoken?: string }>(
          '/api/voice/speak',
          'POST',
          { text, hasApproval },
          { timeoutMs: 30_000 },
        );
        if (data.audioBase64 && token === this.speakToken) {
          try {
            const spoken = data.spoken || text;
            this.beginLyrics(lyricLinesFrom(spoken));
            await this.playBase64(data.audioBase64, data.mimeType || 'audio/mpeg');
            return;
          } catch (err) {
            console.warn('[funke voice] decoded playback failed, trying browser voice', err);
            this.set({
              notice: err instanceof Error ? err.message : 'Speaker playback failed. Trying browser voice…',
            });
          }
        }
        // Server TTS returned empty — fall through to browser.
        this.set({ notice: 'Server voice returned empty audio. Trying browser voice…' });
      }
      let spoken = text;
      let sentences: string[] | undefined;
      try {
        const prep = await api<{ spoken?: string; sentences?: string[] }>('/api/voice/prepare', 'POST', {
          text,
          hasApproval,
        });
        if (prep.spoken) spoken = prep.spoken;
        if (prep.sentences?.length) sentences = prep.sentences;
      } catch {
        /* speak the raw text */
      }
      if (token !== this.speakToken) return;
      this.beginLyrics(lyricLinesFrom(spoken));
      await this.speakBrowser(spoken, sentences);
    } catch (err) {
      console.warn('[funke voice] speak failed', err);
      this.set({
        notice: err instanceof Error ? err.message : 'I could not play audio.',
      });
    } finally {
      this.stopLyricFollow();
      if (this.snap.state === 'speaking') {
        this.set({
          state: this.snap.talkOn ? 'listening' : prev === 'speaking' ? 'idle' : prev,
          notice: this.snap.notice === 'Speaking…' ? '' : this.snap.notice,
          lyricLines: [],
          lyricIndex: 0,
        });
      } else if (!this.snap.talkOn && this.snap.notice === 'Speaking…') {
        this.set({ notice: '', lyricLines: [], lyricIndex: 0 });
      } else if (this.snap.lyricLines.length) {
        this.set({ lyricLines: [], lyricIndex: 0 });
      }
      if (this.snap.talkOn && this.silero && this.snap.state === 'listening') {
        try {
          this.silero.start();
        } catch {
          /* ignore */
        }
      }
    }
  }

  private playBase64(b64: string, mime: string): Promise<void> {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ctx = this.outCtx;
    if (ctx && ctx.state !== 'closed') {
      return this.playViaContext(ctx, bytes);
    }
    return this.playViaElement(bytes, mime);
  }

  /** Playback through the context unlocked on the Talk press. */
  private async playViaContext(ctx: AudioContext, bytes: Uint8Array): Promise<void> {
    if (ctx.state === 'suspended') await ctx.resume();
    if (ctx.state !== 'running') {
      throw new Error('Audio output is blocked. Tap Talk once, then speak again.');
    }
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    let decoded: AudioBuffer;
    try {
      decoded = await ctx.decodeAudioData(copy);
    } catch {
      throw new Error('Could not decode her voice clip.');
    }
    if (decoded.duration < 0.05) throw new Error('Voice clip was empty.');
    await new Promise<void>((resolve, reject) => {
      const src = ctx.createBufferSource();
      src.buffer = decoded;
      src.connect(ctx.destination);
      this.speakSource = src;
      const tokenAtStart = this.speakToken;
      const startedAt = ctx.currentTime;
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        this.stopLyricFollow();
        if (this.speakSource === src) this.speakSource = null;
        if (err) reject(err);
        else resolve();
      };
      src.onended = () => finish();
      try {
        src.start();
      } catch (err) {
        finish(err instanceof Error ? err : new Error('Could not start audio.'));
        return;
      }
      this.followLyrics(() => (ctx.currentTime - startedAt) / decoded.duration);
      // stopSpeaking() bumps the token; end the wait so we don't hang.
      const watch = window.setInterval(() => {
        if (tokenAtStart !== this.speakToken) {
          window.clearInterval(watch);
          try { src.stop(); } catch { /* already stopped */ }
          finish();
        }
      }, 200);
      src.addEventListener('ended', () => window.clearInterval(watch));
    });
  }

  private playViaElement(bytes: Uint8Array, mime: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      const audio = new Audio(url);
      audio.volume = 1;
      this.audio = audio;
      const tokenAtStart = this.speakToken;
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        this.stopLyricFollow();
        if (this.audio === audio) this.audio = null;
        if (err) reject(err);
        else resolve();
      };
      audio.onended = () => finish();
      audio.onerror = () => finish(new Error('Audio playback failed.'));
      this.followLyrics(() => {
        const d = audio.duration;
        if (!d || !Number.isFinite(d)) return 0;
        return audio.currentTime / d;
      });
      audio.onpause = () => {
        if (tokenAtStart !== this.speakToken) finish();
      };
      void audio.play().then(
        () => undefined,
        (err) => finish(err instanceof Error ? err : new Error('Audio play was blocked. Tap Talk, then speak again.')),
      );
    });
  }

  private async speakBrowser(text: string, preparedSentences?: string[]): Promise<void> {
    if (!('speechSynthesis' in window)) return;
    const voices = await waitForVoices();
    const voice = pickFunkeVoice(voices);
    const sentences =
      preparedSentences?.length ? preparedSentences : splitSpokenSentences(text);
    const token = this.speakToken;
    if (!this.activeLyricLines.length) this.beginLyrics(lyricLinesFrom(sentences.join(' ')));
    const totalChars = Math.max(1, sentences.reduce((n, s) => n + s.length, 0));
    let consumed = 0;
    // Measured female cadence: slightly slow, light pitch lift, pause between sentences.
    const rate = 0.94;
    const pitch = 1.1;
    const gapMs = 240;

    for (let i = 0; i < sentences.length; i++) {
      if (token !== this.speakToken) return;
      const line = sentences[i]!;
      const from = consumed / totalChars;
      const to = (consumed + line.length) / totalChars;
      consumed += line.length;
      const t0 = Date.now();
      const est = Math.max(700, line.length * 62);
      this.followLyrics(() => from + (to - from) * Math.min(1, (Date.now() - t0) / est));
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(line);
        u.lang = voice?.lang || 'en-NG';
        if (voice) u.voice = voice;
        u.rate = rate;
        u.pitch = pitch;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        window.setTimeout(() => {
          if (token !== this.speakToken) return resolve();
          try {
            speechSynthesis.resume();
          } catch {
            /* ignore */
          }
          speechSynthesis.speak(u);
        }, i === 0 ? 40 : 0);
      });
      if (i < sentences.length - 1 && token === this.speakToken) await sleep(gapMs);
    }
  }

  private beginLyrics(lines: string[]) {
    this.activeLyricLines = lines;
    this.set({ lyricLines: lines, lyricIndex: 0 });
  }

  /** progress() returns 0..1 through the current utterance. */
  private followLyrics(progress: () => number) {
    this.stopLyricFollow();
    const tick = () => {
      const lines = this.activeLyricLines;
      if (!lines.length) return;
      const idx = lyricIndexAt(lines, progress());
      if (idx !== this.snap.lyricIndex) this.set({ lyricIndex: idx });
    };
    tick();
    this.lyricTimer = window.setInterval(tick, 90);
  }

  private stopLyricFollow() {
    if (!this.lyricTimer) return;
    window.clearInterval(this.lyricTimer);
    this.lyricTimer = 0;
  }

  stopSpeaking() {
    this.speakToken += 1;
    this.stopLyricFollow();
    this.activeLyricLines = [];
    if (this.snap.lyricLines.length) this.set({ lyricLines: [], lyricIndex: 0 });
    if (this.speakSource) {
      try { this.speakSource.stop(); } catch { /* already stopped */ }
      this.speakSource = null;
    }
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
  if (typeof window !== 'undefined') {
    (window as unknown as { __funkeVoice?: VoiceEngine }).__funkeVoice = engine;
  }
  return engine;
}

/**
 * Test/harness helper: run a spoken turn without mic audio (skips STT).
 * Still respects talkMode lifecycle used by Space hold and Talk conversation.
 */
export async function simulateSpokenTurn(text: string): Promise<string> {
  const v = voice();
  await v.ask(text);
  return v.snapshot.reply;
}
