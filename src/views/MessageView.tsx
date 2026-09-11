import type { Message, Person, Thing, ThingId } from "../types";
import { kindLabel, shortDate, timeOfDay } from "../lib/format";
import { useT } from "../lib/i18n";
import MessageBody from "../components/MessageBody";
import { AttachmentCard } from "../components/AttachmentPreview";
import QuotedHistory from "../components/QuotedHistory";
import Addressing from "../components/Addressing";

interface Props {
  message: Message;
  person: Person;
  things: Map<ThingId, Thing>;
}

/** One message, in full. The only screen in the app whose job is reading rather than scanning. */
export default function MessageView({ message, person, things }: Props) {
  const t = useT();

  return (
    <div className="reader-scroll">
      <header className="reader-head">
        <h1 className="reader-subject">{message.subject ?? t.common.noSubject}</h1>
        <p className="page-sub">
          {message.fromMe ? t.common.you : person.name} · {shortDate(message.sentAt)}{" "}
          {timeOfDay(message.sentAt)}
        </p>

        <Addressing message={message} />
      </header>

      <MessageBody
        messageId={message.id}
        html={message.bodyHtml}
        text={message.body}
        signatureHtml={message.signatureHtml}
        hasOriginal={message.hasOriginal}
        defaultOriginal={!message.fromMe && person.isBroadcast}
        senderEmail={message.fromMe ? undefined : person.email}
      />

      <QuotedHistory quoted={message.quoted ?? []} />

      {message.attachmentIds.length > 0 && (
        <div className="reader-files">
          <h2 className="side-label">
            {t.message.attachments(message.attachmentIds.length)}
          </h2>
          <div className="attach-grid">
            {message.attachmentIds.map((id) => {
              const thing = things.get(id);
              if (!thing) return null;
              return (
                <AttachmentCard
                  key={id}
                  id={thing.id}
                  filename={thing.filename}
                  kind={kindLabel(thing)}
                  sizeBytes={thing.sizeBytes}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
