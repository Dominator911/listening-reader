// Cleaned-text export for the future audiobook renderer (version 2).
// Format: one JSON file per book, chapters → paragraphs of speech-ready text.

import { speakable } from './speakable';
import type { BookContent, PlaybackFilters } from './types';
import { isAudible } from './types';

export interface ExportedBook {
  format: 'listening-reader/book';
  version: 1;
  title: string;
  author?: string;
  language: string;
  exportedAt: string;
  chapters: { index: number; title: string; paragraphs: string[] }[];
}

export function exportBook(meta: { title: string; author?: string; language?: string }, content: BookContent, filters: PlaybackFilters): ExportedBook {
  const chapters = content.chapters
    .map((ch) => ({
      title: ch.title,
      paragraphs: ch.paragraphs
        .filter((p) => isAudible(p, filters))
        .map((p) => p.sentences.map(speakable).filter(Boolean).join(' '))
        .filter(Boolean),
    }))
    .filter((c) => c.paragraphs.length)
    .map((c, i) => ({ index: i + 1, ...c }));
  return {
    format: 'listening-reader/book',
    version: 1,
    title: meta.title,
    ...(meta.author ? { author: meta.author } : {}),
    language: meta.language ?? 'en',
    exportedAt: new Date().toISOString(),
    chapters,
  };
}

export function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'book';
