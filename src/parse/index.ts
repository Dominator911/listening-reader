// Parsers are loaded on demand so the app shell stays small (pdf.js alone is ~800 kB).
import type { PdfParseOptions } from './pdf';
import type { ParsedBook } from './types';

export class UnsupportedFileError extends Error {}

/** Detect the format from the file's first bytes (names and MIME types are unreliable on phones). */
export function sniffFormat(head: Uint8Array, name = ''): 'epub' | 'pdf' | undefined {
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf'; // %PDF
  if (head[0] === 0x50 && head[1] === 0x4b) return 'epub'; // PK (zip)
  // Some PDFs have junk before the header; the spec allows it within the first 1024 bytes.
  const start = new TextDecoder('latin1').decode(head.slice(0, 1024));
  if (start.includes('%PDF-')) return 'pdf';
  if (/\.epub$/i.test(name)) return 'epub';
  if (/\.pdf$/i.test(name)) return 'pdf';
  return undefined;
}

export async function parseFile(file: File, opts: PdfParseOptions = {}): Promise<ParsedBook> {
  const data = await file.arrayBuffer();
  const format = sniffFormat(new Uint8Array(data, 0, Math.min(1024, data.byteLength)), file.name);
  if (format === 'pdf') {
    const [{ parsePdf }] = await Promise.all([import('./pdf'), import('./pdfWorker')]);
    const book = await parsePdf(data, { renderCover: true, ...opts });
    if (book.meta.title === 'Untitled') book.meta.title = titleFromName(file.name);
    return book;
  }
  if (format === 'epub') {
    const { parseEpub } = await import('./epub');
    const book = await parseEpub(data);
    if (book.meta.title === 'Untitled') book.meta.title = titleFromName(file.name);
    return book;
  }
  throw new UnsupportedFileError(`"${file.name}" is not an EPUB or PDF file.`);
}

export function titleFromName(name: string): string {
  return name.replace(/\.(epub|pdf)$/i, '').replace(/[_]+/g, ' ').trim() || 'Untitled';
}

export type { ParsedBook } from './types';
