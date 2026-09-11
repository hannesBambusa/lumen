import { useCallback, useEffect, useState } from "react";

import * as backend from "../lib/backend";
import { useAssistant } from "../lib/assistant";
import HtmlBody from "./HtmlBody";
import { useT } from "../lib/i18n";

interface Props {
  messageId: string;
  html?: string;
  text: string;
  signatureHtml?: string;
  hasOriginal?: boolean;
  /**
   * Start in the sender's own layout rather than the app's.
   *
   * Set for broadcast senders (newsletters, receipts, notifications). Their layout *is* the
   * message: a Klaviyo report reduced to paragraphs loses the thing it was sent to show.
   * People's replies stay in the app's design, where the layout was never the point.
   */
  defaultOriginal?: boolean;
  /** Lets the frame remember "show images" per sender. */
  senderEmail?: string;
}

/**
 * A message body.
 *
 * Mail from people renders as allowlisted markup in the app's own typography. Deciding
 * from the markup which mail "deserves" its original layout proved unwinnable, because a
 * corporate signature is structurally indistinguishable from a small newsletter. What does
 * separate the two reliably is *who sent it*: a no-reply address sends designed mail, a
 * colleague sends prose. So the sender decides the default, and one click flips it.
 */
export default function MessageBody({
  messageId,
  html,
  text,
  signatureHtml,
  hasOriginal,
  defaultOriginal,
  senderEmail,
}: Props) {
  const wantsOriginal = Boolean(defaultOriginal && hasOriginal);

  const [original, setOriginal] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(wantsOriginal);
  const [showSignature, setShowSignature] = useState(false);
  const [loading, setLoading] = useState(false);

  const assistant = useAssistant();
  const t = useT();
  const language = t.languages[assistant.language] ?? assistant.language;
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  const translate = useCallback(async () => {
    if (translation !== null) {
      setTranslation(null);
      return;
    }
    setTranslating(true);
    setTranslateError(null);
    setTranslation("");
    try {
      // The clean text: quotes and signature already stripped, so the model is not asked
      // to translate eight repetitions of a footer.
      const result = await assistant.run(
        { kind: "translate", text, target: assistant.language },
        (piece) => setTranslation((current) => (current ?? "") + piece),
      );
      setTranslation(result);
    } catch (e) {
      setTranslateError(String(e));
      setTranslation(null);
    } finally {
      setTranslating(false);
    }
  }, [assistant, text, translation]);

  const fetchOriginal = useCallback(async () => {
    setLoading(true);
    try {
      const fetched = await backend.originalHtml(messageId);
      setOriginal(fetched);
      return fetched;
    } finally {
      setLoading(false);
    }
  }, [messageId]);

  // A broadcast sender's mail is fetched in its original form straight away. If that fails
  // (offline, browser preview), the inline version is already on screen underneath.
  useEffect(() => {
    if (!wantsOriginal) return;
    let cancelled = false;
    void fetchOriginal().then((fetched) => {
      // Nothing came back: drop to the inline version rather than showing an empty frame.
      if (!cancelled && !fetched) setShowOriginal(false);
    });
    return () => {
      cancelled = true;
    };
  }, [wantsOriginal, fetchOriginal]);

  const toggleOriginal = useCallback(async () => {
    if (showOriginal) {
      setShowOriginal(false);
      return;
    }
    if (original) {
      setShowOriginal(true);
      return;
    }
    const fetched = await fetchOriginal();
    if (fetched) setShowOriginal(true);
  }, [fetchOriginal, original, showOriginal]);

  const shown = translation !== null ? { text: translation, running: translating } : null;
  const shownError = translateError;

  return (
    <>
      {shown && !shownError && (
        <div className="translation">
          <div className="translation-head">
            <span>
              {shown.running ? t.body.translatingTo(language) : t.body.translatedTo(language)}
            </span>
            <span className="translation-note">{t.common.onDevice}</span>
          </div>
          <div className="reader-body">{shown.text || "…"}</div>
        </div>
      )}
      {shownError && <p className="rail-note error">{shownError}</p>}

      {showOriginal && original ? (
        <HtmlBody html={original} senderEmail={senderEmail} />
      ) : html ? (
        // Safe: the Rust side allowlists tag names and keeps only a scheme-checked href,
        // dropping every other attribute.
        <div className="reader-body rich" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="reader-body">{text}</div>
      )}

      <div className="body-tools">
        {assistant.can("translate") && text.trim() && (
          <button className="fold-btn" onClick={translate} disabled={translating}>
            {translating ? t.body.translating : translation !== null ? t.body.hideTranslation : t.body.translateTo(language)}
          </button>
        )}
        {signatureHtml && (
          <button className="fold-btn" onClick={() => setShowSignature((v) => !v)}>
            {showSignature ? t.thread.hideSignature : t.thread.signature}
          </button>
        )}
        {hasOriginal && (
          <button className="fold-btn" onClick={toggleOriginal} disabled={loading}>
            {loading ? t.body.loading : showOriginal && original ? t.body.readingView : t.body.showOriginal}
          </button>
        )}
      </div>

      {showSignature && signatureHtml && (
        <div
          className="signature-block reader-body rich"
          dangerouslySetInnerHTML={{ __html: signatureHtml }}
        />
      )}
    </>
  );
}
