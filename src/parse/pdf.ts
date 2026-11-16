// PDF text extraction with pdf.js: positioned lines per page, outline, and a text-layer health check.
// Header/footer stripping, paragraph rebuilding and hyphen repair happen later in cleanup;
// this layer keeps the geometry (x, y, font size) those steps need.

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { ParsedPdf, PdfLine, PdfPage, TextLayerStatus, TocEntry } from './types';
import { normalizeText } from './xhtml';

export class PdfError extends Error {}

/** Minimal shape of a pdf.js text item that the line builder needs (also used by tests). */
export interface RawItem {
  str: string;
  /** [a, b, c, d, e, f] text matrix: e,f = position; hypot(c,d) ≈ font size. */
  transform: number[];
  width: number;
  fontName: string;
}

interface Placed {
  str: string;
  x: number;
  y: number;
  w: number;
  fs: number;
  font: string;
}

const MARKER = /^\s*(\d{1,3}|[*†‡§]+)\s*$/;

/**
 * Group raw text items into visual lines (top to bottom, left to right).
 * Raised small-font markers next to a line (footnote references like ¹²) are removed
 * and counted rather than becoming lines of their own.
 */
export function buildLines(items: RawItem[]): { lines: PdfLine[]; markersRemoved: number } {
  const placed: Placed[] = [];
  for (const it of items) {
    if (!it.str) continue;
    const [a, b, c, d, e, f] = it.transform;
    // Skip strongly rotated text (vertical margin notes, watermarks); it is never body text.
    if (Math.abs(b) > Math.abs(a) * 0.2 && Math.abs(c) > Math.abs(d) * 0.2) continue;
    const fs = Math.hypot(c, d) || Math.hypot(a, b) || 1;
    placed.push({ str: it.str, x: e, y: f, w: it.width, fs, font: it.fontName });
  }
  placed.sort((p, q) => q.y - p.y || p.x - q.x);

  type L = { y: number; fs: number; items: Placed[] };
  const lines: L[] = [];
  const small: Placed[] = [];
  for (const p of placed) {
    if (!p.str.trim()) {
      // Whitespace-only items carry no position info worth keeping; spacing is rebuilt from gaps.
      continue;
    }
    let target: L | undefined;
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 6); i--) {
      const l = lines[i];
      if (Math.abs(p.y - l.y) <= 0.35 * Math.max(l.fs, p.fs)) {
        target = l;
        break;
      }
    }
    if (target) {
      target.items.push(p);
      if (p.fs > target.fs && p.str.trim().length > 2) target.fs = p.fs;
    } else if (MARKER.test(p.str) && p.str.trim().length <= 3) {
      // Possibly a superscript; decide once all normal lines exist.
      small.push(p);
    } else {
      lines.push({ y: p.y, fs: p.fs, items: [p] });
    }
  }

  let markersRemoved = 0;
  for (const s of small) {
    // A raised, smaller marker sitting within the line's height just after a glyph run → footnote ref.
    const host = lines.find((l) => s.fs < l.fs * 0.9 && s.y > l.y && s.y - l.y < l.fs * 0.8);
    if (host) {
      markersRemoved++;
      continue;
    }
    // Not a superscript: maybe a page number on its own line, keep it (cleanup decides).
    const same = lines.find((l) => Math.abs(s.y - l.y) <= 0.35 * Math.max(l.fs, s.fs));
    if (same) same.items.push(s);
    else lines.push({ y: s.y, fs: s.fs, items: [s] });
  }
  lines.sort((p, q) => q.y - p.y);

  const out: PdfLine[] = [];
  for (const l of lines) {
    l.items.sort((p, q) => p.x - q.x);
    let text = '';
    let prevEnd = -Infinity;
    const fontChars = new Map<string, number>();
    let sizeWeighted = 0;
    let chars = 0;
    for (const it of l.items) {
      const gap = it.x - prevEnd;
      // A gap wider than ~2 em is a column gap (tables, tab stops): mark it with a tab.
      if (text && gap > 2 * l.fs) text = text.trimEnd() + '\t';
      else if (text && gap > 0.15 * l.fs && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' ';
      text += it.str;
      prevEnd = Math.max(prevEnd, it.x + it.w);
      const n = it.str.length;
      fontChars.set(it.font, (fontChars.get(it.font) ?? 0) + n);
      sizeWeighted += it.fs * n;
      chars += n;
    }
    const clean = text
      .split('\t')
      .map(normalizeText)
      .filter(Boolean)
      .join('\t');
    if (!clean) continue;
    const first = l.items[0];
    const fontName = [...fontChars.entries()].sort((a, b) => b[1] - a[1])[0][0];
    out.push({
      text: clean,
      x: round(first.x),
      y: round(l.y),
      width: round(prevEnd - first.x),
      fontSize: round(sizeWeighted / Math.max(1, chars)),
      fontName,
    });
  }
  return { lines: out, markersRemoved };
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Classify how usable the text layer is. */
export function textLayerStatus(pageChars: number[], allText: string): { status: TextLayerStatus; empty: number[] } {
  const empty = pageChars.map((n, i) => (n < 10 ? i : -1)).filter((i) => i >= 0);
  const total = pageChars.length;
  if (!total) return { status: 'scanned', empty };
  if (empty.length / total >= 0.9) return { status: 'scanned', empty };
  const sample = allText.slice(0, 200_000);
  const nonSpace = sample.replace(/\s/g, '');
  const bad = (nonSpace.match(/[-�\u0000-\u0008\u000E-\u001F]/g) ?? []).length;
  // Wrong font encodings often yield text with almost no vowels or common words.
  const letters = (nonSpace.match(/\p{L}/gu) ?? []).length;
  const vowels = (nonSpace.match(/[aeiouyAEIOUY]/g) ?? []).length;
  if (nonSpace.length > 500 && (bad / nonSpace.length > 0.1 || (letters > 500 && vowels / letters < 0.2))) {
    return { status: 'garbled', empty };
  }
  if (total > 2 && empty.length / total >= 0.2) return { status: 'partial', empty };
  return { status: 'ok', empty };
}

export interface PdfParseOptions {
  onProgress?: (done: number, total: number) => void;
  /** Render a small first-page thumbnail as the cover (browser only). */
  renderCover?: boolean;
}

export async function parsePdf(data: ArrayBuffer | Uint8Array, opts: PdfParseOptions = {}): Promise<ParsedPdf> {
  let pdf: PDFDocumentProxy;
  let task: ReturnType<typeof pdfjs.getDocument> | undefined;
  try {
    // pdf.js transfers (detaches) the buffer it is given, so hand it a copy.
    const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
    // Text extraction needs no font files; system fonts are only used to draw the cover thumbnail.
    task = pdfjs.getDocument({ data: bytes, useSystemFonts: typeof document !== 'undefined', verbosity: 0 });
    pdf = await task.promise;
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (/password/i.test(msg)) throw new PdfError('This PDF is password-protected. Remove the password and try again.');
    throw new PdfError(`Could not open this PDF: ${msg}`);
  }
  const warnings: string[] = [];

  const info = (await pdf.getMetadata().catch(() => null))?.info as Record<string, unknown> | undefined;
  const str = (v: unknown) => (typeof v === 'string' && normalizeText(v)) || undefined;
  const meta = {
    title: str(info?.Title) ?? 'Untitled',
    author: str(info?.Author),
    language: str(info?.Language),
  };

  const labels = await pdf.getPageLabels().catch(() => null);
  const n = pdf.numPages;
  const pages: PdfPage[] = new Array(n);
  let markersRemoved = 0;
  let done = 0;
  const BATCH = 8;
  for (let start = 0; start < n; start += BATCH) {
    const idx = Array.from({ length: Math.min(BATCH, n - start) }, (_, i) => start + i);
    await Promise.all(
      idx.map(async (i) => {
        const page = await pdf.getPage(i + 1);
        const vp = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        const raw = (tc.items as unknown[]).filter((it): it is RawItem => typeof (it as RawItem).str === 'string');
        const built = buildLines(raw);
        markersRemoved += built.markersRemoved;
        pages[i] = {
          index: i,
          width: round(vp.width),
          height: round(vp.height),
          lines: built.lines,
          ...(labels?.[i] ? { label: labels[i] } : {}),
        };
        page.cleanup();
        opts.onProgress?.(++done, n);
      }),
    );
  }

  const pageChars = pages.map((p) => p.lines.reduce((s, l) => s + l.text.replace(/\s/g, '').length, 0));
  const allText = pages.map((p) => p.lines.map((l) => l.text).join('\n')).join('\n');
  const { status, empty } = textLayerStatus(pageChars, allText);
  if (status === 'scanned') {
    warnings.push(
      'This looks like a scanned PDF: its pages are images with no text layer, so there is nothing to read aloud. ' +
        'Run it through OCR first (for example ocrmypdf, or Preview/Acrobat "Recognize Text"), then import the result.',
    );
  } else if (status === 'garbled') {
    warnings.push(
      'The text layer in this PDF looks garbled (broken font encoding), so speech would be nonsense. ' +
        'Re-running OCR on it usually fixes this.',
    );
  } else if (status === 'partial') {
    warnings.push(`${empty.length} of ${n} pages have no text layer (likely scanned pages or full-page images); they will be skipped.`);
  }
  if (markersRemoved) warnings.push(`Removed ${markersRemoved} superscript footnote markers.`);

  const outline = await readOutline(pdf).catch((e) => {
    warnings.push(`Could not read the PDF outline: ${(e as Error).message}`);
    return [] as TocEntry[];
  });

  let cover: Blob | undefined;
  if (opts.renderCover && typeof document !== 'undefined') cover = await renderThumb(pdf).catch(() => undefined);

  await task.destroy();
  return { format: 'pdf', meta, cover, outline, pages, textLayer: status, emptyPages: empty, warnings };
}

type OutlineNode = { title: string; dest: unknown; items: OutlineNode[] };

async function readOutline(pdf: PDFDocumentProxy): Promise<TocEntry[]> {
  const root = (await pdf.getOutline()) as OutlineNode[] | null;
  if (!root) return [];
  const out: TocEntry[] = [];
  const walk = async (nodes: OutlineNode[], depth: number) => {
    for (const node of nodes) {
      const entry: TocEntry = { title: normalizeText(node.title ?? ''), depth };
      try {
        let dest = node.dest as unknown;
        if (typeof dest === 'string') dest = await pdf.getDestination(dest);
        if (Array.isArray(dest) && dest.length) {
          const ref = dest[0];
          entry.pageIndex =
            typeof ref === 'number' ? ref : await pdf.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0]);
          const kind = (dest[1] as { name?: string } | undefined)?.name;
          if (kind === 'XYZ' && typeof dest[3] === 'number') entry.top = dest[3];
          else if ((kind === 'FitH' || kind === 'FitBH') && typeof dest[2] === 'number') entry.top = dest[2];
        }
      } catch {
        /* unresolved destination: keep the title, page unknown */
      }
      if (entry.title) out.push(entry);
      if (node.items?.length) await walk(node.items, depth + 1);
    }
  };
  await walk(root, 0);
  return out;
}

async function renderThumb(pdf: PDFDocumentProxy): Promise<Blob | undefined> {
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: 240 / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return new Promise((res) => canvas.toBlob((b) => res(b ?? undefined), 'image/jpeg', 0.8));
}
