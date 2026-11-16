// Turns an XHTML content document into a flat list of blocks.
// Footnote reference markers are dropped from running text here (they need the DOM
// to be recognised); footnote bodies are kept but typed 'footnote' so cleanup can skip them.

import type { Block, BlockType } from './types';

const SKIP_TAGS = new Set(['script', 'style', 'head', 'noscript', 'template', 'title', 'meta', 'link']);
const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'aside', 'blockquote', 'body', 'main', 'header', 'footer',
  'nav', 'figure', 'figcaption', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'pre', 'address', 'hr',
  'center', 'caption', 'details', 'summary', 'hgroup', 'form', 'fieldset', 'html',
]);
const HEADING = /^h([1-6])$/;
const IMAGE_TAGS = new Set(['img', 'svg', 'image', 'picture', 'math', 'video', 'audio', 'object', 'canvas']);

const NOTE_TYPES = /\b(footnote|endnote|rearnote|note|annotation)s?\b/i;
const NOTEREF_TYPES = /\bnoteref\b/i;
/** Text that looks like a footnote marker: 1, 23, *, †, ‡, [4], (a), iv. */
const MARKER_TEXT = /^\s*[[(]?\s*(\d{1,3}|[*†‡§¶#]+|[a-z]|[ivxlc]{1,5})\s*[\])]?\s*$/i;

export function localName(el: Element): string {
  return (el.localName || el.nodeName).toLowerCase();
}

/** epub:type, role and class semantics of an element, lower-cased and space-separated. */
export function semanticsOf(el: Element): string {
  const parts: string[] = [];
  for (const attr of Array.from(el.attributes)) {
    const n = attr.name.toLowerCase();
    if (n === 'epub:type' || n.endsWith(':type') || n === 'role') {
      parts.push(attr.value);
    }
  }
  return parts.join(' ').toLowerCase().replace(/\bdoc-/g, '');
}

function fragmentOf(href: string | null): string | undefined {
  if (!href) return undefined;
  const i = href.indexOf('#');
  return i >= 0 ? decodeURIComponent(href.slice(i + 1)) : undefined;
}

/** Is this inline element a footnote reference marker that should not be spoken? */
export function isNoteref(el: Element, noteTargets?: Set<string>): boolean {
  const tag = localName(el);
  if (tag !== 'a' && tag !== 'sup' && tag !== 'span') return false;
  if (NOTEREF_TYPES.test(semanticsOf(el))) return true;
  const text = el.textContent ?? '';
  if (tag === 'a') {
    const href = el.getAttribute('href') ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    const frag = fragmentOf(href);
    if (!frag) return false;
    if (noteTargets?.has(frag) && MARKER_TEXT.test(text)) return true;
    // <a href="#fn3"><sup>3</sup></a> or <a href="notes.xhtml#n3">3</a>
    if (el.querySelector('sup') && MARKER_TEXT.test(text)) return true;
    if (/^\s*\d{1,3}\s*$/.test(text) || /^\s*[*†‡]+\s*$/.test(text)) return true;
    return false;
  }
  if (tag === 'sup') {
    // Superscript wrapping a link, or a bare superscript number/symbol.
    const a = el.querySelector('a');
    if (a && MARKER_TEXT.test(text)) return true;
    return /^\s*(\d{1,3}|[*†‡§]+)\s*$/.test(text);
  }
  return false;
}

/** Collect fragment ids that noteref links point at (so we can recognise footnote bodies). */
export function collectNoteTargets(doc: Document, into: Set<string>): void {
  for (const a of Array.from(doc.getElementsByTagName('a'))) {
    if (isNoteref(a)) {
      const frag = fragmentOf(a.getAttribute('href'));
      if (frag) into.add(frag);
    }
  }
}

export function normalizeText(s: string): string {
  return s
    .replace(/[­​‌‍⁠﻿]/g, '') // soft hyphen, zero-width
    .replace(/[\s  -   　]+/g, ' ')
    .replace(/ ([,.;:!?)\]’”])/g, '$1') // space left before punctuation after removing a marker
    .trim();
}

interface Ctx {
  footnote: boolean;
}

export interface ExtractResult {
  blocks: Block[];
  noterefsRemoved: number;
  title?: string;
  semantics: string[];
}

export function extractBlocks(doc: Document, noteTargets: Set<string> = new Set()): ExtractResult {
  const blocks: Block[] = [];
  let noterefsRemoved = 0;
  let buf = '';
  let bufAnchors: string[] = [];
  let bufFootnote = false;
  let pendingAnchors: string[] = [];

  const takeAnchors = () => {
    const a = [...pendingAnchors, ...bufAnchors];
    pendingAnchors = [];
    bufAnchors = [];
    return a.length ? a : undefined;
  };

  const flush = (ctx: Ctx, type: BlockType = 'text', level?: number) => {
    const text = normalizeText(buf);
    const footnote = bufFootnote;
    buf = '';
    bufFootnote = false;
    if (!text) {
      // Keep the anchors for the next real block.
      pendingAnchors.push(...bufAnchors);
      bufAnchors = [];
      return;
    }
    const finalType: BlockType = type === 'text' && (ctx.footnote || footnote) ? 'footnote' : type;
    const b: Block = { type: finalType, text };
    if (level) b.level = level;
    const anchors = takeAnchors();
    if (anchors) b.anchors = anchors;
    blocks.push(b);
  };

  const addId = (el: Element, toPending: boolean) => {
    const id = el.getAttribute('id') ?? el.getAttribute('name');
    if (!id) return;
    if (toPending) pendingAnchors.push(id);
    else bufAnchors.push(id);
  };

  const isFootnoteContainer = (el: Element) => {
    const sem = semanticsOf(el);
    if (NOTE_TYPES.test(sem) && !NOTEREF_TYPES.test(sem)) return true;
    const cls = el.getAttribute('class') ?? '';
    if (/\b(foot|end)notes?\b|\bfn\b|\bnote\b/i.test(cls)) return true;
    const id = el.getAttribute('id');
    return !!id && noteTargets.has(id);
  };

  const visit = (el: Element, ctx: Ctx) => {
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3 /* text */ || node.nodeType === 4 /* cdata */) {
        buf += node.nodeValue ?? '';
        continue;
      }
      if (node.nodeType !== 1) continue;
      const child = node as Element;
      const tag = localName(child);
      if (SKIP_TAGS.has(tag)) continue;

      if (isNoteref(child, noteTargets)) {
        noterefsRemoved++;
        continue;
      }
      if (tag === 'br') {
        buf += ' ';
        continue;
      }
      if (IMAGE_TAGS.has(tag)) {
        // Inline decorative images inside running text are ignored; standalone ones become image blocks.
        if (normalizeText(buf)) continue;
        flush(ctx);
        addId(child, true);
        const alt = normalizeText(
          child.getAttribute('alt') ?? child.getAttribute('aria-label') ?? child.querySelector('title')?.textContent ?? '',
        );
        blocks.push({ type: 'image', text: alt, ...(pendingAnchors.length ? { anchors: takeAnchors() } : {}) });
        continue;
      }
      if (tag === 'table') {
        flush(ctx);
        addId(child, true);
        const rows = Array.from(child.getElementsByTagName('tr'));
        const cols = rows.reduce((m, r) => Math.max(m, r.children.length), 0);
        const caption = child.getElementsByTagName('caption')[0]?.textContent ?? '';
        const text = normalizeText(
          caption || rows.map((r) => Array.from(r.children).map((c) => c.textContent ?? '').join(' | ')).join(' / '),
        );
        const anchors = takeAnchors();
        blocks.push({ type: 'table', text, rows: rows.length, cols, ...(anchors ? { anchors } : {}) });
        continue;
      }
      const h = HEADING.exec(tag);
      if (h) {
        flush(ctx);
        addId(child, false);
        visit(child, ctx);
        flush(ctx, 'heading', Number(h[1]));
        continue;
      }
      if (BLOCK_TAGS.has(tag)) {
        flush(ctx);
        addId(child, true);
        const childCtx: Ctx = { footnote: ctx.footnote || isFootnoteContainer(child) };
        visit(child, childCtx);
        flush(childCtx);
        continue;
      }
      // Inline element.
      const id = child.getAttribute('id');
      if (id) {
        bufAnchors.push(id);
        if (noteTargets.has(id)) bufFootnote = true;
      }
      if (isFootnoteContainer(child) && tag !== 'a') bufFootnote = true;
      visit(child, ctx);
    }
  };

  const body = doc.getElementsByTagName('body')[0] ?? doc.documentElement;
  const semantics = new Set<string>();
  // Document-level semantics only (front matter, copyright…); a footnote aside inside a chapter is not the chapter's type.
  const addSem = (el: Element) =>
    semanticsOf(el)
      .split(/\s+/)
      .filter((s) => s && !NOTE_TYPES.test(s) && !NOTEREF_TYPES.test(s))
      .forEach((s) => semantics.add(s));
  addSem(body);
  for (const c of Array.from(body.children)) {
    addSem(c);
    // Common pattern: <body><section epub:type="..."> or <body><div><section epub:type="...">
    if (localName(c) === 'div') for (const cc of Array.from(c.children)) addSem(cc);
  }

  visit(body, { footnote: isFootnoteContainer(body) });
  flush({ footnote: false });

  const titleEl = doc.getElementsByTagName('title')[0];
  const title = normalizeText(titleEl?.textContent ?? '') || blocks.find((b) => b.type === 'heading')?.text;
  return { blocks, noterefsRemoved, title: title || undefined, semantics: [...semantics] };
}

/** Parse XHTML strictly, falling back to the forgiving HTML parser for malformed files. */
export function parseMarkup(source: string): Document {
  const parser = new DOMParser();
  const xml = parser.parseFromString(source, 'application/xhtml+xml');
  if (!xml.getElementsByTagName('parsererror').length) return xml;
  return parser.parseFromString(source, 'text/html');
}
