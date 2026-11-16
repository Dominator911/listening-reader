// Debug page (open with #inspect): shows what the parser extracts from a file, without saving it.
import { useCallback, useRef, useState } from 'react';
import { parseFile } from '../parse';
import type { ParsedBook } from '../parse/types';
import { Inspector } from './Inspector';
import './inspect.css';

export interface Loaded {
  id: string;
  fileName: string;
  sizeBytes: number;
  ms: number;
  book?: ParsedBook;
  error?: string;
  progress?: string;
}

export default function InspectPage() {
  const [items, setItems] = useState<Loaded[]>([]);
  const [selected, setSelected] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const update = (id: string, patch: Partial<Loaded>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const id = `${file.name}-${file.size}-${Date.now()}`;
      setItems((xs) => [{ id, fileName: file.name, sizeBytes: file.size, ms: 0, progress: 'Reading…' }, ...xs]);
      setSelected(id);
      const t0 = performance.now();
      try {
        const book = await parseFile(file, { onProgress: (d, n) => update(id, { progress: `Extracting text: page ${d} of ${n}` }) });
        update(id, { book, ms: performance.now() - t0, progress: undefined });
      } catch (e) {
        update(id, { error: (e as Error).message, ms: performance.now() - t0, progress: undefined });
      }
    }
  }, []);

  const current = items.find((x) => x.id === selected);

  return (
    <div
      className={`app inspect ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
      }}
    >
      <header className="topbar">
        <a href="#" className="link">
          ‹ Library
        </a>
        <h1>Parser inspector</h1>
      </header>
      <main className="layout">
        <aside className="sidebar">
          <button className="drop" onClick={() => inputRef.current?.click()}>
            <strong>Inspect a file</strong>
            <span>Nothing is saved; this only shows what the parser sees.</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".epub,.pdf,application/epub+zip,application/pdf"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <ul className="files">
            {items.map((x) => (
              <li key={x.id}>
                <button className={x.id === selected ? 'active' : ''} onClick={() => setSelected(x.id)}>
                  <span className="name">{x.book?.meta.title ?? x.fileName}</span>
                  <span className="sub">{x.progress ?? (x.error ? 'Failed' : `${x.book?.format.toUpperCase()} · ${(x.ms / 1000).toFixed(1)} s`)}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section className="content">
          {!current && <div className="empty">Drop a book anywhere on this page.</div>}
          {current?.progress && <div className="empty">{current.progress}</div>}
          {current?.error && (
            <div className="card error">
              <h2>{current.fileName}</h2>
              <p>{current.error}</p>
            </div>
          )}
          {current?.book && <Inspector item={current} book={current.book} />}
        </section>
      </main>
    </div>
  );
}
