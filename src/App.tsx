import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";

import "./styles.css";

import type { FolderId, Message, MessageId, Person, PersonId, Thing } from "./types";
import {
  ArchiveIcon,
  DraftIcon,
  FilesIcon,
  InboxIcon,
  PeopleIcon,
  SentIcon,
  TrashIcon,
} from "./components/Icon";
import * as backend from "./lib/backend";
import { usePaneWidth } from "./lib/panes";
import { localeTag, useT } from "./lib/i18n";
import { useCategorize } from "./lib/categorize";
import { CategoriesProvider } from "./lib/categories";
import type { Strings } from "./lib/i18n";
import Resizer from "./components/Resizer";
import AssistantToggle from "./components/AssistantToggle";
import SettingsView from "./views/SettingsView";
import type { SettingsTab } from "./views/SettingsView";
import Boot from "./components/Boot";
import { SettingsIcon } from "./components/Icon";
import ClassicView from "./views/ClassicView";
import ConnectView from "./views/ConnectView";
import MessageView from "./views/MessageView";
import PeopleList from "./views/PeopleList";
import PersonMailList from "./views/PersonMailList";
import ThingsView from "./views/ThingsView";

/**
 * Two readings of one mailbox.
 *
 * Mail is the default: folders, threads, subject lines, reading pane. People scopes the
 * mailbox to one person: pick someone, get their files and every message they sent, pick a
 * message, read it. Files is reachable from either and takes over the right-hand panes.
 */
type Mode = "mail" | "people";

const MODE_KEY = "lumen.mode";

/** How often to check for new mail while the window is open. */
const POLL_MS = 2 * 60 * 1000;

/**
 * How long the window is left alone before the first automatic check.
 *
 * The local mailbox is already on screen by then, so the delay costs nothing and keeps the
 * launch from stalling behind a network round trip.
 */
const FIRST_CHECK_MS = 1500;

/**
 * How many silent failures in a row before the interface says something.
 *
 * At one check every two minutes this is about ten minutes of nothing arriving, which is
 * long enough to rule out a passing network blip and short enough to notice the same day.
 */
const QUIET_FAILURES_BEFORE_SPEAKING = 5;

/** Returning to the window checks again, but not if it was checked moments ago. */
const REFOCUS_MIN_AGE_MS = 60 * 1000;

const FOLDERS: Array<{ id: FolderId; icon: () => ReactElement }> = [
  { id: "inbox", icon: InboxIcon },
  { id: "sent", icon: SentIcon },
  { id: "drafts", icon: DraftIcon },
  { id: "archive", icon: ArchiveIcon },
  { id: "trash", icon: TrashIcon },
];

export default function App() {
  const t = useT();
  const [mode, setMode] = useState<Mode>(() => {
    // Wrapped: localStorage throws outright in some embedded contexts rather than
    // returning null, and a mail client should not fail to open over a preference.
    try {
      return localStorage.getItem(MODE_KEY) === "people" ? "people" : "mail";
    } catch {
      return "mail";
    }
  });

  const [folder, setFolder] = useState<FolderId>("inbox");
  const [person, setPerson] = useState<PersonId | null>(null);
  const [message, setMessage] = useState<MessageId | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");

  const [account, setAccount] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [things, setThings] = useState<Thing[]>([]);

  const rail = usePaneWidth("rail");
  const list = usePaneWidth("list");
  const mid = usePaneWidth("mid");

  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A ref, not state: two syncs must never overlap, and the guard has to be readable
  // synchronously rather than after a render.
  const syncing = useRef(false);

  // Background checks keep quiet about failures, because a dropped connection is the normal
  // case and a red line about it every two minutes is noise. Something that fails every time
  // is different: an expired sign-in went unnoticed for a whole night that way. After a few
  // in a row it stops being quiet.
  const quietFailures = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // A preference is not worth surfacing an error for.
    }
  }, [mode]);

  const refresh = useCallback(async () => {
    const mailbox = await backend.loadMailbox();
    setAccount(mailbox.account);
    setPeople(mailbox.people);
    setMessages(mailbox.messages);
    setThings(mailbox.things);
    return mailbox;
  }, []);

  // Startup reads the local database only. No network, so the window is usable immediately
  // and works with no connection at all.
  useEffect(() => {
    refresh()
      .catch((e) => setError(String(e)))
      .finally(() => setBooting(false));
  }, [refresh]);

  /**
   * Check for new mail.
   *
   * `quiet` is for the automatic checks: they update the mailbox and the "checked" time but
   * do not narrate themselves, and they keep failures out of the way. A background poll that
   * shouts about a dropped connection is worse than one that says nothing.
   */
  const sync = useCallback(
    async (quiet = false) => {
      if (syncing.current) return;
      syncing.current = true;

      if (quiet) setChecking(true);
      else {
        setBusy(true);
        setError(null);
        setStatus(t.app.fetching);
      }

      try {
        const report = await backend.syncNow();
        if (!quiet) setStatus(describeSync(t, report));
        else if (report.stored > 0) setStatus(describeSync(t, report));
        setLastChecked(new Date());
        quietFailures.current = 0;
        await refresh();
      } catch (e) {
        if (!quiet) {
          setError(String(e));
          setStatus(null);
        } else {
          // Offline for a moment is not worth a red line. Failing every time for ten minutes
          // is, because nothing is arriving and nothing has said so.
          quietFailures.current += 1;
          if (quietFailures.current >= QUIET_FAILURES_BEFORE_SPEAKING) {
            setError(String(e));
          }
        }
      } finally {
        syncing.current = false;
        setBusy(false);
        setChecking(false);
      }
    },
    [refresh, t],
  );

  const connect = useCallback(async () => {
    setBusy(true);
    setError(null);
    setStatus(t.app.approve);
    try {
      const email = await backend.connectAccount();
      setAccount(email);
      setStatus(t.app.connected);
      const report = await backend.syncNow();
      setStatus(describeSync(t, report));
      await refresh();
    } catch (e) {
      setError(String(e));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, [refresh, t]);

  // Mirrored into a ref so the focus handler reads the current value without the effect
  // needing to tear down and rebuild every time a check completes.
  const lastCheckedRef = useRef<number | null>(null);
  useEffect(() => {
    lastCheckedRef.current = lastChecked ? lastChecked.getTime() : null;
  }, [lastChecked]);

  // Check on launch, then on a timer, then whenever the window is brought back.
  useEffect(() => {
    if (booting || !account) return;

    const first = setTimeout(() => void sync(true), FIRST_CHECK_MS);
    const timer = setInterval(() => void sync(true), POLL_MS);

    const onFocus = () => {
      const age = lastCheckedRef.current ? Date.now() - lastCheckedRef.current : Infinity;
      if (age > REFOCUS_MIN_AGE_MS) void sync(true);
    };
    window.addEventListener("focus", onFocus);

    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [booting, account, sync]);

  const messagesRef = useRef<Map<string, Message>>(new Map());
  useEffect(() => {
    messagesRef.current = new Map(messages.map((m) => [m.id, m]));
  }, [messages]);

  // Sorting reads the same database the list does, so every batch has to be followed by a
  // reload or the categories only appear on the next restart.
  const sorting = useCategorize(refresh);

  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const thingsById = useMemo(() => new Map(things.map((t) => [t.id, t])), [things]);
  const unreadCount = messages.filter((m) => m.unread).length;

  const selectPerson = (id: PersonId) => {
    setPerson(id);
    setMessage(null);
  };

  /**
   * Opening mail marks it read, the way every mail client does.
   *
   * The local state flips first so the dot and the count change on the same frame as the
   * click; the server is told afterwards. A failure there is logged and otherwise ignored:
   * the user did read it, and a red line about label sync would be worse than a stale label
   * that the next sync settles.
   */
  const markRead = useCallback((ids: string[]) => {
    const unread = ids.filter((id) => messagesRef.current.get(id)?.unread);
    if (unread.length === 0) return;

    setMessages((current) =>
      current.map((m) => (unread.includes(m.id) ? { ...m, unread: false } : m)),
    );
    backend.markRead(unread).catch((e) => console.warn("could not mark read on Gmail:", e));
  }, []);

  const openMessage = (id: MessageId) => {
    setMessage(id);
    markRead([id]);
  };

  /** Settings, on the tab that answers whatever sent you there. */
  const openSettings = (tab: SettingsTab = "general") => {
    setSettingsTab(tab);
    setShowFiles(false);
    setShowSettings(true);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setShowFiles(false);
    setShowSettings(false);
  };

  if (booting) {
    return <Boot label={t.app.opening} />;
  }

  if (!account) {
    return <ConnectView onConnect={connect} busy={busy} status={status} error={error} />;
  }

  // Files takes over the right-hand panes, People adds a fourth column once someone is
  // selected. The widths are the user's, so the template is built rather than declared.
  // Files and Settings both take over the right-hand panes.
  const panel = showSettings || showFiles;
  const fourColumn = mode === "people" && Boolean(person) && !panel;
  const columns = panel
    ? `${rail.width}px 1fr`
    : fourColumn
      ? `${rail.width}px ${mid.width}px ${list.width}px 1fr`
      : `${rail.width}px ${list.width}px 1fr`;

  return (
    <CategoriesProvider onChanged={refresh}>
    <div className="app" style={{ gridTemplateColumns: columns }}>
      <nav className="rail" aria-label={t.app.sections}>
        <div className="brand" title={t.app.brandTitle}>
          Lumen
        </div>

        <div className="switch" role="tablist" aria-label={t.app.view}>
          <button
            role="tab"
            aria-selected={mode === "mail"}
            className="switch-btn"
            onClick={() => switchMode("mail")}
          >
            {t.app.mail}
          </button>
          <button
            role="tab"
            aria-selected={mode === "people"}
            className="switch-btn"
            onClick={() => switchMode("people")}
          >
            {t.app.people}
          </button>
        </div>

        {mode === "mail" ? (
          FOLDERS.map((f) => (
            <RailButton
              key={f.id}
              label={t.app.folders[f.id]}
              icon={f.icon}
              count={f.id === "inbox" ? unreadCount : undefined}
              active={!panel && folder === f.id}
              onClick={() => {
                setShowFiles(false);
                setShowSettings(false);
                setFolder(f.id);
              }}
            />
          ))
        ) : (
          <RailButton
            label={t.app.people}
            icon={PeopleIcon}
            active={!panel}
            onClick={() => {
              setShowFiles(false);
              setShowSettings(false);
            }}
          />
        )}

        <div className="rail-gap" />

        <RailButton
          label={t.app.files}
          icon={FilesIcon}
          active={showFiles}
          onClick={() => {
            setShowSettings(false);
            setShowFiles(true);
          }}
        />
        <RailButton
          label={t.app.settings}
          icon={SettingsIcon}
          active={showSettings}
          onClick={() => openSettings("general")}
        />

        <div className="rail-foot">
          <div className="rail-account" title={account}>
            {account}
          </div>

          <AssistantToggle onOpenSettings={() => openSettings("ai")} />

          <button className="rail-sync" onClick={() => void sync()} disabled={busy || checking}>
            {busy || checking ? t.app.checking : t.app.syncNow}
          </button>
          {lastChecked && !busy && (
            <div className="rail-note">{t.app.checkedAt(clockTime(lastChecked))}</div>
          )}
          <button className="rail-relink" onClick={() => void connect()} disabled={busy}>
            {t.app.signInAgain}
          </button>
          {status && <div className="rail-note">{status}</div>}
          {error && <div className="rail-note error">{error}</div>}
        </div>
      </nav>

      <Resizer
        x={rail.width}
        width={rail.width}
        onChange={rail.setWidth}
        onReset={rail.reset}
        min={rail.min}
        max={rail.max}
        label={t.app.resizeSidebar}
      />

      {!panel && (
        <Resizer
          x={rail.width + (fourColumn ? mid.width : list.width)}
          width={fourColumn ? mid.width : list.width}
          onChange={fourColumn ? mid.setWidth : list.setWidth}
          onReset={fourColumn ? mid.reset : list.reset}
          min={fourColumn ? mid.min : list.min}
          max={fourColumn ? mid.max : list.max}
          label={t.app.resizeList}
        />
      )}

      {fourColumn && (
        <Resizer
          x={rail.width + mid.width + list.width}
          width={list.width}
          onChange={list.setWidth}
          onReset={list.reset}
          min={list.min}
          max={list.max}
          label={t.app.resizeMessageList}
        />
      )}

      {showSettings ? (
        <main className="main">
          <SettingsView tab={settingsTab} />
        </main>
      ) : showFiles ? (
        <main className="main">
          <ThingsView things={things} people={peopleById} />
        </main>
      ) : mode === "mail" ? (
        <ClassicView
          messages={messages}
          people={peopleById}
          things={thingsById}
          folder={folder}
          onOpenThread={markRead}
          sorting={sorting}
          onOpenAiSettings={() => openSettings("ai")}
        />
      ) : (
        <>
          <PeopleList
            people={people}
            messages={messages}
            selected={person}
            onSelect={selectPerson}
          />

          {person ? (
            <>
              <PersonMailList
                person={peopleById.get(person)!}
                messages={messages.filter((m) => m.personId === person && !m.isDraft)}
                things={thingsById}
                selected={message}
                onSelect={openMessage}
              />
              <section className="reader" aria-label={t.app.message}>
                {message ? (
                  <MessageView
                    message={messages.find((m) => m.id === message)!}
                    person={peopleById.get(person)!}
                    things={thingsById}
                  />
                ) : (
                  <p className="empty">{t.app.selectMessage}</p>
                )}
              </section>
            </>
          ) : (
            <section className="reader" aria-label={t.app.message}>
              <p className="empty">{t.app.selectSomeone}</p>
            </section>
          )}
        </>
      )}
    </div>
    </CategoriesProvider>
  );
}

function clockTime(at: Date): string {
  return at.toLocaleTimeString(localeTag(), { hour: "2-digit", minute: "2-digit" });
}

/** Plain words for what a sync did, including when it stopped short. */
function describeSync(t: Strings, report: backend.SyncReport): string {
  if (report.partial) {
    return `${t.app.syncPartial(report.stored, report.fetched)} ${report.stoppedBecause ?? ""}`.trim();
  }
  if (report.fetched === 0) {
    return t.app.upToDate;
  }
  return t.app.newMessages(report.stored);
}

function RailButton({
  label,
  icon: Icon,
  count,
  active,
  onClick,
}: {
  label: string;
  icon: () => ReactElement;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className="nav" aria-current={active} onClick={onClick}>
      <span className="nav-icon">
        <Icon />
      </span>
      <span className="nav-label">{label}</span>
      {count !== undefined && count > 0 && <span className="nav-count">{count}</span>}
    </button>
  );
}
