// Turns positioned PDF lines into clean paragraphs:
// strips running headers/footers and page numbers, separates footnotes, spots tables,
// flags front-matter pages, rejoins hyphenated words and paragraphs split across pages.

import type { ParsedPdf, PdfLine } from '../parse/types';

export interface PdfPara {
  kind: 'text' | 'heading' | 'table';
  text: string;
  page: number;
  /** Baseline of the first line (PDF points from the bottom). */
  y: number;
  fontSize: number;
  lineCount: number;
  skip?: 'footnote' | 'front';
  /** First paragraph that starts on its page. */
  pageTop: boolean;
  rows?: number;
  cols?: number;
}

export interface CleanPdf {
  paras: PdfPara[];
  bodySize: number;
  removedLines: number;
  frontPages: number[];
}

const PAGE_NUMBER = [
  /^(page\s+)?(\d{1,4}|[ivxlcdm]{1,7})(\s*(of|\/)\s*\d{1,4})?$/i,
  /^[-–—|•·[(]\s*(\d{1,4}|[ivxlcdm]{1,7})\s*[-–—|•·\])]$/i,
];
const COPYRIGHT = /all rights reserved|\bisbn\b|library of congress|first published|printed in (the )?(united|usa|u\.s|great|china|canada)|cataloging[- ]in[- ]publication|no part of this (book|publication)/i;
const TOC_LINE = /(\.{2,}|…|\s)\s*(\d{1,4}|[ivxlc]{1,6})$/i;
const SENTENCE_END = /[.!?:"”’)\]…]$/;
const NOTE_START = /^(\d{1,3}|[*†‡§¶])[.)]?\s/;

export const isPageNumber = (t: string) => PAGE_NUMBER.some((re) => re.test(t.replace(/\t/g, ' ').trim()));

/** Normalise a header/footer line so "12 THE BOOK" and "14 THE BOOK" compare equal. */
export function headerKey(t: string): string {
  return t
    .toLowerCase()
    .replace(/\t/g, ' ')
    .replace(/\d+/g, '#')
    .replace(/^[ivxlcdm]+\b|\b[ivxlcdm]+$/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

const roundHalf = (n: number) => Math.round(n * 2) / 2;
const words = (s: string) => (s.match(/\S+/g) ?? []).length;

function weightedMode(values: [number, number][]): number {
  const m = new Map<number, number>();
  for (const [v, w] of values) m.set(v, (m.get(v) ?? 0) + w);
  let best = 0;
  let bestW = -1;
  for (const [v, w] of m) if (w > bestW) [best, bestW] = [v, w];
  return best;
}

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

/** Collect the document's vocabulary to decide whether "well-" + "known" keeps its hyphen. */
export function vocabulary(lines: string[]): Set<string> {
  const v = new Set<string>();
  for (const line of lines) {
    const toks = line.match(/[\p{L}]+(?:-[\p{L}]+)*/gu) ?? [];
    if (/-$/.test(line)) toks.pop(); // the broken word at the end of a line is not evidence
    for (const t of toks) v.add(t.toLowerCase());
  }
  return v;
}

/** Join two consecutive lines of the same paragraph, repairing end-of-line hyphenation. */
export function joinLines(prev: string, next: string, vocab: Set<string>): string {
  const hy = /([\p{L}]+)[-‐­¬]$/u.exec(prev);
  if (hy && /^[\p{Ll}]/u.test(next)) {
    const left = hy[1];
    const right = /^[\p{L}]+/u.exec(next)?.[0] ?? '';
    const joined = (left + right).toLowerCase();
    const hyphenated = `${left}-${right}`.toLowerCase();
    const keepHyphen = !vocab.has(joined) && vocab.has(hyphenated);
    return keepHyphen ? prev.replace(/[‐­¬]$/, '-') + next : prev.slice(0, -1) + next;
  }
  if (/-$/.test(prev) && /^[\p{Lu}\d]/u.test(next)) return prev + next; // "Anglo-" + "Saxon"
  return `${prev} ${next}`;
}

/** Remove footnote numbers glued to the end of words in plain text: "the end.12 Then" → "the end. Then". */
export function stripInlineMarkers(t: string): string {
  return t.replace(/([\p{Ll}][.,;:!?”"’)])\d{1,3}(?=\s|$)/gu, '$1');
}

interface Ln extends PdfLine {
  page: number;
  role: 'body' | 'heading' | 'footnote' | 'table';
}

export function cleanPdf(book: Pick<ParsedPdf, 'pages'>): CleanPdf {
  const pages = book.pages;
  const allLines = pages.flatMap((p) => p.lines);
  const bodySize = weightedMode(allLines.map((l) => [roundHalf(l.fontSize), l.text.length])) || 10;
  const isBodySize = (fs: number) => Math.abs(fs - bodySize) <= bodySize * 0.08;

  // 1. Running headers, footers and page numbers.
  const zone = (p: (typeof pages)[number], i: number, l: PdfLine) => {
    const n = p.lines.length;
    const top = i < 2 && l.y >= p.height * 0.85;
    const bottom = i >= n - 2 && l.y <= p.height * 0.15;
    return top || bottom;
  };
  const keyPages = new Map<string, number>();
  for (const p of pages) {
    const seen = new Set<string>();
    p.lines.forEach((l, i) => {
      if (zone(p, i, l)) seen.add(headerKey(l.text));
    });
    seen.forEach((k) => keyPages.set(k, (keyPages.get(k) ?? 0) + 1));
  }
  // Typical line spacing and full line width of body text, to tell headers from body lines.
  const rawGaps: number[] = [];
  for (const p of pages)
    for (let i = 1; i < p.lines.length; i++) {
      const g = p.lines[i - 1].y - p.lines[i].y;
      if (isBodySize(p.lines[i].fontSize) && isBodySize(p.lines[i - 1].fontSize) && g > 0 && g < bodySize * 3) rawGaps.push(g);
    }
  const rawSpacing = percentile(rawGaps, 0.5) || bodySize * 1.2;
  const rawFull = percentile(
    allLines.filter((l) => isBodySize(l.fontSize)).map((l) => l.width),
    0.9,
  );
  /** A running header looks different from body text: smaller, shorter, or set apart. */
  const looksLikeHeader = (p: (typeof pages)[number], i: number, l: PdfLine) => {
    if (l.fontSize < bodySize * 0.97 || l.width < rawFull * 0.75) return true;
    const neighbour = i < p.lines.length / 2 ? p.lines[i + 1] : p.lines[i - 1];
    return !neighbour || Math.abs(l.y - neighbour.y) > rawSpacing * 1.4;
  };

  let removedLines = 0;
  const kept: PdfLine[][] = pages.map((p) =>
    p.lines.filter((l, i) => {
      if (!zone(p, i, l)) return true;
      const repeated = (keyPages.get(headerKey(l.text)) ?? 0) >= 3 && l.fontSize <= bodySize * 1.15 && looksLikeHeader(p, i, l);
      if (isPageNumber(l.text) || repeated) {
        removedLines++;
        return false;
      }
      return true;
    }),
  );

  // 2. Front-matter pages (copyright, contents, title pages).
  const frontPages: number[] = [];
  const earlyLimit = Math.max(8, Math.round(pages.length * 0.05));
  kept.forEach((lines, i) => {
    const text = lines.map((l) => l.text).join(' ');
    const w = words(text);
    if (!w) return;
    const copyright = COPYRIGHT.test(text) && w < 700;
    const tocHits = lines.filter((l) => TOC_LINE.test(l.text.replace(/\t/g, ' '))).length;
    const hasContentsTitle = lines.some((l) => /^(table of )?contents$/i.test(l.text.trim()));
    const toc = lines.length >= 5 && (tocHits / lines.length >= 0.5 || (hasContentsTitle && tocHits / lines.length >= 0.3));
    const titleish = i < earlyLimit && w < 40;
    if (copyright || toc || titleish) frontPages.push(i);
  });
  const front = new Set(frontPages);

  // 3. Classify lines: footnotes below the last body-size line, tables, headings.
  const roled: Ln[][] = kept.map((lines, page) => {
    let lastBody = -1;
    lines.forEach((l, i) => {
      if (isBodySize(l.fontSize)) lastBody = i;
    });
    const out: Ln[] = lines.map((l, i) => ({
      ...l,
      page,
      role:
        lastBody >= 0 && i > lastBody && l.fontSize < bodySize * 0.92
          ? 'footnote'
          : l.fontSize >= bodySize * 1.12
            ? 'heading'
            : 'body',
    }));
    // Runs of 3+ lines with column gaps are tables.
    for (let i = 0; i < out.length; ) {
      let j = i;
      while (j < out.length && out[j].role !== 'footnote' && out[j].text.includes('\t')) j++;
      if (j - i >= 3) for (let k = i; k < j; k++) out[k].role = 'table';
      i = Math.max(j, i + 1);
    }
    return out;
  });

  // 4. Layout statistics.
  const bodyLines = roled.flat().filter((l) => l.role === 'body' && isBodySize(l.fontSize));
  const gaps: number[] = [];
  for (const lines of roled)
    for (let i = 1; i < lines.length; i++) {
      const a = lines[i - 1];
      const b = lines[i];
      if (a.role === 'body' && b.role === 'body') {
        const g = a.y - b.y;
        if (g > 0 && g < bodySize * 3) gaps.push(g);
      }
    }
  const spacing = percentile(gaps, 0.5) || bodySize * 1.2;
  const fullWidth = percentile(
    bodyLines.map((l) => l.width),
    0.9,
  );
  const leftX = roled.map((lines) => {
    const xs = lines.filter((l) => l.role === 'body').map((l) => [Math.round(l.x), 1] as [number, number]);
    return xs.length ? weightedMode(xs) : 0;
  });
  const indented = (l: Ln) => l.x > leftX[l.page] + bodySize * 0.6 && l.x < leftX[l.page] + bodySize * 5;
  const usesIndent = bodyLines.length > 0 && bodyLines.filter(indented).length / bodyLines.length >= 0.03;
  const endsShort = (l: Ln) => l.width < fullWidth * 0.72 && SENTENCE_END.test(l.text);

  const vocab = vocabulary(allLines.map((l) => l.text));

  // 5. Assemble paragraphs.
  const paras: PdfPara[] = [];
  let cur: (PdfPara & { last: Ln }) | null = null;
  let pendingNotes: PdfPara[] = [];
  let pageHasPara = false;

  const push = (p: PdfPara) => {
    if (!pageHasPara && p.skip !== 'footnote') {
      p.pageTop = true;
      pageHasPara = true;
    }
    paras.push(p);
  };
  const flush = () => {
    if (cur) {
      const { last: _last, ...p } = cur;
      void _last;
      p.text = stripInlineMarkers(p.text.replace(/\t/g, ' ')).replace(/\s+/g, ' ').trim();
      if (p.text) paras.push(p);
      cur = null;
    }
    paras.push(...pendingNotes);
    pendingNotes = [];
  };
  const start = (l: Ln, kind: PdfPara['kind']) => {
    flush();
    cur = {
      kind,
      text: l.text,
      page: l.page,
      y: l.y,
      fontSize: l.fontSize,
      lineCount: 1,
      pageTop: false,
      last: l,
      ...(front.has(l.page) ? { skip: 'front' as const } : {}),
    };
    if (!pageHasPara) {
      cur.pageTop = true;
      pageHasPara = true;
    }
  };

  for (const lines of roled) {
    pageHasPara = false;
    const notes: PdfPara[] = [];
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (l.role === 'table') {
        let j = i;
        while (j < lines.length && lines[j].role === 'table') j++;
        const rows = lines.slice(i, j);
        flush();
        push({
          kind: 'table',
          text: rows.map((r) => r.text.split('\t').join(' | ')).join(' / '),
          page: l.page,
          y: l.y,
          fontSize: l.fontSize,
          lineCount: rows.length,
          rows: rows.length,
          cols: Math.max(...rows.map((r) => r.text.split('\t').length)),
          pageTop: false,
          ...(front.has(l.page) ? { skip: 'front' as const } : {}),
        });
        i = j;
        continue;
      }
      if (l.role === 'footnote') {
        const prevNote = notes[notes.length - 1];
        if (prevNote && !NOTE_START.test(l.text)) {
          prevNote.text = joinLines(prevNote.text, l.text, vocab);
          prevNote.lineCount++;
        } else {
          notes.push({ kind: 'text', text: l.text, page: l.page, y: l.y, fontSize: l.fontSize, lineCount: 1, skip: 'footnote', pageTop: false });
        }
        i++;
        continue;
      }
      const c = cur as (PdfPara & { last: Ln }) | null;
      if (l.role === 'heading') {
        const sameHeading =
          c && c.kind === 'heading' && c.last.page === l.page && Math.abs(c.fontSize - l.fontSize) <= c.fontSize * 0.15 && c.last.y - l.y < l.fontSize * 2.5;
        if (sameHeading) {
          c.text = joinLines(c.text, l.text, vocab);
          c.lineCount++;
          c.last = l;
        } else start(l, 'heading');
        i++;
        continue;
      }
      // Body line.
      let newPara = !c || c.kind !== 'text' || !!c.skip !== front.has(l.page);
      if (!newPara && c) {
        const prev = c.last;
        if (prev.page === l.page) {
          newPara = prev.y - l.y > spacing * 1.45 || indented(l) || endsShort(prev);
        } else {
          // Continuing across a page break unless there's evidence of a new paragraph.
          newPara =
            indented(l) ||
            endsShort(prev) ||
            (!usesIndent && /[.!?"”’…]$/.test(prev.text) && /^[\p{Lu}“"‘]/u.test(l.text));
        }
      }
      if (newPara) start(l, 'text');
      else if (c) {
        c.text = joinLines(c.text, l.text, vocab);
        c.lineCount++;
        c.last = l;
      }
      i++;
    }
    // Footnotes are emitted after the paragraph that is open at the end of this page closes.
    pendingNotes.push(...notes);
  }
  flush();

  return { paras, bodySize, removedLines, frontPages };
}
