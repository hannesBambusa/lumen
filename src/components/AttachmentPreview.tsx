import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { invoke } from "@tauri-apps/api/core";

import { fileSize } from "../lib/format";
import { inApp } from "../lib/backend";
import { renderPdfPages } from "../lib/pdf";
import Thumbnail from "./Thumbnail";
import { useT } from "../lib/i18n";

interface SheetPreview {
  name: string;
  rows: string[][];
  totalRows: number;
  totalCols: number;
}

type Preview =
  | { kind: "image"; filename: string; dataUrl: string }
  | { kind: "pdf"; filename: string; dataUrl: string }
  | { kind: "sheet"; filename: string; sheets: SheetPreview[] }
  | { kind: "unsupported"; filename: string; reason: string };

/**
 * Opening a preview from anywhere.
 *
 * File pills live in four different views at three levels of nesting. A context beats
 * threading a callback through every one of them, and the alternative (each view owning its
 * own overlay) would mean four copies of the same thing.
 */
const PreviewContext = createContext<(id: string, filename: string) => void>(() => {});

export function usePreview() {
  return useContext(PreviewContext);
}

export function PreviewProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<{ id: string; filename: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  const show = useCallback((id: string, filename: string) => {
    setOpen({ id, filename });
    setPreview(null);
    setError(null);
  }, []);

  const close = useCallback(() => setOpen(null), []);

  useEffect(() => {
    if (!open) return;

    if (!inApp()) {
      setError(t.preview.needsApp);
      return;
    }

    let cancelled = false;
    invoke<Preview>("preview_attachment", { attachmentId: Number(open.id) })
      .then((result) => {
        // The overlay may have been closed while the fetch was in flight.
        if (!cancelled) setPreview(result);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [open, t]);

  // Escape closes, because every overlay in every app does.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <PreviewContext.Provider value={show}>
      {children}
      {open && (
        <div className="overlay" onClick={close} role="presentation">
          {/* Stop a click inside the panel from reaching the backdrop's close handler. */}
          <div
            className="preview"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={open.filename}
          >
            <header className="preview-head">
              <span className="preview-name">{open.filename}</span>
              <button className="chip" onClick={close}>
                {t.common.close}
              </button>
            </header>

            <div className="preview-body">
              {error && <p className="preview-note error">{error}</p>}
              {!error && !preview && <p className="preview-note">{t.preview.fetching}</p>}
              {preview && <PreviewContent preview={preview} />}
            </div>
          </div>
        </div>
      )}
    </PreviewContext.Provider>
  );
}

function PreviewContent({ preview }: { preview: Preview }) {
  const t = useT();
  if (preview.kind === "image") {
    return <img className="preview-image" src={preview.dataUrl} alt={preview.filename} />;
  }

  if (preview.kind === "pdf") {
    return <PdfPages dataUrl={preview.dataUrl} />;
  }

  if (preview.kind === "sheet") {
    return (
      <div className="preview-sheets">
        {preview.sheets.map((sheet) => (
          <section key={sheet.name} className="sheet">
            <h3 className="sheet-name">
              {sheet.name}
              <span className="sheet-size">{t.preview.rowsCols(sheet.totalRows, sheet.totalCols)}</span>
            </h3>

            <div className="sheet-scroll">
              <table className="sheet-table">
                <tbody>
                  {sheet.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className={rowIndex === 0 ? "sheet-header" : undefined}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {sheet.rows.length < sheet.totalRows && (
              <p className="preview-note">{t.preview.firstRows(sheet.rows.length, sheet.totalRows)}</p>
            )}
          </section>
        ))}
      </div>
    );
  }

  return <p className="preview-note">{preview.reason}</p>;
}

/** The pages of a PDF, drawn by pdf.js. See `renderPdfPages` for why not `<embed>`. */
function PdfPages({ dataUrl }: { dataUrl: string }) {
  const [result, setResult] = useState<{ pages: string[]; total: number } | null | "failed">(null);
  const t = useT();

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    void renderPdfPages(dataUrl).then((rendered) => {
      if (!cancelled) setResult(rendered ?? "failed");
    });
    return () => {
      cancelled = true;
    };
  }, [dataUrl]);

  if (result === null) return <p className="preview-note">{t.preview.rendering}</p>;
  if (result === "failed") {
    return <p className="preview-note error">{t.preview.pdfFailed}</p>;
  }

  return (
    <div className="pdf-pages">
      {result.pages.map((page, index) => (
        <img key={index} className="pdf-page" src={page} alt={t.preview.page(index + 1)} />
      ))}
      {result.total > result.pages.length && (
        <p className="preview-note">{t.preview.firstPages(result.pages.length, result.total)}</p>
      )}
    </div>
  );
}

/**
 * An attachment as a card with a thumbnail.
 *
 * What a message's attachments should look like: you can see the invoice is an invoice
 * before opening anything. Pills are kept for dense lists where there is no room for this.
 */
export function AttachmentCard({
  id,
  filename,
  kind,
  sizeBytes,
}: {
  id: string;
  filename: string;
  kind: string;
  sizeBytes?: number;
}) {
  const show = usePreview();

  return (
    <button className="attach-card" title={filename} onClick={() => show(id, filename)}>
      <Thumbnail
        attachmentId={id}
        className="attach-face"
        fallback={<em className="attach-kind">{kind}</em>}
      />
      <span className="attach-meta">
        <span className="attach-name">{filename}</span>
        {sizeBytes !== undefined && <span className="attach-size">{fileSize(sizeBytes)}</span>}
      </span>
    </button>
  );
}

/** A file pill that opens a preview when clicked. */
export function FilePill({
  id,
  filename,
  kind,
  sizeBytes,
}: {
  id: string;
  filename: string;
  kind: string;
  sizeBytes?: number;
}) {
  const show = usePreview();

  return (
    <button className="file-pill" title={filename} onClick={() => show(id, filename)}>
      <Thumbnail
        attachmentId={id}
        className="pill-thumb"
        compact
        fallback={<em className="pill-kind">{kind}</em>}
      />
      <span>{filename}</span>
      {sizeBytes !== undefined && <em className="pill-size">{fileSize(sizeBytes)}</em>}
    </button>
  );
}
