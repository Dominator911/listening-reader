// Global preferences, stored in IndexedDB and mirrored in React state.
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_FILTERS, type PlaybackFilters } from './core/types';
import { db } from './db';

export interface Prefs {
  voiceURI?: string;
  theme: 'system' | 'light' | 'dark';
  fontSize: number;
  filters: PlaybackFilters;
  /** Play a silent audio loop so headphone buttons / lock-screen controls attach to the app. */
  mediaControls: boolean;
  /** Learned speaking speed at rate 1.0, characters per second. */
  cps: number;
  /** Rate given to newly imported books. */
  lastRate: number;
}

export const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  fontSize: 19,
  filters: DEFAULT_FILTERS,
  // On iOS a playing <audio> element can interrupt speech synthesis, so this starts off there.
  mediaControls: !isIOS(),
  cps: 15,
  lastRate: 1.5,
};

let cache: Prefs | undefined;
const listeners = new Set<(p: Prefs) => void>();

export async function loadPrefs(): Promise<Prefs> {
  if (cache) return cache;
  const rec = await db.settings.get('prefs').catch(() => undefined);
  const stored = (rec?.value ?? {}) as Partial<Prefs>;
  cache = { ...DEFAULT_PREFS, ...stored, filters: { ...DEFAULT_FILTERS, ...stored.filters } };
  return cache;
}

export function getPrefs(): Prefs {
  return cache ?? DEFAULT_PREFS;
}

export async function setPrefs(patch: Partial<Prefs>): Promise<void> {
  cache = { ...(await loadPrefs()), ...patch };
  listeners.forEach((l) => l(cache!));
  await db.settings.put({ key: 'prefs', value: cache });
}

export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const [prefs, set] = useState<Prefs>(getPrefs());
  useEffect(() => {
    listeners.add(set);
    void loadPrefs().then(set);
    return () => void listeners.delete(set);
  }, []);
  const update = useCallback((patch: Partial<Prefs>) => void setPrefs(patch), []);
  return [prefs, update];
}

export function applyTheme(theme: Prefs['theme']) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
