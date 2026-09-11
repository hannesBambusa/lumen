import { useMemo } from "react";

import type { Message, Person, Thing, ThingId } from "../types";
import { initials, kindLabel, shortDate } from "../lib/format";
import { avatarStyle } from "../lib/color";
import { buildThreads } from "../lib/threads";
import { FilePill } from "../components/AttachmentPreview";
import { useT } from "../lib/i18n";
import type { Strings } from "../lib/i18n";

interface Props {
  person: Person;
  messages: Message[];
  things: Map<ThingId, Thing>;
  /** The open conversation. */
  selected: string | null;
  onSelect: (threadId: string) => void;
}

/**
 * Everything exchanged with one person, one row per conversation.
 *
 * By conversation rather than by message: a back-and-forth about one thing filled five rows
 * with the same subject, which is noise however you sort it. The row carries what is true of
 * the exchange as a whole, and the direction arrow shows the **newest** message, because
 * "the last word was theirs" and "the last word was mine" is the thing worth knowing at a
 * glance.
 *
 * The audience line survives from the newest message: "to you" and "you were on copy" are
 * different situations, and a mail client that hides the difference makes you open things to
 * find out.
 */
export default function PersonMailList({ person, messages, things, selected, onSelect }: Props) {
  const t = useT();

  const conversations = useMemo(() => {
    const byId = new Map(messages.map((m) => [m.id, m]));
    return buildThreads(messages)
      .map((thread) => {
        const inThread = thread.messageIds
          .map((id) => byId.get(id))
          .filter((m): m is Message => Boolean(m))
          .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
        return { thread, newest: inThread[0], count: inThread.length };
      })
      .filter((entry) => entry.newest)
      .sort(
        (a, b) => new Date(b.newest.sentAt).getTime() - new Date(a.newest.sentAt).getTime(),
      );
  }, [messages]);

  const theirFiles = useMemo(
    () =>
      [...messages]
        .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
        .filter((m) => !m.fromMe)
        .flatMap((m) => m.attachmentIds)
        .map((id) => things.get(id))
        .filter((t): t is Thing => Boolean(t)),
    [messages, things],
  );

  return (
    <section className="personpane" aria-label={t.list.mailFrom(person.name)}>
      <header className="personpane-head">
        <div className="avatar" style={avatarStyle(person.email)} aria-hidden="true">
          {initials(person)}
        </div>
        <div className="personpane-id">
          <div className="personpane-name">{person.name}</div>
          <div className="personpane-role">{person.role ?? person.email}</div>
        </div>
      </header>

      {theirFiles.length > 0 && (
        <div className="personpane-files">
          <h3 className="pane-label flush">{t.common.files(theirFiles.length)}</h3>
          <div className="filestrip">
            {theirFiles.map((thing) => (
              <FilePill
                key={thing.id}
                id={thing.id}
                filename={thing.filename}
                kind={kindLabel(thing)}
              />
            ))}
          </div>
        </div>
      )}

      <h3 className="pane-label">{t.list.conversations(conversations.length)}</h3>

      {conversations.map(({ thread, newest, count }) => (
        <button
          key={thread.id}
          className={`mrow${thread.id === selected ? " active" : ""}${thread.unread ? " unread" : ""}`}
          onClick={() => onSelect(thread.id)}
        >
          <span className="mrow-line">
            {/* The newest message's direction: whether the last word was theirs or yours is
              * what you want to know before opening it. */}
            <span
              className={newest.fromMe ? "mrow-dir sent" : "mrow-dir received"}
              title={newest.fromMe ? t.list.sentByYou : t.list.received}
              aria-label={newest.fromMe ? t.list.sentByYou : t.list.received}
            >
              {newest.fromMe ? "↗" : "↙"}
            </span>
            <span className="mrow-subject">{thread.subject}</span>
            {count > 1 && <span className="trow-count">{count}</span>}
            <span className="mrow-when">{shortDate(newest.sentAt)}</span>
          </span>

          <span className="mrow-audience">{audienceLabel(t, newest)}</span>

          <span className="mrow-preview">
            {thread.attachmentCount > 0 && (
              <span className="mrow-clip">{t.common.files(thread.attachmentCount)} · </span>
            )}
            {newest.preview}
          </span>
        </button>
      ))}
    </section>
  );
}

/** One line saying how this message reached you. Fully spelled out in the reader. */
export function audienceLabel(t: Strings, m: Message): string {
  if (m.fromMe) return t.list.sentByYou;

  const others = (m.audience?.others ?? []).length;
  if (m.audience?.cc) return others === 0 ? t.list.copiedToYou : t.list.copiedToYouAnd(others);
  return others === 0 ? t.list.toYou : t.list.toYouAnd(others);
}
