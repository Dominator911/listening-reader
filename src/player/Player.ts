// Speech player: one utterance per sentence, so skipping is instant and long chapters never hit
// utterance-length limits. Pause is implemented as cancel + restart-the-sentence because
// speechSynthesis.pause() is unreliable on several platforms.

import * as nav from '../core/nav';
import { speakable } from '../core/speakable';
import type { BookContent, PlaybackFilters, Position } from '../core/types';

export type SleepTimer = { kind: 'minutes'; endsAt: number; minutes: number } | { kind: 'chapter' } | null;

export interface PlayerState {
  playing: boolean;
  pos: Position | null;
  rate: number;
  sleep: SleepTimer;
  /** Chapter explicitly chosen by the user; played in full even if normally skipped. */
  force: number | null;
  error?: string;
  ended: boolean;
}

export interface PlayerOptions {
  content: BookContent;
  filters: PlaybackFilters;
  rate: number;
  pos?: Position;
  voice?: SpeechSynthesisVoice;
  onPosition?: (pos: Position) => void;
  onCalibrate?: (cps: number) => void;
  onPlayingChange?: (playing: boolean) => void;
}

export const supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export class Player {
  private state: PlayerState;
  private listeners = new Set<(s: PlayerState) => void>();
  private token = 0;
  /** Kept so Safari doesn't garbage-collect the utterance and drop its events. */
  utterance?: SpeechSynthesisUtterance;
  private startedAt = 0;
  private watchdog?: ReturnType<typeof setTimeout>;
  private sleepTimer?: ReturnType<typeof setTimeout>;
  private retried = false;
  content: BookContent;
  filters: PlaybackFilters;
  voice?: SpeechSynthesisVoice;
  cps = 15;

  constructor(private opts: PlayerOptions) {
    this.content = opts.content;
    this.filters = opts.filters;
    this.voice = opts.voice;
    const pos = nav.clampPosition(this.ctx, opts.pos);
    this.state = { playing: false, pos, rate: opts.rate, sleep: null, force: null, ended: !pos };
    if (supported()) document.addEventListener('visibilitychange', this.onVisible);
  }

  get ctx(): nav.NavCtx {
    return { content: this.content, filters: this.filters, force: this.state?.force ?? null };
  }

  getState() {
    return this.state;
  }

  subscribe(fn: (s: PlayerState) => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private set(patch: Partial<PlayerState>) {
    const prevPos = this.state.pos;
    const prevPlaying = this.state.playing;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l(this.state));
    if (patch.pos && (patch.pos.c !== prevPos?.c || patch.pos.p !== prevPos?.p || patch.pos.s !== prevPos?.s)) {
      this.opts.onPosition?.(patch.pos);
    }
    if (patch.playing !== undefined && patch.playing !== prevPlaying) this.opts.onPlayingChange?.(patch.playing);
  }

  destroy() {
    this.stopSpeech();
    clearTimeout(this.sleepTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.listeners.clear();
  }

  // ───────── transport ─────────

  play() {
    if (!supported()) return this.set({ error: 'This browser has no speech synthesis.' });
    let pos = this.state.pos;
    if (!pos || this.state.ended) pos = nav.firstAudibleFrom(this.ctx, 0, 0);
    if (!pos) return;
    this.retried = false;
    this.set({ playing: true, pos, ended: false, error: undefined });
    this.speakCurrent();
  }

  pause() {
    this.stopSpeech();
    this.set({ playing: false });
  }

  toggle() {
    if (this.state.playing) this.pause();
    else this.play();
  }

  /** Move to a position; keeps playing if already playing (or if `autoplay`). */
  seek(pos: Position | null, autoplay = false) {
    if (!pos) return;
    const keepForce = this.state.force === pos.c ? this.state.force : null;
    const playing = this.state.playing || autoplay;
    this.stopSpeech();
    this.set({ pos, force: keepForce, ended: false, playing });
    if (playing) this.speakCurrent();
  }

  /** Jump to a chapter chosen by the user, and play it even if it is normally skipped. */
  playChapter(c: number) {
    const normal = nav.chapterStart({ ...this.ctx, force: null }, c);
    const force = normal ? null : c;
    this.state = { ...this.state, force };
    const pos = normal ?? nav.chapterStart({ ...this.ctx, force: c }, c);
    if (pos) this.seek(pos, true);
  }

  /** Start from a tapped sentence. */
  playAt(pos: Position) {
    const audible = nav.paraAudible({ ...this.ctx, force: null }, pos.c, pos.p);
    this.state = { ...this.state, force: audible ? null : pos.c };
    this.seek(pos, true);
  }

  nextSentence = () => this.step(nav.nextSentence);
  prevSentence = () => this.step(nav.prevSentence);
  nextParagraph = () => this.step(nav.nextParagraph);
  prevParagraph = () => this.step(nav.prevParagraph);
  nextChapter = () => this.step(nav.nextChapter);
  prevChapter = () => this.step(nav.prevChapter);

  private step(fn: (ctx: nav.NavCtx, pos: Position) => Position | null) {
    const pos = this.state.pos;
    if (!pos) return;
    const next = fn(this.ctx, pos);
    if (next) this.seek(next);
  }

  setRate(rate: number) {
    const r = Math.round(Math.min(3, Math.max(0.75, rate)) * 100) / 100;
    this.set({ rate: r });
    if (this.state.playing) this.restartSentence();
  }

  setVoice(voice?: SpeechSynthesisVoice) {
    this.voice = voice;
    if (this.state.playing) this.restartSentence();
  }

  setFilters(filters: PlaybackFilters) {
    this.filters = filters;
    this.listeners.forEach((l) => l(this.state));
  }

  setContent(content: BookContent) {
    this.content = content;
    const pos = nav.clampPosition(this.ctx, this.state.pos ?? undefined);
    this.seek(pos);
  }

  setSleep(sleep: SleepTimer) {
    clearTimeout(this.sleepTimer);
    if (sleep?.kind === 'minutes') {
      this.sleepTimer = setTimeout(() => {
        this.pause();
        this.set({ sleep: null });
      }, sleep.endsAt - Date.now());
    }
    this.set({ sleep });
  }

  // ───────── speech ─────────

  private restartSentence() {
    this.stopSpeech();
    this.speakCurrent();
  }

  private stopSpeech() {
    this.token++;
    clearTimeout(this.watchdog);
    this.utterance = undefined;
    if (supported()) speechSynthesis.cancel();
  }

  private speakCurrent() {
    const pos = this.state.pos;
    if (!pos) return;
    const sentence = this.content.chapters[pos.c]?.paragraphs[pos.p]?.sentences[pos.s];
    if (sentence === undefined) return this.advance();
    const text = speakable(sentence);
    const token = ++this.token;
    if (!text) {
      // Nothing speakable (ornament, lone symbol): move on without a pause.
      queueMicrotask(() => token === this.token && this.advance());
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.rate = this.state.rate;
    if (this.voice) u.voice = this.voice;
    u.lang = this.voice?.lang ?? 'en-US';
    u.onstart = () => {
      if (token !== this.token) return;
      this.startedAt = performance.now();
      clearTimeout(this.watchdog);
    };
    u.onend = () => {
      if (token !== this.token) return;
      this.calibrate(text.length);
      this.retried = false;
      this.advance();
    };
    u.onerror = (e) => {
      if (token !== this.token) return;
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      if (e.error === 'not-allowed') {
        // Mobile browsers need a tap before speech can start again (e.g. after the screen locked).
        this.set({ playing: false, error: 'Tap play to continue. The browser stopped speech.' });
        return;
      }
      this.set({ error: `Speech error: ${e.error}` });
      this.advance();
    };
    this.utterance = u; // keep a reference: Safari drops events of garbage-collected utterances
    this.startedAt = 0;
    speechSynthesis.speak(u);
    // Chrome occasionally swallows an utterance after cancel(); retry once if it never starts.
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      if (token !== this.token || this.startedAt || !this.state.playing) return;
      if (!this.retried) {
        this.retried = true;
        speechSynthesis.cancel();
        this.speakCurrent();
      }
    }, 2500);
  }

  private calibrate(chars: number) {
    if (!this.startedAt) return;
    const secs = (performance.now() - this.startedAt) / 1000;
    if (secs < 0.4 || chars < 20) return;
    const cps = chars / secs / this.state.rate;
    if (cps < 4 || cps > 40) return;
    this.cps = this.cps * 0.9 + cps * 0.1;
    this.opts.onCalibrate?.(this.cps);
  }

  private advance() {
    const pos = this.state.pos;
    if (!pos) return;
    const next = nav.nextSentence(this.ctx, pos);
    if (!next) {
      this.set({ playing: false, ended: true, force: null });
      return;
    }
    if (next.c !== pos.c) {
      const force = null;
      // Re-resolve without the forced chapter, so normal skipping resumes after it.
      const resolved = this.state.force === pos.c ? nav.firstAudibleFrom({ ...this.ctx, force }, next.c, next.p) : next;
      if (this.state.sleep?.kind === 'chapter') {
        this.set({ pos: resolved ?? next, playing: false, sleep: null, force });
        return;
      }
      if (!resolved) return this.set({ playing: false, ended: true, force });
      this.set({ pos: resolved, force });
    } else {
      this.set({ pos: next });
    }
    if (this.state.playing) this.speakCurrent();
  }

  /** Mobile browsers may silently stop speech while the screen is locked; restart on return. */
  private onVisible = () => {
    if (document.visibilityState !== 'visible' || !this.state.playing) return;
    setTimeout(() => {
      if (this.state.playing && !speechSynthesis.speaking && !speechSynthesis.pending) this.restartSentence();
    }, 300);
  };
}
