import { useState } from "react";

import type { QuotedMessage } from "../types";
import { useT } from "../lib/i18n";

interface Props {
  quoted: QuotedMessage[];
}

/**
 * The earlier messages a reply carries with it.
 *
 * Rendered in the app's own design, one block per level, rather than as a single blob of
 * whichever client's markup produced it. Collapsed by default: this is reference material,
 * and in a long chain it is many times the length of what the sender actually wrote.
 */
export default function QuotedHistory({ quoted }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);

  if (quoted.length === 0) return null;

  return (
    <div className="fold">
      <button className="fold-btn" onClick={() => setOpen((v) => !v)}>
        {open ? t.thread.hideEarlier : t.thread.showEarlier(quoted.length)}
      </button>

      {open && (
        <div className="quoted">
          {quoted.map((level, index) => (
            <article key={index} className="quoted-level">
              {level.attribution && <div className="quoted-attr">{level.attribution}</div>}
              {/* Safe: the Rust side allowlists tag names and keeps only a scheme-checked
                * href, dropping every other attribute. */}
              <div
                className="reader-body rich quoted-text"
                dangerouslySetInnerHTML={{ __html: level.html }}
              />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
