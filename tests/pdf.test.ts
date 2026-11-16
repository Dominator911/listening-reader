// @vitest-environment node
import { createRequire } from 'node:module';
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { buildLines, parsePdf, textLayerStatus, type RawItem } from '../src/parse/pdf';
import { sniffFormat } from '../src/parse/index';
import { makePdf } from './fixtures';

GlobalWorkerOptions.workerSrc = createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');

const item = (str: string, x: number, y: number, size = 11, width = str.length * size * 0.5): RawItem => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width,
  fontName: 'F1',
});

describe('buildLines', () => {
  it('groups items on one baseline and orders lines top to bottom', () => {
    const { lines } = buildLines([item('world', 100, 500), item('second', 50, 485), item('Hello', 50, 500.5, 11, 40)]);
    expect(lines.map((l) => l.text)).toEqual(['Hello world', 'second']);
  });

  it('does not insert spaces inside tightly kerned words', () => {
    const { lines } = buildLines([item('Hel', 50, 500, 11, 16.5), item('lo', 66.6, 500)]);
    expect(lines[0].text).toBe('Hello');
  });

  it('drops raised small footnote markers', () => {
    const { lines, markersRemoved } = buildLines([item('end of a sentence.', 50, 500, 11, 90), item('12', 141, 504, 7)]);
    expect(lines.map((l) => l.text)).toEqual(['end of a sentence.']);
    expect(markersRemoved).toBe(1);
  });

  it('keeps a standalone page number as its own line', () => {
    const { lines } = buildLines([item('Body text here', 50, 500), item('42', 200, 40, 9)]);
    expect(lines.map((l) => l.text)).toEqual(['Body text here', '42']);
  });

  it('skips rotated margin text', () => {
    const rotated: RawItem = { str: 'Downloaded from somewhere', transform: [0, 9, -9, 0, 20, 300], width: 100, fontName: 'F1' };
    expect(buildLines([rotated, item('Body', 50, 500)]).lines.map((l) => l.text)).toEqual(['Body']);
  });
});

describe('textLayerStatus', () => {
  const prose = 'The quick brown fox jumps over the lazy dog. '.repeat(30);
  it('flags scanned documents', () => expect(textLayerStatus([0, 2, 0, 0, 0, 0, 0, 0, 0, 0], '').status).toBe('scanned'));
  it('flags partially scanned documents', () =>
    expect(textLayerStatus([500, 500, 0, 0, 500, 500, 500, 500], prose).status).toBe('partial'));
  it('accepts normal text', () => expect(textLayerStatus([500, 500, 500], prose).status).toBe('ok'));
  it('flags garbled encodings', () => {
    const garbage = ' '.repeat(400);
    expect(textLayerStatus([500, 500, 500], garbage).status).toBe('garbled');
  });
});

describe('sniffFormat', () => {
  it('detects by magic bytes, not name', () => {
    expect(sniffFormat(new TextEncoder().encode('%PDF-1.7'), 'book.epub')).toBe('pdf');
    expect(sniffFormat(new Uint8Array([0x50, 0x4b, 3, 4]), 'book.pdf')).toBe('epub');
    expect(sniffFormat(new Uint8Array([1, 2, 3]), 'notes.txt')).toBeUndefined();
  });
});

describe('parsePdf on a generated book', async () => {
  const bytes = await makePdf({
    pages: 4,
    title: 'Generated',
    header: (p) => (p % 2 ? 'THE GENERATED BOOK' : 'Chapter One'),
    footer: (p) => String(p + 1),
    body: (p) => [`This is page ${p + 1} of the body text, and it con-`, 'tinues on the next line.^3', 'Last line.'],
  });
  const book = await parsePdf(bytes);

  it('reads metadata and page count', () => {
    expect(book.meta.title).toBe('Generated');
    expect(book.meta.author).toBe('Pdf Author');
    expect(book.pages).toHaveLength(4);
    expect(book.textLayer).toBe('ok');
  });

  it('extracts positioned lines with font sizes, header first and page number last', () => {
    const p = book.pages[1];
    expect(p.lines.map((l) => l.text)).toEqual([
      'THE GENERATED BOOK',
      'This is page 2 of the body text, and it con-',
      'tinues on the next line.',
      'Last line.',
      '2',
    ]);
    expect(p.lines[0].fontSize).toBe(9);
    expect(p.lines[1].fontSize).toBe(11);
  });

  it('removes superscript markers', () => {
    expect(book.warnings.join(' ')).toMatch(/Removed 4 superscript/);
  });
});

describe('parsePdf scanned detection', async () => {
  it('reports a PDF with no text as scanned with a clear message', async () => {
    const book = await parsePdf(await makePdf({ pages: 5, body: () => [], blankPages: [0, 1, 2, 3, 4] }));
    expect(book.textLayer).toBe('scanned');
    expect(book.warnings[0]).toMatch(/scanned PDF/);
  });

  it('reports a partial text layer', async () => {
    const book = await parsePdf(
      await makePdf({ pages: 5, body: () => ['Some real words on this page.'], blankPages: [1, 3] }),
    );
    expect(book.textLayer).toBe('partial');
    expect(book.emptyPages).toEqual([1, 3]);
  });
});
