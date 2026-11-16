import { memo, useEffect, useRef, useState } from 'react';
import type { Chapter, PlaybackFilters, Position } from '../core/types';
import { isAudible } from '../core/types';
import { Target } from './icons';

const SKIP_LABEL = { footnote: 'footnote', front: 'front matter', index: 'index' } as const;

interface Props {
  chapter: Chapter;
  c: number;
  pos: Position | null;
  filters: PlaybackFilters;
  forced: boolean;
  playing: boolean;
  onTap: (pos: Position) => void;
}

/** Chapter text, rendered once per chapter; the spoken sentence is highlighted via the DOM. */
export function ReadingView({ chapter, c, pos, filters, forced, playing, onTap }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const lastUserScroll = useRef(0);
  const [detached, setDetached] = useState(false);

  // Highlight + auto-scroll on every sentence change.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    el.querySelector('.now')?.classList.remove('now');
    if (!pos || pos.c !== c) return;
    const span = el.querySelector<HTMLElement>(`[data-k="${pos.p}-${pos.s}"]`);
    if (!span) return;
    span.classList.add('now');
    if (Date.now() - lastUserScroll.current > 5000) {
      span.scrollIntoView({ block: 'center', behavior: playing ? 'smooth' : 'auto' });
      setDetached(false);
    }
  }, [pos?.c, pos?.p, pos?.s, c, chapter, playing]);

  const userScrolled = () => {
    lastUserScroll.current = Date.now();
    if (playing) setDetached(true);
  };

  const recenter = () => {
    lastUserScroll.current = 0;
    setDetached(false);
    root.current?.querySelector('.now')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  return (
    <div
      className="reading"
      ref={root}
      onWheel={userScrolled}
      onTouchMove={userScrolled}
      onClick={(e) => {
        const k = (e.target as HTMLElement).closest<HTMLElement>('[data-k]')?.dataset.k;
        if (!k) return;
        const [p, s] = k.split('-').map(Number);
        onTap({ c, p, s });
      }}
    >
      <ChapterText chapter={chapter} filters={filters} forced={forced} />
      {detached && (
        <button className="recenter" onClick={recenter}>
          <Target /> Back to current sentence
        </button>
      )}
    </div>
  );
}

const ChapterText = memo(function ChapterText({ chapter, filters, forced }: { chapter: Chapter; filters: PlaybackFilters; forced: boolean }) {
  return (
    <article className="chapter-text">
      {chapter.paragraphs.map((para, p) => {
        const skipped = !forced && !isAudible(para, filters) && para.sentences.length > 0;
        const cls = [para.kind, para.skip ?? '', skipped ? 'skipped' : ''].join(' ');
        const sentences = para.sentences.map((s, i) => (
          <span key={i} data-k={`${p}-${i}`} className="s">
            {s}{' '}
          </span>
        ));
        if (para.kind === 'heading') {
          const Tag = (para.level ?? 1) <= 1 ? 'h2' : 'h3';
          return (
            <Tag key={p} className={cls}>
              {sentences.length ? sentences : para.text}
            </Tag>
          );
        }
        if (!para.sentences.length) return null;
        return (
          <p key={p} className={cls}>
            {skipped && para.skip && <span className="skip-tag">{SKIP_LABEL[para.skip]} · skipped</span>}
            {sentences}
          </p>
        );
      })}
    </article>
  );
});
