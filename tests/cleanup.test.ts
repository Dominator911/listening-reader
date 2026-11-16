import { describe, expect, it } from 'vitest';
import { cleanPdf, headerKey, isPageNumber, joinLines, stripInlineMarkers, vocabulary } from '../src/core/pdfClean';
import { splitSentences } from '../src/core/sentences';
import { romanToInt, speakable } from '../src/core/speakable';
import { page, prose, tag } from './pdfDoc';

describe('splitSentences', () => {
  it('splits ordinary sentences', () => {
    expect(splitSentences('It rained. Then it stopped! Did it? Yes.')).toEqual(['It rained.', 'Then it stopped!', 'Did it?', 'Yes.']);
  });
  it('does not split after titles, initials and common abbreviations', () => {
    expect(splitSentences('Mr. Smith met Dr. Jones at 5 p.m. on Main St. today. J. R. R. Tolkien wrote it, e.g. this.')).toEqual([
      'Mr. Smith met Dr. Jones at 5 p.m. on Main St. today.',
      'J. R. R. Tolkien wrote it, e.g. this.',
    ]);
  });
  it('keeps closing quotes with their sentence', () => {
    expect(splitSentences('He said, “Go home.” She left.')).toEqual(['He said, “Go home.”', 'She left.']);
  });
  it('splits very long sentences at clause breaks', () => {
    const long = Array.from({ length: 12 }, (_, i) => `this is clause number ${i} of a very long sentence`).join('; ') + '.';
    const parts = splitSentences(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 320)).toBe(true);
    expect(parts.join(' ')).toBe(long);
  });
  it('returns nothing for blank text', () => expect(splitSentences('  ')).toEqual([]));
});

describe('speakable', () => {
  it('converts roman chapter numbers', () => expect(speakable('Chapter XIV. The End')).toBe('Chapter 14. The End'));
  it('removes citation brackets and glued footnote numbers', () => {
    expect(speakable('As shown [12], it works.3 Next')).toBe('As shown, it works. Next');
  });
  it('replaces URLs and spaced dashes', () => {
    expect(speakable('See https://example.com/x — then go')).toBe('See link, then go');
  });
  it('drops ornament-only sentences', () => {
    expect(speakable('* * *')).toBe('');
    expect(speakable('———')).toBe('');
  });
  it('parses roman numerals', () => {
    expect(romanToInt('XLII')).toBe(42);
    expect(romanToInt('hello')).toBeUndefined();
  });
});

describe('header/footer helpers', () => {
  it('recognises page numbers', () => {
    for (const t of ['12', 'xiv', 'Page 3', '3 of 200', '- 17 -', '[4]']) expect(isPageNumber(t)).toBe(true);
    for (const t of ['12 Angry Men', 'Chapter 3']) expect(isPageNumber(t)).toBe(false);
  });
  it('normalises running headers with page numbers', () => {
    expect(headerKey('12  THE BOOK')).toBe(headerKey('148 THE BOOK'));
    expect(headerKey('THE BOOK xii')).toBe(headerKey('THE BOOK iv'));
  });
});

describe('joinLines', () => {
  const vocab = vocabulary(['a well-known fact', 'the information age', 'self-aware']);
  it('rejoins words hyphenated at the line end', () => {
    expect(joinLines('the infor-', 'mation age', vocab)).toBe('the information age');
    expect(joinLines('an unprece-', 'dented storm', vocab)).toBe('an unprecedented storm');
  });
  it('keeps real compound hyphens seen elsewhere in the book', () => {
    expect(joinLines('a well-', 'known fact', vocab)).toBe('a well-known fact');
  });
  it('keeps the hyphen before a capital', () => {
    expect(joinLines('the Anglo-', 'Saxon kings', vocab)).toBe('the Anglo-Saxon kings');
  });
  it('joins normal lines with a space', () => expect(joinLines('one', 'two', vocab)).toBe('one two'));
});

describe('stripInlineMarkers', () => {
  it('removes footnote numbers glued after punctuation but keeps years and numbers', () => {
    expect(stripInlineMarkers('the end.12 Then in 1914, page 3.')).toBe('the end. Then in 1914, page 3.');
  });
});

describe('cleanPdf', () => {
  const header = (i: number) => (i % 2 ? 'A MESSY BOOK' : `${i + 1}  Chapter One`);

  const pages = [
    page(0, [{ t: 'Copyright © 2001 Someone. All rights reserved.' }, 'ISBN 978-0-00-000000-0']),
    page(1, [{ t: 'CHAPTER ONE', size: 20 }, { t: 'The Beginning', size: 16, gap: 4 }, { t: 'It was a dark and stormy night; the rain fell in tor-', gap: 20 }, 'rents, except at occasional intervals, when it was', 'checked by a violent gust of wind which swept up', { t: 'the streets.', w: 0.3 }, { t: 'A second paragraph begins here with an indent and', indent: 18 }, 'continues on the next page without a break in the'], {
      header: header(1),
      footer: '2',
    }),
    page(2, ['flow of the text, so it must be joined across pages.¹', { t: 'Short final line.', w: 0.4, indent: 18 }, { t: 'Col A\tCol B\tCol C', gap: 10 }, 'one\ttwo\tthree', 'four\tfive\tsix', { t: 'After the table, more prose that keeps going on and', gap: 10, indent: 18 }, { t: 'on.', w: 0.1 }], {
      header: header(2),
      footer: '3',
      notes: ['1 This is a footnote that runs onto', 'a second line.'],
    }),
    page(3, prose(3, 'alpha'), { header: header(3), footer: '4' }),
    page(4, prose(3, 'beta'), { header: header(4), footer: '5' }),
    page(5, prose(3, 'gamma'), { header: header(5), footer: '6' }),
    page(6, prose(3, 'delta'), { header: header(6), footer: '7' }),
  ];
  const r = cleanPdf({ pages });
  const texts = r.paras.map((p) => p.text);

  it('detects the body font size', () => expect(r.bodySize).toBe(11));

  it('removes running headers and page numbers', () => {
    const all = texts.join('\n');
    expect(all).not.toMatch(/A MESSY BOOK|Chapter One\n|^\d+$/m);
    expect(r.removedLines).toBeGreaterThanOrEqual(8);
  });

  it('keeps the large chapter heading even though it resembles the running header', () => {
    expect(r.paras.find((p) => p.kind === 'heading')?.text).toBe('CHAPTER ONE');
  });

  it('rejoins hyphenated words and lines into paragraphs', () => {
    expect(texts).toContain(
      'It was a dark and stormy night; the rain fell in torrents, except at occasional intervals, when it was checked by a violent gust of wind which swept up the streets.',
    );
  });

  it('joins a paragraph split across a page break', () => {
    expect(texts).toContain(
      'A second paragraph begins here with an indent and continues on the next page without a break in the flow of the text, so it must be joined across pages.¹',
    );
  });

  it('separates footnotes and puts them after the paragraph they interrupt', () => {
    const i = r.paras.findIndex((p) => p.skip === 'footnote');
    expect(r.paras[i].text).toBe('1 This is a footnote that runs onto a second line.');
    expect(r.paras[i - 1].text).toBe('After the table, more prose that keeps going on and on.');
  });

  it('detects tables', () => {
    const t = r.paras.find((p) => p.kind === 'table');
    expect(t).toMatchObject({ rows: 3, cols: 3 });
  });

  it('flags the copyright page as front matter', () => {
    expect(r.frontPages).toContain(0);
    expect(r.paras[0].skip).toBe('front');
  });

  it('keeps identical full body lines that happen to start several pages', () => {
    const same = 'continued text that is exactly the same full-width line on every page here';
    const ps = [0, 1, 2, 3].map((i) => page(i, [same, ...prose(5, tag(i))], { header: 'HEAD', footer: String(i + 1) }));
    const out = cleanPdf({ pages: ps }).paras.map((p) => p.text).join(' ');
    expect(out.split(same).length - 1).toBe(4);
    expect(out).not.toMatch(/HEAD/);
  });

  it('marks the first paragraph on each page', () => {
    // Pages 4-6 only continue the paragraph from page 3, so no paragraph starts on them.
    expect(r.paras.filter((p) => p.pageTop).map((p) => p.page)).toEqual([0, 1, 2, 3]);
  });
});
