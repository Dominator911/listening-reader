import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mergeProgress, mergeWithNext, renameChapter } from '../core/edit';
import { downloadJson, exportBook, safeFileName } from '../core/export';
import * as nav from '../core/nav';
import type { BookContent, Position } from '../core/types';
import { db, type BookRecord } from '../db';
import { reprocessBook } from '../library/importBook';
import { Player, supported, type PlayerState } from '../player/Player';
import { englishVoices, keepScreenOn, setupMediaSession, silentAudio, updateMediaMetadata } from '../player/platform';
import { setPrefs as savePrefs, usePrefs } from '../prefs';
import { Drawer } from './Drawer';
import * as I from './icons';
import { PlayerBar } from './PlayerBar';
import { ReadingView } from './ReadingView';
import { Settings } from './Settings';
import { useCoverUrl } from './useLive';

export function Reader({ bookId, onBack }: { bookId: string; onBack: () => void }) {
  const [book, setBook] = useState<BookRecord>();
  const [content, setContent] = useState<BookContent>();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [b, c] = await Promise.all([db.books.get(bookId), db.content.get(bookId)]);
      if (!alive) return;
      if (!b || !c) return setMissing(true);
      setBook(b);
      setContent(c.content);
      void db.books.update(bookId, { openedAt: Date.now() });
    })();
    return () => {
      alive = false;
    };
  }, [bookId]);

  if (missing) return <Message onBack={onBack} title="Book not found" text="It may have been removed from this device." />;
  if (!book || !content) return <div className="loading">Opening…</div>;
  if (book.unreadable || !content.chapters.length)
    return <Message onBack={onBack} title={book.title} text={book.unreadable ?? 'No readable text was found in this book.'} />;
  return <ReaderInner key={bookId} book={book} initialContent={content} onBack={onBack} />;
}

function Message({ title, text, onBack }: { title: string; text: string; onBack: () => void }) {
  return (
    <div className="reader">
      <header className="bar">
        <button className="icon-btn" onClick={onBack} aria-label="Back to library">
          <I.Back />
        </button>
        <h1 className="bar-title">{title}</h1>
      </header>
      <div className="message">
        <p>{text}</p>
        <button className="btn" onClick={onBack}>
          Back to library
        </button>
      </div>
    </div>
  );
}

function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!supported()) return;
    const load = () => setVoices(englishVoices(speechSynthesis.getVoices()));
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);
  return voices;
}

function ReaderInner({ book, initialContent, onBack }: { book: BookRecord; initialContent: BookContent; onBack: () => void }) {
  const [prefs, setPrefs] = usePrefs();
  const [content, setContent] = useState(initialContent);
  const [drawer, setDrawer] = useState(false);
  const [settings, setSettings] = useState(false);
  const [toast, setToast] = useState<string>();
  const voices = useVoices();
  const voice = voices.find((v) => v.voiceURI === prefs.voiceURI) ?? voices.find((v) => v.default) ?? voices[0];
  const cover = useCoverUrl(book);
  const chapterProgress = useRef<number[]>(book.chapterProgress ?? []);
  const [, bump] = useState(0);

  // One player per open book.
  const player = useMemo(
    () =>
      new Player({
        content: initialContent,
        filters: prefs.filters,
        rate: book.rate,
        pos: book.position,
        onCalibrate: (cps) => void savePrefs({ cps }),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book.id],
  );
  const [state, setState] = useState<PlayerState>(player.getState());
  useEffect(() => {
    player.cps = prefs.cps;
    const unsub = player.subscribe(setState);
    return () => {
      unsub();
      player.destroy();
      void keepScreenOn(false);
      void silentAudio(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  useEffect(() => player.setFilters(prefs.filters), [player, prefs.filters]);
  useEffect(() => player.setVoice(voice), [player, voice]);

  // Lengths for progress and time estimates.
  const ctx = { content, filters: prefs.filters, force: state.force };
  const len = useMemo(() => nav.lengths(ctx), [content, prefs.filters, state.force]); // eslint-disable-line react-hooks/exhaustive-deps
  const allLen = useMemo(() => nav.lengths({ content, filters: prefs.filters }), [content, prefs.filters]);
  const secondsPerChar = 1 / (Math.max(5, player.cps || prefs.cps) * state.rate);
  const pos = state.pos;
  const inChapter = pos ? nav.charsBeforeInChapter(len, pos) : 0;
  const chapterLen = pos ? len.chapter[pos.c] : 0;
  const chapterLeft = (chapterLen - inChapter) * secondsPerChar;
  const bookLeft = pos ? (len.total - nav.charsBefore(len, pos)) * secondsPerChar : 0;

  // Persist position on every sentence change.
  useEffect(() => {
    if (!pos) return;
    const cp = chapterProgress.current;
    const frac = chapterLen ? inChapter / chapterLen : 0;
    if ((cp[pos.c] ?? 0) < frac) cp[pos.c] = frac;
    const progress = allLen.total ? nav.charsBefore(allLen, pos) / allLen.total : 0;
    void db.books.update(book.id, { position: pos, progress, chapterProgress: [...cp], openedAt: Date.now() });
  }, [pos?.c, pos?.p, pos?.s]); // eslint-disable-line react-hooks/exhaustive-deps

  // Finished a chapter: mark it complete.
  useEffect(() => {
    if (state.ended && pos) {
      chapterProgress.current[pos.c] = 1;
      void db.books.update(book.id, { progress: 1, chapterProgress: [...chapterProgress.current] });
    }
  }, [state.ended]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wake lock + silent audio while playing.
  useEffect(() => {
    void keepScreenOn(state.playing);
    void silentAudio(state.playing && prefs.mediaControls);
  }, [state.playing, prefs.mediaControls]);

  // Media Session.
  useEffect(() => {
    setupMediaSession({
      play: () => player.play(),
      pause: () => player.pause(),
      prevChapter: player.prevChapter,
      nextChapter: player.nextChapter,
      back: player.prevParagraph,
      forward: player.nextParagraph,
    });
  }, [player]);
  const chapterTitle = pos ? content.chapters[pos.c]?.title : '';
  useEffect(() => {
    updateMediaMetadata({ title: chapterTitle || book.title, artist: book.author, album: book.title, artwork: cover }, state.playing);
  }, [chapterTitle, state.playing, cover, book.title, book.author]);

  const changeRate = useCallback(
    (r: number) => {
      player.setRate(r);
      const rate = player.getState().rate;
      void db.books.update(book.id, { rate });
      void savePrefs({ lastRate: rate });
    },
    [player, book.id],
  );

  const addBookmark = useCallback(async () => {
    const p = player.getState().pos;
    if (!p) return;
    const sentence = content.chapters[p.c]?.paragraphs[p.p]?.sentences[p.s] ?? '';
    const name = `${content.chapters[p.c]?.title ?? ''}: “${sentence.slice(0, 60)}${sentence.length > 60 ? '…' : ''}”`;
    await db.bookmarks.add({ bookId: book.id, name, pos: p, createdAt: Date.now() });
    setToast('Bookmark added');
  }, [player, content, book.id]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest('input, select, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (drawer || settings) return;
      const handled = (() => {
        switch (e.key) {
          case ' ':
            player.toggle();
            return true;
          case 'ArrowRight':
            (e.shiftKey ? player.nextChapter : player.nextSentence)();
            return true;
          case 'ArrowLeft':
            (e.shiftKey ? player.prevChapter : player.prevSentence)();
            return true;
          case 'ArrowDown':
            player.nextParagraph();
            return true;
          case 'ArrowUp':
            player.prevParagraph();
            return true;
          case ']':
            changeRate(player.getState().rate + 0.25);
            return true;
          case '[':
            changeRate(player.getState().rate - 0.25);
            return true;
          case 'c':
            setDrawer(true);
            return true;
          case 'b':
            void addBookmark();
            return true;
        }
        return false;
      })();
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player, drawer, settings, changeRate, addBookmark]);

  const saveContent = async (next: BookContent, mapPos?: (p: Position) => Position) => {
    setContent(next);
    player.content = next;
    if (mapPos) {
      const p = player.getState().pos;
      player.setContent(next);
      if (p) player.seek(mapPos(p));
      const marks = await db.bookmarks.where('bookId').equals(book.id).toArray();
      await Promise.all(marks.map((m) => db.bookmarks.update(m.id!, { pos: mapPos(m.pos) })));
    }
    await db.content.put({ id: book.id, content: next });
    await db.books.update(book.id, { chapterCount: next.chapters.length, chapterProgress: [...chapterProgress.current] });
  };

  const c = pos?.c ?? 0;
  const chapter = content.chapters[c];

  return (
    <div className="reader" style={{ ['--reading-size' as string]: `${prefs.fontSize}px` }}>
      <header className="bar">
        <button className="icon-btn" onClick={onBack} aria-label="Back to library">
          <I.Back />
        </button>
        <button className="bar-title as-button" onClick={() => setDrawer(true)} title="Chapters (c)">
          <span className="book-name">{book.title}</span>
          <span className="chapter-name">{chapter?.title}</span>
        </button>
        <button className="icon-btn" onClick={() => void addBookmark()} aria-label="Add bookmark" title="Bookmark (b)">
          <I.BookmarkIcon />
        </button>
        <button className="icon-btn" onClick={() => setDrawer(true)} aria-label="Chapters" title="Chapters (c)">
          <I.ListIcon />
        </button>
        <button className="icon-btn" onClick={() => setSettings(true)} aria-label="Settings">
          <I.Gear />
        </button>
      </header>

      {!supported() && <div className="banner">This browser has no text-to-speech, so the book can be read but not played.</div>}

      {chapter && (
        <ReadingView chapter={chapter} c={c} pos={pos} filters={prefs.filters} forced={state.force === c} playing={state.playing} onTap={(p) => player.playAt(p)} />
      )}

      <PlayerBar player={player} state={state} chapterLeft={chapterLeft} bookLeft={bookLeft} chapterFrac={chapterLen ? inChapter / chapterLen : 0} onRate={changeRate} />

      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        bookId={book.id}
        content={content}
        pos={pos}
        filters={prefs.filters}
        chapterProgress={chapterProgress.current}
        allLengths={allLen}
        secondsPerChar={secondsPerChar}
        onChapter={(i) => {
          player.playChapter(i);
          setDrawer(false);
        }}
        onBookmark={(p) => {
          player.seek(nav.clampPosition({ content, filters: prefs.filters }, p), true);
          setDrawer(false);
        }}
        onAddBookmark={() => void addBookmark()}
        onRename={(i, title) => void saveContent(renameChapter(content, i, title))}
        onMerge={(i) => {
          const r = mergeWithNext(content, i);
          chapterProgress.current = mergeProgress(chapterProgress.current, i);
          bump((n) => n + 1);
          void saveContent(r.content, r.mapPos);
        }}
      />

      <Settings
        open={settings}
        onClose={() => setSettings(false)}
        prefs={prefs}
        setPrefs={setPrefs}
        voices={voices}
        voiceURI={voice?.voiceURI}
        warnings={book.warnings}
        onExport={() => downloadJson(`${safeFileName(book.title)}.listening.json`, exportBook(book, content, prefs.filters))}
        onReprocess={async () => {
          if (!confirm('Detect chapters again from the original file? Manual chapter fixes will be lost.')) return;
          player.pause();
          try {
            await reprocessBook(book.id);
            const c2 = await db.content.get(book.id);
            if (c2) {
              setContent(c2.content);
              player.setContent(c2.content);
            }
            setToast('Chapters detected again');
          } catch (e) {
            setToast((e as Error).message);
          }
        }}
      />

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
