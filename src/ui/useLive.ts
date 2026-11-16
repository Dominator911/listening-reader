import { liveQuery } from 'dexie';
import { useEffect, useMemo, useState } from 'react';
import { coverBlob, type BookRecord } from '../db';

/** Subscribe to a Dexie query; re-runs whenever the tables it reads change. */
export function useLive<T>(query: () => Promise<T>, deps: unknown[]): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setValue, error: (e) => console.error(e) });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

/** Object URL for a book's cover, however it was stored. */
export function useCoverUrl(book: Pick<BookRecord, 'id' | 'cover' | 'coverBytes' | 'coverType'>): string | undefined {
  // Key on the id: live queries hand back fresh objects on every change, but a cover never changes.
  const blob = useMemo(() => coverBlob(book), [book.id, !!book.coverBytes, !!book.cover]); // eslint-disable-line react-hooks/exhaustive-deps
  return useObjectUrl(blob);
}

/** Object URL for a blob, revoked when it changes or the component unmounts. */
export function useObjectUrl(blob?: Blob): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) return setUrl(undefined);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}
