// A 200-page text PDF with chapters, headers and page numbers, for size/compatibility checks.
import { writeFileSync } from 'node:fs';
import { makePdf } from '../tests/fixtures';

const line = (p: number, i: number) => `Page ${p} line ${i}: the keeper watched the sea and wrote down the weather again today.`;
writeFileSync(
  'test-books/_samples/big.pdf',
  await makePdf({
    pages: 200,
    title: 'Big Sample',
    header: (p) => (p % 2 ? 'BIG SAMPLE' : 'A. WRITER'),
    footer: (p) => String(p + 1),
    body: (p) => [...(p % 20 === 0 ? [`# Chapter ${p / 20 + 1}`] : []), ...Array.from({ length: 30 }, (_, i) => line(p + 1, i))],
  }),
);
console.log('Wrote test-books/_samples/big.pdf');
