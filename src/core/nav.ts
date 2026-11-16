// Pure navigation over the book, honouring the skip filters.
// `force` is a chapter the user explicitly chose: inside it everything with text is played.

import type { BookContent, PlaybackFilters, Position } from './types';
import { isAudible } from './types';

export interface NavCtx {
  content: BookContent;
  filters: PlaybackFilters;
  force?: number | null;
}

export function paraAudible(ctx: NavCtx, c: number, p: number): boolean {
  const para = ctx.content.chapters[c]?.paragraphs[p];
  if (!para) return false;
  if (ctx.force === c) return para.sentences.length > 0;
  return isAudible(para, ctx.filters);
}

/** First audible paragraph at or after (c, p), possibly in later chapters. */
export function firstAudibleFrom(ctx: NavCtx, c: number, p: number): Position | null {
  const chs = ctx.content.chapters;
  for (let ci = c; ci < chs.length; ci++) {
    for (let pi = ci === c ? p : 0; pi < chs[ci].paragraphs.length; pi++) {
      if (paraAudible(ctx, ci, pi)) return { c: ci, p: pi, s: 0 };
    }
  }
  return null;
}

/** Last audible paragraph at or before (c, p), positioned at its first or last sentence. */
export function lastAudibleBefore(ctx: NavCtx, c: number, p: number, at: 'first' | 'last'): Position | null {
  const chs = ctx.content.chapters;
  for (let ci = Math.min(c, chs.length - 1); ci >= 0; ci--) {
    for (let pi = ci === c ? p : chs[ci].paragraphs.length - 1; pi >= 0; pi--) {
      if (paraAudible(ctx, ci, pi)) {
        const n = chs[ci].paragraphs[pi].sentences.length;
        return { c: ci, p: pi, s: at === 'last' ? n - 1 : 0 };
      }
    }
  }
  return null;
}

export function nextSentence(ctx: NavCtx, pos: Position): Position | null {
  const para = ctx.content.chapters[pos.c]?.paragraphs[pos.p];
  if (para && pos.s + 1 < para.sentences.length) return { ...pos, s: pos.s + 1 };
  return firstAudibleFrom(ctx, pos.c, pos.p + 1);
}

export function prevSentence(ctx: NavCtx, pos: Position): Position | null {
  if (pos.s > 0) return { ...pos, s: pos.s - 1 };
  return lastAudibleBefore(ctx, pos.c, pos.p - 1, 'last');
}

export function nextParagraph(ctx: NavCtx, pos: Position): Position | null {
  return firstAudibleFrom(ctx, pos.c, pos.p + 1);
}

/** Back to the start of this paragraph, or the previous one if already at its start. */
export function prevParagraph(ctx: NavCtx, pos: Position): Position | null {
  if (pos.s > 0) return { ...pos, s: 0 };
  return lastAudibleBefore(ctx, pos.c, pos.p - 1, 'first');
}

export function chapterStart(ctx: NavCtx, c: number): Position | null {
  const pos = firstAudibleFrom(ctx, c, 0);
  return pos && pos.c === c ? pos : null;
}

export function nextChapter(ctx: NavCtx, pos: Position): Position | null {
  for (let c = pos.c + 1; c < ctx.content.chapters.length; c++) {
    const start = chapterStart({ ...ctx, force: null }, c);
    if (start) return start;
  }
  return null;
}

/** Back to the start of this chapter, or the previous playable chapter if already at its start. */
export function prevChapter(ctx: NavCtx, pos: Position): Position | null {
  const here = chapterStart(ctx, pos.c);
  if (here && (here.p < pos.p || (here.p === pos.p && pos.s > 0))) return here;
  for (let c = pos.c - 1; c >= 0; c--) {
    const start = chapterStart({ ...ctx, force: null }, c);
    if (start) return start;
  }
  return here;
}

/** Make an arbitrary (possibly stale) position valid. */
export function clampPosition(ctx: NavCtx, pos: Position | undefined): Position | null {
  const chs = ctx.content.chapters;
  if (!pos || !chs.length) return firstAudibleFrom(ctx, 0, 0);
  const c = Math.min(Math.max(0, pos.c), chs.length - 1);
  const paras = chs[c].paragraphs;
  const p = Math.min(Math.max(0, pos.p), paras.length - 1);
  const n = paras[p]?.sentences.length ?? 0;
  if (!n) return firstAudibleFrom(ctx, c, p) ?? firstAudibleFrom(ctx, 0, 0);
  return { c, p, s: Math.min(Math.max(0, pos.s), n - 1) };
}

// ───────── Lengths, for progress and time estimates ─────────

export interface Lengths {
  /** chars[c][p] = characters in each sentence of that paragraph (0 if not audible). */
  sentence: number[][][];
  chapter: number[];
  total: number;
}

export function lengths(ctx: NavCtx): Lengths {
  const sentence = ctx.content.chapters.map((ch, c) =>
    ch.paragraphs.map((para, p) => (paraAudible(ctx, c, p) ? para.sentences.map((s) => s.length + 1) : [])),
  );
  const chapter = sentence.map((ps) => ps.reduce((n, ss) => n + ss.reduce((a, b) => a + b, 0), 0));
  return { sentence, chapter, total: chapter.reduce((a, b) => a + b, 0) };
}

/** Audible characters in chapter `pos.c` before the position. */
export function charsBeforeInChapter(len: Lengths, pos: Position): number {
  const ps = len.sentence[pos.c] ?? [];
  let n = 0;
  for (let p = 0; p < ps.length; p++) {
    if (p < pos.p) n += ps[p].reduce((a, b) => a + b, 0);
    else if (p === pos.p) n += ps[p].slice(0, pos.s).reduce((a, b) => a + b, 0);
  }
  return n;
}

export function charsBefore(len: Lengths, pos: Position): number {
  let n = 0;
  for (let c = 0; c < pos.c; c++) n += len.chapter[c];
  return n + charsBeforeInChapter(len, pos);
}
