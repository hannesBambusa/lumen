import { useCallback, useEffect, useState } from "react";

import { LANGUAGES, useAssistant } from "../lib/assistant";
import type { AssistantTask } from "../lib/backend";
import { useT } from "../lib/i18n";
import { readDraft, writeDraft } from "../lib/drafts";

interface Props {
  /** Where the draft is remembered, so closing the thread does not lose it. */
  draftKey: string;
  subject: string;
  onClose: () => void;
}

type Job = "proofread" | "improve" | "translate";

/**
 * A place to write, with the assistant beside it.
 *
 * The assistant never edits the draft directly. Every task produces a suggestion that sits
 * under the text until it is accepted or discarded, because a tool that silently rewrites
 * what you typed is a tool you stop trusting the first time it gets something wrong.
 *
 * Drafts persist locally. Sending is not built yet; this is the writing half.
 */
export default function WritingPanel({ draftKey, subject, onClose }: Props) {
  const assistant = useAssistant();
  const t = useT();

  const [text, setText] = useState<string>(() => readDraft(draftKey).text);
  const [suggestion, setSuggestion] = useState<{ job: Job; text: string } | null>(null);
  const [running, setRunning] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The subject travels with it so the Drafts folder can name it without the conversation.
  useEffect(() => {
    writeDraft(draftKey, text, subject);
  }, [draftKey, text, subject]);

  const run = useCallback(
    async (job: Job) => {
      if (!text.trim() || running) return;

      const task: AssistantTask =
        job === "translate"
          ? { kind: "translate", text, target: assistant.language }
          : { kind: job, text };

      setRunning(job);
      setError(null);
      setSuggestion({ job, text: "" });
      try {
        const result = await assistant.run(task, (piece) =>
          setSuggestion((s) => (s ? { ...s, text: s.text + piece } : s)),
        );
        setSuggestion({ job, text: result });
      } catch (e) {
        setError(String(e));
        setSuggestion(null);
      } finally {
        setRunning(null);
      }
    },
    [assistant, running, text],
  );

  const label = (job: Job, busy: boolean) =>
    job === "proofread"
      ? busy ? t.writing.fixing : t.writing.fixed
      : job === "improve"
        ? busy ? t.writing.improving : t.writing.improved
        : busy ? t.writing.translating : t.writing.translated;

  // Each tool stands on its own model, so the "turn it on" hint appears only when none of
  // them can run rather than whenever the general model is missing.
  const available =
    assistant.can("proofread") || assistant.can("improve") || assistant.can("translate");

  const accept = () => {
    if (suggestion) setText(suggestion.text);
    setSuggestion(null);
  };

  return (
    <section className="writing" aria-label={t.writing.reply}>
      <header className="writing-head">
        <strong>{t.writing.reply}</strong>
        <span>{t.writing.re(subject)}</span>
        <span className="spacer" />
        <button className="chip" onClick={onClose}>
          {t.common.close}
        </button>
      </header>

      <textarea
        value={text}
        placeholder={t.writing.placeholder}
        onChange={(e) => setText(e.target.value)}
        spellCheck
      />

      {suggestion && (
        <div className="suggestion">
          <div className="suggestion-head">
            <span>{label(suggestion.job, Boolean(running))}</span>
            <span className="spacer" />
            {!running && (
              <>
                <button className="chip" onClick={accept}>
                  {t.writing.useThis}
                </button>
                <button className="chip" onClick={() => setSuggestion(null)}>
                  {t.writing.discard}
                </button>
              </>
            )}
          </div>
          <div className="suggestion-text">{suggestion.text || "…"}</div>
        </div>
      )}

      {error && <p className="rail-note error" style={{ margin: "0 14px 12px" }}>{error}</p>}

      <div className="writing-tools">
        {available ? (
          <>
            {assistant.can("proofread") && (
              <button className="fold-btn" disabled={!!running || !text.trim()} onClick={() => void run("proofread")}>
                {t.writing.fix}
              </button>
            )}
            {assistant.can("improve") && (
              <button className="fold-btn" disabled={!!running || !text.trim()} onClick={() => void run("improve")}>
                {t.writing.improve}
              </button>
            )}
            {assistant.can("translate") && (
              <>
                <button className="fold-btn" disabled={!!running || !text.trim()} onClick={() => void run("translate")}>
                  {t.writing.translateTo}
                </button>
                <select
                  value={assistant.language}
                  onChange={(e) => assistant.setLanguage(e.target.value)}
                  aria-label={t.writing.translationLanguage}
                >
                  {LANGUAGES.map((language) => (
                    <option key={language} value={language}>
                      {t.languages[language] ?? language}
                    </option>
                  ))}
                </select>
              </>
            )}
          </>
        ) : (
          <span className="assist-status">{t.writing.turnOn}</span>
        )}
        <span className="spacer" />
        <span className="assist-status">{t.writing.notBuilt}</span>
        <span className="assist-status draft-origin">{t.drafts.savedHere}</span>
      </div>
    </section>
  );
}
