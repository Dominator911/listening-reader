import { useRef, useState } from 'react';
import { db, deleteBook, type BookRecord } from '../db';
import { importBook } from '../library/importBook';
import { getPrefs } from '../prefs';
import { More, Plus } from './icons';
import { useLive, useObjectUrl } from './useLive';

interface Job {
  name: string;
  msg: string;
  error?: string;
}

export function Library({ onOpen }: { onOpen: (id: string) => void }) {
  const books = useLive(() => db.books.toArray(), []);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<string>();
  const input = useRef<HTMLInputElement>(null);

  const sorted = [...(books ?? [])].sort((a, b) => (b.openedAt ?? b.addedAt) - (a.openedAt ?? a.addedAt));

  async function handle(files: FileList | File[]) {
    const list = Array.from(files);
    for (const file of list) {
      const update = (patch: Partial<Job>) => setJobs((js) => js.map((j) => (j.name === file.name ? { ...j, ...patch } : j)));
      setJobs((js) => [...js.filter((j) => j.name !== file.name), { name: file.name, msg: 'Waiting…' }]);
      try {
        const r = await importBook(file, (msg) => update({ msg }), getPrefs().lastRate);
        setJobs((js) => js.filter((j) => j.name !== file.name));
        // A single book that is readable opens straight away: "listening within ten seconds".
        if (list.length === 1 && !r.unreadable) onOpen(r.id);
      } catch (e) {
        update({ error: (e as Error).message, msg: 'Failed' });
      }
    }
  }

  return (
    <div
      className={`library ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) void handle(e.dataTransfer.files);
      }}
    >
      <header className="bar">
        <h1>Library</h1>
        <button className="btn primary" onClick={() => input.current?.click()}>
          <Plus /> Add book
        </button>
        <input
          ref={input}
          type="file"
          accept=".epub,.pdf,application/epub+zip,application/pdf"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void handle(e.target.files);
            e.target.value = '';
          }}
        />
      </header>

      <main className="lib-main">
        {jobs.map((j) => (
          <div key={j.name} className={`job ${j.error ? 'failed' : ''}`}>
            <strong>{j.name}</strong>
            <span>{j.error ?? j.msg}</span>
            {j.error && (
              <button className="link" onClick={() => setJobs((js) => js.filter((x) => x.name !== j.name))}>
                Dismiss
              </button>
            )}
          </div>
        ))}

        {books && !sorted.length && !jobs.length && (
          <button className="empty-drop" onClick={() => input.current?.click()}>
            <strong>Add your first book</strong>
            <span>Drop an EPUB or PDF here, or tap to choose one. Books stay on this device.</span>
          </button>
        )}

        <ul className="books">
          {sorted.map((b) => (
            <BookRow key={b.id} book={b} onOpen={() => onOpen(b.id)} menuOpen={menu === b.id} setMenu={(o) => setMenu(o ? b.id : undefined)} />
          ))}
        </ul>
      </main>
    </div>
  );
}

function BookRow({ book, onOpen, menuOpen, setMenu }: { book: BookRecord; onOpen: () => void; menuOpen: boolean; setMenu: (o: boolean) => void }) {
  const cover = useObjectUrl(book.cover);
  const pct = Math.round(book.progress * 100);
  return (
    <li className="book">
      <button className="book-main" onClick={onOpen}>
        {cover ? <img className="thumb" src={cover} alt="" /> : <div className="thumb blank">{book.format.toUpperCase()}</div>}
        <div className="book-info">
          <span className="title">{book.title}</span>
          {book.author && <span className="author">{book.author}</span>}
          {book.unreadable ? (
            <span className="warn-text">No readable text</span>
          ) : (
            <span className="meta">
              <span className="progress">
                <span style={{ width: `${pct}%` }} />
              </span>
              {pct}% · {book.chapterCount} chapters
            </span>
          )}
        </div>
      </button>
      <button className="icon-btn" aria-label="Book options" onClick={() => setMenu(!menuOpen)}>
        <More />
      </button>
      {menuOpen && (
        <div className="menu" role="menu">
          <button
            role="menuitem"
            onClick={async () => {
              setMenu(false);
              if (confirm(`Remove “${book.title}” from this device? Its position and bookmarks are deleted too.`)) await deleteBook(book.id);
            }}
          >
            Remove from library
          </button>
          <button role="menuitem" onClick={() => setMenu(false)}>
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}
