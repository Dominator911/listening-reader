// Chapter detection.
//   EPUB: table of contents (nav/NCX) → spine order.
//   PDF:  outline/bookmarks → headings ("Chapter 3", large type) → even ~15-minute sections.
// Also classifies front matter, notes and index so they can be skipped by default.

import type { Block, ParsedEpub, ParsedPdf, SpineDoc, TocEntry } from '../parse/types';
import { cleanPdf, type PdfPara } from './pdfClean';
import { splitSentences } from './sentences';
import type { BookContent, Chapter, ChapterSource, Paragraph, SkipReason } from './types';
import { wordCount } from './types';

/** Average chapter length (words) we aim for when choosing TOC depth: ~12 min at 1x. */
export const TARGET_CHAPTER_WORDS = 2000;
/** Fallback section length: ~15 minutes at 1x (≈170 words/min). */
export const SECTION_WORDS = 2550;

const FRONT_TYPES = new Set(['cover', 'titlepage', 'halftitlepage', 'copyright-page', 'toc', 'imprint', 'loi', 'lot', 'imprimatur']);
const NOTE_TYPES = new Set(['endnotes', 'footnotes', 'rearnotes']);
const FRONT_TITLE =
  /^(cover|title( page)?|half[- ]title|copyright( page)?|contents|table of contents|imprint|also by .{1,60}|by the same author|other (books|titles) by .{1,60}|praise for .{1,80}|about the publisher)$/i;
const COPYRIGHT = /all rights reserved|\bisbn\b|library of congress|first published|cataloging[- ]in[- ]publication/i;
const CHAPTER_RE =
  /^(chapter|part|book|section|letter|canto|volume)\b\.?\s*([0-9]+|[ivxlcdm]+\b|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|the\b)?|^(prologue|epilogue|introduction|preface|foreword|afterword|conclusion|appendix|interlude|postscript)\b/i;

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function makeParagraph(kind: Paragraph['kind'], text: string, skip?: SkipReason, extra: Partial<Paragraph> = {}): Paragraph {
  let sentences: string[];
  if (kind === 'table') sentences = [describeTable(extra as { rows?: number; cols?: number }, text)];
  else if (kind === 'image') sentences = text ? [`Image: ${text.replace(/[.\s]+$/, '')}.`] : [];
  else sentences = splitSentences(text);
  const p: Paragraph = { kind, text, sentences, ...extra };
  if (skip) p.skip = skip;
  return p;
}

function describeTable(t: { rows?: number; cols?: number }, text: string): string {
  if (t.rows && t.cols) return `Table with ${t.rows} rows and ${t.cols} columns, not read aloud.`;
  return text.length < 80 ? `Table: ${text}.` : 'Table, not read aloud.';
}

/** Merge chapters that are only a heading (e.g. "Part One") into the chapter that follows. */
export function mergeTinyChapters(chapters: Chapter[]): Chapter[] {
  const out: Chapter[] = [];
  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i];
    const next = chapters[i + 1];
    const headingOnly = c.paragraphs.every((p) => p.kind === 'heading' || !p.sentences.length);
    const skipped = c.paragraphs.some((p) => p.skip === 'front' || p.skip === 'index');
    const nextSkipped = !!next && next.paragraphs.length > 0 && next.paragraphs.every((p) => p.skip);
    if (next && headingOnly && !skipped && !nextSkipped && c.paragraphs.length) {
      chapters[i + 1] = {
        ...next,
        title:
          !c.paragraphs.some((p) => p.kind === 'heading') || norm(c.title) === norm(next.title)
            ? next.title
            : `${c.title}: ${next.title}`,
        depth: Math.min(c.depth, next.depth),
        paragraphs: [...c.paragraphs, ...next.paragraphs],
      };
      continue;
    }
    if (c.paragraphs.length) out.push(c);
  }
  return out.map((c, i) => ({ ...c, id: `c${i}` }));
}

interface Start {
  idx: number;
  title: string;
  depth: number;
}

/** Sort, de-duplicate, and pick the deepest TOC level that still gives chapters of a useful length. */
export function chooseStarts(starts: Start[], wordsAt: number[]): Start[] {
  const sorted = starts
    .map((s, order) => ({ ...s, order }))
    .sort((a, b) => a.idx - b.idx || a.depth - b.depth || a.order - b.order)
    .filter((s, i, arr) => i === 0 || s.idx !== arr[i - 1].idx);
  if (!sorted.length) return [];
  const total = wordsAt[wordsAt.length - 1];
  const depths = [...new Set(sorted.map((s) => s.depth))].sort((a, b) => a - b);
  let best = depths[0];
  for (const d of depths) {
    const chosen = sorted.filter((s) => s.depth <= d);
    const covered = total - wordsAt[chosen[0].idx];
    // Heading-only entries ("Part One" pages) get merged later, so they don't count as chapters.
    const real = chosen.filter((s, i) => (wordsAt[chosen[i + 1]?.idx ?? wordsAt.length - 1] ?? total) - wordsAt[s.idx] >= 50).length;
    if (real && covered / real >= TARGET_CHAPTER_WORDS) best = d;
  }
  return sorted.filter((s) => s.depth <= best).map(({ order: _o, ...s }) => (void _o, s));
}

/** Cumulative word counts: wordsAt[i] = words in paragraphs [0, i). */
function cumulativeWords(paras: Paragraph[]): number[] {
  const out = [0];
  for (const p of paras) out.push(out[out.length - 1] + wordCount(p.text));
  return out;
}

function sliceChapters(paras: Paragraph[], starts: Start[], leading: (from: number, to: number) => Chapter[]): Chapter[] {
  const chapters: Chapter[] = [];
  if (starts.length && starts[0].idx > 0) chapters.push(...leading(0, starts[0].idx));
  starts.forEach((s, i) => {
    const end = starts[i + 1]?.idx ?? paras.length;
    chapters.push({ id: '', title: s.title, depth: s.depth, paragraphs: paras.slice(s.idx, end) });
  });
  return chapters;
}

// ───────────────────────────── EPUB ─────────────────────────────

function firstHeading(blocks: Block[]): string | undefined {
  return blocks.find((b) => b.type === 'heading' && b.text)?.text;
}

export function classifyEpubDoc(doc: SpineDoc, landmarkTypes: string[], tocTitles: Set<string>): SkipReason | undefined {
  const types = new Set([...doc.semantics, ...landmarkTypes.flatMap((t) => t.split(/\s+/))]);
  const title = firstHeading(doc.blocks) ?? doc.title ?? '';
  const text = doc.blocks.map((b) => b.text).join(' ');
  const w = wordCount(text);
  if (types.has('index') || /^index$/i.test(title.trim())) return 'index';
  const textBlocks = doc.blocks.filter((b) => b.type === 'text' || b.type === 'footnote');
  const noteShare = textBlocks.length ? textBlocks.filter((b) => b.type === 'footnote').length / textBlocks.length : 0;
  if ([...types].some((t) => NOTE_TYPES.has(t)) || /^(end)?notes$/i.test(title.trim()) || (textBlocks.length >= 3 && noteShare >= 0.6)) {
    return 'footnote';
  }
  if ([...types].some((t) => FRONT_TYPES.has(t)) || FRONT_TITLE.test(title.trim())) return 'front';
  if (w < 600 && COPYRIGHT.test(text)) return 'front';
  const nonEmpty = doc.blocks.filter((b) => b.text);
  if (nonEmpty.length >= 5 && nonEmpty.filter((b) => tocTitles.has(norm(b.text))).length / nonEmpty.length >= 0.6) return 'front';
  return undefined;
}

function blockToParagraph(b: Block, docSkip?: SkipReason): Paragraph {
  const skip: SkipReason | undefined = b.type === 'footnote' ? 'footnote' : docSkip;
  switch (b.type) {
    case 'heading':
      return makeParagraph('heading', b.text, skip, { level: b.level });
    case 'table':
      return makeParagraph('table', b.text, skip, { rows: b.rows, cols: b.cols } as Partial<Paragraph>);
    case 'image':
      return makeParagraph('image', b.text, skip);
    default:
      return makeParagraph('text', b.text, skip);
  }
}

export function epubChapters(book: ParsedEpub): BookContent {
  const warnings: string[] = [];
  const tocTitles = new Set(book.toc.map((t) => norm(t.title)));
  const landmarksByHref = new Map<string, string[]>();
  for (const l of book.landmarks) landmarksByHref.set(l.href, [...(landmarksByHref.get(l.href) ?? []), l.type]);

  const paras: Paragraph[] = [];
  const paraDoc: number[] = [];
  const docStart = new Map<string, number>();
  const anchorAt = new Map<string, number>();
  const docSkips: (SkipReason | undefined)[] = [];

  book.spine.forEach((doc, d) => {
    const skip = classifyEpubDoc(doc, landmarksByHref.get(doc.href) ?? [], tocTitles);
    docSkips.push(skip);
    if (!docStart.has(doc.href)) docStart.set(doc.href, paras.length);
    for (const b of doc.blocks) {
      for (const a of b.anchors ?? []) {
        const key = `${doc.href}#${a}`;
        if (!anchorAt.has(key)) anchorAt.set(key, paras.length);
      }
      paras.push(blockToParagraph(b, skip));
      paraDoc.push(d);
    }
  });
  const wordsAt = cumulativeWords(paras);

  const docTitle = (d: number, n: number) => {
    const doc = book.spine[d];
    const h = firstHeading(doc.blocks);
    if (h) return h;
    if (doc.title && norm(doc.title) !== norm(book.meta.title)) return doc.title;
    const skip = docSkips[d];
    if (skip === 'front') return doc.semantics.includes('copyright-page') ? 'Copyright' : doc.semantics.includes('cover') ? 'Cover' : 'Front matter';
    return `Section ${n}`;
  };
  const byDoc = (from: number, to: number): Chapter[] => {
    const out: Chapter[] = [];
    for (let i = from; i < to; ) {
      const d = paraDoc[i];
      let j = i;
      while (j < to && paraDoc[j] === d) j++;
      out.push({ id: '', title: docTitle(d, out.length + 1), depth: 0, paragraphs: paras.slice(i, j) });
      i = j;
    }
    return out;
  };

  // Resolve TOC entries to paragraph indexes.
  const resolve = (t: TocEntry): number | undefined => {
    if (!t.href) return undefined;
    const idx = (t.fragment ? anchorAt.get(`${t.href}#${t.fragment}`) : undefined) ?? docStart.get(t.href);
    return idx !== undefined && idx < paras.length ? idx : undefined;
  };
  const tocStarts: Start[] = [];
  for (const t of book.toc) {
    const idx = resolve(t);
    if (idx !== undefined) tocStarts.push({ idx, title: t.title, depth: t.depth });
  }
  const starts = chooseStarts(tocStarts, wordsAt);
  const total = wordsAt[wordsAt.length - 1] || 1;
  const usable = starts.length >= 2 && wordsAt[starts[0].idx] / total < 0.5;

  let chapters: Chapter[];
  let source: ChapterSource;
  if (usable) {
    chapters = starts[0].idx > 0 ? byDoc(0, starts[0].idx) : [];
    starts.forEach((s, i) => {
      const end = starts[i + 1]?.idx ?? paras.length;
      // Documents inside a TOC range that classify differently (e.g. an untitled Notes or Index
      // file after the last chapter) become chapters of their own so they can be skipped.
      let segStart = s.idx;
      let title = s.title;
      for (let k = s.idx + 1; k <= end; k++) {
        const boundary = k === end || (paraDoc[k] !== paraDoc[k - 1] && docSkips[paraDoc[k]] !== docSkips[paraDoc[segStart]]);
        if (!boundary) continue;
        chapters.push({ id: '', title, depth: s.depth, paragraphs: paras.slice(segStart, k) });
        if (k < end) {
          segStart = k;
          title = docTitle(paraDoc[k], chapters.length + 1);
        }
      }
    });
    source = 'toc';
  } else {
    if (book.toc.length) warnings.push('The table of contents did not match the text well; chapters follow the reading order instead.');
    // One chapter per document, folding heading-less continuation files into the previous chapter.
    chapters = [];
    for (const c of byDoc(0, paras.length)) {
      const prev = chapters[chapters.length - 1];
      const hasHeading = c.paragraphs.some((p) => p.kind === 'heading');
      const skip = c.paragraphs[0]?.skip;
      const prevSkip = prev?.paragraphs[0]?.skip;
      if (prev && !hasHeading && !skip && !prevSkip && /^Section \d+$/.test(c.title)) prev.paragraphs.push(...c.paragraphs);
      else chapters.push(c);
    }
    source = 'spine';
  }
  return { chapters: mergeTinyChapters(chapters), chapterSource: source, warnings };
}

// ───────────────────────────── PDF ─────────────────────────────

function pdfParagraph(p: PdfPara): Paragraph {
  if (p.kind === 'table') return makeParagraph('table', p.text, p.skip, { rows: p.rows, cols: p.cols } as Partial<Paragraph>);
  return makeParagraph(p.kind, p.text, p.skip);
}

export function evenSections(paras: Paragraph[], from = 0, sectionWords = SECTION_WORDS): Chapter[] {
  const out: Chapter[] = [];
  let cur: Paragraph[] = [];
  let w = 0;
  for (let i = from; i < paras.length; i++) {
    cur.push(paras[i]);
    w += wordCount(paras[i].text);
    // Prefer to break before a heading once we are reasonably close to the target.
    const nextIsHeading = paras[i + 1]?.kind === 'heading';
    if (w >= sectionWords || (nextIsHeading && w >= sectionWords * 0.6)) {
      out.push({ id: '', title: `Section ${out.length + 1}`, depth: 0, paragraphs: cur });
      cur = [];
      w = 0;
    }
  }
  if (cur.length) {
    // Fold a short tail into the previous section.
    if (out.length && w < sectionWords * 0.25) out[out.length - 1].paragraphs.push(...cur);
    else out.push({ id: '', title: `Section ${out.length + 1}`, depth: 0, paragraphs: cur });
  }
  return out;
}

export function headingStarts(pp: PdfPara[], wordsAt: number[]): { starts: Start[]; via: 'pattern' | 'size' } | undefined {
  const isCandidate = (p: PdfPara) => !p.skip && p.kind !== 'table' && wordCount(p.text) <= 15;
  const withSubtitle = (i: number, maxWords = 3): Start => {
    const p = pp[i];
    const next = pp[i + 1];
    let title = p.text;
    // "CHAPTER 3" followed by its name in large type on the same page.
    if (next && next.kind === 'heading' && next.page === p.page && wordCount(next.text) <= 12 && !CHAPTER_RE.test(next.text) && wordCount(p.text) <= maxWords) {
      title = `${p.text}: ${next.text}`;
    }
    return { idx: i, title, depth: 0 };
  };

  // 1. Explicit patterns ("Chapter 3", "Part II", "Epilogue") set as a heading or at the top of a page.
  const pattern: Start[] = [];
  pp.forEach((p, i) => {
    if (isCandidate(p) && CHAPTER_RE.test(p.text) && (p.kind === 'heading' || p.pageTop)) pattern.push(withSubtitle(i));
  });
  if (pattern.length >= 3) return { starts: pattern, via: 'pattern' };

  // 2. Font size: the threshold that yields the most chapters while keeping them a useful length.
  const heads = pp.map((p, i) => ({ p, i })).filter(({ p }) => isCandidate(p) && p.kind === 'heading');
  const sizes = [...new Set(heads.map(({ p }) => Math.round(p.fontSize * 2) / 2))].sort((a, b) => b - a);
  const total = wordsAt[wordsAt.length - 1];
  let best: Start[] | undefined;
  for (const s of sizes) {
    const idxs = heads.filter(({ p }) => p.fontSize >= s - 0.25).map(({ i }) => i);
    // Consecutive heading paragraphs belong to one title.
    const starts: Start[] = [];
    for (const i of idxs) {
      const prev = starts[starts.length - 1];
      // A heading directly after a start is its subtitle, not a new chapter.
      if (prev && i === prev.idx + 1) continue;
      starts.push(withSubtitle(i, 6));
    }
    if (starts.length < 3) continue;
    const avg = (total - wordsAt[starts[0].idx]) / starts.length;
    if (avg >= 1200 && (!best || starts.length > best.length)) best = starts;
  }
  return best ? { starts: best, via: 'size' } : undefined;
}

function outlineStarts(outline: TocEntry[], pp: PdfPara[], wordsAt: number[]): Start[] {
  const raw: Start[] = [];
  for (const e of outline) {
    if (e.pageIndex === undefined) continue;
    const onPage = pp.map((p, i) => ({ p, i })).filter(({ p }) => p.page === e.pageIndex && p.skip !== 'footnote');
    const key = norm(e.title).slice(0, 24);
    let idx = key ? onPage.find(({ p }) => norm(p.text).startsWith(key) || key.startsWith(norm(p.text).slice(0, 24)) && norm(p.text).length > 3)?.i : undefined;
    if (idx === undefined && e.top !== undefined) idx = onPage.find(({ p }) => p.y <= e.top! + 2)?.i;
    if (idx === undefined) idx = onPage[0]?.i ?? pp.findIndex((p) => p.page > e.pageIndex!);
    if (idx !== undefined && idx >= 0) raw.push({ idx, title: e.title, depth: e.depth });
  }
  return chooseStarts(raw, wordsAt);
}

export function pdfChapters(book: ParsedPdf): BookContent {
  const warnings: string[] = [];
  if (book.textLayer === 'scanned' || book.textLayer === 'garbled') {
    return { chapters: [], chapterSource: 'sections', warnings: [...book.warnings] };
  }
  const clean = cleanPdf(book);
  const pp = clean.paras;
  const paras = pp.map(pdfParagraph);
  const wordsAt = cumulativeWords(paras);
  const leading = (from: number, to: number): Chapter[] => [{ id: '', title: 'Opening pages', depth: 0, paragraphs: paras.slice(from, to) }];

  let chapters: Chapter[] | undefined;
  let source: ChapterSource = 'sections';

  if (book.outline.length) {
    const starts = outlineStarts(book.outline, pp, wordsAt);
    const total = wordsAt[wordsAt.length - 1] || 1;
    if (starts.length >= 2 && wordsAt[starts[0].idx] / total < 0.5) {
      chapters = sliceChapters(paras, starts, leading);
      source = 'outline';
    } else warnings.push('The PDF bookmarks did not match the text well; detecting chapters from headings instead.');
  }
  if (!chapters) {
    const h = headingStarts(pp, wordsAt);
    if (h) {
      chapters = sliceChapters(paras, h.starts, leading);
      source = 'headings';
    }
  }
  if (!chapters) {
    const firstBody = paras.findIndex((p) => !p.skip);
    const lead = firstBody > 0 ? leading(0, firstBody) : [];
    chapters = [...lead, ...evenSections(paras, Math.max(0, firstBody))];
    source = 'sections';
    warnings.push('No chapters found; the book is split into sections of about 15 minutes each (at 1x).');
  }
  return { chapters: mergeTinyChapters(chapters), chapterSource: source, warnings };
}

export function buildContent(book: ParsedEpub | ParsedPdf): BookContent {
  return book.format === 'epub' ? epubChapters(book) : pdfChapters(book);
}
