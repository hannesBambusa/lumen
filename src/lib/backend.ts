import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { Content, Message, Person, Thing } from "../types";
import {
  bodies as fixtureBodies,
  messages as fixtureMessages,
  people as fixturePeople,
  things as fixtureThings,
} from "../fixtures";

export interface Mailbox {
  /** The signed-in address, or null when nobody has connected an account yet. */
  account: string | null;
  people: Person[];
  messages: Message[];
  things: Thing[];
}

export interface SyncReport {
  fetched: number;
  stored: number;
  /** The run stopped early. What was stored is kept, so syncing again continues from there. */
  partial: boolean;
  stoppedBecause?: string;
}

/**
 * True when running inside the desktop app rather than a plain browser tab.
 *
 * `pnpm dev` serves the same frontend over HTTP for design work, where there is no Rust
 * side to call. Rather than fail there, the app falls back to the fixture mailbox, so the
 * interface stays workable without signing anything in.
 */
export function inApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const FIXTURE_MAILBOX: Mailbox = {
  account: "fixtures@example.com",
  people: fixturePeople,
  messages: fixtureMessages,
  things: fixtureThings,
};

export async function currentAccount(): Promise<string | null> {
  if (!inApp()) return FIXTURE_MAILBOX.account;
  return invoke<string | null>("current_account");
}

export async function connectAccount(): Promise<string> {
  if (!inApp()) throw new Error("Signing in only works in the desktop app.");
  return invoke<string>("connect_account");
}

export async function loadMailbox(): Promise<Mailbox> {
  if (!inApp()) return FIXTURE_MAILBOX;
  return invoke<Mailbox>("load_mailbox");
}

/**
 * How far back a sync reaches, in days. `0` means everything.
 *
 * Kept here rather than in the backend so the choice is visible in Settings and travels
 * with every sync, automatic ones included.
 */
export const SYNC_WINDOWS = [30, 60, 180, 365, 0] as const;

const WINDOW_KEY = "lumen.syncDays";

export function syncWindow(): number {
  try {
    const raw = Number(localStorage.getItem(WINDOW_KEY));
    return SYNC_WINDOWS.includes(raw as (typeof SYNC_WINDOWS)[number]) ? raw : 60;
  } catch {
    return 60;
  }
}

export function setSyncWindow(days: number): void {
  try {
    localStorage.setItem(WINDOW_KEY, String(days));
  } catch {
    // A preference is not worth failing over.
  }
}

/**
 * Each message as it is stored, during a sync.
 *
 * A first sync runs for minutes. Without this the window has nothing to say for all of it,
 * which is indistinguishable from a hung app even though mail is landing the whole time.
 */
export async function onSyncProgress(
  handler: (stored: number, total: number) => void,
): Promise<() => void> {
  if (!inApp()) return () => {};
  const stop = await listen<[number, number]>("sync-progress", (e) =>
    handler(e.payload[0], e.payload[1]),
  );
  return () => stop();
}

export async function syncNow(): Promise<SyncReport> {
  if (!inApp()) return { fetched: 0, stored: 0, partial: false };
  return invoke<SyncReport>("sync_now", { days: syncWindow() });
}

/**
 * The sender's own rendering of one message, for "show original".
 *
 * Fetched on demand rather than shipped with every message: full mail HTML is tens of
 * kilobytes each and almost none of it is ever looked at.
 */
/**
 * Fixture content for the browser preview, where there is no database to parse.
 *
 * The fixtures carry their text on the message itself, so this hands it straight back.
 */
function fixtureContents(messageIds: string[]): Content[] {
  return messageIds.map((id) => ({ id, body: fixtureBodies.get(id) ?? "" }));
}

/** The readable content of one conversation's messages. See `Content`. */
export async function threadContents(messageIds: string[]): Promise<Content[]> {
  if (!inApp()) return fixtureContents(messageIds);
  return invoke<Content[]>("thread_contents", { messageIds });
}

export async function originalHtml(messageId: string): Promise<string | null> {
  if (!inApp()) return null;
  return invoke<string | null>("original_html", { messageId });
}

// ---------- on-device assistant ----------

export interface AssistantFeatures {
  translate: boolean;
  proofread: boolean;
  improve: boolean;
  summarize: boolean;
}

export type ModelState = "missing" | "downloading" | "paused" | "ready" | "error";

export interface AssistantModel {
  id: string;
  name: string;
  blurb: string;
  sizeBytes: number;
  family: "qwen" | "translategemma";
  role: "general" | "translation";
  licence: string;
  state: ModelState;
  downloadedBytes: number;
  error?: string;
}

export interface AssistantStatus {
  enabled: boolean;
  features: AssistantFeatures;
  /** Id of the general model used for writing tools. */
  model: string;
  /** Id of a translation specialist used for Translate, if chosen. */
  translationModel?: string;
  /** What performs a translation. */
  translationBackend: "model" | "apple";
  /** Whether this computer has a built-in translator to offer. macOS only. */
  appleTranslation: boolean;
  models: AssistantModel[];
  /** Id of the model currently in memory, if any. */
  loaded?: string;
}

export type AssistantTask =
  | { kind: "translate"; text: string; target: string }
  | { kind: "proofread"; text: string }
  | { kind: "improve"; text: string }
  | { kind: "summarize"; text: string; language: string };

const OFF: AssistantStatus = {
  enabled: false,
  features: { translate: true, proofread: true, improve: true, summarize: true },
  model: "qwen3-1.7b",
  translationBackend: "model",
  appleTranslation: false,
  models: [
    { id: "qwen3-1.7b", name: "Qwen3 1.7B", blurb: "Small.", sizeBytes: 1_107_409_472, family: "qwen", role: "general", licence: "Apache 2.0", state: "missing", downloadedBytes: 0 },
    { id: "qwen3-4b", name: "Qwen3 4B", blurb: "Better.", sizeBytes: 2_497_281_312, family: "qwen", role: "general", licence: "Apache 2.0", state: "missing", downloadedBytes: 0 },
    { id: "translategemma-4b", name: "TranslateGemma 4B", blurb: "Translation only.", sizeBytes: 2_489_909_760, family: "translategemma", role: "translation", licence: "Gemma Terms of Use", state: "missing", downloadedBytes: 0 },
  ],
};

export async function assistantStatus(): Promise<AssistantStatus> {
  if (!inApp()) return OFF;
  return invoke<AssistantStatus>("assistant_status");
}

export async function assistantSetEnabled(enabled: boolean): Promise<AssistantStatus> {
  if (!inApp()) return { ...OFF, enabled };
  return invoke<AssistantStatus>("assistant_set_enabled", { enabled });
}

export async function assistantSetFeatures(features: AssistantFeatures): Promise<AssistantStatus> {
  if (!inApp()) return { ...OFF, features };
  return invoke<AssistantStatus>("assistant_set_features", { features });
}

export async function assistantSetModel(modelId: string): Promise<AssistantStatus> {
  if (!inApp()) return { ...OFF, model: modelId };
  return invoke<AssistantStatus>("assistant_set_model", { modelId });
}

export async function assistantSetTranslationModel(modelId: string | null): Promise<AssistantStatus> {
  if (!inApp()) return { ...OFF, translationModel: modelId ?? undefined };
  return invoke<AssistantStatus>("assistant_set_translation_model", { modelId });
}

/** Past this the model starts confusing categories with each other. Mirrors the Rust side. */
export const MAX_AUTO_SORTED = 10;

export interface StoredSummary {
  summary: string;
  /** How many messages it was made from. */
  messageCount: number;
  /** When it was made, as a Unix timestamp in seconds. */
  createdAt: number;
  /** True when messages have arrived since, so it describes an older conversation. */
  stale: boolean;
}

interface SummaryKey {
  threadKey: string;
  language: string;
  messageCount: number;
  newestAt: string;
}

export async function threadSummary(key: SummaryKey): Promise<StoredSummary | null> {
  if (!inApp()) return null;
  return invoke<StoredSummary | null>("thread_summary", { ...key });
}

export async function saveThreadSummary(
  saved: SummaryKey & { summary: string },
): Promise<void> {
  if (!inApp()) return;
  await invoke("save_thread_summary", { ...saved });
}

export interface MailCategory {
  slug: string;
  /** The English name. Built-ins are translated by slug; a custom one is shown as typed. */
  name: string;
  /** What the assistant is told, and therefore what it sorts by. */
  description: string;
  isBuiltin: boolean;
  autoSort: boolean;
  /** Whether you have reworded it. An untouched built-in is shown translated. */
  edited: boolean;
  position: number;
}

/** The seeded six, for the browser preview where there is no database to ask. */
const FIXTURE_CATEGORIES: MailCategory[] = [
  ["reply", "Needs a reply", "a person is asking me for something, or expects an answer from me"],
  ["fyi", "For information", "a person wrote to me, but nothing is being asked of me"],
  ["meeting", "Meetings", "a meeting invitation, or arranging a time"],
  ["invoice", "Invoices", "an invoice, a receipt, a payment or an order confirmation"],
  ["automated", "Notifications", "an automatic notification from a system or service"],
  ["newsletter", "Newsletters", "marketing, campaigns, product news sent to many people"],
].map(([slug, name, description], position) => ({
  slug,
  name,
  description,
  isBuiltin: true,
  autoSort: true,
  edited: false,
  position,
}));

export async function listCategories(): Promise<MailCategory[]> {
  if (!inApp()) return FIXTURE_CATEGORIES;
  return invoke<MailCategory[]>("list_categories");
}

export async function createCategory(
  name: string,
  description: string,
  autoSort: boolean,
): Promise<MailCategory[]> {
  if (!inApp()) return [];
  return invoke<MailCategory[]>("create_category", { name, description, autoSort });
}

export async function updateCategory(
  slug: string,
  name: string,
  description: string,
  autoSort: boolean,
): Promise<MailCategory[]> {
  if (!inApp()) return [];
  return invoke<MailCategory[]>("update_category", { slug, name, description, autoSort });
}

export async function deleteCategory(slug: string): Promise<MailCategory[]> {
  if (!inApp()) return [];
  return invoke<MailCategory[]>("delete_category", { slug });
}

/** Put messages in a category by hand. `null` clears it. */
export async function setMessageCategory(
  messageIds: string[],
  slug: string | null,
): Promise<number> {
  if (!inApp()) return 0;
  return invoke<number>("set_message_category", { messageIds, slug });
}

/** Forget what the rules and the model decided. What you set by hand is kept. */
export async function resortMailbox(): Promise<number> {
  if (!inApp()) return 0;
  return invoke<number>("resort_mailbox");
}

export interface CategorizeReport {
  /** Sorted in this batch. */
  sorted: number;
  /** Considered in this batch. Fewer than `sorted` means some were left for a retry. */
  lookedAt: number;
  /** Sorted in the whole mailbox. */
  done: number;
  total: number;
}

/** Sort one batch of messages. Called repeatedly while there is more to do. */
export async function categorizeBatch(limit?: number): Promise<CategorizeReport> {
  if (!inApp()) return { sorted: 0, lookedAt: 0, done: 0, total: 0 };
  return invoke<CategorizeReport>("categorize_batch", { limit });
}

export async function categorizeProgress(): Promise<CategorizeReport> {
  if (!inApp()) return { sorted: 0, lookedAt: 0, done: 0, total: 0 };
  return invoke<CategorizeReport>("categorize_progress");
}

export async function assistantSetTranslationBackend(
  backend: "model" | "apple",
): Promise<AssistantStatus> {
  if (!inApp()) return { ...OFF, translationBackend: backend };
  return invoke<AssistantStatus>("assistant_set_translation_backend", { backend });
}

export async function assistantDownloadStart(modelId: string): Promise<AssistantStatus> {
  if (!inApp()) throw new Error("Downloads only work in the desktop app.");
  return invoke<AssistantStatus>("assistant_download_start", { modelId });
}

export async function assistantDownloadPause(modelId: string): Promise<void> {
  if (!inApp()) return;
  await invoke("assistant_download_pause", { modelId });
}

export async function assistantDownloadCancel(modelId: string): Promise<void> {
  if (!inApp()) return;
  await invoke("assistant_download_cancel", { modelId });
}

export async function assistantRemoveModel(modelId: string): Promise<AssistantStatus> {
  if (!inApp()) return OFF;
  return invoke<AssistantStatus>("assistant_remove_model", { modelId });
}

/**
 * Run a task, calling `onToken` with each piece as the model produces it.
 *
 * Streaming matters more here than anywhere else in the app: on the target laptop a
 * paragraph takes tens of seconds, and watching words arrive is the difference between
 * "working" and "broken".
 */
export async function assistantRun(
  task: AssistantTask,
  onToken: (piece: string) => void,
): Promise<string> {
  if (!inApp()) throw new Error("The assistant only runs in the desktop app.");

  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const stop = await listen<[string, string]>("assistant-token", (event) => {
    const [id, piece] = event.payload;
    if (id === jobId) onToken(piece);
  });
  try {
    return await invoke<string>("assistant_run", { jobId, task });
  } finally {
    stop();
  }
}

/** Subscribe to download progress and readiness changes. Returns an unsubscribe. */
export async function onAssistantEvents(handlers: {
  progress: (modelId: string, done: number, total: number) => void;
  changed: () => void;
}): Promise<() => void> {
  if (!inApp()) return () => {};
  const a = await listen<[string, number, number]>("assistant-progress", (e) =>
    handlers.progress(e.payload[0], e.payload[1], e.payload[2]),
  );
  const b = await listen<boolean>("assistant-changed", () => handlers.changed());
  return () => {
    a();
    b();
  };
}

/** Mark messages read, locally and on Gmail. No-op in the browser preview. */
export async function markRead(messageIds: string[]): Promise<void> {
  if (!inApp() || messageIds.length === 0) return;
  await invoke("mark_read", { messageIds });
}

export async function signOut(): Promise<void> {
  if (!inApp()) return;
  await invoke("sign_out");
}
