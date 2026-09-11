import { useMemo } from "react";

import type { Message, MessageId, Person, Thing, ThingId } from "../types";
import { initials, kindLabel, shortDate } from "../lib/format";
import { avatarStyle } from "../lib/color";
import { FilePill } from "../components/AttachmentPreview";
import { useT } from "../lib/i18n";
import type { Strings } from "../lib/i18n";

interface Props {
  person: Person;
  messages: Message[];
  things: Map<ThingId, Thing>;
  selected: MessageId | null;
  onSelect: (id: MessageId) => void;
}

/**
 * Everything one person sent you, as mail rather than as a chat log.
 *
 * Subject lines survive here because this is a list of messages, not a conversation, and
 * the audience line is the point: "to you" and "you were on copy" are different situations
 * and a mail client that hides the difference makes you open things to find out.
 */
export default function PersonMailList({ person, messages, things, selected, onSelect }: Props) {
  const t = useT();
  const ordered = useMemo(
    () => [...messages].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()),
    [messages],
  );

  const theirFiles = useMemo(
    () =>
      ordered
        .filter((m) => !m.fromMe)
        .flatMap((m) => m.attachmentIds)
        .map((id) => things.get(id))
        .filter((t): t is Thing => Boolean(t)),
    [ordered, things],
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

      <h3 className="pane-label">{t.common.messages(ordered.length)}</h3>

      {ordered.map((m) => (
        <button
          key={m.id}
          className={`mrow${m.id === selected ? " active" : ""}${m.unread ? " unread" : ""}`}
          onClick={() => onSelect(m.id)}
        >
          <span className="mrow-line">
            <span className="mrow-subject">{m.subject ?? t.common.noSubject}</span>
            <span className="mrow-when">{shortDate(m.sentAt)}</span>
          </span>
          <span className="mrow-audience">{audienceLabel(t, m)}</span>
          <span className="mrow-preview">
            {m.attachmentIds.length > 0 && (
              <span className="mrow-clip">
                {t.common.files(m.attachmentIds.length)} ·{" "}
              </span>
            )}
            {m.body}
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
