import { buildContent } from '../core/chapters';
import { db, requestPersistence, type BookRecord } from '../db';
import { parseFile } from '../parse';
import type { ParsedBook } from '../parse/types';

async function fileId(data: ArrayBuffer): Promise<string> {
  if (crypto?.subtle) {
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Non-secure contexts (plain-http LAN testing) have no subtle crypto: fall back to a cheap hash.
  const bytes = new Uint8Array(data);
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i += Math.max(1, Math.floor(bytes.length / 65536))) h = Math.imul(h ^ bytes[i], 16777619);
  return `${(h >>> 0).toString(16)}-${bytes.length.toString(16)}`;
}

export interface ImportResult {
  id: string;
  title: string;
  replaced: boolean;
  unreadable?: string;
}

/** Parse, detect chapters, clean, and store a book. Re-importing the same file keeps the position. */
export async function importBook(file: File, onProgress?: (msg: string) => void, defaultRate = 1): Promise<ImportResult> {
  onProgress?.('Reading file…');
  const data = await file.arrayBuffer();
  const id = await fileId(data);
  const book = await parseFile(file, { onProgress: (d, n) => onProgress?.(`Extracting text: page ${d} of ${n}`) });
  onProgress?.('Finding chapters…');
  return saveParsed(id, file, book, defaultRate, data);
}

/**
 * Store a parsed book. Everything binary goes into IndexedDB as an ArrayBuffer, never as a
 * Blob/File: WebKit (Safari and every iPhone browser) rejects Blobs with
 * "Error preparing Blob/File data to be stored in object store".
 */
export async function saveParsed(
  id: string,
  file: { name: string; size: number },
  book: ParsedBook,
  defaultRate = 1,
  original?: ArrayBuffer,
): Promise<ImportResult> {
  const content = buildContent(book);
  const existing = await db.books.get(id);
  let unreadable: string | undefined;
  if (book.format === 'pdf' && (book.textLayer === 'scanned' || book.textLayer === 'garbled')) unreadable = book.warnings[0];
  else if (!content.chapters.length) unreadable = 'No readable text was found in this book.';

  const sameShape = existing && existing.chapterCount === content.chapters.length;
  const record: BookRecord = {
    id,
    title: book.meta.title,
    author: book.meta.author,
    format: book.format,
    fileName: file.name,
    fileSize: file.size,
    addedAt: existing?.addedAt ?? Date.now(),
    openedAt: existing?.openedAt,
    ...(book.cover ? { coverBytes: await book.cover.arrayBuffer(), coverType: book.cover.type || 'image/jpeg' } : {}),
    chapterCount: content.chapters.length,
    warnings: [...new Set([...book.warnings, ...content.warnings])],
    rate: existing?.rate ?? defaultRate,
    // Keep the position only if the chapter structure is unchanged.
    position: sameShape ? existing?.position : undefined,
    progress: sameShape ? (existing?.progress ?? 0) : 0,
    chapterProgress: sameShape ? (existing?.chapterProgress ?? []) : [],
    ...(unreadable ? { unreadable } : {}),
  };
  await db.transaction('rw', [db.books, db.content, db.files], async () => {
    await db.books.put(record);
    await db.content.put({ id, content });
    if (original) await db.files.put({ id, data: original });
  });
  void requestPersistence();
  return { id, title: record.title, replaced: !!existing, unreadable };
}

/** Re-run parsing and cleanup from the stored original (after an app update improves detection). */
export async function reprocessBook(id: string): Promise<void> {
  const f = await db.files.get(id);
  const rec = await db.books.get(id);
  const bytes = f?.data ?? (await f?.blob?.arrayBuffer());
  if (!bytes || !rec) throw new Error('The original file is not stored for this book; import it again.');
  const file = new File([bytes], rec.fileName);
  const book = await parseFile(file);
  // Re-save the original as bytes too, which also migrates older Blob-based records.
  await saveParsed(id, file, book, rec.rate, bytes);
}
