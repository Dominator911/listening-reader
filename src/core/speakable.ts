// Last-mile text fixes applied right before a sentence is handed to the speech engine.
// The reading view keeps the original text; only what is spoken changes.

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

export function romanToInt(r: string): number | undefined {
  const s = r.toLowerCase();
  if (!/^[ivxlcdm]+$/.test(s)) return undefined;
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]];
    const next = ROMAN[s[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  return total > 0 && total < 4000 ? total : undefined;
}

export function speakable(sentence: string): string {
  let s = sentence;
  // Citation markers like [12] or [3, 4] and stray footnote digits after punctuation: "end.12 Next"
  s = s.replace(/\s?\[\d+(?:\s*[,–-]\s*\d+)*\]/g, '');
  s = s.replace(/([a-zÀ-ɏ][.,;:!?”"’)])\d{1,3}(?=\s|$)/g, '$1');
  // URLs are unlistenable.
  s = s.replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, 'link');
  // "Chapter IV" → "Chapter 4" (voices tend to spell out the letters).
  s = s.replace(/\b(Chapter|Part|Book|Volume|Vol\.|Section|Act|Scene|Canto|Letter)\s+([IVXLCDM]+)\b/g, (m, w, r) => {
    const n = romanToInt(r);
    return n ? `${w} ${n}` : m;
  });
  // Spaced em/en dashes read better as a pause.
  s = s.replace(/\s+[—–]\s+/g, ', ').replace(/—/g, ', ');
  // Scene-break ornaments and runs of symbols.
  s = s.replace(/([*#~•·_=])(\s*\1){2,}/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return /[\p{L}\p{N}]/u.test(s) ? s : '';
}
