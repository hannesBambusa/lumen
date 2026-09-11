import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { invoke } from "@tauri-apps/api/core";

import { inApp } from "../lib/backend";
import { renderPdfThumbnail } from "../lib/pdf";

/**
 * Thumbnails are expensive: each one means downloading the original attachment from Gmail.
 * So they are fetched only when the tile is actually on screen, and only a couple at a time.
 *
 * Without the queue, opening the Files grid would fire a hundred attachment downloads at
 * once and earn a rate limit, which is exactly the failure this project already hit.
 */
const MAX_IN_FLIGHT = 2;

let inFlight = 0;
const waiting: Array<() => void> = [];

type Thumb =
  | { kind: "image"; dataUrl: string }
  | { kind: "pdf"; dataUrl: string }
  | { kind: "sheet"; rows: string[][] }
  | { kind: "none" };

/** Rendered results, kept for the session so scrolling back does not refetch. */
const cache = new Map<string, Thumb>();

/**
 * No single thumbnail may hold a slot longer than this. One that never settled (a PDF render
 * waiting on an animation frame that never came) jammed the queue for the whole session.
 */
const SLOT_TIMEOUT_MS = 30_000;

async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  inFlight += 1;
  try {
    const deadline = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("thumbnail timed out")), SLOT_TIMEOUT_MS),
    );
    return await Promise.race([work(), deadline]);
  } finally {
    inFlight -= 1;
    waiting.shift()?.();
  }
}

interface Props {
  attachmentId: string;
  /** Shown until a thumbnail arrives, and kept for anything that has none. */
  fallback: ReactNode;
  className?: string;
  style?: CSSProperties;
  /**
   * Tiny contexts (an 18px pill) can only show a picture. A spreadsheet's miniature grid
   * needs room to mean anything, so at that size the type label is the better answer.
   */
  compact?: boolean;
}

export default function Thumbnail({ attachmentId, fallback, className, style, compact }: Props) {
  const host = useRef<HTMLSpanElement>(null);
  const [thumb, setThumb] = useState<Thumb | null>(() => cache.get(attachmentId) ?? null);
  const [visible, setVisible] = useState(false);

  // Only ask for what someone can actually see.
  useEffect(() => {
    if (cache.has(attachmentId) || !host.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      // A little ahead of the viewport, so a thumbnail is usually ready by the time the tile
      // is scrolled to rather than popping in afterwards.
      { rootMargin: "300px" },
    );

    observer.observe(host.current);
    return () => observer.disconnect();
  }, [attachmentId]);

  useEffect(() => {
    if (!visible || !inApp() || cache.has(attachmentId)) return;

    let cancelled = false;
    void withSlot(async () => {
      let result: Thumb = { kind: "none" };
      try {
        const raw = await invoke<Thumb>("attachment_thumbnail", {
          attachmentId: Number(attachmentId),
        });

        // A PDF comes back as the document itself and is rasterised here, where a renderer
        // already exists. Doing it in Rust would mean a native PDF library.
        result =
          raw.kind === "pdf"
            ? await renderPdfThumbnail(raw.dataUrl).then(
                (dataUrl) => (dataUrl ? { kind: "image", dataUrl } : { kind: "none" }),
                () => ({ kind: "none" }),
              )
            : raw;
      } catch {
        result = { kind: "none" };
      }

      // Cached either way: remembering that a file has no thumbnail is as valuable as
      // remembering that it has one.
      cache.set(attachmentId, result);
      if (!cancelled) setThumb(result);
    });

    return () => {
      cancelled = true;
    };
  }, [visible, attachmentId]);

  return (
    <span ref={host} className={className} style={style}>
      {thumb?.kind === "image" && <img className="thumb-img" src={thumb.dataUrl} alt="" />}

      {thumb?.kind === "sheet" && !compact && (
        <span className="thumb-sheet" aria-hidden="true">
          {thumb.rows.map((row, rowIndex) => (
            <span key={rowIndex} className={rowIndex === 0 ? "thumb-row head" : "thumb-row"}>
              {row.map((cell, cellIndex) => (
                <span key={cellIndex} className="thumb-cell">
                  {cell}
                </span>
              ))}
            </span>
          ))}
        </span>
      )}

      {(!thumb || thumb.kind === "none" || (thumb.kind === "sheet" && compact)) && fallback}
    </span>
  );
}
