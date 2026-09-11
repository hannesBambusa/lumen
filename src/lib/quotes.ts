/**
 * Split a message body into what is new, what is quoted history, and the signature.
 *
 * A 14-message thread is really 14 nested copies of the same conversation, and hiding the
 * copies is the single biggest thing that makes a long thread readable.
 *
 * This is heuristic and always will be: mail clients quote in a dozen incompatible ways and
 * some of them are indistinguishable from ordinary prose. It is therefore **conservative**:
 * it only cuts where the marker is unambiguous, and the full original is always one click
 * away, so being wrong costs a click rather than losing text.
 */

export interface ParsedBody {
  /** What this message actually says. */
  body: string;
  /** Quoted earlier messages. Empty when there are none. */
  quoted: string;
  /** Trailing signature or footer. Empty when none was found. */
  signature: string;
}

/**
 * Attribution lines, in the languages this mailbox actually sees.
 *
 * English, Swedish and Norwegian at minimum: an English-only rule leaves every reply from
 * Asgeir or Alexandra fully quoted, which is precisely the mail that needs the help.
 */
const ATTRIBUTION = [
  /^On .{10,80}\bwrote:\s*$/i, // On Mon, 1 Sep 2026 at 10:00, Asgeir <a@b.no> wrote:
  /^Den .{6,80}\bskrev\b.*:\s*$/i, // Den 1 sep. 2026 kl. 10:00 skrev Asgeir:
  /^Am .{6,80}\bschrieb\b.*:\s*$/i,
  /^Le .{6,80}\ba écrit\s*:\s*$/i,
  /^.{0,60}\b(skrev|wrote|schrieb)\b.{0,40}:\s*$/i,
];

/** Outlook and friends announce the quote with a header block instead of an attribution. */
const QUOTE_BANNER = [
  /^-{2,}\s*(Original Message|Ursprungligt meddelande|Opprinnelig melding|Forwarded message)\s*-{2,}\s*$/i,
  /^_{10,}\s*$/,
  /^From:\s.+$/i,
  /^Från:\s.+$/i,
  /^Fra:\s.+$/i,
];

/**
 * Sign-offs. Only trusted near the end of a message: "Tack" in the middle of a sentence is
 * not a signature, and cutting there would eat the content.
 */
const SIGN_OFF =
  /^(--\s*$|__+\s*$|med vänliga hälsningar|vänliga hälsningar|mvh\b|vennlig hilsen|med vennlig hilsen|hilsen\b|best regards|kind regards|regards,|cheers,|thanks,|tack,|bästa hälsningar|sent from my |skickat från min |sendt fra min )/i;

/** How many trailing lines a sign-off may appear in before it stops counting as one. */
const SIGNATURE_WINDOW = 12;

export function parseBody(raw: string): ParsedBody {
  const text = raw.replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  const quoteStart = findQuoteStart(lines);
  const head = quoteStart === -1 ? lines : lines.slice(0, quoteStart);
  const quoted = quoteStart === -1 ? "" : lines.slice(quoteStart).join("\n").trim();

  const signatureStart = findSignatureStart(head);
  const bodyLines = signatureStart === -1 ? head : head.slice(0, signatureStart);
  const signature = signatureStart === -1 ? "" : head.slice(signatureStart).join("\n").trim();

  const body = bodyLines.join("\n").trim();

  // Never hand back an empty message. If the heuristics ate everything, the heuristics were
  // wrong, so show the original instead.
  if (!body) {
    return { body: text.trim(), quoted: "", signature: "" };
  }

  return { body, quoted, signature };
}

function findQuoteStart(lines: string[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();

    if (QUOTE_BANNER.some((pattern) => pattern.test(line))) return i;

    if (ATTRIBUTION.some((pattern) => pattern.test(line))) {
      // Only a real attribution if quoted material follows it. Otherwise it is a sentence
      // that happens to end in "wrote:".
      if (looksQuotedAfter(lines, i + 1)) return i;
    }

    // Two consecutive quoted lines. One alone is too easily a stray ">" in prose or a
    // shell prompt someone pasted.
    if (line.startsWith(">") && lines[i + 1]?.trim().startsWith(">")) return i;
  }
  return -1;
}

/** Do the next few non-empty lines look like quoted material? */
function looksQuotedAfter(lines: string[], from: number): boolean {
  for (let i = from; i < Math.min(from + 4, lines.length); i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    return line.startsWith(">") || /^(From|Från|Fra|Sent|Skickat|To|Till|Til|Subject|Ämne|Emne):/i.test(line);
  }
  // Nothing after it at all: an attribution at the very end still marks a quote boundary.
  return true;
}

function findSignatureStart(lines: string[]): number {
  const firstCandidate = Math.max(0, lines.length - SIGNATURE_WINDOW);

  for (let i = firstCandidate; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;

    // "-- " on its own line is the RFC 3676 delimiter and the only unambiguous marker here.
    if (/^--\s*$/.test(lines[i])) return i;

    if (SIGN_OFF.test(line)) {
      // A sign-off with a lot of text after it is not a sign-off, it is the body.
      const remaining = lines.slice(i + 1).filter((l) => l.trim()).length;
      if (remaining <= 6) return i;
    }
  }
  return -1;
}

/**
 * Rough count of how many messages are nested in a quoted block, for the toggle's label.
 * Counting attributions is close enough and cheap.
 */
export function countQuotedMessages(quoted: string): number {
  if (!quoted) return 0;
  // Accepts either plain text or the allowlisted HTML the backend produces for quoted
  // history, so tags are flattened to line breaks before the attributions are counted.
  const text = quoted.includes("<")
    ? quoted.replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n").replace(/<[^>]*>/g, "")
    : quoted;
  const hits = text
    .split("\n")
    .filter((line) => ATTRIBUTION.some((pattern) => pattern.test(line.replace(/^[>\s]+/, "").trim())))
    .length;
  return Math.max(1, hits);
}
