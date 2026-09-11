import type { FolderId, Message, Thread } from "../types";

/** "Re: Fakturan" and "SV: Fakturan" are the same thread. Swedish and Norwegian clients
 *  use SV and VS, so stripping only "Re:" and "Fwd:" would split threads in half here. */
const REPLY_PREFIX = /^\s*(re|sv|vs|fwd|fw|vb)\s*:\s*/i;

export function normaliseSubject(subject?: string): string {
  if (!subject) return "";
  let out = subject;
  while (REPLY_PREFIX.test(out)) out = out.replace(REPLY_PREFIX, "");
  return out.trim();
}

/**
 * Group messages into threads by person plus normalised subject.
 *
 * This is the crude version on purpose. Real threading uses In-Reply-To and References,
 * which the provider layer already carries; subject grouping is only good enough to design
 * the Classic view against fixtures.
 */
export function buildThreads(messages: Message[]): Thread[] {
  const byKey = new Map<string, Message[]>();

  for (const message of messages) {
    const subject = normaliseSubject(message.subject);
    // The provider's thread id when there is one. Falling back to person + subject is only
    // for fixtures and for providers with no server-side threading, and it is strictly
    // worse: it splits a group conversation into one thread per participant.
    // A draft never joins a conversation: it was written, not sent, and putting it in the
    // thread makes it look like something the other people saw.
    const key = message.isDraft
      ? `draft::${message.id}`
      : message.threadId
      ? `t::${message.threadId}`
      : subject
        ? `${message.personId}::${subject}`
        : `solo::${message.id}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(message);
    else byKey.set(key, [message]);
  }

  const threads: Thread[] = [];
  for (const [key, group] of byKey) {
    const ordered = [...group].sort(
      (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
    );
    const last = ordered[ordered.length - 1];
    threads.push({
      id: key,
      subject: firstSubject(ordered) || "(no subject)",
      personId: last.personId,
      messageIds: ordered.map((m) => m.id),
      lastAt: last.sentAt,
      unread: ordered.some((m) => m.unread),
      attachmentCount: ordered.reduce((sum, m) => sum + m.attachmentIds.length, 0),
      // The newest message that has one: a thread that began as an invoice and became a
      // question is a question now. The source comes from that same message, never from
      // another one, or the label would credit the wrong decider.
      category: [...ordered].reverse().find((m) => m.category)?.category,
      categorySource: [...ordered].reverse().find((m) => m.category)?.categorySource,
    });
  }

  return threads.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
}

/**
 * The subject the conversation started with.
 *
 * The newest message's subject can be "Re: Re: Fwd:" of something renamed halfway through,
 * so the opening subject describes the thread better than the latest one does.
 */
function firstSubject(ordered: Message[]): string {
  for (const message of ordered) {
    const subject = normaliseSubject(message.subject);
    if (subject) return subject;
  }
  return "";
}

/**
 * Which folder a thread sits in.
 *
 * Fixtures carry no folder data, so this is derived: anything you sent is in Sent,
 * everything else is in Inbox. Drafts, Archive and Trash are genuinely empty rather than
 * salted with fake content, so their empty states get designed too.
 */
export function threadFolder(thread: Thread, messages: Map<string, Message>): FolderId {
  const all = thread.messageIds.map((id) => messages.get(id));
  if (all.every((m) => m?.isDraft)) return "drafts";
  return all.every((m) => m?.fromMe) ? "sent" : "inbox";
}
