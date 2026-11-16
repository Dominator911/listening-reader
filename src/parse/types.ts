// Shared shapes produced by the parsers. Chapter detection and text cleanup
// (later steps) consume these; nothing here is speech-ready yet.

export type BookFormat = 'epub' | 'pdf';

export type BlockType = 'heading' | 'text' | 'footnote' | 'table' | 'image';

/** One block-level unit of an EPUB content document. */
export interface Block {
  type: BlockType;
  /** Normalised text: whitespace collapsed, soft hyphens and footnote markers removed. */
  text: string;
  /** Heading level 1-6 for headings. */
  level?: number;
  /** Element ids inside (or immediately before) this block, so TOC fragments can be located. */
  anchors?: string[];
  /** For tables: row/column counts, used later to describe instead of reading. */
  rows?: number;
  cols?: number;
}

export interface TocEntry {
  title: string;
  /** Zip path of the target document (EPUB) — undefined for PDF entries. */
  href?: string;
  fragment?: string;
  /** 0-based page index (PDF). */
  pageIndex?: number;
  /** Vertical position of the destination on the page, in PDF points from the bottom (PDF). */
  top?: number;
  depth: number;
}

export interface SpineDoc {
  href: string;
  linear: boolean;
  /** <title> or first heading. */
  title?: string;
  /** epub:type / role semantics found on body or top-level sections (e.g. "copyright-page", "toc"). */
  semantics: string[];
  blocks: Block[];
  /** Number of footnote reference markers removed from running text. */
  noterefsRemoved: number;
}

export interface Landmark {
  type: string;
  href: string;
  fragment?: string;
  title?: string;
}

export interface BookMeta {
  title: string;
  author?: string;
  language?: string;
}

export interface ParsedEpub {
  format: 'epub';
  meta: BookMeta;
  cover?: Blob;
  toc: TocEntry[];
  tocSource: 'nav' | 'ncx' | 'none';
  landmarks: Landmark[];
  spine: SpineDoc[];
  warnings: string[];
}

export interface PdfLine {
  text: string;
  x: number;
  /** Baseline y in PDF points, origin bottom-left. */
  y: number;
  width: number;
  fontSize: number;
  fontName: string;
}

export interface PdfPage {
  index: number;
  width: number;
  height: number;
  lines: PdfLine[];
  /** Printed page label, if the PDF defines them ("iv", "12"). */
  label?: string;
}

export type TextLayerStatus = 'ok' | 'partial' | 'scanned' | 'garbled';

export interface ParsedPdf {
  format: 'pdf';
  meta: BookMeta;
  cover?: Blob;
  outline: TocEntry[];
  pages: PdfPage[];
  textLayer: TextLayerStatus;
  /** 0-based indexes of pages with (almost) no extractable text. */
  emptyPages: number[];
  warnings: string[];
}

export type ParsedBook = ParsedEpub | ParsedPdf;
