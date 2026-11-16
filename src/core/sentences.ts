// English sentence splitting on top of Intl.Segmenter, with repairs for abbreviations and
// initials, and an upper bound on length so skipping stays fine-grained.

const ABBREVIATIONS = new Set(
  (
    'mr mrs ms mx dr prof sr jr st mt ft gen col capt cpt lt sgt maj rev hon gov sen rep pres supt insp ' +
    'vs etc cf al approx inc ltd co corp no nos vol vols p pp ch chap fig figs ed eds trans ca esp ' +
    'jan feb mar apr jun jul aug sep sept oct nov dec mon tue wed thu fri sat sun ' +
    'e.g i.e a.m p.m u.s u.k u.n a.d b.c ph.d m.d b.a m.a d.c op viz'
  ).split(' '),
);

export const MAX_SENTENCE = 320;

let segmenter: Intl.Segmenter | undefined;
function segments(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    segmenter ??= new Intl.Segmenter('en', { granularity: 'sentence' });
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  return text.split(/(?<=[.!?…]["”’)\]]*)\s+(?=["“‘(\[]?[A-Z0-9])/);
}

function endsWithAbbreviation(s: string): boolean {
  const m = /(?:^|[\s(“"'‘])([A-Za-z][A-Za-z.]*)\.\s*$/.exec(s);
  if (!m) return false;
  const word = m[1];
  if (word.length === 1 && /[A-Z]/.test(word)) return true; // initial: "J. R. R. Tolkien"
  return ABBREVIATIONS.has(word.toLowerCase());
}

export function splitSentences(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const raw = segments(t);
  const merged: string[] = [];
  for (const seg of raw) {
    const s = seg.trim();
    if (!s) continue;
    const prev = merged[merged.length - 1];
    // Re-attach after an abbreviation, or when the fragment is just punctuation / a lone number.
    if (prev !== undefined && (endsWithAbbreviation(prev) || /^[\p{P}\p{S}\d\s]{1,3}$/u.test(s))) {
      merged[merged.length - 1] = `${prev} ${s}`;
    } else {
      merged.push(s);
    }
  }
  return merged.flatMap((s) => (s.length > MAX_SENTENCE ? splitLong(s) : [s]));
}

/** Split an overlong sentence at the clause break closest to its middle, recursively. */
function splitLong(s: string): string[] {
  if (s.length <= MAX_SENTENCE) return [s];
  const mid = s.length / 2;
  let best = -1;
  let bestScore = Infinity;
  const re = /[;:]\s|,\s|\s[—–]\s|—/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const at = m.index + m[0].length;
    if (at < 40 || s.length - at < 40) continue;
    // Prefer semicolons/colons/dashes over commas.
    const score = Math.abs(at - mid) * (m[0].startsWith(',') ? 1.5 : 1);
    if (score < bestScore) {
      bestScore = score;
      best = at;
    }
  }
  if (best < 0) {
    // No punctuation: break at the space nearest the middle.
    best = s.lastIndexOf(' ', mid);
    if (best <= 0) return [s];
  }
  return [...splitLong(s.slice(0, best).trim()), ...splitLong(s.slice(best).trim())];
}
