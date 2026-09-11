interface Props {
  label: string;
}

/**
 * The half-second before the mailbox is on screen.
 *
 * Named after light, so it opens with some: the wordmark is lit by a sweep passing across
 * it, over a track where the same light runs back and forth. Nothing here reports real
 * progress, and it deliberately does not pretend to — a bar creeping to 90% and stopping is
 * worse than an honest "working on it".
 *
 * All CSS, no library, and it stops moving entirely for anyone who has asked the system for
 * less motion.
 */
export default function Boot({ label }: Props) {
  return (
    <div className="boot">
      <div className="boot-stage">
        <div className="boot-mark" aria-hidden="true">
          Lumen
        </div>

        <div className="boot-track" aria-hidden="true">
          <span className="boot-beam" />
        </div>

        <p className="boot-label" role="status">
          {label}
        </p>
      </div>
    </div>
  );
}
