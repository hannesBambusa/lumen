/**
 * Accent-folding search.
 *
 * "havard" has to find "Håvard" and "sokk" has to find "søkk". A Nordic mailbox is full of
 * å, ä, ö, æ and ø, and nobody types them into a search box when they are hunting for a
 * file. The tradeoff is that folding also merges genuinely different letters (in Swedish,
 * ö is its own letter, not a decorated o), which is the right call for search and would be
 * the wrong call for sorting.
 */
export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    // ø and æ carry no combining mark, so NFD leaves them alone.
    .replace(/ø/gi, "o")
    .replace(/æ/gi, "ae")
    .replace(/ð/gi, "d")
    .replace(/þ/gi, "th")
    .toLowerCase();
}

/**
 * Every whitespace-separated term must appear somewhere in the haystack.
 *
 * Terms are ANDed and order-independent, so "asgeir csv" and "csv asgeir" both find the
 * export Asgeir sent. Substring rather than prefix, because filenames run words together
 * ("flow-b-export") and a prefix match would miss the middle of them.
 */
export function matches(fields: Array<string | undefined>, query: string): boolean {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = fields.filter(Boolean).map((f) => fold(f as string)).join(" ");
  return terms.every((term) => haystack.includes(term));
}

/**
 * Split text into runs, marking the parts a query matched.
 *
 * Needed because the match is done on folded text and the highlight has to land on the
 * original: "havard" matches "Håvard", and the letters do not line up one to one. Folding
 * "æ" to "ae" makes the folded string longer than what is on screen, so an index from one
 * cannot be used in the other. The map below is built character by character, so every
 * folded position knows which original character it came from.
 */
export interface Segment {
  text: string;
  hit: boolean;
}

export function segments(text: string, query: string): Segment[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0 || !text) return [{ text, hit: false }];

  let folded = "";
  const origin: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    for (const char of fold(text[index])) {
      folded += char;
      origin.push(index);
    }
  }

  // Every occurrence of every term, as ranges over the original string.
  const ranges: Array<[number, number]> = [];
  for (const term of terms) {
    let at = folded.indexOf(term);
    while (at !== -1) {
      const start = origin[at];
      const end = origin[at + term.length - 1] + 1;
      if (start !== undefined && end !== undefined) ranges.push([start, end]);
      at = folded.indexOf(term, at + term.length);
    }
  }
  if (ranges.length === 0) return [{ text, hit: false }];

  // Overlapping terms would otherwise produce nested highlights.
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  const out: Segment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) out.push({ text: text.slice(cursor, start), hit: false });
    out.push({ text: text.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false });
  return out;
}
