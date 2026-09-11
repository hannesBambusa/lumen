import { useCallback, useEffect, useState } from "react";

import type { Message, Person, PersonId } from "../types";
import { useAssistant } from "../lib/assistant";
import { localeTag, modelLanguage, useLocale, useT } from "../lib/i18n";
import { parseBody } from "../lib/quotes";
import { shortDate } from "../lib/format";
import * as backend from "../lib/backend";

interface Props {
  /** Identifies the conversation a summary is kept under. */
  threadKey: string;
  messages: Message[];
  people: Map<PersonId, Person>;
}

/**
 * Whether the summary is folded away, remembered across threads.
 *
 * Per app rather than per conversation: someone who does not want a summary taking the top
 * of the reader does not want it on the next thread either, and the alternative is folding
 * it again on every mail they open.
 */
const COLLAPSED_KEY = "lumen.summary.collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** How much of a long thread the model is shown. Beyond this, the newest wins. */
const MAX_CHARS = 6000;

/**
 * What a conversation is about and what it still needs, in a few sentences.
 *
 * Built from the timeline's material: who said what, when, with quotes and signatures
 * already stripped, so the model reads the discussion rather than eight copies of it.
 *
 * Kept once made, because it costs seconds of work and most threads do not change between
 * one look and the next. What it was made from is kept with it, so a reply that arrives
 * afterwards shows the summary as out of date rather than letting it quietly describe a
 * conversation that has moved on. Redoing it is then a click, not something that happens
 * behind your back every time a thread gets a reply.
 */
export default function ThreadSummary({ threadKey, messages, people }: Props) {
  const assistant = useAssistant();
  const { locale } = useLocale();
  const t = useT();

  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  /** What was on file, once it has been looked up. Absent while a fresh one is running. */
  const [stored, setStored] = useState<backend.StoredSummary | null>(null);

  const language = modelLanguage(locale);
  const newestAt = messages.reduce((newest, m) => (m.sentAt > newest ? m.sentAt : newest), "");

  const summarise = useCallback(async () => {
    const transcript = [...messages]
      .sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime())
      .map((m) => {
        const who = m.fromMe ? "Me" : people.get(m.personId)?.name ?? "Unknown";
        return `${who} (${shortDate(m.sentAt)}): ${parseBody(m.body).body.trim()}`;
      })
      .filter((line) => !line.endsWith(": "))
      .join("\n\n");

    // Keep the end, which is where the open questions are.
    const clipped = transcript.length > MAX_CHARS ? transcript.slice(-MAX_CHARS) : transcript;

    setText("");
    setStored(null);
    setRunning(true);
    setError(null);
    try {
      const result = await assistant.run(
        { kind: "summarize", text: clipped, language },
        (piece) => setText((current) => current + piece),
      );
      setText(result);
      await backend.saveThreadSummary({
        threadKey,
        language,
        summary: result,
        messageCount: messages.length,
        newestAt,
      });
      // Straight back out of the database rather than assembling it here, so what is shown
      // is what was actually kept.
      setStored(
        await backend.threadSummary({
          threadKey,
          language,
          messageCount: messages.length,
          newestAt,
        }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
    // `messages` and `people` are the thread this component was mounted for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistant, language, threadKey, newestAt]);

  useEffect(() => {
    let cancelled = false;

    void backend
      .threadSummary({ threadKey, language, messageCount: messages.length, newestAt })
      .then((stored) => {
        if (cancelled) return;
        if (stored) {
          // Even an out-of-date summary is worth showing at once: it is mostly right, and
          // it beats several seconds of blank space.
          setText(stored.summary);
          setStored(stored);
          return;
        }
        void summarise();
      })
      .catch(() => {
        if (!cancelled) void summarise();
      });

    return () => {
      cancelled = true;
    };
    // Once per mounted thread; the parent remounts this with a new key per thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fold = (next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // A preference is not worth failing over.
    }
  };

  const stale = Boolean(stored?.stale) && !running;
  const arrivedSince = stored ? Math.max(0, messages.length - stored.messageCount) : 0;

  return (
    <div className={stale ? "summary stale" : "summary"}>
      <div className="summary-head">
        {/* The whole heading folds it, with the caret saying so. A summary is worth reading
          * once and then getting out of the way. */}
        <button
          className="summary-fold"
          aria-expanded={!collapsed}
          onClick={() => fold(!collapsed)}
          title={collapsed ? t.body.summaryExpand : t.body.summaryCollapse}
        >
          <span className="summary-caret" aria-hidden="true">
            {collapsed ? "▸" : "▾"}
          </span>
          {running
            ? t.body.summarising
            : stale
              ? t.body.summaryOutOfDate
              : t.body.summary}
        </button>

        {/* When it was made is the fact that lets you judge the rest for yourself. */}
        {stored && !running && (
          <span className="summary-when">
            {t.body.summarisedAt(clockTime(stored.createdAt))}
            {arrivedSince > 0 && ` · ${t.body.sinceThen(arrivedSince)}`}
          </span>
        )}

        <span className="spacer" />

        {stale && (
          <button className="chip warn" onClick={() => void summarise()}>
            {t.body.summaryStale}
          </button>
        )}
        <span className="translation-note">{t.common.onDevice}</span>
      </div>

      {error ? (
        <p className="rail-note error">{error}</p>
      ) : (
        // Never folded away while it is still being written: hiding a thing mid-generation
        // looks like it failed.
        (!collapsed || running) && <div className="summary-text">{text || "…"}</div>
      )}
    </div>
  );
}

/** A stored timestamp as a date and time, in the app's locale. */
function clockTime(seconds: number): string {
  const at = new Date(seconds * 1000);
  const today = new Date().toDateString() === at.toDateString();
  return today
    ? at.toLocaleTimeString(localeTag(), { hour: "2-digit", minute: "2-digit" })
    : at.toLocaleString(localeTag(), {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}
