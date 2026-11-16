import { useEffect, useRef, useState } from 'react';
import type { Lengths } from '../core/nav';
import { chapterAudible, type BookContent, type PlaybackFilters, type Position } from '../core/types';
import { db, type Bookmark } from '../db';
import { fmtDuration } from './format';
import { Close } from './icons';
import { useLive } from './useLive';

interface Props {
  open: boolean;
  onClose: () => void;
  bookId: string;
  content: BookContent;
  pos: Position | null;
  filters: PlaybackFilters;
  chapterProgress: number[];
  allLengths: Lengths;
  secondsPerChar: number;
  onChapter: (c: number) => void;
  onBookmark: (pos: Position) => void;
  onRename: (c: number, title: string) => void;
  onMerge: (c: number) => void;
  onAddBookmark: () => void;
}

export function Drawer(props: Props) {
  const { open, onClose, content, pos } = props;
  const [tab, setTab] = useState<'chapters' | 'bookmarks'>('chapters');
  const [editing, setEditing] = useState(false);
  const list = useRef<HTMLOListElement>(null);

  // Bring the current chapter into view when the drawer opens.
  useEffect(() => {
    if (open && tab === 'chapters') list.current?.querySelector('.current')?.scrollIntoView({ block: 'center' });
  }, [open, tab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div className={`scrim ${open ? 'show' : ''}`} onClick={onClose} />
      <aside className={`drawer ${open ? 'open' : ''}`} aria-hidden={!open} inert={!open || undefined}>
        <div className="drawer-head">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'chapters'} onClick={() => setTab('chapters')}>
              Chapters
            </button>
            <button role="tab" aria-selected={tab === 'bookmarks'} onClick={() => setTab('bookmarks')}>
              Bookmarks
            </button>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </div>

        {tab === 'chapters' ? (
          <>
            <div className="drawer-tools">
              <span className="muted small">{content.chapters.length} chapters · from {sourceLabel(content.chapterSource)}</span>
              <button className="link" onClick={() => setEditing(!editing)}>
                {editing ? 'Done' : 'Fix chapters'}
              </button>
            </div>
            <ol className="chapters" ref={list}>
              {content.chapters.map((ch, c) => {
                const audible = chapterAudible(ch, props.filters);
                const prog = pos?.c === c ? Math.max(props.chapterProgress[c] ?? 0, 0.001) : (props.chapterProgress[c] ?? 0);
                const secs = props.allLengths.chapter[c] * props.secondsPerChar;
                return (
                  <li key={ch.id + c} className={`${pos?.c === c ? 'current' : ''} ${audible ? '' : 'is-skipped'}`} style={{ paddingLeft: 12 + Math.min(ch.depth, 3) * 14 }}>
                    {editing ? (
                      <div className="chapter-edit">
                        <input defaultValue={ch.title} aria-label="Chapter title" onBlur={(e) => props.onRename(c, e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                        {c < content.chapters.length - 1 && (
                          <button className="btn small" onClick={() => props.onMerge(c)} title="Merge with the next chapter">
                            Merge ↓
                          </button>
                        )}
                      </div>
                    ) : (
                      <button className="chapter-row" onClick={() => props.onChapter(c)}>
                        <span className="ch-title">{ch.title}</span>
                        <span className="ch-meta">
                          {audible ? fmtDuration(secs) : 'skipped'}
                          {prog >= 0.98 ? ' · ✓' : ''}
                        </span>
                        <span className="ch-progress">
                          <span style={{ width: `${Math.round(prog * 100)}%` }} />
                        </span>
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        ) : (
          <Bookmarks bookId={props.bookId} content={content} onJump={props.onBookmark} onAdd={props.onAddBookmark} />
        )}
      </aside>
    </>
  );
}

function sourceLabel(s: BookContent['chapterSource']) {
  return { toc: 'table of contents', spine: 'reading order', outline: 'PDF bookmarks', headings: 'detected headings', sections: 'even sections' }[s];
}

function Bookmarks({ bookId, content, onJump, onAdd }: { bookId: string; content: BookContent; onJump: (p: Position) => void; onAdd: () => void }) {
  const marks = useLive(() => db.bookmarks.where('bookId').equals(bookId).sortBy('createdAt'), [bookId]);
  return (
    <div className="bookmarks">
      <button className="btn primary wide" onClick={onAdd}>
        Bookmark this sentence
      </button>
      {marks && !marks.length && <p className="muted pad">No bookmarks yet.</p>}
      <ul>
        {marks?.map((m: Bookmark) => (
          <li key={m.id}>
            <button className="chapter-row" onClick={() => onJump(m.pos)}>
              <span className="ch-title">{m.name}</span>
              <span className="ch-meta">{content.chapters[m.pos.c]?.title ?? ''}</span>
            </button>
            <div className="bm-actions">
              <button
                className="link"
                onClick={() => {
                  const name = prompt('Bookmark name', m.name);
                  if (name?.trim()) void db.bookmarks.update(m.id!, { name: name.trim() });
                }}
              >
                Rename
              </button>
              <button className="link danger" onClick={() => void db.bookmarks.delete(m.id!)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
