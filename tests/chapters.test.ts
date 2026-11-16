import { describe, expect, it } from 'vitest';
import { buildContent, chooseStarts, evenSections, makeParagraph, mergeTinyChapters, TARGET_CHAPTER_WORDS } from '../src/core/chapters';
import { DEFAULT_FILTERS, chapterAudible, type Chapter } from '../src/core/types';
import { parseEpub } from '../src/parse/epub';
import type { Block, ParsedEpub, ParsedPdf, SpineDoc, TocEntry } from '../src/parse/types';
import { makeEpub3 } from './fixtures';
import { page, prose, tag } from './pdfDoc';

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ') + '.';

function doc(href: string, blocks: Block[], extra: Partial<SpineDoc> = {}): SpineDoc {
  return { href, linear: true, semantics: [], blocks, noterefsRemoved: 0, ...extra };
}
function epub(spine: SpineDoc[], toc: TocEntry[] = [], extra: Partial<ParsedEpub> = {}): ParsedEpub {
  return { format: 'epub', meta: { title: 'Book' }, toc, tocSource: toc.length ? 'nav' : 'none', landmarks: [], spine, warnings: [], ...extra };
}
const h = (text: string, level = 1): Block => ({ type: 'heading', text, level });
const t = (text: string, anchors?: string[]): Block => ({ type: 'text', text, ...(anchors ? { anchors } : {}) });

describe('EPUB chapters from the TOC', async () => {
  const content = buildContent(await parseEpub(await makeEpub3()));

  it('uses the TOC and keeps leading front matter as its own chapter', () => {
    expect(content.chapterSource).toBe('toc');
    expect(content.chapters.map((c) => c.title)).toEqual(['Copyright', 'Chapter 1: Beginnings', 'Chapter 2', 'Notes']);
  });

  it('skips copyright and notes by default, but plays them when toggled on', () => {
    const [copy, ch1, , notes] = content.chapters;
    expect(chapterAudible(copy, DEFAULT_FILTERS)).toBe(false);
    expect(chapterAudible(notes, DEFAULT_FILTERS)).toBe(false);
    expect(chapterAudible(ch1, DEFAULT_FILTERS)).toBe(true);
    expect(chapterAudible(copy, { ...DEFAULT_FILTERS, frontMatter: true })).toBe(true);
    expect(chapterAudible(notes, { ...DEFAULT_FILTERS, footnotes: true })).toBe(true);
  });

  it('marks in-chapter footnotes as skippable and describes figures', () => {
    const ch1 = content.chapters[1].paragraphs;
    expect(ch1.filter((p) => p.skip === 'footnote').map((p) => p.text)).toEqual(['A local footnote.', '9. A class-based footnote.']);
    expect(ch1.find((p) => p.kind === 'image')?.sentences).toEqual(['Image: Map of the valley.']);
    expect(ch1.find((p) => p.kind === 'table')?.sentences[0]).toMatch(/Table with 2 rows and 2 columns/);
  });
});

describe('EPUB TOC depth choice', () => {
  // Two parts, each with three ~1000-word chapters: chapters (depth 1) are too short to beat parts
  // only if parts alone are useful; here each part is 3000 words, chapters 1000 → choose parts.
  const spine: SpineDoc[] = [];
  const toc: TocEntry[] = [];
  for (let p = 1; p <= 2; p++) {
    spine.push(doc(`p${p}.xhtml`, [h(`Part ${p}`)]));
    toc.push({ title: `Part ${p}`, href: `p${p}.xhtml`, depth: 0 });
    for (let c = 1; c <= 3; c++) {
      const href = `p${p}c${c}.xhtml`;
      spine.push(doc(href, [h(`Chapter ${c}`, 2), t(words(1000))]));
      toc.push({ title: `Chapter ${c}`, href, depth: 1 });
    }
  }

  it('keeps chapters of at least the target length', () => {
    const c = buildContent(epub(spine, toc));
    expect(c.chapters.map((x) => x.title)).toEqual(['Part 1', 'Part 2']);
  });

  it('goes one level deeper when the deeper chapters are long enough', () => {
    const long = spine.map((d) => (d.blocks.length > 1 ? { ...d, blocks: [d.blocks[0], t(words(TARGET_CHAPTER_WORDS + 100))] } : d));
    const c = buildContent(epub(long, toc));
    // "Part 1" has no text of its own, so it merges into its first chapter.
    expect(c.chapters.map((x) => x.title)).toEqual([
      'Part 1: Chapter 1',
      'Chapter 2',
      'Chapter 3',
      'Part 2: Chapter 1',
      'Chapter 2',
      'Chapter 3',
    ]);
    expect(c.chapters[1].depth).toBe(1);
  });
});

describe('EPUB fragment-level TOC entries', () => {
  it('splits a single file at anchors', () => {
    const spine = [doc('all.xhtml', [h('One', 2), t(words(50), ['a1']), h('Two', 2), t(words(50))].map((b, i) => (i === 2 ? { ...b, anchors: ['two'] } : b)))];
    const toc: TocEntry[] = [
      { title: 'One', href: 'all.xhtml', depth: 0 },
      { title: 'Two', href: 'all.xhtml', fragment: 'two', depth: 0 },
    ];
    const c = buildContent(epub(spine, toc));
    expect(c.chapters.map((x) => [x.title, x.paragraphs.length])).toEqual([
      ['One', 2],
      ['Two', 2],
    ]);
  });
});

describe('EPUB spine fallback', () => {
  it('uses one chapter per document and folds heading-less split files into the previous one', () => {
    const c = buildContent(
      epub([
        doc('title.xhtml', [t('The Book')], { semantics: ['titlepage'] }),
        doc('c1.xhtml', [h('The First'), t(words(100))]),
        doc('c1b.xhtml', [t(words(100))]),
        doc('c2.xhtml', [h('The Second'), t(words(100))]),
        doc('idx.xhtml', [h('Index'), t('apples, 4')]),
      ]),
    );
    expect(c.chapterSource).toBe('spine');
    expect(c.chapters.map((x) => [x.title, x.paragraphs.length])).toEqual([
      ['Front matter', 1],
      ['The First', 3],
      ['The Second', 2],
      ['Index', 2],
    ]);
    expect(c.chapters[3].paragraphs[0].skip).toBe('index');
  });

  it('detects a copyright page by its text and a contents page by TOC titles', () => {
    const toc: TocEntry[] = [
      { title: 'Alpha', href: 'a.xhtml', depth: 0 },
      { title: 'Beta', href: 'b.xhtml', depth: 0 },
      { title: 'Gamma', href: 'c.xhtml', depth: 0 },
      { title: 'Delta', href: 'd.xhtml', depth: 0 },
      { title: 'Epsilon', href: 'e.xhtml', depth: 0 },
    ];
    const c = buildContent(
      epub(
        [
          doc('copy.xhtml', [t('Copyright 2010. All rights reserved. ISBN 123.')]),
          doc('toc.xhtml', [h('In this book'), t('Alpha'), t('Beta'), t('Gamma'), t('Delta'), t('Epsilon')]),
          ...['a', 'b', 'c', 'd', 'e'].map((x, i) => doc(`${x}.xhtml`, [h(toc[i].title), t(words(300))])),
        ],
        toc,
      ),
    );
    expect(c.chapters.slice(0, 2).map((x) => x.paragraphs.every((p) => p.skip === 'front'))).toEqual([true, true]);
  });
});

describe('helpers', () => {
  it('chooseStarts sorts and removes duplicates', () => {
    const starts = chooseStarts(
      [
        { idx: 5, title: 'B', depth: 0 },
        { idx: 0, title: 'A', depth: 0 },
        { idx: 5, title: 'B again', depth: 1 },
      ],
      [0, 10, 20, 30, 40, 50, 60, 70],
    );
    expect(starts.map((s) => s.title)).toEqual(['A', 'B']);
  });

  it('evenSections splits by length, preferring heading boundaries, and folds a short tail', () => {
    const paras = [
      ...Array.from({ length: 10 }, () => makeParagraph('text', words(500))),
      makeParagraph('heading', 'A heading'),
      ...Array.from({ length: 3 }, () => makeParagraph('text', words(500))),
      makeParagraph('text', words(100)),
    ];
    const s = evenSections(paras, 0, 2500);
    expect(s.map((c) => c.title)).toEqual(['Section 1', 'Section 2', 'Section 3']);
    expect(s[2].paragraphs[0].text).toBe('A heading');
    expect(s[2].paragraphs.length).toBe(5);
  });

  it('mergeTinyChapters keeps titles of image-only openers out of the next title', () => {
    const chs: Chapter[] = [
      { id: '', title: 'Cover', depth: 0, paragraphs: [makeParagraph('image', '')] },
      { id: '', title: 'One', depth: 0, paragraphs: [makeParagraph('text', words(50))] },
    ];
    expect(mergeTinyChapters(chs).map((c) => [c.id, c.title])).toEqual([['c0', 'One']]);
  });
});

// ───────────── PDF ─────────────

function pdf(pages: ParsedPdf['pages'], outline: TocEntry[] = []): ParsedPdf {
  return { format: 'pdf', meta: { title: 'P' }, outline, pages, textLayer: 'ok', emptyPages: [], warnings: [] };
}

describe('PDF chapters', () => {
  // 12 body pages; chapters start on pages 1, 5, 9 with a big "Chapter N" heading and a subtitle.
  const pages = [page(0, [{ t: 'Copyright 2020. All rights reserved.' }, 'ISBN 1'])];
  for (let i = 1; i <= 12; i++) {
    const n = (i - 1) / 4 + 1;
    const body = (i - 1) % 4 === 0 ? [{ t: `Chapter ${n}`, size: 20 }, { t: `Title ${n}`, size: 16 }, ...prose(24, tag(i))] : prose(28, tag(i));
    pages.push(page(i, body, { header: i % 2 ? 'RUNNING HEAD' : 'Author Name', footer: String(i) }));
  }

  it('uses the outline when present', () => {
    const c = buildContent(
      pdf(pages, [
        { title: 'Chapter 1', pageIndex: 1, depth: 0 },
        { title: 'Chapter 2', pageIndex: 5, depth: 0 },
        { title: 'Chapter 3', pageIndex: 9, depth: 0 },
      ]),
    );
    expect(c.chapterSource).toBe('outline');
    expect(c.chapters.map((x) => x.title)).toEqual(['Opening pages', 'Chapter 1', 'Chapter 2', 'Chapter 3']);
    expect(c.chapters[1].paragraphs[0].text).toBe('Chapter 1');
    expect(chapterAudible(c.chapters[0], DEFAULT_FILTERS)).toBe(false);
  });

  it('falls back to "Chapter N" headings and joins the subtitle', () => {
    const c = buildContent(pdf(pages));
    expect(c.chapterSource).toBe('headings');
    expect(c.chapters.map((x) => x.title)).toEqual(['Opening pages', 'Chapter 1: Title 1', 'Chapter 2: Title 2', 'Chapter 3: Title 3']);
  });

  it('falls back to font-size headings without chapter words', () => {
    const named = pages.map((p) => ({
      ...p,
      lines: p.lines.map((l) => (/^Chapter \d$/.test(l.text) ? { ...l, text: `The ${['', 'Red', 'Green', 'Blue'][Number(l.text.slice(-1))]} Room` } : l)),
    }));
    const c = buildContent(pdf(named));
    expect(c.chapterSource).toBe('headings');
    expect(c.chapters.slice(1).map((x) => x.title)).toEqual(['The Red Room: Title 1', 'The Green Room: Title 2', 'The Blue Room: Title 3']);
  });

  it('splits into even sections when there are no headings', () => {
    const flat = Array.from({ length: 30 }, (_, i) => page(i, prose(28, tag(i)).map((t, j) => (j % 6 === 0 ? { t, indent: 18 } : t))));
    const c = buildContent(pdf(flat));
    expect(c.chapterSource).toBe('sections');
    expect(c.chapters.length).toBeGreaterThan(2);
    expect(c.chapters.every((x) => /^Section \d+$/.test(x.title))).toBe(true);
    expect(c.warnings.join(' ')).toMatch(/15 minutes/);
  });

  it('returns no chapters for scanned PDFs', () => {
    const c = buildContent({ ...pdf([]), textLayer: 'scanned', warnings: ['scanned'] });
    expect(c.chapters).toEqual([]);
  });
});
