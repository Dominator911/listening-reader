// Builds small synthetic books in memory so tests don't depend on copyrighted files.
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const xhtml = (body: string, title = '', bodyAttrs = '') => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${title}</title></head>
<body ${bodyAttrs}>${body}</body></html>`;

export async function makeEpub3(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
     <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">test-1</dc:identifier>
    <dc:title>The Test Book</dc:title>
    <dc:creator>Ada Writer</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="copy" href="text/copyright.xhtml" media-type="application/xhtml+xml"/>
    <item id="c1" href="text/chapter%201.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="notes" href="text/notes.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="copy"/>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
    <itemref idref="notes" linear="no"/>
  </spine>
</package>`,
  );
  zip.file('OEBPS/images/cover.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  zip.file(
    'OEBPS/nav.xhtml',
    xhtml(`<nav epub:type="toc"><ol>
      <li><a href="text/chapter%201.xhtml">Chapter 1: Beginnings</a>
        <ol><li><a href="text/chapter%201.xhtml#s2">A Second Section</a></li></ol></li>
      <li><a href="text/ch2.xhtml">Chapter 2</a></li>
    </ol></nav>
    <nav epub:type="landmarks"><ol>
      <li><a epub:type="copyright-page" href="text/copyright.xhtml">Copyright</a></li>
      <li><a epub:type="bodymatter" href="text/chapter%201.xhtml">Start</a></li>
    </ol></nav>`),
  );
  zip.file(
    'OEBPS/text/copyright.xhtml',
    xhtml(`<section epub:type="copyright-page"><p>Copyright © 2020 Ada Writer. All rights reserved.</p></section>`, 'Copyright'),
  );
  zip.file(
    'OEBPS/text/chapter 1.xhtml',
    xhtml(
      `<h1>Chapter 1: Beginnings</h1>
       <p>It was a <em>dark</em> night.<a epub:type="noteref" href="notes.xhtml#n1">1</a> The wind was up&#173;set.</p>
       <p>She said “no”<sup><a href="#fn2">2</a></sup>, and left.</p>
       <h2 id="s2">A Second Section</h2>
       <div>Loose text in a div <p>with a nested paragraph.</p> and a tail.</div>
       <figure><img src="../images/map.png" alt="Map of the valley"/><figcaption>The valley</figcaption></figure>
       <table><tr><th>Year</th><th>Event</th></tr><tr><td>1901</td><td>Flood</td></tr></table>
       <aside epub:type="footnote" id="fn2"><p>A local footnote.</p></aside>
       <p class="footnote" id="fn9">9. A class-based footnote.</p>`,
      'Chapter 1',
    ),
  );
  zip.file('OEBPS/text/ch2.xhtml', xhtml(`<h1>Chapter 2</h1><p>Second chapter text<br/>across a break.</p>`));
  zip.file(
    'OEBPS/text/notes.xhtml',
    xhtml(`<h1>Notes</h1><p id="n1"><a href="chapter%201.xhtml#r1">1</a> An endnote.</p>`, 'Notes'),
  );
  return zip.generateAsync({ type: 'uint8array' });
}

/** EPUB 2 with NCX only, malformed-ish content (HTML entities that are not XML) and no container dir prefix. */
export async function makeEpub2(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
     <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  zip.file(
    'content.opf',
    `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>Old Book</dc:title>
    <dc:creator opf:role="aut">B. Author</dc:creator>
    <dc:creator opf:role="edt">An Editor</dc:creator>
    <meta name="cover" content="cov"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cov" href="cover.jpg" media-type="image/jpeg"/>
    <item id="a" href="a.html" media-type="application/xhtml+xml"/>
    <item id="b" href="b.html" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="a"/><itemref idref="b"/></spine>
  <guide><reference type="toc" title="Contents" href="a.html"/></guide>
</package>`,
  );
  zip.file('cover.jpg', new Uint8Array([0xff, 0xd8, 0xff]));
  zip.file(
    'toc.ncx',
    `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>
      <navPoint id="p1"><navLabel><text>Part One</text></navLabel><content src="a.html"/>
        <navPoint id="p2"><navLabel><text>The First Chapter</text></navLabel><content src="b.html#start"/></navPoint>
      </navPoint></navMap></ncx>`,
  );
  zip.file('a.html', `<html><head><title>Part One</title></head><body><h1>Part One</h1><p>Caf&eacute; &amp; more&nbsp;text.</p></body></html>`);
  zip.file('b.html', `<html><body><h2 id="start">The First Chapter</h2><p>Body.</p></body></html>`);
  return zip.generateAsync({ type: 'uint8array' });
}

export interface PdfSpec {
  pages: number;
  /** Return body lines for a page (already wrapped). */
  body: (page: number) => string[];
  header?: (page: number) => string | undefined;
  footer?: (page: number) => string | undefined;
  /** Leave these pages without any text (simulates scanned pages). */
  blankPages?: number[];
  title?: string;
}

export async function makePdf(spec: PdfSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  if (spec.title) doc.setTitle(spec.title);
  doc.setAuthor('Pdf Author');
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  for (let i = 0; i < spec.pages; i++) {
    const page = doc.addPage([432, 648]); // 6x9 in
    if (spec.blankPages?.includes(i)) continue;
    const h = spec.header?.(i);
    if (h) page.drawText(h, { x: 54, y: 610, size: 9, font });
    let y = 570;
    for (const line of spec.body(i)) {
      // "# " marks a chapter heading in large type.
      if (line.startsWith('# ')) {
        y -= 10;
        page.drawText(line.slice(2), { x: 54, y, size: 20, font });
        y -= 34;
        continue;
      }
      // "  " (two leading spaces) marks an indented first line of a paragraph.
      const indent = line.startsWith('  ') ? 18 : 0;
      // "^" marks a superscript footnote number: draw it smaller and raised.
      const parts = line.trimStart().split(/\^(\d+)/);
      let x = 54 + indent;
      parts.forEach((part, k) => {
        if (!part) return;
        if (k % 2 === 1) {
          page.drawText(part, { x, y: y + 4, size: 7, font });
          x += font.widthOfTextAtSize(part, 7);
        } else {
          page.drawText(part, { x, y, size: 11, font });
          x += font.widthOfTextAtSize(part, 11);
        }
      });
      y -= 15;
    }
    const f = spec.footer?.(i);
    if (f) page.drawText(f, { x: 210, y: 36, size: 9, font });
  }
  return doc.save();
}
