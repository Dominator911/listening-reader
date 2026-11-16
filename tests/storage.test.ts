// Regression: WebKit (Safari and every iPhone browser) cannot store Blob/File values in
// IndexedDB ("Error preparing Blob/File data to be stored in object store"), so nothing we
// save may contain one.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { coverBlob, db } from '../src/db';
import { saveParsed } from '../src/library/importBook';
import { parseEpub } from '../src/parse/epub';
import { makeEpub3 } from './fixtures';

function findBlob(v: unknown, path = 'record'): string | undefined {
  if (v instanceof Blob) return path;
  if (v && typeof v === 'object' && !(v instanceof ArrayBuffer) && !ArrayBuffer.isView(v)) {
    for (const [k, x] of Object.entries(v)) {
      const hit = findBlob(x, `${path}.${k}`);
      if (hit) return hit;
    }
  }
  return undefined;
}

describe('storage', () => {
  it('stores books, covers and original files without any Blob values', async () => {
    const bytes = await makeEpub3();
    const book = await parseEpub(bytes);
    expect(book.cover).toBeInstanceOf(Blob);
    const original = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const r = await saveParsed('test-id', { name: 't.epub', size: bytes.length }, book, 1.5, original);

    const rec = await db.books.get(r.id);
    const content = await db.content.get(r.id);
    const file = await db.files.get(r.id);
    expect(findBlob(rec)).toBeUndefined();
    expect(findBlob(content)).toBeUndefined();
    expect(findBlob(file)).toBeUndefined();
    expect(file?.data?.byteLength).toBe(bytes.length);
    expect(rec?.coverType).toBe('image/png');
    expect(coverBlob(rec!)?.size).toBe(4);
    expect(rec?.rate).toBe(1.5);
  });
});
