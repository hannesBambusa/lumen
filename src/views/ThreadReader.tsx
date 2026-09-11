import { useEffect, useMemo, useState } from "react";

import type { Content, Message, Person, PersonId, Thing, ThingId, Thread } from "../types";
import { initials, kindLabel, shortDate, timeOfDay } from "../lib/format";
import { avatarStyle } from "../lib/color";
import { countQuotedMessages, parseBody } from "../lib/quotes";
import MessageBody from "../components/MessageBody";
import { AttachmentCard } from "../components/AttachmentPreview";
import Timeline from "./Timeline";
import WritingPanel from "../components/WritingPanel";
import ThreadSummary from "../components/ThreadSummary";
import { useAssistant } from "../lib/assistant";
import QuotedHistory from "../components/QuotedHistory";
import Addressing from "../components/Addressing";
import { modelLanguage, useLocale, useT } from "../lib/i18n";
import { useCategories } from "../lib/categories";
import * as backend from "../lib/backend";
import { draftKey } from "../lib/drafts";
import type { Strings } from "../lib/i18n";

interface Props {
  thread: Thread;
  messages: Message[];
  people: Map<PersonId, Person>;
  things: Map<ThingId, Thing>;
}

/** A pause worth marking. Below this, timestamps already tell the story. */
const GAP_DAYS = 2;

/** How many of the newest messages open automatically. */
const OPEN_TAIL = 2;

/**
 * A whole conversation, readable.
 *
 * Long threads fail for one reason above all: every reply carries a copy of everything
 * before it. So the quoted copies are folded away, each message shows only what is new, and
 * the rest of the design is about seeing the shape of the exchange at a glance: who is in
 * it, who has been quiet, and where it stalled.
 */
export default function ThreadReader({ thread, messages, people, things }: Props) {
  // Oldest first for anything that reasons about the conversation: elapsed time, "who spoke
  // first", the gaps. Reading order is the reverse of this and is derived below.
  const ordered = useMemo(
    () => [...messages].sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime()),
    [messages],
  );

  // Newest at the top, history going down: you open a thread to see what just happened, and
  // scrolling down walks backwards through how it got there.
  const reading = useMemo(() => [...ordered].reverse(), [ordered]);

  /**
   * The readable content of this conversation, fetched when it opens.
   *
   * Not part of the mailbox the app loads at startup: deriving every message's body, quotes
   * and signature up front took fourteen seconds on a two-thousand-message mailbox. Here it
   * is a handful of messages and costs milliseconds.
   */
  const [contents, setContents] = useState<Map<string, Content>>(new Map());

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<PersonId | null>(null);
  const [view, setView] = useState<"reading" | "timeline">("reading");
  const [writing, setWriting] = useState(false);
  const [summarising, setSummarising] = useState(false);
  const assistant = useAssistant();
  const t = useT();
  const { locale } = useLocale();
  const categories = useCategories();


  // Unread, plus the last couple, so opening a thread lands you where the conversation is
  // rather than at the top of six weeks of history.
  useEffect(() => {
    const open = new Set<string>();
    ordered.forEach((m, index) => {
      if (m.unread || index >= ordered.length - OPEN_TAIL) open.add(m.id);
    });
    setExpanded(open);
    setHighlight(null);
    // Opening a different thread should start in the normal view rather than inheriting
    // whatever the last one was left in.
    setView("reading");
    setWriting(false);
    // Keyed on the thread, not on `ordered`: opening a thread marks its messages read, which
    // changes `ordered`, and re-running here would collapse the very messages that were
    // expanded because they were unread a moment ago.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id]);

  useEffect(() => {
    let cancelled = false;
    setContents(new Map());

    void backend
      .threadContents(thread.messageIds)
      .then((fetched) => {
        if (!cancelled) setContents(new Map(fetched.map((c) => [c.id, c])));
      })
      .catch(() => {
        // Without it the messages show their preview lines, which is thin but not broken.
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id]);

  // A conversation summarised before shows its summary again on opening. It is stored, so
  // showing it costs nothing, and having to ask a second time for something already paid
  // for is pure friction. Absent one, the panel stays closed and nothing runs.
  useEffect(() => {
    let cancelled = false;
    setSummarising(false);

    const newest = ordered.reduce((latest, m) => (m.sentAt > latest ? m.sentAt : latest), "");
    void backend
      .threadSummary({
        threadKey: thread.id,
        language: modelLanguage(locale),
        messageCount: ordered.length,
        newestAt: newest,
      })
      .then((found) => {
        if (!cancelled && found) setSummarising(true);
      })
      .catch(() => {
        // No summary to show is the normal case, not a failure worth reporting.
      });

    return () => {
      cancelled = true;
    };
    // Keyed on the thread for the same reason as the effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id, locale]);

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const participants = useMemo(() => {
    const seen = new Map<PersonId, { person: Person | undefined; count: number }>();
    for (const m of ordered) {
      if (m.fromMe) continue;
      const entry = seen.get(m.personId);
      if (entry) entry.count += 1;
      else seen.set(m.personId, { person: people.get(m.personId), count: 1 });
    }
    return [...seen.entries()];
  }, [ordered, people]);

  const mineCount = ordered.filter((m) => m.fromMe).length;
  const span = describeSpan(t, ordered);

  return (
    <div className="thread">
      <header className="thread-head">
        <h1 className="reader-subject">{thread.subject}</h1>
        <div className="thread-line">
          <p className="thread-stats">
            {t.common.messages(ordered.length)}
            {` · ${t.thread.people(participants.length + (mineCount > 0 ? 1 : 0))}`}
            {span && ` · ${span}`}
          </p>

          {assistant.can("summarize") && ordered.length > 1 && (
            <button className="chip" onClick={() => setSummarising((v) => !v)}>
              {summarising ? t.thread.hideSummary : t.thread.summarise}
            </button>
          )}
          <button className="chip" onClick={() => setWriting((v) => !v)}>
            {writing ? t.thread.closeReply : t.thread.reply}
          </button>

          {categories.all.length > 0 && (
            <label className="cat-pick">
              <span className="cat-pick-label">{t.category.pick}</span>
              <select
                value={thread.category ?? ""}
                aria-label={t.category.pick}
                onChange={(e) =>
                  void categories.assign(thread.messageIds, e.target.value || null)
                }
              >
                <option value="">{t.category.unsorted}</option>
                {categories.all.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {categories.nameOf(c.slug)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="switch thread-switch" role="tablist" aria-label={t.thread.threadView}>
            <button
              role="tab"
              aria-selected={view === "reading"}
              className="switch-btn"
              onClick={() => setView("reading")}
            >
              {t.thread.reading}
            </button>
            <button
              role="tab"
              aria-selected={view === "timeline"}
              className="switch-btn"
              onClick={() => setView("timeline")}
            >
              {t.thread.timeline}
            </button>
          </div>
        </div>

        <div className="thread-people">
          {participants.map(([id, { person, count }]) => (
            <button
              key={id}
              className={`who${highlight === id ? " on" : ""}`}
              onClick={() => setHighlight((current) => (current === id ? null : id))}
              title={`${person?.email ?? id} · ${t.common.messages(count)}`}
            >
              <span
                className="avatar sm"
                style={person ? avatarStyle(person.email) : undefined}
                aria-hidden="true"
              >
                {person ? initials(person) : "?"}
              </span>
              <span>{person?.name.split(" ")[0] ?? id}</span>
              <span className="who-count">{count}</span>
            </button>
          ))}
          {mineCount > 0 && (
            <span className="who is-me">
              <span className="avatar sm me" aria-hidden="true">
                ME
              </span>
              <span>{t.common.you}</span>
              <span className="who-count">{mineCount}</span>
            </span>
          )}
        </div>
      </header>

      {summarising && (
        <ThreadSummary
          key={thread.id}
          threadKey={thread.id}
          messages={ordered}
          contents={contents}
          people={people}
        />
      )}

      {writing && (
        <WritingPanel
          draftKey={draftKey(thread.id)}
          subject={thread.subject}
          onClose={() => setWriting(false)}
        />
      )}

      {view === "timeline" ? (
        <Timeline messages={ordered} people={people} contents={contents} />
      ) : (
      <div className="thread-body">
        {reading.map((m, index) => {
          const dimmed = highlight !== null && !(m.personId === highlight && !m.fromMe);
          // The gap sits below the newer message and above the older one, so it is read as
          // "everything under here happened this much earlier".
          const gap = gapAfter(t, reading, index);

          return (
            <div key={m.id}>
              <ThreadMessage
                message={m}
                person={people.get(m.personId)}
                things={things}
                open={expanded.has(m.id)}
                dimmed={dimmed}
                onToggle={() => toggle(m.id)}
                content={contents.get(m.id)}
              />
              {gap && <div className="gap">{gap}</div>}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

function ThreadMessage({
  message,
  person,
  things,
  open,
  dimmed,
  onToggle,
  content,
}: {
  message: Message;
  person?: Person;
  things: Map<ThingId, Thing>;
  open: boolean;
  dimmed: boolean;
  onToggle: () => void;
  /** Absent until the conversation's content arrives, which is a blink. */
  content?: Content;
}) {
  const t = useT();
  const [showQuoted, setShowQuoted] = useState(false);
  const [showSignature, setShowSignature] = useState(false);

  const parsed = useMemo(() => parseBody(content?.body ?? ""), [content?.body]);
  // HTML mail has its quotes split on the backend, where the markup is still intact; plain
  // text has them split here. Either way the reader sees one "show quoted text" control.
  const quotedLevels = content?.quoted ?? [];
  const quotedCount = countQuotedMessages(parsed.quoted);
  const who = message.fromMe ? t.common.you : person?.name ?? t.common.unknown;

  if (!open) {
    return (
      <button
        className={`tmsg collapsed${dimmed ? " dim" : ""}${message.unread ? " unread" : ""}`}
        onClick={onToggle}
      >
        <span className="tmsg-caret" aria-hidden="true">
          ▸
        </span>
        <span
          className="avatar sm"
          style={message.fromMe ? undefined : person ? avatarStyle(person.email) : undefined}
          aria-hidden="true"
        >
          {message.fromMe ? "ME" : person ? initials(person) : "?"}
        </span>
        <span className="tmsg-who">{who}</span>
        <span className="tmsg-peek">{message.preview.replace(/\s+/g, " ")}</span>
        {message.attachmentIds.length > 0 && (
          <span className="tmsg-clip">{message.attachmentIds.length}</span>
        )}
        <span className="tmsg-when">{shortDate(message.sentAt)}</span>
      </button>
    );
  }

  return (
    <article className={`tmsg open${dimmed ? " dim" : ""}`}>
      <button className="tmsg-bar" onClick={onToggle}>
        <span className="tmsg-caret" aria-hidden="true">
          ▾
        </span>
        <span
          className="avatar sm"
          style={message.fromMe ? undefined : person ? avatarStyle(person.email) : undefined}
          aria-hidden="true"
        >
          {message.fromMe ? "ME" : person ? initials(person) : "?"}
        </span>
        <span className="tmsg-who">{who}</span>
        <span className="tmsg-when">
          {shortDate(message.sentAt)} {timeOfDay(message.sentAt)}
        </span>
      </button>

      <div className="tmsg-content">
        <Addressing message={message} />

        <MessageBody
          messageId={message.id}
          html={content?.bodyHtml}
          text={parsed.body || message.preview}
          signatureHtml={content?.signatureHtml}
          hasOriginal={message.hasOriginal}
          defaultOriginal={!message.fromMe && person?.isBroadcast}
          senderEmail={message.fromMe ? undefined : person?.email}
        />

        {!content?.bodyHtml && parsed.signature && (
          <div className="fold">
            <button className="fold-btn" onClick={() => setShowSignature((v) => !v)}>
              {showSignature ? t.thread.hideSignature : t.thread.signature}
            </button>
            {showSignature && <pre className="fold-text">{parsed.signature}</pre>}
          </div>
        )}

        {message.attachmentIds.length > 0 && (
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
        )}

        {quotedLevels.length > 0 ? (
          <QuotedHistory quoted={quotedLevels} />
        ) : (
          parsed.quoted && (
            <div className="fold">
              <button className="fold-btn" onClick={() => setShowQuoted((v) => !v)}>
                {showQuoted ? t.thread.hideEarlier : t.thread.showEarlier(quotedCount)}
              </button>
              {showQuoted && <pre className="fold-text">{parsed.quoted}</pre>}
            </div>
          )
        )}
      </div>
    </article>
  );
}

/** "6 weeks", "4 days", or nothing when the whole thread happened in a day. */
function describeSpan(t: Strings, ordered: Message[]): string | null {
  if (ordered.length < 2) return null;

  const first = new Date(ordered[0].sentAt).getTime();
  const last = new Date(ordered[ordered.length - 1].sentAt).getTime();
  const days = Math.round((last - first) / 86_400_000);

  if (days < 1) return null;
  if (days < 14) return t.common.days(days);
  const weeks = Math.round(days / 7);
  if (weeks < 9) return t.common.weeks(weeks);
  const months = Math.round(days / 30);
  return t.common.months(months);
}

/**
 * The silence between a message and the older one below it.
 *
 * "Asgeir asked, then nothing for three weeks, then Håvard chased it" is the real story of
 * most work threads, and timestamps alone do not tell it. Reading downwards goes backwards
 * in time, so the wording is "earlier", not "later".
 */
function gapAfter(t: Strings, reading: Message[], index: number): string | null {
  const older = reading[index + 1];
  if (!older) return null;

  const newer = new Date(reading[index].sentAt).getTime();
  const days = Math.floor((newer - new Date(older.sentAt).getTime()) / 86_400_000);

  if (days < GAP_DAYS) return null;
  if (days < 14) return t.thread.daysEarlier(days);

  const weeks = Math.round(days / 7);
  if (weeks < 9) return t.thread.weeksEarlier(weeks);
  const months = Math.round(days / 30);
  return t.thread.monthsEarlier(months);
}
