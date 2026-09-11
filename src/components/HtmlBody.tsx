import { useCallback, useMemo, useRef, useState } from "react";

import { useT } from "../lib/i18n";

interface Props {
  html: string;
  /** When given, "show images" is remembered for this sender. */
  senderEmail?: string;
}

const IMAGES_KEY = (email: string) => `lumen.images.${email.toLowerCase()}`;

function rememberedImages(email?: string): boolean {
  if (!email) return false;
  try {
    return localStorage.getItem(IMAGES_KEY(email)) === "1";
  } catch {
    return false;
  }
}

/**
 * Render mail HTML without letting it do anything.
 *
 * Mail HTML is hostile by default: tracking pixels, remote CSS, occasionally scripts. Three
 * layers keep it contained, and each would be enough on its own:
 *
 * 1. The Rust side has already stripped scripts, frames and event handlers.
 * 2. The frame is sandboxed with no `allow-scripts`, so nothing in it can execute.
 * 3. A content policy blocks every remote request until the reader asks for images.
 *
 * `allow-same-origin` is present only so the height can be measured. Without
 * `allow-scripts` alongside it, nothing inside the frame can run, which is the combination
 * that makes this safe rather than convenient.
 */
export default function HtmlBody({ html, senderEmail }: Props) {
  const t = useT();
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(240);
  const [showImages, setShowImages] = useState(() => rememberedImages(senderEmail));

  // Per sender, not per message: allowing Klaviyo's images once and being asked again on
  // every one of their mails would make the bar noise rather than protection.
  const allowImages = () => {
    setShowImages(true);
    if (senderEmail) {
      try {
        localStorage.setItem(IMAGES_KEY(senderEmail), "1");
      } catch {
        // A preference is not worth failing over.
      }
    }
  };

  // Remote images are the tracking-pixel vector, so the offer is only made when the
  // message actually contains some.
  const hasRemoteImages = useMemo(() => /<img[^>]+src=["']?https?:/i.test(html), [html]);

  const document = useMemo(() => {
    const imgSrc = showImages ? "https: data:" : "data:";
    return `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src data:;">
<base target="_blank">
<style>
  html { color-scheme: light; }
  body {
    margin: 0;
    padding: 2px;
    background: #ffffff;
    color: #1b1a17;
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    word-break: break-word;
  }
  img { max-width: 100%; height: auto; }
  ${showImages ? "" : `
  /* Blocked images otherwise render as broken-image boxes, which on a dark signature
     table means large black rectangles. Absent is better than broken. */
  img { display: none !important; }`}
  table { max-width: 100% !important; }
  a { color: #1f5c4c; }
  blockquote {
    margin: 8px 0;
    padding-left: 12px;
    border-left: 3px solid #d5d2ca;
    color: #56534c;
  }
</style>
${html}`;
  }, [html, showImages]);

  // Mail is laid out with tables at fixed pixel widths, so the frame has to grow to its
  // content rather than the content adapting to the frame.
  const measure = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    const measured = Math.max(
      doc.documentElement?.scrollHeight ?? 0,
      doc.body?.scrollHeight ?? 0,
    );
    if (measured > 0) setHeight(measured + 8);
  }, []);

  return (
    <div className="htmlbody">
      {hasRemoteImages && !showImages && (
        <div className="imgbar">
          <span>{t.body.imagesBlocked}</span>
          <button className="chip" onClick={allowImages}>
            {senderEmail ? t.body.alwaysShowFromSender : t.body.showImages}
          </button>
        </div>
      )}

      <iframe
        ref={frame}
        className="htmlframe"
        title={t.body.messageContent}
        // No allow-scripts, no allow-popups, no allow-top-navigation.
        sandbox="allow-same-origin"
        srcDoc={document}
        style={{ height }}
        onLoad={measure}
      />
    </div>
  );
}
