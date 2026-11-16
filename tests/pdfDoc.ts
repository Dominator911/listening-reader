// Builds ParsedPdf-shaped page data directly, for cleanup and chapter tests.
import type { PdfLine, PdfPage } from '../src/parse/types';

export interface L {
  t: string;
  size?: number;
  /** Left indent in points relative to the margin. */
  indent?: number;
  /** Line width as a fraction of the full measure (default 1). */
  w?: number;
  /** Extra vertical space before this line, in points. */
  gap?: number;
}

const H = 648;
const W = 432;
const LEFT = 54;
const MEASURE = 324;

export function page(index: number, body: (L | string)[], opts: { header?: string; footer?: string; notes?: string[] } = {}): PdfPage {
  const lines: PdfLine[] = [];
  const mk = (t: string, x: number, y: number, size: number, width: number): PdfLine => ({ text: t, x, y, width, fontSize: size, fontName: 'F1' });
  if (opts.header) lines.push(mk(opts.header, LEFT, 610, 9, 150));
  let y = 570;
  for (const raw of body) {
    const l: L = typeof raw === 'string' ? { t: raw } : raw;
    const size = l.size ?? 11;
    y -= l.gap ?? 0;
    lines.push(mk(l.t, LEFT + (l.indent ?? 0), y, size, MEASURE * (l.w ?? 1)));
    y -= size * 1.35;
  }
  let ny = 80;
  for (const n of opts.notes ?? []) {
    lines.push(mk(n, LEFT, ny, 8.5, MEASURE));
    ny -= 11;
  }
  if (opts.footer) lines.push(mk(opts.footer, 210, 36, 9, 12));
  return { index, width: W, height: H, lines };
}

/**
 * Filler lines of ordinary prose (full width). `word` should differ per page, otherwise identical
 * lines at the top/bottom of many pages are (correctly) treated as running headers.
 */
export const prose = (n: number, word: string) =>
  Array.from({ length: n }, (_, i) => `${word} ipsum dolor sit amet line ${i} with enough words to look like body text`);

/** A letters-only tag for page i ("aa", "ba", …), since digits are ignored when comparing headers. */
export const tag = (i: number) => String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26));
