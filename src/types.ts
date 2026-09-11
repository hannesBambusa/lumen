// Domain types for the UI layer.
//
// These are NOT the sync/storage types (those live in Rust, in src-tauri/src/provider).
// They are what the interface needs, which is a different shape on purpose: the app is
// organised around obligations and people, not around messages and folders.

export type PersonId = string;
export type MessageId = string;
export type ThingId = string;

export interface Person {
  id: PersonId;
  name: string;
  email: string;
  /** Job title or relationship. Shown under the name; omitted for machines. */
  role?: string;
  /** Broadcast senders (newsletters, receipts, no-reply) never appear in People. */
  isBroadcast?: boolean;
}

export interface Message {
  id: MessageId;
  /**
   * The provider's own thread id. Present for real mail, absent in fixtures.
   *
   * Grouping by this is what keeps a four-person conversation as one conversation; grouping
   * by subject splits it per sender and quietly loses the shape of the discussion.
   */
  threadId?: string;
  personId: PersonId;
  /** True when Hannes wrote it. Drives which side of the conversation it sits on. */
  fromMe: boolean;
  subject?: string;
  /**
   * The opening of the message, for the preview line in a list.
   *
   * The full body, its markup, the signature and the quoted history are fetched per
   * conversation when one is opened. Deriving all of that for every message at startup meant
   * re-parsing tens of megabytes of mail HTML before the window could draw.
   */
  preview: string;
  /** Whether the sender's own layout exists to ask for. */
  hasOriginal?: boolean;
  sentAt: string; // ISO 8601
  attachmentIds: ThingId[];
  unread?: boolean;
  /**
   * Never sent to anyone.
   *
   * Gmail keeps an autosaved draft as a message of its own and does not always clean it up
   * after sending, so a conversation can contain a half-typed sentence dated a minute
   * before the real reply. A draft belongs in Drafts, not in the exchange.
   */
  isDraft?: boolean;
  /**
   * Who else was on it. Absent means a plain one-to-one message.
   *
   * `cc` true means you were only on copy, which is the difference between "someone asked
   * you" and "someone kept you informed". That distinction is worth a field.
   */
  audience?: {
    cc?: boolean;
    others?: string[];
    /** Everyone it was addressed to, you included. */
    to?: Address[];
    /** Everyone on copy. */
    copies?: Address[];
  };
  /**
   * Who actually sent it. Not derivable from `personId`: on your own messages that is the
   * person you wrote to, not you.
   */
  sender?: Address;
  /** What this was sorted as, once something has sorted it. */
  category?: Category;
  /** Whether a rule or the model decided it. */
  categorySource?: CategorySource;
}

/**
 * The buckets mail is sorted into.
 *
 * A closed set on purpose. Most of it is decided by rule (a calendar part, an unsubscribe
 * link, a no-reply address); only what is left is read by the model, which is reliable at
 * picking from a short list and unreliable the moment it is asked to invent a label.
 */
/**
 * A category is whatever the database says it is, so this is a string rather than a union.
 * The six below are seeded and have translated names and deterministic rules behind them;
 * anything else was made by the user and is shown under the name they typed.
 */
/** One person on a message, as written in the header. */
export interface Address {
  name: string;
  email: string;
}

export type Category = string;

export const BUILTIN_CATEGORIES = [
  "reply",
  "fyi",
  "meeting",
  "invoice",
  "automated",
  "newsletter",
] as const;

export type CategorySource = "rule" | "model" | "user";



/**
 * Classic groups messages by subject, the way every other mail client does.
 *
 * Derived, never stored: the underlying data is still people and messages, so the two
 * modes are two readings of one mailbox rather than two copies of it.
 */
/**
 * One message's readable content, fetched when a conversation is opened.
 *
 * Everything here comes from parsing the stored HTML, which is the expensive part: doing it
 * for one conversation costs milliseconds, doing it for a whole mailbox cost fourteen
 * seconds of startup.
 */
export interface Content {
  id: MessageId;
  /** The message as text, with quotes and signature already removed. */
  body: string;
  bodyHtml?: string;
  signatureHtml?: string;
  quoted?: QuotedMessage[];
}

export interface Thread {
  id: string;
  subject: string;
  personId: PersonId;
  messageIds: MessageId[];
  lastAt: string;
  unread: boolean;
  attachmentCount: number;
  /**
   * The thread's category: the newest categorised message in it.
   *
   * A conversation that started as an invoice and turned into a question is a question
   * now, and filtering on where it started would hide it.
   */
  category?: Category;
  categorySource?: CategorySource;
}

export type FolderId = "inbox" | "sent" | "drafts" | "archive" | "trash";

export interface QuotedMessage {
  /** "Den 10 sep. 2026 skrev Hannes:", or an Outlook From/Sent/To header. */
  attribution?: string;
  /** Allowlisted inline markup, styled by the app. */
  html: string;
}

export type ThingKind = "pdf" | "sheet" | "image" | "doc" | "archive" | "other";

export interface Thing {
  id: ThingId;
  filename: string;
  kind: ThingKind;
  sizeBytes: number;
  personId: PersonId;
  messageId: MessageId;
  receivedAt: string;
}

/**
 * The unit the home screen is built from.
 *
 * `owed` = someone asked you for something and has not got it.
 * `awaiting` = you asked someone and have not got it back.
 *
 * `summary` is the ask in plain words, not the subject line. A subject line is what the
 * sender typed; the summary is what you actually have to do.
 */
export interface Obligation {
  id: string;
  direction: "owed" | "awaiting";
  personId: PersonId;
  summary: string;
  /** When the clock started: the message that created the obligation. */
  since: string;
  messageId: MessageId;
  /** Set once the user resolves it, so it leaves the list without deleting the mail. */
  settled?: boolean;
}
