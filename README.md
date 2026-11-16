# Listening Reader

A personal web app that reads your own DRM-free EPUB and PDF books aloud with the device's
text-to-speech, with fast chapter navigation. Everything stays on your device: no accounts,
no server, no uploads.

## Run it on your laptop

Requires Node 22+.

```bash
npm install
npm run dev          # http://localhost:5173
```

Drop a book onto the page (or tap **Add book**). A single readable book opens straight into the
player. Other commands:

```bash
npm test             # chapter detection, cleanup, parsing and navigation tests
npm run build        # production build into dist/ (includes the offline service worker)
npm run preview      # serve the production build locally
npm run inspect -- test-books/mybook.pdf [--full]   # print what the parser and cleanup produce
npx tsx scripts/make-samples.ts                     # synthetic sample books in test-books/_samples
```

Open `#inspect` (e.g. `http://localhost:5173/#inspect`) for a raw parser view of any file.

## Using it

| Action | Touch | Keyboard |
|---|---|---|
| Play / pause | big round button | Space |
| Sentence back / forward | ‹ › | ← → |
| Paragraph back / forward | « » | ↑ ↓ |
| Chapter back / forward | ⏮ ⏭ | Shift + ← → |
| Speed −/+ 0.25 (0.75×–3×, per book) | − + | [ ] |
| Chapters and bookmarks | list icon, or tap the chapter title | C |
| Bookmark current sentence | bookmark icon | B |
| Start from any sentence | tap the sentence | |

- **Chapters drawer:** tap any chapter to jump there and start playing. Chapters skipped by
  default (copyright, contents, notes, index) are marked "skipped", but tapping one plays it anyway.
  **Fix chapters** lets you rename a chapter or merge it with the next one.
- **Settings:** voice (remembered for all books); whether to read footnotes, front matter and the
  index (all off by default); whether to mention or skip tables and images; theme; text size.
  **Export cleaned text** saves the JSON described below. **Re-detect chapters** rebuilds the book
  from the stored original file.
- **Sleep timer:** moon icon, 15, 30 or 60 minutes, or end of chapter.
- **Resume:** the position is saved on every sentence. Reopening a book resumes at that sentence.

## Install it on your iPhone

A home-screen app must be served over HTTPS. Only the app's code is hosted; your books never leave
the phone.

1. Publish `dist/` to any free static host. The simplest is GitHub Pages: push this folder to a
   repository, run `npm run build`, and publish `dist/` (for example with the `gh-pages` package:
   `npx gh-pages -d dist`). Cloudflare Pages and Netlify also work: build command
   `npm run build`, output folder `dist`. The app uses relative paths, so a sub-folder URL such
   as `https://you.github.io/listening-reader/` is fine.
2. On the iPhone, open that URL. In **Brave**: tap the share button, then **Add to Home Screen**.
   If Brave doesn't offer it on your iOS version, open the URL once in Safari and use
   Share → Add to Home Screen. The home-screen app runs on its own either way.
3. Launch it from the home screen and add books with **Add book** (Files app, iCloud Drive, or
   downloads). After the first launch it works offline.
4. For much better speech, download a high-quality voice: **Settings → Accessibility → Spoken
   Content → Voices → English**, choose an *Enhanced* or *Premium* voice, then pick it in the app's
   Settings.

Books added on the phone are stored in the phone's app storage, separate from the laptop. Import a
book on each device you want to listen on.

## Known limits

- **Screen lock and background on iPhone.** Speech in a web page stops when the screen locks or you
  switch apps. This is an iOS rule for web speech, and no web code can get around it. To cope with
  it, the app:
  - keeps the screen on while playing (Screen Wake Lock, iOS 16.4+, and in home-screen apps 18.4+),
  - resumes from the same sentence when you come back (tap play if iOS asks for a tap first).

  I could not test this on a real iPhone from here, so please tell me what you see. Listening with
  the screen off needs real audio files: that is the version 2 plan below.
- **Lock-screen and headphone controls** need the page to be playing real audio, so the app can
  play a silent loop alongside the speech (Settings → *Headphone and lock-screen controls*).
  On desktop Chrome this makes media keys and headphone buttons work: previous/next track goes to
  the previous/next chapter, and seek back/forward goes one paragraph. On iPhone the loop can
  interrupt speech, so it is **off by default there**. Try turning it on, and turn it off again if
  speech stops.
- **Speed above 2×** depends on the voice. Some iOS voices top out before 3× even if the app asks
  for more.
- **Scanned PDFs** (page images with no text layer) are detected and flagged with an explanation.
  There is no OCR. Run the file through OCR first (for example `ocrmypdf in.pdf out.pdf`, or
  Acrobat's "Recognize Text"), then import the result. PDFs with a garbled text layer (broken font
  encoding) are flagged the same way.
- **PDF layout.** Headers, footers, page numbers, line-end hyphens, superscript footnote markers and
  paragraphs split across pages are cleaned up. Two-column pages may still read the columns
  interleaved. Tables are detected only when their columns are clearly spaced.
- **Time estimates** start from a typical speaking speed and adjust to your voice as you listen.
- **Storage.** Books live in the browser's storage (IndexedDB). Clearing site data removes them. In
  Safari, data for sites you haven't opened in a while can be cleared. The home-screen app is
  exempt from that.

## Version 2: export an audiobook (designed, not built)

Settings → **Export cleaned text** saves `<title>.listening.json`. It contains exactly what the app
would speak with your current skip settings:

```json
{
  "format": "listening-reader/book",
  "version": 1,
  "title": "The Book",
  "author": "A. Writer",
  "language": "en",
  "exportedAt": "2026-11-16T12:00:00.000Z",
  "chapters": [
    { "index": 1, "title": "Chapter 1: Beginnings", "paragraphs": ["It was a dark night.", "…"] }
  ]
}
```

The planned script reads this file, renders one audio file per chapter with a free neural voice
that runs locally (Kokoro or Piper), and tags the files (album = book, track number = chapter
index, title = chapter title) so any audiobook or podcast app plays them in order with the screen
off.

## Project layout

```
src/parse/      EPUB reader (JSZip + DOMParser), PDF text extraction (pdf.js), scan detection
src/core/       chapter detection, PDF cleanup, sentence splitting, speech-text fixes, navigation, export
src/player/     speech queue (one utterance per sentence), wake lock, media session, silent audio
src/ui/         library, reader, player bar, chapter drawer, settings
src/db.ts       IndexedDB storage (Dexie)
tests/          Vitest tests; fixtures build synthetic EPUBs and PDFs in memory
```

Libraries: Vite 8, React 19, TypeScript 7, pdf.js 6 (legacy build, for older iOS versions), JSZip,
Dexie 4, vite-plugin-pwa. EPUB parsing is our own small parser instead of epub.js, which has had
no release since 2023.
