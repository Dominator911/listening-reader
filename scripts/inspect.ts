// Usage: npm run inspect -- path/to/book.epub|pdf [--full]
// Prints what the parser extracts, so problems can be diagnosed without the browser.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename } from 'node:path';
import { JSDOM } from 'jsdom';
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';

const { window } = new JSDOM('');
Object.assign(globalThis, { DOMParser: window.DOMParser });
GlobalWorkerOptions.workerSrc = createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');

const { parseEpub } = await import('../src/parse/epub');
const { parsePdf } = await import('../src/parse/pdf');
const { sniffFormat } = await import('../src/parse/index');

const path = process.argv[2];
const full = process.argv.includes('--full');
if (!path) {
  console.error('Usage: npm run inspect -- <book.epub|book.pdf> [--full]');
  process.exit(1);
}
const bytes = new Uint8Array(readFileSync(path));
const t0 = performance.now();
const fmt = sniffFormat(bytes.slice(0, 1024), path);
const book = fmt === 'pdf' ? await parsePdf(bytes) : await parseEpub(bytes);
const ms = performance.now() - t0;

console.log(`\n${book.meta.title} — ${book.meta.author ?? 'unknown author'}  [${book.format}, ${(ms / 1000).toFixed(2)} s]`);
book.warnings.forEach((w) => console.log(`  ! ${w}`));
const toc = book.format === 'epub' ? book.toc : book.outline;
console.log(`\nTOC (${book.format === 'epub' ? book.tocSource : 'outline'}, ${toc.length} entries):`);
toc.slice(0, full ? undefined : 60).forEach((t) =>
  console.log(`  ${'  '.repeat(t.depth)}${t.title}  → ${t.pageIndex !== undefined ? `p${t.pageIndex + 1}` : `${t.href ?? '-'}${t.fragment ? '#' + t.fragment : ''}`}`),
);

if (book.format === 'epub') {
  console.log(`\nSpine (${book.spine.length} docs):`);
  for (const d of book.spine) {
    const counts: Record<string, number> = {};
    d.blocks.forEach((b) => (counts[b.type] = (counts[b.type] ?? 0) + 1));
    console.log(`  ${d.linear ? ' ' : '~'} ${d.href}  "${d.title ?? ''}"  [${d.semantics.join(',')}]  ${JSON.stringify(counts)} refs-removed=${d.noterefsRemoved}`);
    for (const b of d.blocks.slice(0, full ? undefined : 3)) console.log(`      ${b.type.padEnd(8)} ${b.text.slice(0, 110)}`);
  }
} else {
  console.log(`\nText layer: ${book.textLayer}; ${book.pages.length} pages; empty pages: ${book.emptyPages.length}`);
  const sample = full ? book.pages : [0, 1, 2, Math.floor(book.pages.length / 2), book.pages.length - 1].map((i) => book.pages[i]).filter(Boolean);
  for (const p of sample) {
    console.log(`\n  --- page ${p.index + 1}${p.label ? ` (label ${p.label})` : ''}`);
    p.lines.forEach((l) => console.log(`  y${String(Math.round(l.y)).padStart(4)} ${String(l.fontSize).padStart(5)}pt  ${l.text}`));
  }
}

// What the player will see after chapter detection and cleanup.
const { buildContent } = await import('../src/core/chapters');
const content = buildContent(book);
console.log(`\n==== Chapters (${content.chapterSource}, ${content.chapters.length}) ====`);
content.warnings.forEach((w) => console.log(`  ! ${w}`));
for (const ch of content.chapters) {
  const skipped = ch.paragraphs.every((p) => p.skip || !p.sentences.length);
  console.log(`\n${'  '.repeat(ch.depth)}# ${ch.title}${skipped ? '   [skipped by default]' : ''}  (${ch.paragraphs.length} paragraphs)`);
  for (const p of ch.paragraphs.slice(0, full ? undefined : 3)) {
    console.log(`    [${p.kind}${p.skip ? '/' + p.skip : ''}] ${p.text.slice(0, full ? undefined : 200)}`);
  }
}

const out = `test-books/${basename(path)}.parse.json`;
const { cover: _c, ...rest } = book;
void _c;
writeFileSync(out, JSON.stringify(rest, null, 1));
console.log(`\nFull result written to ${out}`);
