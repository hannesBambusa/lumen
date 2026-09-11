/**
 * Replies written in Lumen but not sent.
 *
 * These live in this browser profile and nowhere else: Lumen cannot send yet, and it does
 * not push anything to Gmail, so a draft written here is invisible from every other device
 * and from Gmail itself. That is exactly why they need to be findable and labelled — a
 * draft you cannot locate is a draft you cannot finish or throw away.
 *
 * Stored as JSON so the subject and the time survive alongside the text. Older drafts were
 * stored as a bare string; those are still read, so nobody loses one to a format change.
 */
export interface LocalDraft {
  /** The storage key, which is also how it is deleted. */
  key: string;
  /** The conversation it belongs to, as the mail list identifies one. */
  threadKey: string;
  subject: string;
  text: string;
  /** ISO 8601, or empty for a draft saved before times were kept. */
  savedAt: string;
}

const PREFIX = "lumen.draft.";

export function draftKey(threadKey: string): string {
  return `${PREFIX}${threadKey}`;
}

export function readDraft(key: string): { text: string; subject: string; savedAt: string } {
  const empty = { text: "", subject: "", savedAt: "" };
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return empty;
    return parse(raw);
  } catch {
    return empty;
  }
}

function parse(raw: string): { text: string; subject: string; savedAt: string } {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.text === "string") {
      return {
        text: parsed.text,
        subject: typeof parsed.subject === "string" ? parsed.subject : "",
        savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
      };
    }
  } catch {
    // Written before drafts carried anything but their text.
  }
  return { text: raw, subject: "", savedAt: "" };
}

export function writeDraft(key: string, text: string, subject: string): void {
  try {
    if (!text.trim()) {
      // An empty draft is not a draft. Leaving the key behind would put a blank row in the
      // Drafts folder that cannot be got rid of by clearing the box.
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(
      key,
      JSON.stringify({ text, subject, savedAt: new Date().toISOString() }),
    );
  } catch {
    // A draft that cannot be saved is still a draft on screen.
  }
}

export function deleteDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to do: it is already unreachable.
  }
}

/** Every unsent reply written in Lumen, newest first. */
export function listDrafts(): LocalDraft[] {
  const found: LocalDraft[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      const { text, subject, savedAt } = parse(raw);
      if (!text.trim()) continue;
      found.push({ key, threadKey: key.slice(PREFIX.length), subject, text, savedAt });
    }
  } catch {
    // No storage, no drafts.
  }
  return found.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
