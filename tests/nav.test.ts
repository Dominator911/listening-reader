import { describe, expect, it } from 'vitest';
import { makeParagraph } from '../src/core/chapters';
import * as nav from '../src/core/nav';
import { DEFAULT_FILTERS, type BookContent } from '../src/core/types';

const content: BookContent = {
  chapterSource: 'toc',
  warnings: [],
  chapters: [
    { id: 'c0', title: 'Copyright', depth: 0, paragraphs: [makeParagraph('text', 'All rights reserved.', 'front')] },
    {
      id: 'c1',
      title: 'One',
      depth: 0,
      paragraphs: [
        makeParagraph('heading', 'One'),
        makeParagraph('text', 'A one. A two.'),
        makeParagraph('text', 'A footnote.', 'footnote'),
        makeParagraph('text', 'B one. B two.'),
      ],
    },
    { id: 'c2', title: 'Notes', depth: 0, paragraphs: [makeParagraph('text', 'Note one.', 'footnote')] },
    { id: 'c3', title: 'Two', depth: 0, paragraphs: [makeParagraph('text', 'C one.')] },
  ],
};
const ctx: nav.NavCtx = { content, filters: DEFAULT_FILTERS };

describe('navigation', () => {
  it('starts at the first audible sentence, skipping front matter', () => {
    expect(nav.clampPosition(ctx, undefined)).toEqual({ c: 1, p: 0, s: 0 });
  });

  it('steps sentences across skipped footnotes and skipped chapters', () => {
    expect(nav.nextSentence(ctx, { c: 1, p: 1, s: 1 })).toEqual({ c: 1, p: 3, s: 0 });
    expect(nav.nextSentence(ctx, { c: 1, p: 3, s: 1 })).toEqual({ c: 3, p: 0, s: 0 });
    expect(nav.prevSentence(ctx, { c: 1, p: 3, s: 0 })).toEqual({ c: 1, p: 1, s: 1 });
    expect(nav.nextSentence(ctx, { c: 3, p: 0, s: 0 })).toBeNull();
  });

  it('includes footnotes when the filter is on', () => {
    const on = { ...ctx, filters: { ...DEFAULT_FILTERS, footnotes: true } };
    expect(nav.nextSentence(on, { c: 1, p: 1, s: 1 })).toEqual({ c: 1, p: 2, s: 0 });
  });

  it('paragraph back goes to the paragraph start first', () => {
    expect(nav.prevParagraph(ctx, { c: 1, p: 3, s: 1 })).toEqual({ c: 1, p: 3, s: 0 });
    expect(nav.prevParagraph(ctx, { c: 1, p: 3, s: 0 })).toEqual({ c: 1, p: 1, s: 0 });
    expect(nav.nextParagraph(ctx, { c: 1, p: 1, s: 0 })).toEqual({ c: 1, p: 3, s: 0 });
  });

  it('chapter skip ignores fully skipped chapters', () => {
    expect(nav.nextChapter(ctx, { c: 1, p: 1, s: 0 })).toEqual({ c: 3, p: 0, s: 0 });
    expect(nav.prevChapter(ctx, { c: 3, p: 0, s: 0 })).toEqual({ c: 1, p: 0, s: 0 });
    expect(nav.prevChapter(ctx, { c: 1, p: 3, s: 0 })).toEqual({ c: 1, p: 0, s: 0 });
  });

  it('a forced chapter plays even when it is normally skipped', () => {
    expect(nav.chapterStart(ctx, 2)).toBeNull();
    expect(nav.chapterStart({ ...ctx, force: 2 }, 2)).toEqual({ c: 2, p: 0, s: 0 });
  });

  it('measures audible characters for progress and time', () => {
    const len = nav.lengths(ctx);
    expect(len.chapter[0]).toBe(0);
    expect(len.chapter[2]).toBe(0);
    expect(nav.charsBefore(len, { c: 1, p: 3, s: 0 })).toBe('One'.length + 1 + 'A one.'.length + 1 + 'A two.'.length + 1);
  });

  it('clamps stale positions', () => {
    expect(nav.clampPosition(ctx, { c: 9, p: 9, s: 9 })).toEqual({ c: 3, p: 0, s: 0 });
    expect(nav.clampPosition(ctx, { c: 1, p: 1, s: 7 })).toEqual({ c: 1, p: 1, s: 1 });
  });
});
