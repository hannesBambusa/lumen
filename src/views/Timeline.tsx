import { useMemo } from "react";

import type { Content, Message, MessageId, Person, PersonId } from "../types";
import { initials, shortDate, timeOfDay } from "../lib/format";
import { avatarStyle } from "../lib/color";
import { parseBody } from "../lib/quotes";
import { useT } from "../lib/i18n";

interface Props {
  messages: Message[];
  people: Map<PersonId, Person>;
  /** The words themselves, fetched with the conversation. */
  contents: Map<MessageId, Content>;
}

/**
 * The conversation as it was actually said.
 *
 * Nothing but who spoke, when, and the words they wrote. No signatures, no quoted history,
 * no images, no attachments, no formatting. A thread that runs to several screens in the
 * reading view is usually a page and a half of actual sentences, and this is the view that
 * shows that.
 *
 * Newest first, the same way round as the reading view. It was built oldest-first, on the
 * argument that a discussion only makes sense forwards, but having the two views run in
 * opposite directions meant the eye had to start somewhere different depending on which tab
 * was open. Consistency wins: you open a conversation to see what just happened, and
 * scrolling down walks backwards through how it got there.
 */
export default function Timeline({ messages, people, contents }: Props) {
  const t = useT();
  const ordered = useMemo(
    () =>
      [...messages]
        .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
        .map((message) => ({
          message,
          // The backend already strips quotes and signatures from HTML mail; this catches
          // the plain-text ones and anything the backend left behind.
          said: parseBody(contents.get(message.id)?.body ?? "").body.trim(),
        }))
        // A message that is nothing but a signature or a quote has nothing to contribute
        // here, and leaving an empty entry in a timeline just looks broken.
        .filter((entry) => entry.said.length > 0),
    [messages, contents],
  );

  if (ordered.length === 0) {
    return <p className="empty">{t.thread.nothingWritten}</p>;
  }

  return (
    <ol className="timeline">
      {ordered.map(({ message, said }) => {
        const person = people.get(message.personId);
        const who = message.fromMe ? t.common.you : person?.name ?? t.common.unknown;

        return (
          <li key={message.id} className={message.fromMe ? "tl-item mine" : "tl-item"}>
            <span
              className="tl-dot avatar sm"
              style={message.fromMe ? undefined : person ? avatarStyle(person.email) : undefined}
              aria-hidden="true"
            >
              {message.fromMe ? "ME" : person ? initials(person) : "?"}
            </span>

            <div className="tl-entry">
              <div className="tl-meta">
                <span className="tl-who">{who}</span>
                <span className="tl-when">
                  {shortDate(message.sentAt)} {timeOfDay(message.sentAt)}
                </span>
              </div>
              <p className="tl-said">{said}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
