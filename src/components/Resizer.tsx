import { useCallback, useRef } from "react";

interface Props {
  /** Distance from the left edge of the frame, in pixels. */
  x: number;
  /** Current width of the column to the left of this handle. */
  width: number;
  onChange: (width: number) => void;
  onReset: () => void;
  min: number;
  max: number;
  label: string;
}

/**
 * A draggable divider between two panes.
 *
 * Positioned over the boundary rather than occupying a grid column, so adding one does not
 * change the layout it divides. The hit area is deliberately wider than the line it draws:
 * a 1px target is the classic way a resizer feels broken.
 */
export default function Resizer({ x, width, onChange, onReset, min, max, label }: Props) {
  const start = useRef({ pointer: 0, width: 0 });

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      start.current = { pointer: event.clientX, width };
      // Capture, so the drag survives the pointer leaving the handle. Without it a quick
      // drag stops the moment the cursor outruns the 9px hit area.
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [width],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const next = start.current.width + (event.clientX - start.current.pointer);
      onChange(Math.min(max, Math.max(min, next)));
    },
    [max, min, onChange],
  );

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  return (
    <div
      className="resizer"
      style={{ left: x }}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        // Keyboard resizing, because a drag-only control is unusable without a mouse.
        const step = event.shiftKey ? 32 : 8;
        if (event.key === "ArrowLeft") onChange(Math.max(min, width - step));
        if (event.key === "ArrowRight") onChange(Math.min(max, width + step));
      }}
    >
      <span className="resizer-line" aria-hidden="true" />
    </div>
  );
}
