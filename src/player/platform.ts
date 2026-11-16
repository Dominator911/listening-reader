// Browser integrations around speech: wake lock, a silent audio loop that lets the
// Media Session (headphone buttons, lock-screen controls) attach to this page, and voices.

let lock: WakeLockSentinel | null = null;
let wantLock = false;

export async function keepScreenOn(on: boolean): Promise<void> {
  wantLock = on;
  try {
    if (on && !lock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => (lock = null));
    } else if (!on && lock) {
      await lock.release();
      lock = null;
    }
  } catch {
    lock = null; // Denied (battery saver, unsupported in this context): nothing else to do.
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (wantLock && document.visibilityState === 'visible') void keepScreenOn(true);
  });
}

export const wakeLockSupported = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator;

// ───────── Silent audio loop ─────────

let audio: HTMLAudioElement | undefined;

/** A 5-second silent 8 kHz mono WAV (Chrome only shows media controls for media ≥ 5 s). */
function silentWavUrl(): string {
  const rate = 8000;
  const n = rate * 5;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  str(36, 'data');
  v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128); // 8-bit silence is the midpoint
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

export async function silentAudio(on: boolean): Promise<void> {
  if (!on) {
    audio?.pause();
    return;
  }
  if (!audio) {
    audio = new Audio(silentWavUrl());
    audio.loop = true;
    audio.preload = 'auto';
  }
  try {
    await audio.play();
  } catch {
    /* autoplay rules: will retry on the next user-initiated play */
  }
}

// ───────── Media Session ─────────

export interface MediaHandlers {
  play: () => void;
  pause: () => void;
  prevChapter: () => void;
  nextChapter: () => void;
  back: () => void;
  forward: () => void;
}

export function setupMediaSession(h: MediaHandlers): void {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const set = (a: MediaSessionAction, fn: (() => void) | null) => {
    try {
      ms.setActionHandler(a, fn);
    } catch {
      /* action unsupported here */
    }
  };
  set('play', h.play);
  set('pause', h.pause);
  set('stop', h.pause);
  set('previoustrack', h.prevChapter);
  set('nexttrack', h.nextChapter);
  set('seekbackward', h.back);
  set('seekforward', h.forward);
}

export function updateMediaMetadata(meta: { title: string; artist?: string; album: string; artwork?: string }, playing: boolean) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: meta.title,
      artist: meta.artist ?? '',
      album: meta.album,
      artwork: meta.artwork ? [{ src: meta.artwork, sizes: '512x512' }] : [],
    });
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  } catch {
    /* ignore */
  }
}

// ───────── Voices ─────────

const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Pipe Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Deranged|Hysterical|Junior|Ralph|Fred|Kathy|Princess)\b/;

export function englishVoices(all: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const en = all.filter((v) => /^en([-_]|$)/i.test(v.lang) && !NOVELTY.test(v.name));
  const list = en.length ? en : all;
  const quality = (v: SpeechSynthesisVoice) => (/premium|enhanced|natural|neural/i.test(v.name) ? 0 : 1);
  return [...list].sort((a, b) => quality(a) - quality(b) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
}
