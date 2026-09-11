import { useCallback, useEffect, useState } from "react";

/**
 * Pane widths, remembered between launches.
 *
 * Each pane has a default, a floor and a ceiling. The floors are not arbitrary: below them a
 * pane stops doing its job (a thread list too narrow to show a subject is worse than no
 * thread list), and the ceilings stop one pane crushing the one that has to flex.
 */
export const PANES = {
  rail: { key: "lumen.pane.rail", initial: 214, min: 168, max: 340 },
  list: { key: "lumen.pane.list", initial: 330, min: 240, max: 620 },
  mid: { key: "lumen.pane.mid", initial: 300, min: 220, max: 520 },
} as const;

export type PaneName = keyof typeof PANES;

export function usePaneWidth(name: PaneName) {
  const pane = PANES[name];

  const [width, setWidth] = useState<number>(() => {
    try {
      const stored = Number(localStorage.getItem(pane.key));
      // NaN, 0 and out-of-range values all fall back rather than producing a broken layout
      // from a corrupted or hand-edited preference.
      if (Number.isFinite(stored) && stored >= pane.min && stored <= pane.max) {
        return stored;
      }
    } catch {
      // Storage can throw outright; a layout preference is not worth failing over.
    }
    return pane.initial;
  });

  useEffect(() => {
    try {
      localStorage.setItem(pane.key, String(Math.round(width)));
    } catch {
      // As above.
    }
  }, [pane.key, width]);

  const reset = useCallback(() => setWidth(pane.initial), [pane.initial]);

  return { width, setWidth, reset, min: pane.min, max: pane.max };
}
