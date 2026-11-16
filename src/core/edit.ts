// Manual chapter fixes: rename and merge-with-next. Positions are remapped so playback
// and bookmarks keep pointing at the same sentence.

import type { BookContent, Position } from './types';

export function renameChapter(content: BookContent, c: number, title: string): BookContent {
  const t = title.trim();
  if (!t) return content;
  return { ...content, chapters: content.chapters.map((ch, i) => (i === c ? { ...ch, title: t } : ch)) };
}

export function mergeWithNext(content: BookContent, c: number): { content: BookContent; mapPos: (p: Position) => Position } {
  const chs = content.chapters;
  if (c < 0 || c >= chs.length - 1) return { content, mapPos: (p) => p };
  const a = chs[c];
  const b = chs[c + 1];
  const offset = a.paragraphs.length;
  const merged = { ...a, paragraphs: [...a.paragraphs, ...b.paragraphs] };
  const chapters = [...chs.slice(0, c), merged, ...chs.slice(c + 2)].map((ch, i) => ({ ...ch, id: `c${i}` }));
  const mapPos = (p: Position): Position => {
    if (p.c <= c) return p;
    if (p.c === c + 1) return { c, p: p.p + offset, s: p.s };
    return { ...p, c: p.c - 1 };
  };
  return { content: { ...content, chapters }, mapPos };
}

/** Chapter progress array after merging chapter c with c+1 (keeps the lower of the two). */
export function mergeProgress(progress: number[], c: number): number[] {
  const out = [...progress];
  if (c + 1 < out.length) out.splice(c, 2, Math.min(out[c] ?? 0, out[c + 1] ?? 0));
  return out;
}
