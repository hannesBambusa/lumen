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
