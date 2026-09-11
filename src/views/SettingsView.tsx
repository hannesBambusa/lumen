import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { LANGUAGES, useAssistant } from "../lib/assistant";
import type { AssistantFeatures, AssistantModel } from "../lib/backend";
import { fileSize } from "../lib/format";
import { LOCALES, useLocale, useT } from "../lib/i18n";
import { useCategories } from "../lib/categories";
import { THEMES, TEXT_SIZES, useAppearance } from "../lib/theme";
import type { ThemeChoice } from "../lib/theme";
import * as backend from "../lib/backend";
import type { MailCategory } from "../lib/backend";
import type { LocaleChoice } from "../lib/i18n";

const FEATURES: Array<keyof AssistantFeatures> = ["translate", "proofread", "improve", "summarize"];

/** Which half of the settings you are looking at. */
export type SettingsTab = "general" | "ai";

interface Props {
  /** Which tab to open on. The sidebar's assistant block sends you straight to "ai". */
  tab?: SettingsTab;
}

/**
 * Everything about the app in one place: its language, then the on-device assistant with
 * its switch, its models and its features. Separate decisions, deliberately: whether the
 * assistant runs at all, which models are on disk, which of them do which job, and what
 * they are allowed to do.
 */
export default function SettingsView({ tab: initial = "general" }: Props) {
  const assistant = useAssistant();
  const { status } = assistant;
  const { choice, setChoice } = useLocale();
  const t = useT();
  const [working, setWorking] = useState(false);
  const [tab, setTab] = useState<SettingsTab>(initial);

  // Arriving from the sidebar means arriving with a tab in mind, and that can happen while
  // the page is already open.
  useEffect(() => setTab(initial), [initial]);

  const act = async (fn: () => Promise<void>) => {
    setWorking(true);
    try {
      await fn();
    } finally {
      setWorking(false);
    }
  };

  const toggleFeature = (key: keyof AssistantFeatures) =>
    void act(() => assistant.setFeatures({ ...status.features, [key]: !status.features[key] }));

  const general = status.models.filter((m) => m.role === "general");
  const translators = status.models.filter((m) => m.role === "translation");

  return (
    <div className="wrap">
      <header className="page-head">
        <h1 className="page-title">{t.settings.title}</h1>
        <p className="page-sub">{t.settings.sub}</p>
      </header>

      <div className="switch settings-tabs" role="tablist" aria-label={t.settings.title}>
        <button
          role="tab"
          aria-selected={tab === "general"}
          className="switch-btn"
          onClick={() => setTab("general")}
        >
          {t.settings.tabGeneral}
        </button>
        <button
          role="tab"
          aria-selected={tab === "ai"}
          className="switch-btn"
          onClick={() => setTab("ai")}
        >
          {t.settings.tabAi}
        </button>
      </div>

      {tab === "general" ? (
        <>
      <Appearance />

      <section className="settings-section">
        <h2>{t.settings.language}</h2>
        <p className="settings-lede">{t.settings.languageLede}</p>
        <div className="setting">
          <div className="setting-text">
            <div className="setting-name">{t.settings.appLanguage}</div>
          </div>
          <select
            value={choice}
            onChange={(e) => setChoice(e.target.value as LocaleChoice)}
            aria-label={t.settings.appLanguage}
          >
            <option value="system">{t.settings.system}</option>
            {LOCALES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      </section>

        </>
      ) : (
        <>
      <section className="settings-section">
        <h2>{t.settings.assistant}</h2>
        <p className="settings-lede">{t.settings.assistantLede}</p>

        <div className="setting">
          <div className="setting-text">
            <div className="setting-name">{t.settings.useAssistant}</div>
            <div className="setting-desc">{status.enabled ? t.settings.on : t.settings.off}</div>
          </div>
          <button
            className="toggle"
            role="switch"
            aria-checked={status.enabled}
            aria-label={t.settings.useAssistant}
            disabled={working}
            onClick={() => void act(() => assistant.setEnabled(!status.enabled))}
          />
        </div>

        <h2 style={{ marginTop: 26 }}>{t.settings.writingModel}</h2>
        <p className="settings-lede">{t.settings.writingModelLede}</p>
        {general.map((model) => (
          <ModelCard
            key={model.id}
            model={model}
            chosen={status.model === model.id}
            onChoose={() => void act(() => assistant.setModel(model.id))}
            working={working}
            act={act}
          />
        ))}

        <h2 style={{ marginTop: 26 }}>{t.settings.translationModel}</h2>
        <p className="settings-lede">
          {status.appleTranslation ? t.settings.translationLedeMac : t.settings.translationModelLede}
        </p>
        <div className="setting">
          <div className="setting-text">
            <div className="setting-name">{t.settings.translateWith}</div>
          </div>
          <select
            value={status.translationBackend === "apple" ? "apple" : status.translationModel ?? ""}
            onChange={(e) =>
              void act(async () => {
                if (e.target.value === "apple") {
                  await assistant.setTranslationBackend("apple");
                  return;
                }
                await assistant.setTranslationModel(e.target.value || null);
                await assistant.setTranslationBackend("model");
              })
            }
            aria-label={t.settings.translateWith}
            disabled={working}
          >
            {status.appleTranslation && <option value="apple">{t.settings.appleTranslation}</option>}
            <option value="">{t.settings.theWritingModel}</option>
            {translators.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.state !== "ready" ? ` (${t.settings.notDownloaded})` : ""}
              </option>
            ))}
          </select>
        </div>
        {translators.map((model) => (
          <ModelCard
            key={model.id}
            model={model}
            chosen={status.translationModel === model.id}
            working={working}
            act={act}
          />
        ))}

        <div className="setting" style={{ marginTop: 10 }}>
          <div className="setting-text">
            <div className="setting-name">{t.settings.translateInto}</div>
            <div className="setting-desc">{t.settings.translateIntoDesc}</div>
          </div>
          <select
            value={assistant.language}
            onChange={(e) => assistant.setLanguage(e.target.value)}
            aria-label={t.settings.translateInto}
          >
            {LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {t.languages[language] ?? language}
              </option>
            ))}
          </select>
        </div>

        <h2 style={{ marginTop: 26 }}>{t.settings.features}</h2>
        <p className="settings-lede">{t.settings.featuresLede}</p>
        {FEATURES.map((key) => (
          <div key={key} className={status.features[key] ? "setting" : "setting off"}>
            <div className="setting-text">
              <div className="setting-name">{t.settings.feature[key].name}</div>
              <div className="setting-desc">{t.settings.feature[key].desc}</div>
            </div>
            <button
              className="toggle"
              role="switch"
              aria-checked={status.features[key]}
              aria-label={t.settings.feature[key].name}
              disabled={working}
              onClick={() => toggleFeature(key)}
            />
          </div>
        ))}
      </section>

      <CategorySettings />
        </>
      )}
    </div>
  );
}

/** Theme and text size: how the app looks before it is about mail at all. */
function Appearance() {
  const t = useT();
  const { choice, setChoice, textSize, setTextSize } = useAppearance();

  return (
    <section className="settings-section">
      <h2>{t.settings.appearance}</h2>
      <p className="settings-lede">{t.settings.appearanceLede}</p>

      <div className="theme-grid">
        <ThemeCard
          id="system"
          name={t.settings.system}
          swatch={["#8b857b", "#d8d5cf", "#f1efe9"]}
          accent="#5a8f7b"
          chosen={choice === "system"}
          onChoose={setChoice}
        />
        {THEMES.map((theme) => (
          <ThemeCard
            key={theme.id}
            id={theme.id}
            name={t.settings.theme[theme.id]}
            swatch={theme.swatch}
            accent={theme.accent}
            chosen={choice === theme.id}
            onChoose={setChoice}
          />
        ))}
      </div>

      <div className="setting" style={{ marginTop: 18 }}>
        <div className="setting-text">
          <div className="setting-name">{t.settings.textSize}</div>
          <div className="setting-desc">{t.settings.textSizeDesc}</div>
        </div>
        <div className="text-sizes">
          {TEXT_SIZES.map((size) => (
            <button
              key={size}
              className="chip"
              aria-pressed={textSize === size}
              onClick={() => setTextSize(size)}
            >
              {t.settings.size[size]}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function ThemeCard({
  id,
  name,
  swatch,
  accent,
  chosen,
  onChoose,
}: {
  id: ThemeChoice;
  name: string;
  swatch: [string, string, string] | string[];
  accent: string;
  chosen: boolean;
  onChoose: (id: ThemeChoice) => void;
}) {
  return (
    <button className="theme-card" aria-pressed={chosen} onClick={() => onChoose(id)}>
      {/* The bands are the rail, the list and the reader, so the miniature reads as the
        * app rather than as three arbitrary colours. */}
      <span className="theme-swatch" aria-hidden="true">
        <i style={{ background: swatch[0] }} />
        <i style={{ background: swatch[1] }} />
        <i style={{ background: swatch[2], ["--line-colour" as string]: accent } as CSSProperties} />
      </span>
      <span className="theme-name">{name}</span>
    </button>
  );
}

/**
 * Managing the categories mail is sorted into.
 *
 * Editing in place rather than behind a dialog: the description is the part that matters
 * and the part people skip, so it is on screen next to the name rather than one click away.
 */
function CategorySettings() {
  const t = useT();
  const categories = useCategories();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const autoSorted = categories.all.filter((c) => c.autoSort);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await categories.create(name, description, true);
      setName("");
      setDescription("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section">
      <h2>{t.category.manage}</h2>
      <p className="settings-lede">{t.category.manageLede}</p>
      <p className="settings-lede subtle">{t.category.descriptionNote}</p>

      {categories.all.map((category) => (
        <CategoryRow key={category.slug} category={category} />
      ))}

      {autoSorted.length > backend.MAX_AUTO_SORTED && (
        <p className="settings-warn">{t.category.tooMany(backend.MAX_AUTO_SORTED)}</p>
      )}

      <div className="cat-new">
        <input
          value={name}
          placeholder={t.category.newName}
          aria-label={t.category.newName}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          value={description}
          placeholder={t.category.newDescription}
          aria-label={t.category.newDescription}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button className="chip primary" disabled={busy || !name.trim()} onClick={() => void add()}>
          {t.category.add}
        </button>
      </div>

      {categories.error && <p className="rail-note error">{categories.error}</p>}

      <div className="setting" style={{ marginTop: 14 }}>
        <div className="setting-text">
          <div className="setting-name">{t.category.resort}</div>
          <div className="setting-desc">{t.category.resortLede}</div>
        </div>
        <button
          className="chip"
          onClick={() => void backend.resortMailbox().then(() => categories.reload())}
        >
          {t.category.resort}
        </button>
      </div>
    </section>
  );
}

/** One category: its name, what the assistant is told about it, and whether it may. */
function CategoryRow({ category }: { category: MailCategory }) {
  const t = useT();
  const categories = useCategories();
  // Built-ins start from what is on screen, not from the English in the database: editing
  // a field should begin at the text you were reading.
  const [name, setName] = useState(() => categories.nameOf(category.slug));
  const [description, setDescription] = useState(() => categories.describe(category));

  const dirty =
    name !== categories.nameOf(category.slug) || description !== categories.describe(category);

  return (
    <div className="cat-row">
      <div className="cat-row-head">
        <input
          className="cat-name"
          value={name}
          aria-label={t.category.newName}
          onChange={(e) => setName(e.target.value)}
        />
        {category.isBuiltin && <span className="cat-builtin">{t.category.builtin}</span>}
      </div>

      <input
        className="cat-desc"
        value={description}
        placeholder={t.category.newDescription}
        title={category.isBuiltin && !category.edited ? t.category.descriptionNote : undefined}
        aria-label={t.category.newDescription}
        onChange={(e) => setDescription(e.target.value)}
      />

      <div className="cat-row-tools">
        <label className="cat-auto">
          <input
            type="checkbox"
            checked={category.autoSort}
            onChange={(e) =>
              void categories.update(category.slug, name, description, e.target.checked)
            }
          />
          {category.autoSort ? t.category.autoSort : t.category.manualOnly}
        </label>

        <span className="spacer" />

        {dirty && (
          <button
            className="chip primary"
            onClick={() =>
              void categories.update(category.slug, name, description, category.autoSort)
            }
          >
            {t.category.save}
          </button>
        )}
        <button
          className="chip danger"
          title={t.category.removeWarning}
          onClick={() => void categories.remove(category.slug)}
        >
          {t.category.remove}
        </button>
      </div>
    </div>
  );
}

/** One model: what it is, where its file is, and the one action that applies right now. */
function ModelCard({
  model,
  chosen,
  onChoose,
  working,
  act,
}: {
  model: AssistantModel;
  chosen: boolean;
  onChoose?: () => void;
  working: boolean;
  act: (fn: () => Promise<void>) => Promise<void>;
}) {
  const assistant = useAssistant();
  const t = useT();
  const m = t.settings.model;
  const speed = assistant.speed[model.id];
  const fraction = model.sizeBytes > 0 ? model.downloadedBytes / model.sizeBytes : 0;
  const eta =
    speed && speed > 0 && model.state === "downloading"
      ? Math.round((model.sizeBytes - model.downloadedBytes) / speed)
      : null;
  const loaded = assistant.status.loaded === model.id;

  const stateLine = (() => {
    switch (model.state) {
      case "missing":
        return m.missing;
      case "downloading":
        return [
          m.downloading(fileSize(model.downloadedBytes), fileSize(model.sizeBytes)),
          speed ? m.perSecond(fileSize(speed)) : null,
          eta !== null ? m.left(describeSeconds(t.settings.model, eta)) : null,
        ]
          .filter(Boolean)
          .join(" · ");
      case "paused":
        return m.paused(fileSize(model.downloadedBytes), fileSize(model.sizeBytes));
      case "ready":
        return loaded ? m.loaded : m.ready;
      case "error":
        return model.error ?? m.error;
    }
  })();

  return (
    <div className={chosen ? "model-card chosen" : "model-card"}>
      <div className="model-head">
        <span className="model-name">
          {model.name}
          {chosen && <span className="model-chosen">{m.inUse}</span>}
        </span>
        <span className="model-meta">
          {fileSize(model.sizeBytes)} · {model.licence}
        </span>
      </div>
      <p className="model-blurb">{m.blurbs[model.id] ?? model.blurb}</p>

      <div className={model.state === "error" ? "model-state error" : "model-state"}>{stateLine}</div>

      {(model.state === "downloading" || model.state === "paused") && (
        <div className="model-bar" aria-hidden="true">
          <span style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
      )}

      <div className="model-actions">
        {onChoose && !chosen && model.state === "ready" && (
          <button className="chip primary" disabled={working} onClick={onChoose}>
            {m.useThis}
          </button>
        )}
        {(model.state === "missing" || model.state === "error") && (
          <button className="chip primary" disabled={working} onClick={() => void act(() => assistant.download.start(model.id))}>
            {m.download(fileSize(model.sizeBytes))}
          </button>
        )}
        {model.state === "paused" && (
          <>
            <button className="chip primary" disabled={working} onClick={() => void act(() => assistant.download.start(model.id))}>
              {m.resume}
            </button>
            <button className="chip danger" disabled={working} onClick={() => void act(() => assistant.download.cancel(model.id))}>
              {m.cancelDelete}
            </button>
          </>
        )}
        {model.state === "downloading" && (
          <>
            <button className="chip" disabled={working} onClick={() => void act(() => assistant.download.pause(model.id))}>
              {m.pause}
            </button>
            <button className="chip danger" disabled={working} onClick={() => void act(() => assistant.download.cancel(model.id))}>
              {m.cancel}
            </button>
          </>
        )}
        {model.state === "ready" && (
          <button className="chip danger" disabled={working} onClick={() => void act(() => assistant.removeModel(model.id))}>
            {m.remove}
          </button>
        )}
      </div>
    </div>
  );
}

function describeSeconds(m: { seconds: (n: number) => string; minutes: (n: number) => string; hours: (n: number) => string }, seconds: number): string {
  if (seconds < 60) return m.seconds(seconds);
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return m.minutes(minutes);
  return m.hours(Math.round(minutes / 60));
}
