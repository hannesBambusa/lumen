import { useCallback, useEffect, useRef, useState } from "react";

import * as backend from "./backend";

/**
 * Sorting the mailbox, a batch at a time.
 *
 * Four hundred messages is minutes of work, so it cannot be one call: this asks for a
 * small batch, lets the interface repaint, and asks again. Stopping is simply not asking
 * again, which means there is no cancellation to get wrong and no half-written state — a
 * message is either sorted and stored or untouched.
 */
export interface Sorting {
  /** Messages sorted so far. */
  done: number;
  total: number;
  running: boolean;
  /** Work left, and so whether there is anything to offer. */
  remaining: number;
  start: () => void;
  stop: () => void;
}

/** How many per call. Small enough that stopping feels immediate. */
const BATCH = 10;

export function useCategorize(onProgress: () => Promise<unknown>): Sorting {
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [running, setRunning] = useState(false);

  // A ref, not state: the loop below has to see a stop the moment it happens, not on the
  // next render.
  const wanted = useRef(false);

  useEffect(() => {
    void backend.categorizeProgress().then((report) => {
      setDone(report.done);
      setTotal(report.total);
    });
  }, []);

  const stop = useCallback(() => {
    wanted.current = false;
    setRunning(false);
  }, []);

  const start = useCallback(() => {
    if (wanted.current) return;
    wanted.current = true;
    setRunning(true);

    void (async () => {
      try {
        while (wanted.current) {
          const report = await backend.categorizeBatch(BATCH);
          setDone(report.done);
          setTotal(report.total);

          // Nothing was even looked at: everything is sorted, or nothing can be.
          if (report.lookedAt === 0) break;
          // Looked at but sorted none: the model is refusing every one of them, so
          // carrying on would just spin.
          if (report.sorted === 0) break;

          await onProgress();
        }
      } finally {
        wanted.current = false;
        setRunning(false);
      }
    })();
  }, [onProgress]);

  // A run that is still going when the window closes should not keep asking.
  useEffect(() => stop, [stop]);

  return { done, total, running, remaining: Math.max(0, total - done), start, stop };
}
