import { useEffect, useMemo, useState } from "react";

import type { Category, FolderId, Message, Person, PersonId, Thing, Thread, ThingId } from "../types";
import { useCategories } from "../lib/categories";
import { useAssistant } from "../lib/assistant";
import { deleteDraft, listDrafts } from "../lib/drafts";
import type { LocalDraft } from "../lib/drafts";
import { buildThreads, threadFolder } from "../lib/threads";
import { shortDate } from "../lib/format";
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

  useEffect(() => {
    setLocalDrafts(folder === "drafts" ? listDrafts() : []);
  }, [folder]);

  const messagesById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

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

  const threads = useMemo(
    () => (category === "all" ? inFolder : inFolder.filter((t) => t.category === category)),
    [inFolder, category],
  );

  // Nothing sorted yet means the row would be six empty chips. Offer the sort instead.
  const anySorted = counts.size > 0;

  const open = threads.find((t) => t.id === selected) ?? null;

  return (
    <>
      <section className="threadlist" aria-label={t.list.messagesAria}>
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
            {category === "all"
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
              preview={messagesById.get(thread.messageIds[thread.messageIds.length - 1])?.body ?? ""}
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
  onClick,
}: {
  thread: Thread;
  person?: Person;
  preview: string;
  active: boolean;
  /** Gmail is holding this one, which is where it has to be deleted. */
  isDraft: boolean;
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
        <span className="trow-from">{person?.name ?? t.common.unknown}</span>
        {isDraft && <span className="draft-badge">{t.drafts.inGmail}</span>}
        <span className="trow-when">{shortDate(thread.lastAt)}</span>
      </span>
      <span className="trow-line">
        <span className="trow-subject">{thread.subject}</span>
        {thread.messageIds.length > 1 && (
          <span className="trow-count">{thread.messageIds.length}</span>
        )}
      </span>
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
