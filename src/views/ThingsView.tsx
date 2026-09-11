import { useMemo, useState } from "react";

import type { Person, PersonId, Thing, ThingKind } from "../types";
import { fileSize, kindLabel, shortDate } from "../lib/format";
import { thingFace } from "../lib/color";
import { matches } from "../lib/search";
import { usePreview } from "../components/AttachmentPreview";
import Thumbnail from "../components/Thumbnail";
import { useT } from "../lib/i18n";

interface Props {
  things: Thing[];
  people: Map<PersonId, Person>;
}

const FILTERS: Array<ThingKind | "all"> = ["all", "pdf", "sheet", "image", "doc", "archive"];

/**
 * Every file that ever arrived, across the whole mailbox, browsable without knowing which
 * message carried it. This is the thing no mail client does and the reason the project
 * started.
 */
export default function ThingsView({ things, people }: Props) {
  const t = useT();
  const [filter, setFilter] = useState<ThingKind | "all">("all");
  const [query, setQuery] = useState("");
  const showPreview = usePreview();

  const visible = useMemo(() => {
    return things
      .filter((t) => filter === "all" || t.kind === filter)
      .filter((t) => {
        const person = people.get(t.personId);
        // Name and address both searchable: you remember "asgeir" or you remember the
        // domain, and either should work.
        return matches([t.filename, person?.name, person?.email], query);
      })
      .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
  }, [things, people, filter, query]);

  const groups = useMemo(() => {
    const week = Date.now() - 7 * 86_400_000;
    return [
      { label: t.things.thisWeek, items: visible.filter((t) => new Date(t.receivedAt).getTime() >= week) },
      { label: t.things.earlier, items: visible.filter((t) => new Date(t.receivedAt).getTime() < week) },
    ].filter((g) => g.items.length > 0);
  }, [visible, t]);

  const searching = query.trim().length > 0;

  return (
    <div className="wrap">
      <header className="page-head">
        <h1 className="page-title">{t.things.title}</h1>
        <p className="page-sub">{t.things.sub}</p>
      </header>

      <div className="searchrow">
        <svg
          className="search-icon"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="4.6" />
          <path d="M10.4 10.4 14 14" />
        </svg>
        <input
          className="search"
          type="search"
          value={query}
          placeholder={t.things.searchPlaceholder}
          aria-label={t.things.searchAria}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
        />
        {searching && (
          <button className="search-clear" onClick={() => setQuery("")} aria-label={t.things.clearSearch}>
            {t.things.clear}
          </button>
        )}
      </div>

      <div className="filters">
        {FILTERS.map((f) => (
          <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {t.things.filters[f]}
          </button>
        ))}
      </div>

      {searching && (
        <p className="search-count">
          {t.things.matching(visible.length, query.trim())}
        </p>
      )}

      {groups.length === 0 && (
        <p className="empty">
          {searching ? t.things.nothingMatches(query.trim()) : t.things.noneOfKind}
        </p>
      )}

      {groups.map((group) => (
        <section key={group.label}>
          <h2 className="section-label">{group.label}</h2>
          <div className="grid">
            {group.items.map((thing) => (
              <button
                key={thing.id}
                className="thing"
                onClick={() => showPreview(thing.id, thing.filename)}
                title={thing.filename}
              >
                <Thumbnail
                  attachmentId={thing.id}
                  className="thing-face"
                  style={thingFace(thing.kind)}
                  fallback={kindLabel(thing)}
                />
                <span className="thing-body">
                  <span className="thing-name">{thing.filename}</span>
                  <span className="thing-meta">
                    {people.get(thing.personId)?.name.split(" ")[0] ?? t.common.unknown} ·{" "}
                    {shortDate(thing.receivedAt)} · {fileSize(thing.sizeBytes)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
