import type { Person, Thing, ThingKind } from "../types";
import { localeTag, strings } from "./i18n";

const DAY = 86_400_000;

/** "2 hours", "3 days", "5 weeks". No "ago": the label around it supplies that. */
export function elapsed(iso: string, from = Date.now()): string {
  const ms = from - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  const t = strings().common;
  if (hours < 1) return t.justNow;
  if (hours < 24) return t.hours(hours);
  const days = Math.floor(ms / DAY);
  if (days < 14) return t.days(days);
  const weeks = Math.floor(days / 7);
  return t.weeks(weeks);
}

/**
 * How loudly an unmet obligation should read.
 *
 * Age alone, on purpose. Anything cleverer (priority, sender importance) is a guess the
 * app would be making on the user's behalf, and a wrong guess is worse than no guess.
 */
export function heat(iso: string, from = Date.now()): "cool" | "warm" | "hot" {
  const days = (from - new Date(iso).getTime()) / DAY;
  if (days >= 7) return "hot";
  if (days >= 2) return "warm";
  return "cool";
}

/** Short, absolute, unambiguous. Used where "3 days" would hide which day it was. */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(localeTag(), {
    day: "numeric",
    month: "short",
  });
}

export function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString(localeTag(), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function initials(person: Person): string {
  return person.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["kB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

const KIND_LABEL: Record<ThingKind, string> = {
  pdf: "PDF",
  sheet: "SHEET",
  image: "IMAGE",
  doc: "DOC",
  archive: "ZIP",
  other: "FILE",
};

export function kindLabel(thing: Thing): string {
  return KIND_LABEL[thing.kind];
}
