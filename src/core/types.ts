// The processed, speech-ready book model that the player, reader and export use.

export type ParaKind = 'text' | 'heading' | 'table' | 'image';
/** Why a paragraph may be skipped; each reason has its own toggle. */
export type SkipReason = 'footnote' | 'front' | 'index';

export interface Paragraph {
  kind: ParaKind;
  /** Display text. */
  text: string;
  /** Display sentences; speech uses speakable(sentence). Empty → nothing to say. */
  sentences: string[];
  skip?: SkipReason;
  level?: number;
}

export interface Chapter {
  id: string;
  title: string;
  depth: number;
  paragraphs: Paragraph[];
}

export type ChapterSource = 'toc' | 'spine' | 'outline' | 'headings' | 'sections';

export interface BookContent {
  chapters: Chapter[];
  chapterSource: ChapterSource;
  warnings: string[];
}

/** Chapter / paragraph / sentence indexes into BookContent (unfiltered). */
export interface Position {
  c: number;
  p: number;
  s: number;
}

export interface PlaybackFilters {
  footnotes: boolean;
  frontMatter: boolean;
  index: boolean;
  /** 'describe' reads a short description of tables/images, 'skip' leaves them out. */
  figures: 'describe' | 'skip';
}

export const DEFAULT_FILTERS: PlaybackFilters = { footnotes: false, frontMatter: false, index: false, figures: 'describe' };

export function isAudible(p: Paragraph, f: PlaybackFilters): boolean {
  if (!p.sentences.length) return false;
  if (p.skip === 'footnote' && !f.footnotes) return false;
  if (p.skip === 'front' && !f.frontMatter) return false;
  if (p.skip === 'index' && !f.index) return false;
  if ((p.kind === 'table' || p.kind === 'image') && f.figures === 'skip') return false;
  return true;
}

export function wordCount(s: string): number {
  return (s.match(/\S+/g) ?? []).length;
}

export function chapterWords(c: Chapter): number {
  return c.paragraphs.reduce((n, p) => n + wordCount(p.text), 0);
}

/** A chapter is "skipped" when none of its paragraphs would be spoken with these filters. */
export function chapterAudible(c: Chapter, f: PlaybackFilters): boolean {
  return c.paragraphs.some((p) => isAudible(p, f));
}
