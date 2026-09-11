import * as pdfjs from "pdfjs-dist";
// Vite hands back a URL for the bundled worker, so it is served from the app rather than
// from a CDN. A mail client that reaches out to the network to draw a thumbnail would be
// both slower and a privacy problem.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Longest edge of a rendered page, matching what the Rust side produces for images. */
const EDGE = 320;

/** Generous for a first page; anything slower is stuck, not slow. */
const RENDER_TIMEOUT_MS = 15_000;

/**
 * Rasterise the first page of a PDF into a data URL.
 *
 * Only the first page: a thumbnail exists to say "this is the invoice", not to be read.
 */
export async function renderPdfThumbnail(dataUrl: string): Promise<string | null> {
  const base64 = dataUrl.split(",")[1];
  if (!base64) return null;

  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

  const task = pdfjs.getDocument({
    data: bytes,
    // Nothing here should ever fetch: no remote fonts, no external CMaps.
    disableAutoFetch: true,
    disableStream: true,
  });

  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);

    const base = page.getViewport({ scale: 1 });
    const scale = EDGE / Math.max(base.width, base.height);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    const context = canvas.getContext("2d");
    if (!context) return null;

    // White first: PDF pages are transparent where nothing is drawn, and on a dark theme an
    // unpainted page renders as a black rectangle.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    // `canvas` only: pdf.js v6 documents `canvasContext` as a legacy alternative that must be
    // paired with `canvas: null`, and supplying both is contradictory.
    //
    // `intent: "print"`, not the default "display": display rendering is paced through
    // `requestAnimationFrame`, which does not fire while the window is hidden, minimised or
    // throttled, so the promise never settles. A thumbnail is drawn into an offscreen canvas
    // and has no business waiting for animation frames.
    //
    // And a hard deadline regardless, because a render that never settles held a thumbnail
    // slot open and jammed every thumbnail queued behind it.
    const render = page.render({ canvas, viewport, intent: "print" });
    const deadline = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("pdf render timed out")), RENDER_TIMEOUT_MS),
    );
    try {
      await Promise.race([render.promise, deadline]);
    } catch (error) {
      render.cancel();
      throw error;
    }
    return canvas.toDataURL("image/jpeg", 0.75);
  } catch {
    // Encrypted, malformed, or simply not a PDF. The tile keeps its type label.
    return null;
  } finally {
    // Destroy is on the loading task, not the document. Without it every thumbnail leaks
    // its copy of the file inside the worker.
    void task.destroy();
  }
}

/** Pages rendered for the full preview. Enough to read a document, not a PDF viewer. */
const PREVIEW_MAX_PAGES = 12;

/** Width the preview pages are rendered at; the panel scales them down if narrower. */
const PREVIEW_WIDTH = 1400;

/**
 * Rasterise the first pages of a PDF for the preview overlay.
 *
 * Canvases rather than `<embed>`: the webview's built-in PDF plugin does not reliably
 * render from a data URL inside an embed, and a blank panel with no error is the worst
 * possible outcome. Drawing the pages ourselves is one mechanism, already proven for the
 * thumbnails, and it behaves the same everywhere.
 */
export async function renderPdfPages(
  dataUrl: string,
): Promise<{ pages: string[]; total: number } | null> {
  const base64 = dataUrl.split(",")[1];
  if (!base64) return null;

  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const task = pdfjs.getDocument({ data: bytes, disableAutoFetch: true, disableStream: true });

  try {
    const doc = await task.promise;
    const total = doc.numPages;
    const pages: string[] = [];

    for (let number = 1; number <= Math.min(total, PREVIEW_MAX_PAGES); number += 1) {
      const page = await doc.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: PREVIEW_WIDTH / base.width });

      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      // Same reasoning as the thumbnail: never wait on animation frames, never hang.
      const render = page.render({ canvas, viewport, intent: "print" });
      const deadline = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("pdf render timed out")), RENDER_TIMEOUT_MS),
      );
      try {
        await Promise.race([render.promise, deadline]);
      } catch (error) {
        render.cancel();
        throw error;
      }
      pages.push(canvas.toDataURL("image/jpeg", 0.85));
    }

    return { pages, total };
  } catch {
    return null;
  } finally {
    void task.destroy();
  }
}
