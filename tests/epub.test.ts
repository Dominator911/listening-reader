import { describe, expect, it } from 'vitest';
import { parseEpub, resolvePath } from '../src/parse/epub';
import { extractBlocks, parseMarkup } from '../src/parse/xhtml';
import { makeEpub2, makeEpub3 } from './fixtures';

describe('resolvePath', () => {
  it('resolves relative, parent and encoded paths', () => {
    expect(resolvePath('OEBPS', 'text/ch1.xhtml#x')).toBe('OEBPS/text/ch1.xhtml');
    expect(resolvePath('OEBPS/text', '../images/a.png')).toBe('OEBPS/images/a.png');
    expect(resolvePath('', 'chapter%201.xhtml')).toBe('chapter 1.xhtml');
    expect(resolvePath('a/b', '/root.xhtml')).toBe('root.xhtml');
  });
});

describe('parseEpub (EPUB 3)', async () => {
  const book = await parseEpub(await makeEpub3());

  it('reads metadata and cover', () => {
    expect(book.meta).toEqual({ title: 'The Test Book', author: 'Ada Writer', language: 'en' });
    expect(book.cover?.type).toBe('image/png');
  });

  it('reads the nav TOC with depth and fragments', () => {
    expect(book.tocSource).toBe('nav');
    expect(book.toc.map((t) => [t.title, t.href, t.fragment, t.depth])).toEqual([
      ['Chapter 1: Beginnings', 'OEBPS/text/chapter 1.xhtml', undefined, 0],
      ['A Second Section', 'OEBPS/text/chapter 1.xhtml', 's2', 1],
      ['Chapter 2', 'OEBPS/text/ch2.xhtml', undefined, 0],
    ]);
  });

  it('reads landmarks', () => {
    expect(book.landmarks.map((l) => l.type)).toEqual(['copyright-page', 'bodymatter']);
  });

  it('keeps spine order, linear flag and semantics', () => {
    expect(book.spine.map((d) => [d.href.split('/').pop(), d.linear])).toEqual([
      ['copyright.xhtml', true],
      ['chapter 1.xhtml', true],
      ['ch2.xhtml', true],
      ['notes.xhtml', false],
    ]);
    expect(book.spine[0].semantics).toContain('copyright-page');
    // A footnote <aside> directly under <body> must not label the whole chapter.
    expect(book.spine[1].semantics).toEqual([]);
  });

  it('removes footnote markers and soft hyphens from running text', () => {
    const ch1 = book.spine[1].blocks;
    expect(ch1[1]).toEqual({ type: 'text', text: 'It was a dark night. The wind was upset.' });
    expect(ch1[2].text).toBe('She said “no”, and left.');
    expect(book.spine[1].noterefsRemoved).toBe(2);
  });

  it('types headings, images, tables and footnotes', () => {
    const ch1 = book.spine[1].blocks;
    expect(ch1[0]).toMatchObject({ type: 'heading', level: 1 });
    expect(ch1.find((b) => b.text === 'A Second Section')).toMatchObject({ type: 'heading', level: 2, anchors: ['s2'] });
    expect(ch1.find((b) => b.type === 'image')?.text).toBe('Map of the valley');
    expect(ch1.find((b) => b.type === 'table')).toMatchObject({ rows: 2, cols: 2 });
    const notes = ch1.filter((b) => b.type === 'footnote').map((b) => b.text);
    expect(notes).toEqual(['A local footnote.', '9. A class-based footnote.']);
    // The endnote in notes.xhtml is a link target → recognised as a footnote body.
    expect(book.spine[3].blocks.find((b) => b.text.includes('An endnote'))?.type).toBe('footnote');
  });

  it('splits mixed div content into separate blocks in order', () => {
    const texts = book.spine[1].blocks.map((b) => b.text);
    const i = texts.indexOf('Loose text in a div');
    expect(texts.slice(i, i + 3)).toEqual(['Loose text in a div', 'with a nested paragraph.', 'and a tail.']);
  });

  it('turns <br> into a space', () => {
    expect(book.spine[2].blocks[1].text).toBe('Second chapter text across a break.');
  });
});

describe('parseEpub (EPUB 2 + NCX, non-XML HTML)', async () => {
  const book = await parseEpub(await makeEpub2());

  it('falls back to NCX', () => {
    expect(book.tocSource).toBe('ncx');
    expect(book.toc.map((t) => [t.title, t.depth, t.fragment])).toEqual([
      ['Part One', 0, undefined],
      ['The First Chapter', 1, 'start'],
    ]);
  });

  it('uses only author-role creators and the meta cover', () => {
    expect(book.meta.author).toBe('B. Author');
    expect(book.cover?.type).toBe('image/jpeg');
  });

  it('parses HTML entities via the lenient parser', () => {
    expect(book.spine[0].blocks[1].text).toBe('Café & more text.');
  });

  it('maps guide references to landmarks', () => {
    expect(book.landmarks[0]).toMatchObject({ type: 'toc', href: 'a.html' });
  });
});

describe('parseEpub errors', () => {
  it('rejects non-zip data clearly', async () => {
    await expect(parseEpub(new Uint8Array([1, 2, 3]))).rejects.toThrow(/not a valid EPUB/);
  });
});

describe('extractBlocks edge cases', () => {
  it('does not treat ordinary numbered links as note markers when the text is a word', () => {
    const doc = parseMarkup('<html><body><p>See <a href="#x">chapter five</a> for more.</p></body></html>');
    expect(extractBlocks(doc).blocks[0].text).toBe('See chapter five for more.');
  });

  it('carries container ids to the next block with text', () => {
    const doc = parseMarkup('<html><body><section id="part2"><div id="empty"></div><p>Hello</p></section></body></html>');
    expect(extractBlocks(doc).blocks[0].anchors).toEqual(['part2', 'empty']);
  });
});
