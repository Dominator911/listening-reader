// Writes synthetic books to test-books/_samples for manual checks:
//   sample.epub  – EPUB 3 with nav, footnotes, a table and an image
//   sample.pdf   – tiny PDF with a header, page numbers, hyphenation and a superscript note
//   messy.pdf    – 3-chapter PDF, no bookmarks: alternating running heads, page numbers,
//                  hyphenated line ends, paragraphs split across pages, a copyright page
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeEpub3, makePdf } from '../tests/fixtures';

mkdirSync('test-books/_samples', { recursive: true });
writeFileSync('test-books/_samples/sample.epub', await makeEpub3());
writeFileSync(
  'test-books/_samples/sample.pdf',
  await makePdf({
    pages: 3,
    title: 'Sample PDF',
    header: () => 'RUNNING HEAD',
    footer: (p) => String(p + 1),
    body: () => ['A body line with a hyphen-', 'ated word.^1', 'Another line.'],
  }),
);

const para = [
  '  The lighthouse keeper had not spoken to anyone in eleven days, and the',
  'silence had begun to feel like a second coat. Each morning he climbed the',
  'stairs, wiped the great lens, and wrote the weather in a book that no-',
  'body would ever read. The gulls were his only correspondents.^1',
  '  On the twelfth day a boat appeared on the horizon. It was small and',
  'painted a cheerful yellow, and it moved with the unhurried confi-',
  'dence of a vessel that knew exactly where it was going. He watched',
  'it for an hour before he admitted to himself that it was coming here.',
];
const chapters = ['# Chapter 1: The Keeper', '# Chapter 2: The Visitor', '# Chapter 3: The Storm'];
const pages: string[][] = [['Copyright © 2024 A. Writer. All rights reserved.', 'ISBN 978-0-00-000000-0', 'First published 2024.']];
chapters.forEach((h) => {
  pages.push([h, ...para, ...para.slice(0, 6)]);
  pages.push([...para.slice(6), ...para, ...para.slice(0, 7)]);
  pages.push([...para.slice(7), ...para, ...para]);
});
writeFileSync(
  'test-books/_samples/messy.pdf',
  await makePdf({
    pages: pages.length,
    title: 'The Lighthouse (messy sample)',
    header: (p) => (p === 0 ? undefined : p % 2 ? 'THE LIGHTHOUSE' : `${p + 1}    A. WRITER`),
    footer: (p) => (p === 0 ? undefined : String(p + 1)),
    body: (p) => pages[p],
  }),
);
console.log('Wrote sample.epub, sample.pdf and messy.pdf to test-books/_samples');
