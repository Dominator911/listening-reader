// IndexedDB storage via Dexie. Library rows are small; chapter text and the original file
// live in separate tables so the library list loads instantly.

import Dexie, { type Table } from 'dexie';
import type { BookContent, Position } from './core/types';

export interface BookRecord {
  id: string;
  title: string;
  author?: string;
  format: 'epub' | 'pdf';
  fileName: string;
  fileSize: number;
  addedAt: number;
  openedAt?: number;
  /**
   * Cover image as raw bytes. Stored as an ArrayBuffer, not a Blob: Safari/WebKit (every iPhone
   * browser) fails with "Error preparing Blob/File data to be stored" when Blobs go into IndexedDB.
   */
  coverBytes?: ArrayBuffer;
  coverType?: string;
  /** Legacy (v1 imports made in Chrome): cover stored as a Blob. */
  cover?: Blob;
  chapterCount: number;
  warnings: string[];
  /** Playback rate, remembered per book. */
  rate: number;
  position?: Position;
  /** 0–1, share of the book's text before the current position. */
  progress: number;
  /** Furthest point reached in each chapter, 0–1. */
  chapterProgress: number[];
  /** Set when the book has no readable text (scanned PDF). */
  unreadable?: string;
}

export interface ContentRecord {
  id: string;
  content: BookContent;
}

export interface FileRecord {
  id: string;
  /** Original file bytes (ArrayBuffer for the same WebKit reason as covers). */
  data?: ArrayBuffer;
  /** Legacy (v1 imports made in Chrome). */
  blob?: Blob;
}

/** The cover as a Blob for display, whichever way it was stored. */
export function coverBlob(b: Pick<BookRecord, 'cover' | 'coverBytes' | 'coverType'>): Blob | undefined {
  if (b.coverBytes) return new Blob([b.coverBytes], { type: b.coverType ?? 'image/jpeg' });
  return b.cover;
}

export interface Bookmark {
  id?: number;
  bookId: string;
  name: string;
  pos: Position;
  createdAt: number;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

class ReaderDB extends Dexie {
  books!: Table<BookRecord, string>;
  content!: Table<ContentRecord, string>;
  files!: Table<FileRecord, string>;
  bookmarks!: Table<Bookmark, number>;
  settings!: Table<SettingRecord, string>;

  constructor() {
    super('listening-reader');
    this.version(1).stores({
      books: 'id, openedAt, addedAt',
      content: 'id',
      files: 'id',
      bookmarks: '++id, bookId',
      settings: 'key',
    });
  }
}

export const db = new ReaderDB();

export async function deleteBook(id: string): Promise<void> {
  await db.transaction('rw', [db.books, db.content, db.files, db.bookmarks], async () => {
    await db.books.delete(id);
    await db.content.delete(id);
    await db.files.delete(id);
    await db.bookmarks.where('bookId').equals(id).delete();
  });
}

/** Ask the browser not to evict our data under storage pressure (best effort). */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
