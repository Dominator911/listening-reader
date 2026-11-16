// Developer-facing view of a parse result, used for the step-1 checkpoint.
import { useEffect, useMemo, useState } from 'react';
import type { Loaded } from './InspectPage';
import type { ParsedBook, ParsedEpub, ParsedPdf, TocEntry } from '../parse/types';

export function Inspector({ item, book }: { item: Loaded; book: ParsedBook }) {
  const [coverUrl, setCoverUrl] = useState<string>();
  useEffect(() => {
    if (!book.cover) return setCoverUrl(undefined);
    const url = URL.createObjectURL(book.cover);
    setCoverUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [book.cover]);

  const words = useMemo(() => countWords(book), [book]);
  const toc = book.format === 'epub' ? book.toc : book.outline;

  return (
    <div className="inspector">
      <div className="card head">
        {coverUrl ? (
          <img className="cover" src={coverUrl} alt="" onError={() => setCoverUrl(undefined)} />
        ) : (
          <div className="cover none">No cover</div>
        )}
        <div>
          <h2>{book.meta.title}</h2>
          {book.meta.author && <p className="author">{book.meta.author}</p>}
          <dl className="facts">
            <dt>File</dt>
            <dd>
              {item.fileName} · {(item.sizeBytes / 1024 / 1024).toFixed(1)} MB
            </dd>
            <dt>Parsed in</dt>
            <dd>{(item.ms / 1000).toFixed(2)} s</dd>
            <dt>Words</dt>
            <dd>
              {words.toLocaleString()} (≈ {fmtMinutes(words / 170)} at 1x, {fmtMinutes(words / 340)} at 2x)
            </dd>
            {book.format === 'epub' ? (
              <>
                <dt>Documents</dt>
                <dd>{book.spine.length} in reading order</dd>
                <dt>Contents</dt>
                <dd>{book.tocSource === 'none' ? 'none found' : `${book.toc.length} entries from ${book.tocSource.toUpperCase()}`}</dd>
              </>
            ) : (
              <>
                <dt>Pages</dt>
                <dd>{book.pages.length}</dd>
                <dt>Text layer</dt>
                <dd className={`status ${book.textLayer}`}>{statusLabel(book.textLayer)}</dd>
                <dt>Outline</dt>
                <dd>{book.outline.length ? `${book.outline.length} bookmarks` : 'none'}</dd>
              </>
            )}
          </dl>
          <button className="small" onClick={() => downloadJson(item.fileName, book)}>
            Download parse result (JSON)
          </button>
        </div>
      </div>

      {book.warnings.length > 0 && (
        <div className="card warn">
          {book.warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}

      <div className="cols">
        <div className="card">
          <h3>{book.format === 'epub' ? 'Table of contents' : 'Outline (bookmarks)'}</h3>
          <TocList toc={toc} />
        </div>
        {book.format === 'epub' ? <EpubBody book={book} /> : <PdfBody book={book} />}
      </div>
    </div>
  );
}

function TocList({ toc }: { toc: TocEntry[] }) {
  if (!toc.length) return <p className="muted">None in this file.</p>;
  return (
    <ol className="toc">
      {toc.map((t, i) => (
        <li key={i} style={{ paddingLeft: `${t.depth * 14}px` }}>
          <span>{t.title}</span>
          <span className="muted mono target">
            {t.pageIndex !== undefined ? `p.${t.pageIndex + 1}` : t.href ? shortHref(t.href, t.fragment) : '—'}
          </span>
        </li>
      ))}
    </ol>
  );
}

function EpubBody({ book }: { book: ParsedEpub }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="card">
      <h3>Reading order</h3>
      <ol className="spine">
        {book.spine.map((d, i) => {
          const chars = d.blocks.reduce((n, b) => n + b.text.length, 0);
          const counts = countBy(d.blocks.map((b) => b.type));
          return (
            <li key={i}>
              <button className="row" onClick={() => setOpen(open === i ? null : i)}>
                <span>
                  {d.title ?? shortHref(d.href)}
                  {!d.linear && <em className="pill">non-linear</em>}
                  {d.semantics.map((s) => (
                    <em key={s} className="pill">
                      {s}
                    </em>
                  ))}
                </span>
                <span className="muted mono">
                  {chars.toLocaleString()} chars
                  {counts.footnote ? ` · ${counts.footnote} notes` : ''}
                  {d.noterefsRemoved ? ` · ${d.noterefsRemoved} refs` : ''}
                </span>
              </button>
              {open === i && (
                <div className="blocks">
                  {d.blocks.slice(0, 400).map((b, j) => (
                    <p key={j} className={`blk ${b.type}`}>
                      <span className="badge">{b.type === 'heading' ? `h${b.level}` : b.type}</span>
                      {b.text || <em className="muted">(no text)</em>}
                      {b.anchors && <span className="muted mono"> #{b.anchors.join(' #')}</span>}
                    </p>
                  ))}
                  {d.blocks.length > 400 && <p className="muted">…{d.blocks.length - 400} more blocks</p>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function PdfBody({ book }: { book: ParsedPdf }) {
  const [page, setPage] = useState(0);
  const sizes = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of book.pages) for (const l of p.lines) m.set(Math.round(l.fontSize), (m.get(Math.round(l.fontSize)) ?? 0) + l.text.length);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [book]);
  const total = sizes.reduce((s, [, n]) => s + n, 0) || 1;
  const p = book.pages[page];
  return (
    <div className="card">
      <h3>Font sizes (share of text)</h3>
      <div className="sizes">
        {sizes.map(([s, n]) => (
          <div key={s} className="size">
            <span className="mono">{s}pt</span>
            <span className="bar" style={{ width: `${Math.max(2, (n / total) * 100)}%` }} />
            <span className="muted mono">{Math.round((n / total) * 100)}%</span>
          </div>
        ))}
      </div>
      <h3>
        Page {page + 1}
        {p?.label && p.label !== String(page + 1) ? ` (printed “${p.label}”)` : ''} of {book.pages.length}
      </h3>
      <div className="pager">
        <button className="small" disabled={page === 0} onClick={() => setPage(page - 1)}>
          ‹ Prev
        </button>
        <input
          type="range"
          min={0}
          max={book.pages.length - 1}
          value={page}
          onChange={(e) => setPage(Number(e.target.value))}
        />
        <button className="small" disabled={page >= book.pages.length - 1} onClick={() => setPage(page + 1)}>
          Next ›
        </button>
      </div>
      {p && (
        <div className="lines">
          {p.lines.length === 0 && <p className="muted">No text on this page.</p>}
          {p.lines.map((l, i) => (
            <p key={i} className="line">
              <span className="muted mono">
                y{Math.round(l.y)} · {l.fontSize}pt
              </span>
              <span>{l.text}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function statusLabel(s: ParsedPdf['textLayer']) {
  return {
    ok: 'OK',
    partial: 'Some pages have no text',
    scanned: 'Scanned, no text layer',
    garbled: 'Garbled text layer',
  }[s];
}

function countWords(book: ParsedBook): number {
  const count = (s: string) => (s.match(/\S+/g) ?? []).length;
  if (book.format === 'epub') return book.spine.reduce((n, d) => n + d.blocks.reduce((m, b) => m + count(b.text), 0), 0);
  return book.pages.reduce((n, p) => n + p.lines.reduce((m, l) => m + count(l.text), 0), 0);
}

function fmtMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

function shortHref(href: string, frag?: string) {
  const f = href.split('/').pop() ?? href;
  return frag ? `${f}#${frag}` : f;
}

function countBy(xs: string[]) {
  const m: Record<string, number> = {};
  for (const x of xs) m[x] = (m[x] ?? 0) + 1;
  return m;
}

function downloadJson(fileName: string, book: ParsedBook) {
  const { cover: _cover, ...rest } = book;
  void _cover;
  const blob = new Blob([JSON.stringify(rest, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName.replace(/\.(epub|pdf)$/i, '') + '.parse.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
