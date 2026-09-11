import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import * as backend from "./backend";
import type { AssistantFeatures, AssistantModel, AssistantStatus, AssistantTask } from "./backend";

/**
 * The assistant, shared by everything that can ask it for something.
 *
 * One status, kept current from the backend's events; one `run` that streams. The settings
 * page, the sidebar row, the Translate button on a message and the reply drawer all read
 * the same `status`, so they agree about which models are there and what they may do.
 */
export interface Assistant {
  status: AssistantStatus;
  /** The general model's catalogue entry and state. */
  general: AssistantModel | undefined;
  /** The chosen translation specialist, if any. */
  translator: AssistantModel | undefined;
  /** Master switch on and the general model complete on disk. */
  ready: boolean;
  /**
   * That feature is switched on and a model that can do it is downloaded.
   *
   * Translate is the exception: a translation specialist is enough on its own, so choosing
   * one and deleting the general model leaves Translate working. Everything else needs the
   * general model.
   */
  can: (feature: keyof AssistantFeatures) => boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
  setFeatures: (features: AssistantFeatures) => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
  setTranslationModel: (modelId: string | null) => Promise<void>;
  setTranslationBackend: (backend: "model" | "apple") => Promise<void>;
  download: {
    start: (modelId: string) => Promise<void>;
    pause: (modelId: string) => Promise<void>;
    cancel: (modelId: string) => Promise<void>;
  };
  removeModel: (modelId: string) => Promise<void>;
  /** Bytes per second per model over the last few seconds of its download. */
  speed: Record<string, number>;
  run: (task: AssistantTask, onToken: (piece: string) => void) => Promise<string>;
  /** Remembered target language for translations. */
  language: string;
  setLanguage: (language: string) => void;
}

const LANGUAGE_KEY = "lumen.assistant.language";

export const LANGUAGES = ["English", "Swedish", "Norwegian", "Danish", "German", "French", "Spanish"];

const AssistantContext = createContext<Assistant | null>(null);

export function useAssistant(): Assistant {
  const value = useContext(AssistantContext);
  if (!value) throw new Error("useAssistant outside AssistantProvider");
  return value;
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AssistantStatus>({
    enabled: false,
    features: { translate: true, proofread: true, improve: true, summarize: true },
    model: "qwen3-1.7b",
    translationBackend: "model",
    appleTranslation: false,
    models: [],
  });
  const [speed, setSpeed] = useState<Record<string, number>>({});
  const [language, setLanguageState] = useState<string>(() => {
    try {
      return localStorage.getItem(LANGUAGE_KEY) || "English";
    } catch {
      return "English";
    }
  });

  // Speed is a rolling window over recent progress events per model, not since the start:
  // a download that stalled and resumed should show what it is doing now.
  const samples = useRef<Record<string, Array<{ at: number; bytes: number }>>>({});

  const refresh = useCallback(async () => {
    setStatus(await backend.assistantStatus());
  }, []);

  useEffect(() => {
    void refresh();
    let stop = () => {};
    void backend
      .onAssistantEvents({
        progress: (modelId, done, total) => {
          const now = Date.now();
          const list = (samples.current[modelId] ??= []);
          list.push({ at: now, bytes: done });
          samples.current[modelId] = list.filter((s) => now - s.at <= 8000);
          const first = samples.current[modelId][0];
          if (first && now - first.at > 1000 && done > first.bytes) {
            const rate = ((done - first.bytes) * 1000) / (now - first.at);
            setSpeed((s) => ({ ...s, [modelId]: rate }));
          }
          setStatus((s) => ({
            ...s,
            models: s.models.map((m) =>
              m.id === modelId ? { ...m, state: "downloading", downloadedBytes: done, sizeBytes: total } : m,
            ),
          }));
        },
        changed: () => {
          samples.current = {};
          setSpeed({});
          void refresh();
        },
      })
      .then((unsubscribe) => {
        stop = unsubscribe;
      });
    return () => stop();
  }, [refresh]);

  const apply = useCallback(async (next: Promise<AssistantStatus>) => setStatus(await next), []);

  const setLanguage = useCallback((next: string) => {
    setLanguageState(next);
    try {
      localStorage.setItem(LANGUAGE_KEY, next);
    } catch {
      // A preference is not worth failing over.
    }
  }, []);

  const general = status.models.find((m) => m.id === status.model);
  const translator = status.translationModel
    ? status.models.find((m) => m.id === status.translationModel)
    : undefined;
  const ready = status.enabled && general?.state === "ready";
  // The Mac's own translator needs no model and no download, so a Mac user has Translate
  // even with nothing downloaded at all.
  const canTranslate =
    status.enabled &&
    (status.translationBackend === "apple"
      ? status.appleTranslation
      : ready || translator?.state === "ready");

  const value: Assistant = {
    status,
    general,
    translator,
    ready,
    can: (feature) =>
      Boolean(feature === "translate" ? canTranslate : ready) && status.features[feature],
    setEnabled: (enabled) => apply(backend.assistantSetEnabled(enabled)),
    setFeatures: (features) => apply(backend.assistantSetFeatures(features)),
    setModel: (id) => apply(backend.assistantSetModel(id)),
    setTranslationModel: (id) => apply(backend.assistantSetTranslationModel(id)),
    setTranslationBackend: (b) => apply(backend.assistantSetTranslationBackend(b)),
    download: {
      start: async (id) => {
        samples.current[id] = [];
        await apply(backend.assistantDownloadStart(id));
      },
      pause: (id) => backend.assistantDownloadPause(id),
      cancel: async (id) => {
        await backend.assistantDownloadCancel(id);
        samples.current[id] = [];
        setSpeed((s) => {
          const next = { ...s };
          delete next[id];
          return next;
        });
        await refresh();
      },
    },
    removeModel: (id) => apply(backend.assistantRemoveModel(id)),
    speed,
    run: backend.assistantRun,
    language,
    setLanguage,
  };

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}
