import { useEffect, useMemo, useState } from "react";

import type {
  Address,
  Category,
  FolderId,
  Message,
  Person,
  PersonId,
  Thing,
  Thread,
  ThingId,
} from "../types";
import { useCategories } from "../lib/categories";
import { matches } from "../lib/search";
import Highlight from "../components/Highlight";
import { useAssistant } from "../lib/assistant";
import { deleteDraft, listDrafts } from "../lib/drafts";
import type { LocalDraft } from "../lib/drafts";
import { buildThreads, threadFolder } from "../lib/threads";
import { initials, shortDate } from "../lib/format";
import { avatarStyle } from "../lib/color";
import { useT } from "../lib/i18n";
import type { Sorting } from "../lib/categorize";
import ThreadReader from "./ThreadReader";

interface Props {
  messages: Message[];
  people: Map<PersonId, Person>;
  things: Map<ThingId, Thing>;
  folder: FolderId;
  /** Called with the thread's message ids when it is opened, so it can be marked read. */
  onOpenThread?: (messageIds: string[]) => void;
  /** State of the sorting pass, for the filter row. */
  sorting: Sorting;
  /** Sorting needs the assistant, so the filter row has to be able to send you there. */
  onOpenAiSettings: () => void;
  /** Everything exchanged with one person, which is the People view's whole job. */
  onOpenPerson: (id: PersonId) => void;
}

/**
 * The familiar reading of the same mailbox: folders, threads, subject lines, a reading
 * pane. Nothing here is derived differently from Focus mode, it is the same messages
 * grouped by subject instead of by obligation.
 */
export default function ClassicView({
  messages,
  people,
  things,
  folder,
  onOpenThread,
  sorting,
  onOpenAiSettings,
  onOpenPerson,
}: Props) {
  const t = useT();
  const categories = useCategories();
  const assistant = useAssistant();
  const [selected, setSelected] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | "all">("all");
  // Lumen's own unsent replies. Read when the folder is opened rather than watched: they
  // only change from inside this app, and one of the two places that changes them is a
  // drawer that is not open while you are looking at this list.
  const [localDrafts, setLocalDrafts] = useState<LocalDraft[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setLocalDrafts(folder === "drafts" ? listDrafts() : []);
  }, [folder]);

  const messagesById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  /**
   * What each conversation can be searched by: its subject, and every person on it.
   *
   * Names, addresses and therefore domains, so "bambusa.no" finds everything from that
   * company and "kristin" finds her whether you remember her surname or her address. Built
   * once per mailbox rather than on every keystroke.
   *
   * Deliberately not the message bodies. Searching what people wrote is a different job with
   * different expectations, and mixing it in here would mean a search for "Asgeir" also
   * returning every mail that merely mentions him.
   */
  const allThreads = useMemo(() => buildThreads(messages), [messages]);

  const haystacks = useMemo(() => {
    const byThread = new Map<string, string>();
    for (const thread of allThreads) {
      const parts: Array<string | undefined> = [thread.subject];
      for (const id of thread.messageIds) {
        const message = messagesById.get(id);
        if (!message) continue;
        const person = people.get(message.personId);
        parts.push(person?.name, person?.email, message.sender?.name, message.sender?.email);
        for (const who of [...(message.audience?.to ?? []), ...(message.audience?.copies ?? [])]) {
          parts.push(who.name, who.email);
        }
      }
      byThread.set(thread.id, parts.filter(Boolean).join(" "));
    }
    return byThread;
  }, [allThreads, messagesById, people]);

  const searching = query.trim().length > 0;

  const inFolder = useMemo(() => {
    const all = buildThreads(messages);
    return all.filter((t) => threadFolder(t, messagesById) === folder);
  }, [messages, messagesById, folder]);

  // Counts come from the whole folder, not the filtered view, so a chip showing 0 is
  // telling you there is nothing rather than that you have filtered it away.
  const counts = useMemo(() => {
    const map = new Map<Category, number>();
    for (const thread of inFolder) {
      if (thread.category) map.set(thread.category, (map.get(thread.category) ?? 0) + 1);
    }
    return map;
  }, [inFolder]);

  const threads = useMemo(() => {
    // A search spans every folder. Looking for a person and being told there is nothing,
    // because the one mail from them was archived, is worse than useless.
    const pool = searching
      ? allThreads.filter((t) => matches([haystacks.get(t.id)], query))
      : inFolder;
    return category === "all" ? pool : pool.filter((t) => t.category === category);
  }, [inFolder, category, searching, query, haystacks, allThreads]);

  /**
   * The person a row matched on, when it is not one the row already shows.
   *
   * A thread found because someone was copied on it looks, in the list, exactly like a
   * thread found for no reason: the sender and subject on screen contain nothing the search
   * asked for. Without this the honest reaction is "why is this here", which is the feeling
   * a search is supposed to remove.
   */
  const matchNote = useMemo(() => {
    if (!searching) return new Map<string, Address>();

    const notes = new Map<string, Address>();
    for (const thread of threads) {
      const shown = people.get(thread.personId);
      if (matches([shown?.name, shown?.email, thread.subject], query)) continue;

      outer: for (const id of thread.messageIds) {
        const message = messagesById.get(id);
        if (!message) continue;
        const candidates: Array<Address | undefined> = [
          message.sender,
          ...(message.audience?.to ?? []),
          ...(message.audience?.copies ?? []),
        ];
        for (const who of candidates) {
          if (who && matches([who.name, who.email], query)) {
            notes.set(thread.id, who);
            break outer;
          }
        }
      }
    }
    return notes;
  }, [searching, threads, people, messagesById, query]);

  /**
   * People whose name or address matches, with how much mail each accounts for.
   *
   * Most searches for a person mean "everything from this person", not "the letters a-s-g-e-i-r
   * somewhere". Listing them separately answers that directly instead of making someone read
   * a list of subjects to work out which rows are the right person.
   */
  const matchedPeople = useMemo(() => {
    if (!searching) return [];
    const counts = new Map<PersonId, number>();
    for (const thread of allThreads) {
      for (const id of thread.messageIds) {
        const person = messagesById.get(id)?.personId;
        if (person) counts.set(person, (counts.get(person) ?? 0) + 1);
      }
    }
    return [...people.values()]
      .filter((p) => matches([p.name, p.email], query))
      .map((person) => ({ person, count: counts.get(person.id) ?? 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
  }, [searching, query, people, allThreads, messagesById]);

  // Nothing sorted yet means the row would be six empty chips. Offer the sort instead.
  const anySorted = counts.size > 0;

  const open = threads.find((t) => t.id === selected) ?? null;

  return (
    <>
      <section className="threadlist" aria-label={t.list.messagesAria}>
        <div className="searchrow listsearch">
          <svg
            className="search-icon"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="4.6" />
            <path d="M10.4 10.4 14 14" />
          </svg>
          <input
            className="search"
            type="search"
            value={query}
            placeholder={t.list.searchPlaceholder}
            aria-label={t.list.searchAria}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
          />
          {searching && (
            <button className="search-clear" onClick={() => setQuery("")} aria-label={t.things.clearSearch}>
              {t.things.clear}
            </button>
          )}
        </div>

        {searching && (
          <>
            {matchedPeople.length > 0 && (
              <div className="search-people">
                {matchedPeople.map(({ person, count }) => (
                  <button
                    key={person.id}
                    className="search-person"
                    onClick={() => onOpenPerson(person.id)}
                    title={t.list.openPerson(person.name)}
                  >
                    <span className="avatar sm" style={avatarStyle(person.email)} aria-hidden="true">
                      {initials(person)}
                    </span>
                    <span className="search-person-text">
                      <span className="search-person-name">
                        <Highlight text={person.name} query={query} />
                      </span>
                      <span className="search-person-mail">
                        <Highlight text={person.email} query={query} />
                      </span>
                    </span>
                    <span className="search-person-count">
                      {t.common.messages(count)}
                      <span className="search-person-go" aria-hidden="true">
                        →
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            <p className="search-count">{t.list.searchCount(threads.length)}</p>
          </>
        )}

        <div className="catbar">
          {anySorted && (
            <>
              <button
                className="chip"
                aria-pressed={category === "all"}
                onClick={() => setCategory("all")}
              >
                {t.category.all}
              </button>
              {categories.all
                .filter((c) => counts.has(c.slug))
                .map((c) => (
                  <button
                    key={c.slug}
                    className="chip"
                    aria-pressed={category === c.slug}
                    onClick={() => setCategory(c.slug)}
                  >
                    {categories.nameOf(c.slug)}{" "}
                    <span className="cat-count">{counts.get(c.slug)}</span>
                  </button>
                ))}
            </>
          )}

          {sorting.running ? (
            <button className="chip" onClick={sorting.stop}>
              {t.category.sorting(sorting.done, sorting.total)}
            </button>
          ) : sorting.remaining > 0 ? (
            assistant.ready ? (
              <button className="chip primary" onClick={sorting.start}>
                {anySorted
                  ? t.category.sortMore(sorting.remaining)
                  : t.category.sortAll(sorting.remaining)}
              </button>
            ) : (
              <button className="chip warn" onClick={onOpenAiSettings}>
                {t.category.needsAi(sorting.remaining)} →
              </button>
            )
          ) : null}
        </div>

        {folder === "drafts" &&
          localDrafts.map((draft) => (
            <LocalDraftRow
              key={draft.key}
              draft={draft}
              onOpen={() => setSelected(draft.threadKey)}
              onDelete={() => {
                deleteDraft(draft.key);
                setLocalDrafts(listDrafts());
              }}
            />
          ))}

        {threads.length === 0 && localDrafts.length === 0 ? (
          <p className="empty">
            {searching
              ? t.list.noMatches(query.trim())
              : category === "all"
                ? t.list.nothingIn(t.app.folders[folder])
                : t.category.noneOfKind}
          </p>
        ) : (
          threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              person={people.get(thread.personId)}
              isDraft={thread.messageIds.every((id) => messagesById.get(id)?.isDraft)}
              query={searching ? query : ""}
              matched={matchNote.get(thread.id)}
              // A search crosses folders, so a result has to say where it lives, or acting
              // on it means hunting for it afterwards.
              folder={searching ? threadFolder(thread, messagesById) : undefined}
              preview={messagesById.get(thread.messageIds[thread.messageIds.length - 1])?.preview ?? ""}
              active={thread.id === selected}
              onClick={() => {
                setSelected(thread.id);
                onOpenThread?.(thread.messageIds);
              }}
            />
          ))
        )}
      </section>

      <section className="reader" aria-label={t.list.reader}>
        {open ? (
          <ThreadReader
            thread={open}
            messages={open.messageIds.map((id) => messagesById.get(id)!).filter(Boolean)}
            people={people}
            things={things}
          />
        ) : (
          <p className="empty">{t.app.selectMessage}</p>
        )}
      </section>
    </>
  );
}

/**
 * A reply written in Lumen and never sent.
 *
 * Labelled with where it actually is, because that is the only way to know where to get rid
 * of it: this one is in this app on this computer, and a draft Gmail is holding is a
 * different thing that has to be deleted there. Deleting is offered here since this is the
 * only place it can be done at all.
 */
function LocalDraftRow({
  draft,
  onOpen,
  onDelete,
}: {
  draft: LocalDraft;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const t = useT();

  return (
    <div className="trow draft-row">
      <button className="draft-open" onClick={onOpen}>
        <span className="trow-line">
          <span className="trow-from">{t.drafts.inLumen}</span>
          {draft.savedAt && <span className="trow-when">{shortDate(draft.savedAt)}</span>}
        </span>
        <span className="trow-line">
          <span className="trow-subject">
            {draft.subject ? t.writing.re(draft.subject) : t.common.noSubject}
          </span>
        </span>
        <span className="trow-preview">{draft.text}</span>
      </button>

      <div className="draft-tools">
        <span className="draft-where">{t.drafts.onlyHere}</span>
        <button className="chip danger" onClick={onDelete}>
          {t.drafts.discard}
        </button>
      </div>
    </div>
  );
}

function ThreadRow({
  thread,
  person,
  preview,
  active,
  isDraft,
  query,
  folder,
  matched,
  onClick,
}: {
  thread: Thread;
  person?: Person;
  preview: string;
  active: boolean;
  /** Gmail is holding this one, which is where it has to be deleted. */
  isDraft: boolean;
  /** The search that found it, for marking the matching words. Empty when not searching. */
  query: string;
  /** Which folder it is in. Only set for search results, which cross folders. */
  folder?: FolderId;
  /** Who this matched on, when the row does not already show them. */
  matched?: Address;
  onClick: () => void;
}) {
  const t = useT();
  const categories = useCategories();
  return (
    <button
      className={`trow${active ? " active" : ""}${thread.unread ? " unread" : ""}`}
      onClick={onClick}
    >
      <span className="trow-line">
        <span className="trow-from">
          <Highlight text={person?.name ?? t.common.unknown} query={query} />
        </span>
        {isDraft && <span className="draft-badge">{t.drafts.inGmail}</span>}
        {folder && <span className="trow-folder">{t.app.folders[folder]}</span>}
        <span className="trow-when">{shortDate(thread.lastAt)}</span>
      </span>
      <span className="trow-line">
        <span className="trow-subject">
          <Highlight text={thread.subject} query={query} />
        </span>
        {thread.messageIds.length > 1 && (
          <span className="trow-count">{thread.messageIds.length}</span>
        )}
      </span>
      {matched && (
        <span className="trow-why">
          {t.list.matchedOn}{" "}
          <Highlight text={matched.name} query={query} />{" "}
          <span className="trow-why-mail">
            <Highlight text={matched.email} query={query} />
          </span>
        </span>
      )}

      <span className="trow-preview">
        {thread.attachmentCount > 0 && (
          <span className="trow-clip">{t.common.files(thread.attachmentCount)} · </span>
        )}
        {preview}
      </span>

      {thread.category && (
        <span
          className={`trow-cat cat-${thread.category}`}
          title={
            thread.categorySource === "user"
              ? t.category.byYou
              : thread.categorySource === "model"
                ? t.category.byModel
                : t.category.byRule
          }
        >
          {t.category.label(categories.nameOf(thread.category))}
        </span>
      )}
    </button>
  );
}
