import { useAssistant } from "../lib/assistant";
import { useT } from "../lib/i18n";

interface Props {
  onOpenSettings: () => void;
}

/**
 * Where the assistant stands, in the sidebar, at a glance.
 *
 * Two separate things have to be true before anything works: a model has to be downloaded
 * *and* the assistant has to be switched on. Having one of the two and silently seeing no
 * features is the state people get stuck in, so this never collapses the two into one word.
 * The whole block is the way to the settings that fix it.
 */
export default function AssistantToggle({ onOpenSettings }: Props) {
  const { status, general, ready } = useAssistant();
  const t = useT();

  const downloading = status.models.find((m) => m.state === "downloading");
  const percent = (m: { downloadedBytes: number; sizeBytes: number }) =>
    Math.round((m.downloadedBytes / Math.max(1, m.sizeBytes)) * 100);

  // Four states, and the dot is the fastest way to read which: grey off, amber needs
  // something, green working.
  const state: "off" | "busy" | "waiting" | "ready" = downloading
    ? "busy"
    : !status.enabled
      ? "off"
      : ready
        ? "ready"
        : "waiting";

  const detail = (() => {
    if (downloading) return t.assistant.downloadingShort(downloading.name, percent(downloading));
    if (!status.enabled) return t.assistant.tapToTurnOn;
    if (!general) return t.assistant.noModelChosen;
    switch (general.state) {
      case "ready":
        return general.name;
      case "paused":
        return t.assistant.pausedShort(general.name);
      case "error":
        return t.assistant.failedShort(general.name);
      default:
        return t.assistant.notDownloadedShort(general.name);
    }
  })();

  return (
    <button
      className={`assist assist-${state}`}
      onClick={onOpenSettings}
      title={t.assistant.openSettings}
    >
      <span className="assist-top">
        <span className="assist-dot" aria-hidden="true" />
        <span className="assist-head">
          {state === "ready" ? t.assistant.aiOn : t.assistant.aiOff}
        </span>
        <span className="assist-go" aria-hidden="true">
          →
        </span>
      </span>
      <span className="assist-detail">{detail}</span>

      {downloading && (
        <span className="assist-bar" aria-hidden="true">
          <span style={{ width: `${percent(downloading)}%` }} />
        </span>
      )}
    </button>
  );
}
