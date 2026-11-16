// Minimal EPUB 2/3 reader: container.xml → OPF (metadata, manifest, spine) → nav or NCX → content blocks.
// We only need text and structure, not rendering, so this avoids a full reader engine.

import JSZip from 'jszip';
import type { Landmark, ParsedEpub, SpineDoc, TocEntry } from './types';
import { collectNoteTargets, extractBlocks, localName, normalizeText, parseMarkup, semanticsOf } from './xhtml';

interface ManifestItem {
  id: string;
  href: string; // resolved zip path
  mediaType: string;
  properties: string;
}

export class EpubError extends Error {}

/** Resolve `href` relative to the directory `base` (both zip paths). Strips any fragment. */
export function resolvePath(base: string, href: string): string {
  const clean = safeDecode(href.split('#')[0]);
  if (clean.startsWith('/')) return normalizeSegments(clean.slice(1).split('/'));
  const baseParts = base ? base.split('/').filter(Boolean) : [];
  return normalizeSegments([...baseParts, ...clean.split('/')]);
}

function normalizeSegments(parts: string[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i) : '';
}

function fragmentOf(href: string): string | undefined {
  const i = href.indexOf('#');
  return i >= 0 ? safeDecode(href.slice(i + 1)) || undefined : undefined;
}

function byLocalName(root: Document | Element, name: string): Element[] {
  // Namespace-agnostic lookup (OPF/NCX use default namespaces, dc: uses a prefix).
  const all = root.getElementsByTagName('*');
  const out: Element[] = [];
  for (let i = 0; i < all.length; i++) if (localName(all[i]) === name) out.push(all[i]);
  return out;
}

function childrenByName(el: Element, name: string): Element[] {
  return Array.from(el.children).filter((c) => localName(c) === name);
}

function parseXml(source: string, what: string): Document {
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    // Some files have stray entities or a BOM; the HTML parser is forgiving enough for OPF/NCX.
    const html = new DOMParser().parseFromString(source, 'text/html');
    if (!html.body && !html.documentElement) throw new EpubError(`Could not read ${what}`);
    return html;
  }
  return doc;
}

class Zip {
  private lower = new Map<string, string>();
  constructor(private zip: JSZip) {
    zip.forEach((path) => this.lower.set(path.toLowerCase(), path));
  }
  private find(path: string) {
    return this.zip.file(path) ?? this.zip.file(this.lower.get(path.toLowerCase()) ?? '\0');
  }
  has(path: string) {
    return !!this.find(path);
  }
  async text(path: string): Promise<string> {
    const f = this.find(path);
    if (!f) throw new EpubError(`Missing file in EPUB: ${path}`);
    return f.async('string');
  }
  async blob(path: string, type: string): Promise<Blob | undefined> {
    const f = this.find(path);
    if (!f) return undefined;
    return new Blob([await f.async('arraybuffer')], { type });
  }
}

export async function parseEpub(data: ArrayBuffer | Uint8Array): Promise<ParsedEpub> {
  let jszip: JSZip;
  try {
    jszip = await JSZip.loadAsync(data);
  } catch {
    throw new EpubError('This file is not a valid EPUB (it is not a readable zip archive).');
  }
  const zip = new Zip(jszip);
  const warnings: string[] = [];

  if (zip.has('META-INF/encryption.xml')) {
    const enc = await zip.text('META-INF/encryption.xml');
    // Font obfuscation is harmless; anything else means DRM-protected content we cannot read.
    if (/EncryptedData/.test(enc) && !/http:\/\/www\.idpf\.org\/2008\/embedding|http:\/\/ns\.adobe\.com\/pdf\/enc#RC/.test(enc)) {
      warnings.push('This EPUB declares encrypted content (DRM). Text may be unreadable.');
    }
  }

  // 1. container.xml → OPF path
  let opfPath: string | undefined;
  if (zip.has('META-INF/container.xml')) {
    const container = parseXml(await zip.text('META-INF/container.xml'), 'container.xml');
    opfPath = byLocalName(container, 'rootfile')[0]?.getAttribute('full-path') ?? undefined;
  }
  if (!opfPath) {
    jszip.forEach((p) => {
      if (!opfPath && p.toLowerCase().endsWith('.opf')) opfPath = p;
    });
    if (opfPath) warnings.push('META-INF/container.xml missing or broken; found the package file by name.');
  }
  if (!opfPath) throw new EpubError('This EPUB has no package (.opf) file.');
  const opfDir = dirOf(opfPath);
  const opf = parseXml(await zip.text(opfPath), opfPath);

  // 2. Metadata
  const firstText = (name: string) => normalizeText(byLocalName(opf, name)[0]?.textContent ?? '') || undefined;
  const creators = byLocalName(opf, 'creator')
    .filter((c) => {
      const role = c.getAttribute('opf:role') ?? c.getAttribute('role');
      return !role || role === 'aut';
    })
    .map((c) => normalizeText(c.textContent ?? ''))
    .filter(Boolean);
  const meta = {
    title: firstText('title') ?? 'Untitled',
    author: creators.length ? creators.join(', ') : undefined,
    language: firstText('language'),
  };

  // 3. Manifest
  const manifest = new Map<string, ManifestItem>();
  for (const item of byLocalName(opf, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (!id || !href) continue;
    manifest.set(id, {
      id,
      href: resolvePath(opfDir, href),
      mediaType: item.getAttribute('media-type') ?? '',
      properties: item.getAttribute('properties') ?? '',
    });
  }
  const items = [...manifest.values()];

  // 4. Cover
  let coverItem = items.find((i) => /\bcover-image\b/.test(i.properties));
  if (!coverItem) {
    const coverMeta = byLocalName(opf, 'meta').find((m) => m.getAttribute('name') === 'cover');
    const cid = coverMeta?.getAttribute('content');
    if (cid) coverItem = manifest.get(cid) ?? items.find((i) => i.href.endsWith(cid));
  }
  if (!coverItem) coverItem = items.find((i) => i.mediaType.startsWith('image/') && /cover/i.test(i.id + i.href));
  const cover = coverItem?.mediaType.startsWith('image/') ? await zip.blob(coverItem.href, coverItem.mediaType) : undefined;

  // 5. Spine
  const spineEl = byLocalName(opf, 'spine')[0];
  const spineRefs = spineEl ? childrenByName(spineEl, 'itemref') : [];
  const spineItems = spineRefs
    .map((ref) => ({ item: manifest.get(ref.getAttribute('idref') ?? ''), linear: ref.getAttribute('linear') !== 'no' }))
    .filter((s): s is { item: ManifestItem; linear: boolean } => !!s.item && /html|xml/.test(s.item.mediaType));
  if (!spineItems.length) throw new EpubError('This EPUB has no readable content documents in its spine.');

  // 6. Table of contents: EPUB 3 nav first, then EPUB 2 NCX.
  let toc: TocEntry[] = [];
  let tocSource: ParsedEpub['tocSource'] = 'none';
  let landmarks: Landmark[] = [];
  const navItem = items.find((i) => /\bnav\b/.test(i.properties));
  if (navItem && zip.has(navItem.href)) {
    try {
      const navDoc = parseMarkup(await zip.text(navItem.href));
      const navDir = dirOf(navItem.href);
      const navs = byLocalName(navDoc, 'nav');
      const tocNav = navs.find((n) => /\btoc\b/.test(semanticsOf(n))) ?? navs[0];
      if (tocNav) toc = readNavList(tocNav, navDir);
      const lmNav = navs.find((n) => /\blandmarks\b/.test(semanticsOf(n)));
      if (lmNav) {
        landmarks = byLocalName(lmNav, 'a').map((a) => {
          const href = a.getAttribute('href') ?? '';
          return {
            type: semanticsOf(a).trim(),
            href: resolvePath(navDir, href),
            fragment: fragmentOf(href),
            title: normalizeText(a.textContent ?? ''),
          };
        });
      }
      if (toc.length) tocSource = 'nav';
    } catch (e) {
      warnings.push(`Could not read the EPUB 3 navigation document: ${(e as Error).message}`);
    }
  }
  if (!toc.length) {
    const ncxId = spineEl?.getAttribute('toc');
    const ncxItem = (ncxId && manifest.get(ncxId)) || items.find((i) => i.mediaType === 'application/x-dtbncx+xml');
    if (ncxItem && zip.has(ncxItem.href)) {
      try {
        const ncx = parseXml(await zip.text(ncxItem.href), ncxItem.href);
        const navMap = byLocalName(ncx, 'navMap')[0] ?? byLocalName(ncx, 'navmap')[0];
        if (navMap) toc = readNcx(navMap, dirOf(ncxItem.href), 0);
        if (toc.length) tocSource = 'ncx';
      } catch (e) {
        warnings.push(`Could not read the NCX table of contents: ${(e as Error).message}`);
      }
    }
  }
  if (!landmarks.length) {
    landmarks = byLocalName(opf, 'reference').map((r) => {
      const href = r.getAttribute('href') ?? '';
      return {
        type: (r.getAttribute('type') ?? '').toLowerCase(),
        href: resolvePath(opfDir, href),
        fragment: fragmentOf(href),
        title: r.getAttribute('title') ?? undefined,
      };
    });
  }
  if (!toc.length) warnings.push('No table of contents found; chapters will follow the reading order (spine).');

  // 7. Content documents. Parse all first so footnote targets can be found across files.
  const docs: { item: ManifestItem; linear: boolean; doc: Document }[] = [];
  for (const s of spineItems) {
    if (!zip.has(s.item.href)) {
      warnings.push(`Spine item missing from archive: ${s.item.href}`);
      continue;
    }
    docs.push({ ...s, doc: parseMarkup(await zip.text(s.item.href)) });
  }
  const noteTargets = new Set<string>();
  for (const d of docs) collectNoteTargets(d.doc, noteTargets);

  const spine: SpineDoc[] = docs.map(({ item, linear, doc }) => {
    const r = extractBlocks(doc, noteTargets);
    return {
      href: item.href,
      linear,
      title: r.title,
      semantics: r.semantics,
      blocks: r.blocks,
      noterefsRemoved: r.noterefsRemoved,
    };
  });

  const totalChars = spine.reduce((n, d) => n + d.blocks.reduce((m, b) => m + b.text.length, 0), 0);
  if (totalChars < 200) warnings.push('Almost no text found. This may be an image-only or fixed-layout EPUB.');

  return { format: 'epub', meta, cover, toc, tocSource, landmarks, spine, warnings };
}

function readNavList(container: Element, baseDir: string, depth = 0): TocEntry[] {
  const ol = childrenByName(container, 'ol')[0] ?? byLocalName(container, 'ol')[0];
  if (!ol) return [];
  const out: TocEntry[] = [];
  for (const li of childrenByName(ol, 'li')) {
    const label = childrenByName(li, 'a')[0] ?? childrenByName(li, 'span')[0];
    if (label) {
      const href = label.getAttribute('href');
      const title = normalizeText(label.textContent ?? '');
      if (title && href) {
        out.push({ title, href: resolvePath(baseDir, href), fragment: fragmentOf(href), depth });
      } else if (title) {
        // Grouping label without a link (e.g. "Part One" headers); keep so the structure is visible.
        out.push({ title, depth });
      }
    }
    out.push(...readNavList(li, baseDir, depth + 1));
  }
  return out;
}

function readNcx(parent: Element, baseDir: string, depth: number): TocEntry[] {
  const out: TocEntry[] = [];
  for (const np of childrenByName(parent, 'navPoint').concat(childrenByName(parent, 'navpoint'))) {
    const own = (n: string) => Array.from(np.children).find((c) => localName(c) === n.toLowerCase() || localName(c) === n);
    const labelEl = own('navLabel');
    const label = (labelEl && byLocalName(labelEl, 'text')[0]?.textContent) ?? labelEl?.textContent ?? '';
    const src = own('content')?.getAttribute('src') ?? '';
    const title = normalizeText(label);
    if (title && src) out.push({ title, href: resolvePath(baseDir, src), fragment: fragmentOf(src), depth });
    out.push(...readNcx(np, baseDir, depth + 1));
  }
  return out;
}
