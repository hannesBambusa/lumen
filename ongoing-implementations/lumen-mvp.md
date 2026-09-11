# Lumen MVP

| | |
|---|---|
| **Status** | in progress |
| **Branch** | none yet |
| **Updated** | 2026-09-10 |
| **Scope** | Standalone Tauri desktop mail client with two modes over one mailbox: Mail (folders and threads) and People (everything from one person). Provider-neutral core, Gmail adapter first, mail mirrored into local SQLite. |

Phase 0 (core), the UI, and Gmail sign-in and sync are done. The app reads a real mailbox.

**Two modes over one mailbox.** *Mail* is the default: folders, threads, subject lines,
reading pane, nothing surprising. *People* scopes the mailbox to one person: pick someone, get their files and every message
they sent you, pick a message, read it. Mail is three panes, People is four once someone is
selected. Files is reachable from either mode and takes over the right-hand panes.

Same messages underneath either way. The modes are two readings of one mailbox, not two
copies of it, so switching costs nothing and loses nothing.

**The obligation-centric Focus mode is parked**, not deleted. See `src/parked/README.md`.

Name is a placeholder. Lumen is heavily taken (Lumen Technologies, Proton Lumo, Lumen Learning);
settle it with a real trademark search before anything is published.

No server, no account system, no login screen of our own. The only credential is a
per-account OAuth refresh token in the OS keychain, or an IMAP password for providers
without OAuth. All mail data lives on the user's own machine. Ships as a public OAuth
client: `client_id` in the binary, no client secret, PKCE required. That is Google's
documented setup for installed apps.

## Files

**Owned** — exists now:

- `src/types.ts`, `src/fixtures.ts` — UI domain model and the fixture mailbox
- `src/App.tsx` — mode switch, rail, routing
- `src/views/**` — `ClassicView`, `PeopleList`, `PersonMailList`, `ThreadReader`, `ThingsView`
- `src/parked/**` — the Focus home screen, unwired on purpose
- `src/lib/threads.ts` — subject threading and folder derivation
- `src/lib/format.ts` — elapsed time, heat, initials, file sizes
- `src/lib/color.ts` — per-person avatar hues, per-kind file hues
- `src/lib/search.ts` — accent folding and term matching
- `src/lib/quotes.ts` — quoted-history and signature splitting
- `src/lib/panes.ts`, `src/components/Resizer.tsx` — draggable pane widths
- `src/components/HtmlBody.tsx` — sandboxed HTML rendering
- `src-tauri/src/mailbox/html.rs` — HTML to text, and sanitising for the frame
- `src/views/ThreadReader.tsx` — the long-conversation reader
- `src/views/Timeline.tsx` — the stripped conversation overview
- `src/components/Icon.tsx` — the eight rail icons
- `src/styles.css` — design tokens and every component style
- `src-tauri/src/provider/**` — trait and neutral types (2 files)
- `src-tauri/src/auth/**` — OAuth loopback + PKCE, keychain token store
- `src-tauri/src/provider/gmail.rs` — Gmail REST adapter and MIME parsing
- `src-tauri/src/sync/**` — fetch and upsert into SQLite
- `src-tauri/src/assistant/**` — on-device model: settings, resumable download, engine, prompts
- `src/lib/assistant.tsx`, `src/components/AssistantToggle.tsx`, `src/components/WritingPanel.tsx`
- `.github/workflows/release.yml`, `docs/packaging.md` — installers for macOS, Windows and Linux
- `src/lib/theme.tsx` — six palettes, text size, and the root attributes CSS keys off
- `src/components/{Boot,AssistantToggle}.tsx` — the opening animation, and the assistant's state in the sidebar
- `src/lib/i18n.tsx` — interface strings in English, Swedish, Norwegian Bokmål; locale detection and override
- `macos/lumen-translate.swift`, `src-tauri/src/assistant/apple.rs` — the Mac's own translator, and the bridge to it
- `src-tauri/src/categorize/mod.rs`, `src-tauri/migrations/000{2,3}_categor*.sql`, `src/lib/categorize.ts`, `src/lib/categories.tsx` — sorting mail into categories, and the categories themselves
- `scripts/tauri.sh`, `scripts/cargo-sign.sh` — dev builds get a stable code signature so the keychain stops asking
- `src-tauri/src/attachments/**` — fetching, caching and previewing attachments
- `src/components/AttachmentPreview.tsx` — the preview overlay and file pills
- `src-tauri/src/mailbox/**` — database to interface shapes
- `src-tauri/src/commands.rs` — the frontend's whole surface onto the backend
- `src/lib/backend.ts`, `src/views/ConnectView.tsx` — frontend side of the same
- `docs/google-setup.md` — Cloud console steps and scope rationale
- `src-tauri/src/db/**` — connection, migration runner, tests
- `src-tauri/migrations/0001_init.sql` — the schema
- `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`
- the Tauri and Vite scaffold at the root

**Owned** — intended, not created yet:

- `src-tauri/src/provider/imap/**`, `.../graph/**` — the later adapters
- `docs/privacy-policy.md` — needed before verification

**Shared**: none yet.

## Built

**Provider boundary.** `MailProvider` is an async trait covering folders, backfill,
incremental changes, message and attachment fetch, flags, folder changes, send and drafts.
A `Capabilities` struct states per adapter whether the provider has server-side threads,
multi-folder membership, delta sync, usable server search and remote drafts; every one of
those is false for plain IMAP, so callers ask instead of assuming. Ids are opaque newtypes
(`RemoteMessageId`, `RemoteFolderId`, `RemoteAttachmentId`) that only the adapter that
produced them may interpret. `ProviderError::CursorExpired` is a distinct variant because
every provider has a way of invalidating a sync cursor and every caller must handle it.
Files: `src-tauri/src/provider/mod.rs`, `src-tauri/src/provider/types.rs`.

**Local store.** SQLite, bundled rather than the host's copy, WAL, foreign keys on,
migrations tracked by `PRAGMA user_version` and applied in a transaction. Schema is
accounts, folders, threads, messages, `message_folders`, `message_addresses`, attachments,
`sync_state`, plus an FTS5 external-content index over subject and body kept in step by
three triggers. `attachments` is indexed by mime type and date, not only by message, which
is what the whole-mailbox attachment browser reads.
Files: `src-tauri/src/db/mod.rs`, `src-tauri/migrations/0001_init.sql`.
Tests: `src-tauri/src/db/mod.rs` — migrations are idempotent, FTS triggers index on insert
and clear on delete. Both pass.

**The keychain is only touched when a token is needed.** Which accounts exist is recorded in
the database, not the keychain, so answering "is anyone signed in" on launch does not make
macOS prompt for keychain access. Reading mail needs no keychain access at all; only syncing
does. Files: `src-tauri/src/auth/store.rs`, `src-tauri/src/mailbox/mod.rs`.

**Google sign-in.** Loopback OAuth with PKCE, as a public client: `127.0.0.1:0` for a random
port, the system browser for consent, `state` verified on the way back, code exchanged for
tokens, refresh token into the OS keychain. Never a password in Lumen. A 5 minute timeout on
the listener, and a small styled page telling the user to close the tab. Sign-out revokes at
Google, drops the keychain entry, and deletes the account row, which cascades the mail away.
Scopes are `gmail.modify`, `gmail.send`, `userinfo.email`. Client id is compiled in and is
not a secret. Files: `src-tauri/src/auth/mod.rs`, `src-tauri/src/auth/store.rs`.

**Gmail adapter.** Message listing by Gmail search query, full fetch, MIME tree walk that
separates body text, HTML and attachments, header parsing including a tolerant address-list
parser, base64url decode, labels to folders. Produces the neutral `RemoteMessage` type, so
nothing above it knows Gmail exists. Files: `src-tauri/src/provider/gmail.rs`.
Tests: address parsing with display names, quoted commas, unpadded base64url.

**Sync and read.** Sync pulls `newer_than:60d -in:spam -in:trash`, capped at 400 messages,
upserting accounts, threads, messages, addresses, attachments and folders. **Ids already in
the database are skipped**, so a resync costs one cheap list call rather than re-downloading
several hundred messages. Requests are spaced 150ms apart, and a rate-limit response (403
with `rateLimitExceeded`, or 429) is retried with backoff starting at 5s and doubling,
honouring `Retry-After`. A single unparseable message is logged and skipped; exhausted
retries stop the run and return a partial report, keeping everything already stored so the
next sync continues rather than restarting. The read side turns
rows into the interface's people-shaped model: it works out the counterpart for each message
(sender when they wrote to you, first recipient when you wrote to them), detects no-reply
senders, derives the Cc audience, strips HTML when there is no plain text, and converts unix
seconds to ISO 8601. Files: `src-tauri/src/sync/mod.rs`, `src-tauri/src/mailbox/mod.rs`.
Tests: ISO conversion, style-block stripping, broadcast detection.

**Every message shows who it came from and who else got it, addresses included.** A
`från / till / kopia` block at the top of each open message in the thread reader, and in the
single-message reader. Names alone cannot be checked: two people called Kristin, a stranger
whose display name matches a colleague's, or a reply that quietly goes to a different address
are all invisible without the address itself. The block is selectable so an address can be
copied, drops the name when it is only the address again, and folds past three recipients
behind "och N till" rather than letting a forty-person cc push the message off screen.
Backend: `Audience` gained `to` and `copies` as name-and-address pairs, and `Message` gained
`sender` — not derivable from `personId`, which on your own messages is the person you wrote
to. `src/components/Addressing.tsx`, `src-tauri/src/mailbox/mod.rs`.

**Summaries are kept, with what they were made from.** A summary costs seconds of work and
most threads do not change between one look and the next, so it is stored and shown instantly
next time. Stored alongside it: the message count and the newest timestamp it covered. When a
reply arrives those no longer match, and the summary is shown with "Nya meddelanden sedan
dess. Sammanfatta igen" rather than quietly describing a conversation that has moved on.
Redoing it is a click, never automatic, because it is the expensive half. When it was made
is shown next to it, and how many messages have arrived since, so the reader can judge how
much it is likely to have missed. Out of date, the whole panel turns amber rather than only
its button: a summary that no longer describes the conversation is the one thing on the page
that can quietly mislead, so it stops looking like a trustworthy green panel. Keyed by language
as well as thread, so switching the app language does not hand you a summary in the wrong
one. Opening a conversation that has been summarised before shows it again straight away:
the panel used to reset with every other piece of per-thread state, which meant asking a
second time for something already paid for. Without a stored summary the panel stays shut and
nothing runs. `src-tauri/migrations/0005_thread_summaries.sql`, `src/components/ThreadSummary.tsx`.

**Six themes and four text sizes, on the General tab.** Two light (Paper, Snow), two in
between (Sand leaning light, Slate leaning dark), two dark (Ink, the one the app shipped
with, and Midnight), plus following the computer, which resolves to Paper or Ink. Each theme
defines the whole token set rather than patching another: a half-defined palette is how an
interface ends up with black text on a black panel in one corner. The picker shows a
miniature of the three panes rather than colour dots, since what is being chosen is how they
sit together. Text size multiplies `--fs`, which every `font-size` in the stylesheet is
wrapped in, so labels and counts scale with the body text instead of being left behind.
`src/lib/theme.tsx`.

**The assistant's state is a block in the sidebar, above Sync.** Two separate things have to
be true before anything works, a model downloaded *and* the switch on, and having one of the
two while silently seeing no features is the state people get stuck in. So it never collapses
into one word: a dot (grey off, amber waiting, amber pulsing while downloading, green ready),
a heading saying on or off, and a line underneath naming what is missing. The whole block
opens Settings on the **AI** tab. Settings is split into **Allmant** (language) and **AI**
(switch, models, translation, features, categories), and the tab to open on travels in as a
prop; categories live with the AI because the sorting behind them is its work. Sorting needs
the assistant too, so with a backlog and no working assistant the mail list shows an amber
chip saying so instead of a Sort button that would quietly sort only the rule-decided few.
`src/components/AssistantToggle.tsx`, `src/views/SettingsView.tsx`.

**The launch screen is lit rather than written.** The wordmark takes a highlight sweeping
across it (a gradient clipped to the text) over a track where the same light runs back and
forth, with the status line underneath. Nothing claims a percentage: the load is a local
database read of unknown length, and a bar creeping to 90% and stopping is worse than an
honest "working on it". All CSS, and a reduced-motion preference stops every part of it.
`src/components/Boot.tsx`.

**Interface language.** Follows the computer (`navigator.languages`: sv, nb/nn/no, else
English) with an override in Settings (System / English / Svenska / Norsk, stored in
`lumen.locale`). One typed dictionary per language in `src/lib/i18n.tsx`; `en` is the type,
so a missing string in `sv` or `nb` fails `tsc`. Counts and names are functions, since
plurals and word order differ. Dates use the locale tag (`localeTag()`), so "10 sep." in
Swedish. Only the app's own words are translated; mail stays as written. Changing language
remounts the tree (keyed on locale) rather than chasing every cached string. Translation
target names shown localised, sent to the model in English.

**Startup does no parsing.** Opening the app took fourteen seconds on a 2000-message
mailbox, and measurement said why: `load_mailbox` re-derived every message's body, quotes and
signature on every launch, 56 MB of mail HTML through `split_quote`, `split_signature`,
`to_inline` and `to_text`, and then shipped all of it to a window that only needed subjects
and previews to draw a list. The list payload now carries a `preview` only, taken from the
stored snippet with no parsing at all, and a conversation's real content is fetched when it
is opened, through `thread_contents`. **14.9s to 0.28s**, and the part that was growing with
the mailbox no longer runs at startup at all. `src-tauri/src/mailbox/mod.rs`,
`src/views/ThreadReader.tsx`.

**Search over people, addresses and subjects**, built for a mailbox that got away from
someone. In a box above the mail list. Matches a
person's name, any address on the message, and therefore any company domain, plus the
subject. Terms are ANDed and accent-folded by the existing `matches` helper, so "havard"
finds Håvard and "kristin bakke" finds the thread she is only copied on. A search spans every
folder rather than the open one: being told there is nothing because the single mail from
that person was archived is worse than useless, and the count says "alla mappar" so that is
not a surprise. Searching runs over the mailbox already in memory, so it costs no round trip;
the per-thread haystack is built once per mailbox rather than per keystroke. **Deliberately
not the bodies** — that is a different job with different expectations, and folding it in
would mean a search for a colleague also returning every mail that merely mentions them. The
FTS index is built and waiting for it.

A result has to be readable at a glance, which took three things beyond filtering the list.
**Matched words are marked** in the sender and subject, which means highlighting the original
text from a match made on the folded one: "havard" matches "Håvard", the letters do not line
up, and folding "æ" to "ae" makes the folded string longer, so `segments()` builds a
character-by-character index map rather than reusing an offset. **Matching people are listed
first**, name, address and message count, because most searches for a person mean "everything
from them" rather than "these letters somewhere"; clicking one opens the People view for them: everything exchanged in both
directions, with their files, which is the question that view was built to answer. The two
modes were disjoint until then, and reimplementing a narrower version of it inside the list
would have been the wrong half of the answer. **A row says why it is there** when the reason is not on screen: a thread found
because someone was copied on it otherwise looks identical to a thread found for no reason,
so it carries "Även med här: Håvard Nilsen <havard@bambusa.no>". Each result also shows which
folder it is in, since the search crosses all of them and finding a mail you then cannot find
again is its own failure. `src/views/ClassicView.tsx`, `src/lib/search.ts`,
`src/components/Highlight.tsx`.

**How far back a sync reaches is a setting, not a constant.** It was `newer_than:60d` with a
400-message ceiling, hard-coded, and nothing on screen said so: an account with thousands of
messages showed 244, which is indistinguishable from a bug. General settings now offer 30
days, 60 days, 6 months, 1 year or everything, and the choice travels with every sync,
automatic ones included. The ceiling scales with the window (600 up to 20 000) rather than
staying one number, because a wider window is a deliberate request for more and a fixed cap
would silently truncate exactly the people who asked. A run that hits the ceiling still
reports itself partial, and the next one carries on, since stored messages are skipped.
`src-tauri/src/sync/mod.rs`, `src/views/SettingsView.tsx`.

**It builds as a downloadable app for all three platforms.** `pnpm tauri build` produces a
signed `Lumen.app` and a `.dmg` on macOS, `.msi` and `.exe` on Windows, `.deb` and
`.AppImage` on Linux. Tauri cannot cross-compile, so `.github/workflows/release.yml` runs one
job per platform on GitHub's runners: Apple silicon, Intel Mac, Windows, Linux. The macOS
bundle is 13 MB and carries the Swift translation helper inside `Contents/MacOS`, but **no
model** — those are downloaded on demand, so nobody pays for gigabytes they may not use.
What stands between this and a public download is signing (a Developer ID plus notarization
on macOS, a code-signing certificate on Windows) and, above all, Google's OAuth verification:
`gmail.modify` is a restricted scope, so until the app is verified only the 100 test users
added by hand can sign in. See `docs/packaging.md`.

**Categories are data, and yours to change.** Six are seeded (reply, fyi, meeting, invoice,
automated, newsletter) but they are rows in a `categories` table, not an enum: rename any of
them, add your own, delete one, or tell the assistant to leave one alone so only you put mail
there. The model's prompt is built from the table at sort time, which is why every category
carries a **description** — the name is for you, the description is the line the model sorts
by, and a category with a vague one sorts badly. Creating a category with no description
turns its auto-sorting off, since the model would otherwise be sorting at random. The
assistant uses the first ten auto-sorting categories; past that it starts confusing them, and
Settings says so rather than enforcing it invisibly. Deleting a category un-sorts the mail
that was in it. **A category you set by hand is recorded as `user` and no later pass touches
it**, which is what makes correcting the model stick; "sort the mailbox again" clears what
the rules and the model decided and keeps what you did. The picker sits in the thread header
and applies to every message in the conversation. Files: `src-tauri/src/categorize/mod.rs`,
`src/lib/categories.tsx`, `src/views/SettingsView.tsx`.

**Mail is sorted into six categories, rules first and the model second.** reply, fyi,
meeting, invoice, automated, newsletter. A calendar part, an unsubscribe link, a
notifications@ sender, a money word in the subject or your own address as the sender all
settle it outright at no cost; only what is left goes to the model, at about 1.1s a message.
On the real mailbox that is roughly 40% decided by rule. The category is stored on the
message (`category`, `category_source`) because the model pass is far too slow to redo on
every launch, and `category_source` records which decided it so a better prompt later can
re-run only the model's rows. Sorting runs in batches of ten from the interface rather than
as one long command: progress shows, stopping is just not asking for another batch, and a
message is either stored or untouched. The mail list grows a filter row of the categories
that actually occur, with counts from the whole folder rather than the filtered view, and
every row carries its category as "AI-kategori: …" with a colour accent for reply, meeting
and invoice. `categorySource` reaches the interface too, so the label's tooltip says whether
a rule or the model decided it rather than crediting the model for both. A
thread takes the category of its newest categorised message. Measured: the model alone got
12 of 14 on real mail, and both misses were bulk mail the rules now catch first.
Files: `src-tauri/src/categorize/mod.rs`, `src/lib/categorize.ts`, `src/views/ClassicView.tsx`.

**Translation uses the Mac's own translator where there is one.** macOS translates
on-device for free, with models Apple ships, and it beats a 4B model: on the same Norwegian
test message TranslateGemma silently dropped a parenthesis of content that Apple kept, and
Apple took 2.7s with nothing to download. So on a Mac it is the default, chosen in Settings
under "Translate with" next to the model options; the choice is hidden entirely on other
platforms, driven by `appleTranslation` in the assistant status rather than by sniffing the
user agent. Translate then works with no model downloaded at all. Apple's API is reachable
only from SwiftUI, so the work happens in a small Swift helper built by `build.rs` and
spawned per request; without Xcode's toolchain the helper is simply absent and the option
never appears. Files: `macos/lumen-translate.swift`, `src-tauri/src/assistant/apple.rs`.

**On-device writing assistant.** Off by default; owned by a Settings page (rail entry with a
gear) rather than a toggle in the margin, because a 1GB download deserves a page. Three
separate decisions there: the master switch, the models, and per-feature switches. A model
catalogue (`src-tauri/src/assistant/catalog.rs`) lists Qwen3 1.7B (1.1GB), Qwen3 4B (2.5GB,
both Apache 2.0, Hugging Face) and TranslateGemma 4B (2.5GB, Gemma terms, ungated community GGUF
since Google's Hugging Face repo is gated). Every model has its own card with
**Download, Pause, Resume, Cancel** (deletes the partial file) and **Remove from disk**, a
progress bar, transfer speed over a rolling 8-second window, and time left; downloads of
different models may run at once. The user picks a **writing model** ("Use this model" on a
downloaded general card) and optionally a **translation model** (select), which Translate uses
when it is downloaded; everything else runs on the writing model. Settings persist in
`assistant.json` as `{enabled, features, model, translationModel}`. Prompts are built per
model family (`tasks::prompts`): Qwen gets the system turn and `/no_think`, TranslateGemma gets
its official single-user-turn template with the source language detected by `whatlang`. The
engine holds one model at a time and swaps when a task needs another. Downloads run on a
background thread, honour pause and cancel between 1MB chunks, and resume from the partial
file with a `Range` request after any interruption, including quitting the app. The sidebar
shows one status line linking to Settings, with a thin progress bar while anything downloads.

Features are individual switches: Translate, Fix spelling and grammar, Improve writing,
Summarise threads. A switched-off feature appears nowhere. Runs through `llama.cpp`
(`llama-cpp-2`), Metal on Apple Silicon, CPU elsewhere, threads capped at eight; loaded into
memory on first use, unloaded when the master switch goes off, the file kept on disk. Each
task is a short firm prompt ending "reply with the result only", with `/no_think` appended
since Qwen3 otherwise reasons at length about a two-line reply. Output streams token by token.

Where it appears: Translate on every message (the clean text, quotes and signature already
stripped, into a language remembered in Settings), one message at a time. Translating a whole
conversation at once was built and then removed: a thread is read one reply at a time, and
the button that translated all of it meant waiting on every message to see one. A Reply
drawer per thread with Fix, Improve and Translate to, each result a suggestion under the
draft with Use / Discard, never an edit in place; and Summarise on threads with more than one
message, fed the timeline's material clipped to its newest 6000 characters. The summary row
folds away, and stays folded on the next thread too. Drafts persist per thread on this device.
**Sending is not built**, and a draft written here says so: it is kept in this browser
profile only, invisible to Gmail and to every other device. The Utkast folder lists both
kinds side by side, each labelled with where it actually is, because that is the only way to
know where to delete it: a Lumen draft says "Bara på den här datorn, i Lumen" and carries a
delete button, since this is the only place it can be removed at all, while a draft Gmail is
holding is badged as such and has to be dealt with there. Drafts are stored with their
subject and the time they were saved; the older bare-string format is still read, and
clearing the box deletes the draft rather than leaving a blank row that cannot be got rid of.
Files: `src/lib/drafts.ts`, `src/views/ClassicView.tsx`.
Files: `src-tauri/src/assistant/{mod,catalog,engine,tasks}.rs`, `src/lib/assistant.tsx`,
`src/views/SettingsView.tsx`, `src/components/{AssistantToggle,WritingPanel,ThreadSummary,MessageBody}.tsx`.

**Read state, both ways.** Opening a thread in Mail, or a message in People, marks it read.
The local flag flips on the same frame as the click, so the unread dot and the Inbox count
never wait on the network; Gmail is then told through `batchModify` (one request per thread,
up to 1000 ids), removing its `UNREAD` label. A server failure is logged and otherwise ignored:
the user did read it, and a red line about label sync would be worse than a stale label. The
`UNREAD` folder membership is dropped locally too, so the two views of the same fact agree.
Files: `src-tauri/src/provider/gmail.rs`, `src-tauri/src/mailbox/mod.rs`, `src/App.tsx`.

**Automatic checking.** New mail is fetched without being asked: 1.5 seconds after launch
(so the local mailbox is already on screen and the window never stalls behind a network round
trip), every two minutes while open, and whenever the window is brought back to the front
after more than a minute away. A ref guards against overlapping runs. Automatic checks are
quiet: they update the mailbox and the "Checked 14:32" line, they announce themselves only
when something new arrived, and they swallow failures, because a background poll that shouts
about a dropped connection is worse than one that says nothing. Manual "Sync now" still
reports everything, successes and errors alike. Cheap to repeat, because a sync skips ids
already stored, so a poll with nothing new is one list call. File: `src/App.tsx`.

**Connect screen and wiring.** First launch shows one button and three plain statements about
what Lumen does with the mail. Connecting runs consent, then a first sync with progress, then
loads. The rail carries the account address, a Sync now button and any error. Startup reads
only the local database, so the window is usable instantly and offline. In a plain browser
(`pnpm dev`) the frontend falls back to the fixture mailbox, which keeps design work possible
without signing in. Files: `src/views/ConnectView.tsx`, `src/lib/backend.ts`, `src/App.tsx`.

**App shell.** Tauri 2, React 19, TypeScript, Vite. `Db` opens under the per-user app data
dir on startup and is held in Tauri state. Light and dark via `prefers-color-scheme`.
Files: `src-tauri/src/lib.rs`, `src/App.tsx`, `src/styles.css`.

**Thread reader.** Built for long conversations, where every client fails for the same
reason: each reply carries a nested copy of everything before it. So each message shows only
what is new, with the quoted history behind a toggle labelled with how many earlier messages
it holds, and signatures folded away separately. Messages are collapsed to a line each except
unread ones and the newest two. **Newest at the top, history descending**, with explicit
markers for real pauses ("3 weeks earlier") sitting between the newer message and the older
one below it. A header states the shape (8 messages, 4 people, 6 weeks) and a participant
strip shows who is in it and how much each said; clicking someone dims everyone else.
Files: `src/views/ThreadReader.tsx`, `src/lib/quotes.ts`.

**Who sent it decides the default rendering.** Mail from people renders in the app's design.
Mail from broadcast senders (no-reply addresses: newsletters, receipts, notifications) opens in
the sender's own layout, because for a Klaviyo report the layout *is* the message. The markup
could never tell the two apart reliably; the sender address can. One click flips either way.
"Show images" is remembered per sender, so allowing Klaviyo's images once is enough.
Files: `src/components/MessageBody.tsx`, `src/components/HtmlBody.tsx`.

**Mail from people renders in the app's design.** Every such message is reduced to a handful of
allowlisted tags (paragraphs, emphasis, lists, quotes, headings, links), every attribute
dropped except a scheme-checked `href`, and rendered with the app's own typography, colours
and dark mode. No frame, no white box, no borrowed styling.

**"Show original" fetches the sender's layout on demand** into a sandboxed frame: no
`allow-scripts`, a `default-src 'none'` policy, and remote images blocked until the reader
asks (loading them tells the sender you opened it). Sanitised in Rust first, removing scripts,
frames, objects, forms, `on*` handlers and `javascript:` URLs, so a gap in any one layer does
not mean execution. Fetched per message rather than shipped with the mailbox, because full
mail HTML is tens of kilobytes each and almost none is ever looked at.

**Signatures are split off and hidden**, behind a "Signature" toggle, for HTML as well as
plain text. Explicit containers (`gmail_signature`, Outlook's, Proton's) are trusted anywhere;
a sign-off phrase only counts when little follows it.

**Quoted history is split off first**, then the signature, so the signature found belongs to
this message rather than to something it quotes. HTML quotes are detected by client markers (`gmail_quote`,
`yahoo_quoted`, `moz-cite-prefix`, Outlook header blocks, `<blockquote>`) and by localised
`From:`/`Från:`/`Fra:` header blocks.

**The chain is then unpicked into its individual messages**, each with its attribution line
("Den 10 sep. skrev Hannes:") lifted out as a header, and each rendered in the app's own
design as a nested card rather than as indentation, which runs out of room after three
replies. Collapsed behind one control: in a long chain the history is many times the length of
what the sender actually wrote. Files: `src/components/QuotedHistory.tsx`,
`src-tauri/src/mailbox/html.rs`.

Files: `src/components/MessageBody.tsx`, `src/components/HtmlBody.tsx`,
`src-tauri/src/mailbox/html.rs`.

**HTML to text.** Still produced for every message, because previews, search, collapsed
thread rows and quote folding all need text. Decodes named and numeric entities, drops
`<style>`, `<script>` and `<head>` contents, turns block tags into line breaks, and strips
the invisible characters marketing tools use for preheader padding.
File: `src-tauri/src/mailbox/html.rs`. Tests: entities, padding, block breaks, script
contents, `>` inside an attribute, and both sanitiser behaviours.

**Timeline view.** A per-thread toggle beside the header, next to Reading. Shows only who
spoke, when, and the words they wrote: no signatures, no quoted history, no images, no
attachments, no formatting, on a vertical spine. A thread that runs to several screens in the
reading view is usually a page and a half of actual sentences, and this is the view that shows
that. **Newest first**, the same way round as the reading view. It was built oldest-first, on
the argument that a discussion only makes sense forwards, but two views running in opposite
directions meant the eye had to start somewhere different depending on which tab was open, and
consistency beat the argument. Messages that turn out to be nothing but
a signature or a quote are dropped rather than left as empty entries. Resets to Reading when a
different thread is opened. File: `src/views/Timeline.tsx`.

**Quote and signature parsing.** Attribution lines in English, Swedish, Norwegian, German and
French, Outlook's `-----Original Message-----` banners, `From:`/`Från:`/`Fra:` header blocks,
and runs of `>` lines. Signatures via the RFC 3676 `-- ` delimiter plus sign-off phrases in
the same languages, trusted only near the end of a message. Conservative by design: if the
heuristics would leave an empty body, the original is shown instead.
File: `src/lib/quotes.ts`.

**Mail mode (default).** Three panes: folders, thread list, reading pane. Threads derived by
person plus normalised subject, sorted newest first, two-line rows with sender, subject,
message count, attachment count and preview, unread in bold. Reader stacks the thread's
messages with sender, timestamp, body and attachment pills carrying file sizes. Drafts,
Archive and Trash are genuinely empty rather than salted with fake mail, so their empty
states get designed too. Files: `src/views/ClassicView.tsx`, `src/lib/threads.ts`.

**Visual language.** Two kinds of colour, kept strictly apart. *Meaningful*: the accent and
the age scale, used only where that state is true. *Decorative*: avatar gradients hashed from
a person's address by golden-angle rotation so colleagues never collide, and fixed per-kind
hues for file tiles. Depth comes from layered shadows (near for the edge, far for the lift)
rather than one blur, cards carry a slight gradient, rows lift on hover, and the rail is
tinted with a fade of the accent. Eight hand-drawn 16px stroked icons, no icon library.
Files: `src/lib/color.ts`, `src/components/Icon.tsx`, `src/styles.css`.

**Resizable panes.** Every divider drags. Widths are remembered between launches, clamped to
floors and ceilings that keep a pane doing its job (a thread list too narrow to show a subject
is worse than no thread list). Double-click a divider to reset it, and arrow keys move it when
focused, since a drag-only control is unusable without a mouse. The handles are positioned over
the boundaries rather than occupying grid columns, so they do not alter the layout they divide,
and their hit area is 11px against a 1px line. Files: `src/components/Resizer.tsx`,
`src/lib/panes.ts`.

**Mode switch.** Segmented control at the top of the rail. The rail's contents change with
the mode: folders in Mail, People in People, with Files below a divider in both. Choice
persists in `localStorage`, wrapped in try/catch so a blocked storage API cannot stop the app
opening. Files: `src/App.tsx`.

**People mode.** Four panes: rail, people, that person's mail, the message. The people list
ranks humans by most recent contact and keeps machines in their own group, with an unread dot
and a message count each. Selecting someone shows their files as a wrapped strip at the top,
then every message they sent, newest first, each row carrying subject, date, preview,
attachment count and an **audience line**: "To you", "To you and 1 other", "Copied to you",
"Sent by you", preceded by a direction arrow: ↗ sent, accented, and ↙ received, grey. The
words say the same thing, but a column of arrows is readable without reading. The subject
takes the space between the arrow and the date, or `space-between` spreads the gap around all
three and every subject starts somewhere different.

**One row per conversation, not per message.** A back-and-forth about one thing filled five
rows with the same subject, which is noise however it is sorted. The row carries what is true
of the exchange as a whole, and the arrow shows the **newest** message, because "the last word
was theirs" against "the last word was mine" is the thing worth knowing before opening it.
Selecting one opens it in the thread reader, the same component the mail list uses, which
brought quoted history, attachments, translation and the category picker to this half of the
app; the single-message view it replaced had none of those and is deleted.
Files: `src/views/PeopleList.tsx`, `src/views/PersonMailList.tsx`, `src/views/ThreadReader.tsx`.

**Attachments are cards, not chips.** A message's attachments render as a grid of cards with
a 96px preview face, the filename and the size, so an invoice looks like an invoice before
anything is opened. Pills survive only in the dense per-person file strip, where there is no
room for a card. Files: `src/components/AttachmentPreview.tsx`.

**Thumbnails, without being asked.** All three types show one, in the Files grid and on
message attachment cards.

- **Images**: downscaled in Rust with the `image` crate at 320px on the longest edge, JPEG,
  cached on disk beside the original so it is made once.
- **PDFs**: first page rasterised by `pdfjs-dist` on a canvas. Done in the frontend because a
  renderer already exists there; the alternative is a native PDF library and a much heavier
  build. The canvas is painted white first, since PDF pages are transparent where nothing is
  drawn and on a dark theme an unpainted page renders as a black rectangle.
- **Spreadsheets**: the first 6 rows and 4 columns drawn as a miniature grid. Not readable at
  tile size and not meant to be; it says "spreadsheet, with data in it" at a glance.

Fetching them is the expensive part: a thumbnail means downloading the whole attachment. So
they are requested only when the tile is actually near the viewport (`IntersectionObserver`
with a 300px margin) and only two at a time. Without that queue, opening the Files grid would
fire a hundred attachment downloads at once and earn the rate limit this project has already
hit. Results are cached for the session, including the negative ones: remembering that a file
has no thumbnail is as useful as remembering that it has one. Nothing over 6MB is thumbnailed.
Files: `src/components/Thumbnail.tsx`, `src/lib/pdf.ts`, `src-tauri/src/attachments/mod.rs`.

**Attachment previews.** Clicking any file, in a message or in the Files grid, fetches it and
shows it. Images inline (on a checkerboard, so transparency reads as transparency), PDFs as
pages drawn by pdf.js (first 12, at 1400px wide; `<embed>` with a data URL does not reliably
render in the webview and fails blank), and spreadsheets parsed in Rust with
`calamine` into the first 40 rows and 14 columns per sheet, with the sheet's real size stated
so it is clear what is not shown. CSV too, with the separator guessed from the first line
because a Swedish Excel export uses semicolons. Anything else says why it cannot be shown
rather than presenting a blank box, and nothing over 12MB is fetched at all. Bytes are cached
on disk and the path recorded, so opening a file twice costs one round trip. The overlay is
reached through a React context rather than a callback threaded through four views.
Files: `src-tauri/src/attachments/mod.rs`, `src/components/AttachmentPreview.tsx`.

**Files.** Every attachment that ever arrived, grouped by week, filterable by kind, each
card showing sender, date and size, clicking through to the person. **Search** matches file
name, sender name and sender address at once, with terms ANDed and order-independent, so
"havard sokk" finds Håvard's sock images and "sokk havard" finds the same three. Accents are
folded, because nobody types å, ø or ä into a search box while hunting for a file. Escape
clears, and the result count and empty state both quote the query back. Files:
`src/views/ThingsView.tsx`.

**Fixture mailbox.** 9 people (5 human, 4 machine), 16 messages, 14 attachments. Deliberately
awkward: a thread spanning weeks, a message with no subject, one mail carrying six files, mail
addressed to several people, mail where you are only on copy, and mixed Norwegian, Swedish and
English. Files: `src/fixtures.ts`.

## Gotchas

- **Computing theme colours in JS locks you to one theme.** File-kind tints were built in
  `color.ts` at a fixed lightness: legible on light paper, nearly invisible on dark. The fix
  is to publish only the hue as a CSS custom property and let the stylesheet pick lightness
  per theme. `src/lib/color.ts`, `src/styles.css`
- **React 19 removed the global `JSX` namespace.** `JSX.Element` no longer resolves; import
  `ReactElement` from `react` instead. `src/App.tsx`
- **Gmail signals rate limiting with a 403, not just a 429.** The body says
  `rateLimitExceeded` while the status claims `PERMISSION_DENIED`, so treating 403 as a
  permission problem turns a temporary pause into an apparent failure.
  `src-tauri/src/provider/gmail.rs`
- **Gmail's published quota is a ceiling, not a promise.** 5 units per call against 6000 per
  minute implies 20 requests per second is safe; in practice this account was throttled at
  well under that. Spacing is set from observed behaviour (150ms), not from the documented
  arithmetic. `src-tauri/src/provider/gmail.rs`
- **Backoff for a per-minute quota has to be measured in tens of seconds.** A 1-2-4-8 second
  sequence retries four times inside the same exhausted minute and fails four times. It starts
  at 5s so the sequence crosses into a fresh window. `src-tauri/src/provider/gmail.rs`
- **Re-fetching what is already stored is what actually exhausts the quota.** Listing ids is
  cheap and fetching messages is not, so a resync that does not skip known ids spends the whole
  budget re-downloading mail it already has. The cost of skipping: changes to existing messages
  (read state, labels) are missed until `history.list` replaces this. `src-tauri/src/sync/mod.rs`
- **Google only returns a refresh token on the first consent.** A second sign-in for an
  account that already granted access returns an access token and nothing else, so the app has
  nothing durable to store. `prompt=consent` forces it, and the error text points at
  myaccount.google.com/permissions. `src-tauri/src/auth/mod.rs`
- **Gmail's `internalDate` is milliseconds, as a string.** Everything else in the schema is
  unix seconds, so it needs parsing and dividing, and getting it wrong puts every message in
  1970. `src-tauri/src/provider/gmail.rs`
- **`<style>` and `<script>` bodies are not markup, they are content.** Stripping tags without
  skipping those blocks turns an HTML newsletter into a wall of CSS in the reading pane.
  `src-tauri/src/mailbox/html.rs`
- **Marketing mail is padded with hundreds of invisible characters.** A run of `&nbsp;&zwnj;`
  after the headline stops an inbox preview showing the next line. Invisible when rendered,
  a wall of noise when tags are stripped, so zero-width characters are removed and the
  resulting blank lines collapsed. `src-tauri/src/mailbox/html.rs`
- **`>` occurs inside attribute values.** Scanning for the next `>` to find a tag's end
  breaks on `<a title="5 > 3">`, swallowing the rest of the message. Quoting state has to be
  tracked. `src-tauri/src/mailbox/html.rs`
- **Most mail from people is HTML, and framing it looks absurd.** A colleague's two-sentence
  reply is usually `<div><p>...</p></div>`, and rendering that in an isolated frame makes an
  ordinary message look like an embedded web page. Only designed mail needs the frame.
  `src-tauri/src/mailbox/html.rs`
- **Automatic sync on launch brings the keychain prompt back in dev builds.** Reading mail
  needs no keychain access, but syncing needs the token, so checking on launch necessarily asks
  for it. Unavoidable while the binary is unsigned; a signed release build settles it once.
  `src/App.tsx`, `src-tauri/src/auth/store.rs`
- **macOS ties keychain permission to the binary's code signature.** "Always allow" cannot
  stick under `tauri dev`, because every rebuild produces a different unsigned binary that the
  OS treats as a different app. It only settles for a signed release build, so the fix is to
  ask the keychain as rarely as possible rather than to try to silence the prompt.
  `src-tauri/src/auth/store.rs`
- **Tokens are bytes, not characters.** An emoji or an "ä" spans several tokens, and
  decoding each token on its own turns the seam into U+FFFD (the 🙏 in a Norwegian mail
  rendered as `��`). Bytes accumulate and only the longest valid UTF-8 prefix is released
  per step. `src-tauri/src/assistant/engine.rs`
- **A small model copies between close languages.** Asked for Swedish with the instruction
  only in the system prompt, it returned the Norwegian source with a few words swapped. The
  instruction now lives in the user turn, names the source languages, shows one example that
  ends in the target language (a Norwegian→Swedish example nudges an English request towards
  Swedish, so the example is per target), and lists the false friends that actually come up.
  Verified against the real model with `debug_translate` (ignored test, `LUMEN_MODEL=`):
  1.5s per message on an M3 Pro. `src-tauri/src/assistant/tasks.rs`
- **Translate paragraph by paragraph, not message by message.** Handed a whole message the
  model merged the writer's paragraphs into one block; handed one paragraph at a time it
  keeps them, and a small model is markedly more accurate on a short input. The joins are
  reproduced exactly. `src-tauri/src/assistant/mod.rs`
- **1.7B has a ceiling on Norwegian→Swedish, and no prompt moves it.** The languages are close
  enough that the model treats "utrolig", "må", "gruppe", "efterpå" as acceptable Swedish. A
  second "fix the leftovers" pass was measured against the real model and changed nothing.
  **Qwen3 4B does not move it either**: same test text, 3.4s, still "må", "gruppe-uppsettet",
  and "utrolig" became "olyckligt" (wrong meaning). **TranslateGemma 4B solves it**: same
  text in 2.8s came back as idiomatic Swedish with no Norwegian left. A general model is the
  wrong tool for close-language pairs; that is why the catalogue has a translation-only slot.
  `src-tauri/src/assistant/tasks.rs`
- **Every assistant feature was gated on the *writing* model, Translate included.** With a
  translation specialist downloaded and chosen, deleting the general model still hid every
  Translate button, because `can()` only looked at the general model. Translate now needs
  only the model that will actually run it. `src/lib/assistant.tsx`
- **Removing the model in use no longer switches the assistant off in effect.** Deleting it
  hands the job to another downloaded general model when there is one, and clears the
  translation slot if that was what went. `src-tauri/src/assistant/mod.rs`
- **Fixture subjects are not interface text.** "(no subject)" in the fixture list is the
  fixture's subject string, not the `noSubject` label; do not chase it. `src/fixtures.ts`
- **No local model on hand can spot a real word used in place of another.** "jeg blir like
  utrolig som deg" is "urolig", and the mistranslation reads as nonsense. Seven framings were
  measured against Qwen3 4B: correct-the-source, name-the-typo, think mode, a two-way forced
  choice between the exact pair, and cloze with and without thread context. All failed, and
  the forced choice picked "utrolig" for the control sentence too, so there is no signal to
  build on. Real misspellings (non-words) it fixes cleanly and with no false positives, which
  is a different and much easier problem. Faithful translation stays the behaviour.
- **whatlang will not call a short Nordic text reliable.** Swedish, Norwegian and Danish
  overlap too much for its confidence bar; the best guess among those three is kept anyway,
  since the fallback phrase gives TranslateGemma nothing. `src-tauri/src/assistant/tasks.rs`
- **The Ollama registry blob of TranslateGemma does not load in llama.cpp.** Ollama's own
  converter bundles the vision tower and omits `gemma3.attention.layer_norm_rms_epsilon`;
  upstream llama.cpp fails on "key not found". The catalogue uses the mradermacher Q4_K_M
  conversion instead. `src-tauri/src/assistant/catalog.rs`
- **Background curl downloads share the app's `.part` names.** A `.part` written by hand in
  the models folder looks like a paused download to the app and Resume appends to it. Do not
  run both at once on the same file.
- **A rule pointing at a deleted category must not fire.** The built-in rules name slugs
  (`meeting`, `newsletter`), and those rows can be removed or told not to auto-sort, so every
  rule answer is checked against the live list before it is used and otherwise falls through
  to the model. `src-tauri/src/categorize/mod.rs`
- **Renaming a category must not lose the mail in it.** The slug is the key and never
  changes; only the display name does. `src-tauri/src/categorize/mod.rs`
- **Translating the category descriptions makes sorting worse.** They are the prompt. With
  the six rewritten in Swedish, Qwen3 4B started reasoning instead of answering and 6 of 14
  came back as a bare `<think>`; a bigger token budget did not help, so it is the wording,
  not the budget. The descriptions the assistant reads stay English, the interface shows a
  translation of them, and rewording one marks it `edited` so your words are shown and used.
  `src-tauri/migrations/0004_category_edited.sql`, `src/lib/categories.tsx`
- **Deriving the whole mailbox at startup is what made it slow, not SQLite.** Reading 2066
  rows took 0.25s; parsing their HTML took ten. The work is deterministic given the stored
  markup, so it belongs where it is needed, per conversation, not on the path between launch
  and the first paint.
- **A Content-ID does not mean an image is part of the body.** Attachments flagged inline
  were dropped from the list on the reasoning that the body already draws them. Gmail gives
  every attached image a Content-ID whether or not the message embeds it, so images attached
  the ordinary way disappeared twice over: never drawn in the text, never listed as files.
  Eight product photographs in one message, 38 across the mailbox. An image now counts as
  part of the body only when the body actually contains `cid:<its id>`.
  `src-tauri/src/mailbox/mod.rs`
- **Gmail autosaves a draft as a message, and this sync only ever added.** A reply typed in
  Gmail's own composer is saved as a real message with the DRAFT label; sending deletes it,
  but nothing here deleted anything, so the abandoned autosave stayed forever and appeared in
  the conversation a minute before the real reply, cut off mid-sentence, looking exactly like
  the same mail sent twice. Two halves to the fix: drafts are no longer folded into a
  conversation at all (their own thread, routed to the Drafts folder, and kept out of the
  People list, since an unsent draft is not correspondence), and each sync now drops local
  drafts Gmail no longer has. Drafts only: they are few, so it is one cheap request, and they
  are the only kind of message that vanishes as part of normal use. Reconciling the whole
  mailbox needs `history.list`. `src-tauri/src/sync/mod.rs`, `src/lib/threads.ts`
- **GitHub blocks a push carrying the OAuth client id and secret, and it is right to.**
  They were compiled in from constants in `auth/mod.rs`, which is fine for a binary and wrong
  for a public repository: whoever holds the id can put this app's name on their own consent
  screen. Both now come from the environment at build time via `option_env!`, from
  `src-tauri/.cargo/config.toml` locally (gitignored, with a committed example beside it) and
  from Actions secrets in CI. A build with neither compiles and says so at sign-in rather
  than failing at Google with a raw error body. `src-tauri/src/auth/mod.rs`
- **A platform-specific `externalBin` must live in a platform-specific config.** The Mac's
  translation helper was declared in the shared `tauri.conf.json`, and Tauri fails any bundle
  whose declared external binary has no build for that target triple, so the Windows and
  Linux jobs would have failed looking for a helper that only ever exists on macOS. Moved to
  `tauri.macos.conf.json`, which Tauri merges for that platform alone.
- **A release build of llama.cpp needs macOS 11 or later, and CMake caches the old target.**
  Tauri's default minimum system version is below 10.15, where Apple marks `std::filesystem`
  unavailable, so the release build failed with dozens of "introduced in macOS 10.15" errors
  while the dev build was fine (it inherits the SDK's target instead). Raising
  `bundle.macOS.minimumSystemVersion` to 11.0 is only half of it: CMake keeps
  `CMAKE_OSX_DEPLOYMENT_TARGET` in its cache, so the next build reuses the old value and
  fails identically. Delete `target/release/build/llama-cpp-sys-2-*` after changing it.
  `src-tauri/tauri.conf.json`
- **The DMG step drives Finder with AppleScript.** Without Automation permission for the
  terminal it fails with `-1743` after the `.app` is already built, which reads as a bundling
  failure when only the disk image is missing. CI is unaffected. `docs/packaging.md`
- **An unverified OAuth app expires refresh tokens after seven days.** Not an error anyone
  can act on from `Google rejected the token request: {"error":"invalid_grant"…}`, which is
  what it used to say. `invalid_grant` now returns a plain "Lumen needs you to sign in to
  Google again", and the sidebar carries a **Sign in to Google again** link at all times
  rather than trying to guess from an error string which failures mean that.
  `src-tauri/src/auth/mod.rs`, `src/App.tsx`
- **`Instant` stops while a Mac sleeps, so the access token never looked expired.** Token
  expiry was tracked with `Instant`, which is monotonic and does not advance across system
  sleep. A laptop closed overnight woke with a token Google had expired hours earlier and an
  app that believed it had fifty minutes left, so every request, including the two-minute
  background checks, came back 401. Expiry is wall clock (`SystemTime`) now, and a 401 also
  forces one refresh and retry: the expiry is our arithmetic, the 401 is Google's answer, and
  Google wins. `src-tauri/src/auth/mod.rs`, `src-tauri/src/provider/gmail.rs`
- **A background check that fails every time must stop being quiet.** Automatic syncs
  swallow errors, which is right for a passing network blip and wrong for an expired
  sign-in: that one failed silently all night. Five consecutive failures, about ten minutes,
  now surface in the sidebar. `src/App.tsx`
- **The model calls your own sent mail a request.** It reads like one, so from_me is
  settled by rule before the model ever sees it. Same for bulk mail: asked cold, the model
  called Fortnox and Klaviyo marketing "fyi", which is why the unsubscribe-link rule runs
  first. `src-tauri/src/categorize/mod.rs`
- **A model that answers with something unrecognised leaves the row alone.** Storing a guess
  would be permanent; leaving `category` null means the next pass retries and the message
  still shows under "All". `src-tauri/src/commands.rs`
- **Apple's translator cannot be called from a plain function, and blocking the main
  thread to wait for it deadlocks.** A `TranslationSession` comes only from SwiftUI's
  `.translationTask`, so the helper needs an `NSApplication`, a window the system considers
  live (borderless, alpha 0, positioned off-screen) and a run loop. The framework calls back
  on the main queue, so an availability check with `semaphore.wait()` before `app.run()`
  hangs forever. It does not need an app bundle, though: a bare `swiftc` binary works.
  `macos/lumen-translate.swift`
- **Cargo's `[target.*] runner` cannot sign a Tauri dev build.** It applies to `cargo run`
  and `cargo test` only; Tauri runs `cargo build` and launches the binary itself, so a runner
  configured there never executes. The first attempt at the keychain fix was wired that way
  and was dead code. Signing now happens in a cargo wrapper passed through
  `tauri dev --runner`, which is the only hook between the build and the launch.
  `scripts/tauri.sh`, `scripts/cargo-sign.sh`, `docs/dev-signing.md`
- **A chosen model that is no longer on disk left the assistant switched on and dead.**
  Deleting it now hands the job to another downloaded general model, and the same check runs
  at startup for machines already in that state. Only at startup, where no download can be in
  flight to trample. `src-tauri/src/assistant/mod.rs`
- **An explicit theme cannot coexist with `prefers-color-scheme`.** Nine blocks in the
  stylesheet keyed off the operating system, so choosing a light theme on a dark Mac left
  component-level dark tweaks in place. All nine now hang off `:root[data-mode="dark"]`,
  which is set from the chosen theme and from the system only when the choice is to follow
  it. There are no `prefers-color-scheme` rules left. `src/styles.css`
- **A silent signing step is a signing step nobody notices is broken.** Twice the wrapper
  looked installed and never ran, and nothing said so. It now prints `cargo-sign: …` to the
  terminal and appends to `src-tauri/target/signing.log` on every build, whether it signed,
  found no certificate, or failed. That log is the first thing to check when the keychain
  asks again. `scripts/cargo-sign.sh`
- **A plain `cargo build` strips the signature.** Only the wrapper signs, so building
  directly (or from an editor) leaves an ad-hoc binary until the next `pnpm tauri dev`.
- **Tauri asks the runner for `cargo run`, not `cargo build`.** The first signing wrapper
  only signed on `build`, so it silently never ran and the keychain kept prompting. The
  wrapper now builds as its own step, signs, and only then hands `run` back to cargo, which
  finds everything fresh and just launches it. `scripts/cargo-sign.sh`
- **The keychain prompt in dev builds is an unstable code signature.** macOS remembers
  "Always allow" per signature, and a dev build is ad-hoc signed afresh on every rebuild.
  Every build is now signed with one identity (`LUMEN_DEV_SIGNING_IDENTITY`, else a
  self-signed "Lumen Dev", else the machine's Apple Development certificate) and a fixed
  identifier `se.bambusa.lumen`. No certificate on the machine means an unsigned build, as
  before. `scripts/cargo-sign.sh`
- **"Summarise in its own language" gets you English.** Told that, the model summarised a
  Norwegian and Danish thread in English. The app's language is now named outright in both
  the system and user turns, the way translation already names its target, and the summary
  comes back in it. It is the reader's language that matters here anyway, not the writers'.
  `src-tauri/src/assistant/tasks.rs`
- **`white-space: pre-wrap` on the reading body double-spaced every HTML mail.** The rule
  belongs to plain text, which arrives with real newlines and no markup, but it applied to
  the inline-HTML variant too. Mail HTML is written with newlines and indentation inside its
  tags, so every one of them rendered as a line break on top of the paragraph margins: one
  GitHub message had 42 source newlines and read as double-spaced with ragged leading
  indents, while the same mail in "Visa original" was compact. `.reader-body.rich` now sets
  `white-space: normal`. `src/styles.css`
- **The stream showed what the finished text hid.** `clean_output` only ever sees the
  completed answer, so a `<think>` tag sat on screen for the whole generation and vanished
  when the cleaned result replaced it. A `StreamCleaner` now does the same job token by
  token, on both the general and the paragraph-by-paragraph translation paths. The hard part
  is that an empty block closes immediately while an unclosed one is followed by the real
  answer, so content after an opening tag is held for 24 characters and then released rather
  than suppressed until a closing tag that may never come. Verified against the real model:
  the first thing to reach the screen is now the first word of the summary.
  `src-tauri/src/assistant/tasks.rs`
- **An unclosed `<think>` leaks into the answer.** On a long input Qwen3 sometimes opens a
  reasoning block, never closes it, and answers anyway; the cleanup only knew how to cut at
  `</think>`. A bare opening tag at the start is now dropped on its own.
  `src-tauri/src/assistant/tasks.rs`
- **Qwen3 thinks unless told not to.** Without `/no_think` in the user turn the model
  emits a long reasoning block before the answer, and the answer arrives a minute late on a
  laptop. The output is still stripped of any `<think>` block in case one leaks.
  `src-tauri/src/assistant/tasks.rs`
- **A long-lived llama.cpp context borrows the model.** Holding both in one struct is a
  self-referential borrow; a fresh context per generation costs ~100ms and avoids it.
  `src-tauri/src/assistant/engine.rs`
- **Marking a thread read on open collapses it.** The reader auto-expands unread messages
  and re-ran that on every change to the message list; flipping the flags on open changed the
  list, so the messages expanded for being unread collapsed a frame later. The expansion is
  keyed on the thread id. `src/views/ThreadReader.tsx`
- **Table layouts flatten into dozens of `<br>`s separated by indentation whitespace.** Every
  cell, row and table boundary became a break, and collapsing only *adjacent* `<br>` tags
  missed all of them, so a newsletter rendered as one sentence followed by a screen and a half
  of empty lines with the rest, and the buttons, below the fold. Any run of breaks and
  whitespace is now at most one blank line. Caught by running the stored HTML through each
  stage (`debug_pipeline`, an ignored test driven by `LUMEN_DEBUG_HTML`). `src-tauri/src/mailbox/html.rs`
- **Bulk senders are not all called no-reply.** Klaviyo's reports come from
  `marketing-responses@`, which no list of no-reply spellings catches. The body is the better
  tell: bulk mail carries an unsubscribe link, mail from a person never does. Both signals are
  used. `src-tauri/src/mailbox/mod.rs`
- **pdf.js display rendering waits on `requestAnimationFrame`, which never fires in a hidden
  or throttled webview.** The render promise then never settles. Thumbnails render with
  `intent: "print"`, which paces through timers instead, and carry a hard deadline. Confirmed
  by rendering in a hidden tab: display intent hung, print intent finished in 65ms.
  `src/lib/pdf.ts`
- **Passing both `canvas` and `canvasContext` to pdf.js v6 is contradictory.** The docs pair
  `canvasContext` with `canvas: null`; supplying both did not render. `src/lib/pdf.ts`
- **A promise that never settles holds its queue slot forever.** With two thumbnail slots, one
  stuck PDF silently stopped every thumbnail after it for the rest of the session. Every slot
  now has a timeout. `src/components/Thumbnail.tsx`
- **`pdfjs-dist` puts `destroy()` on the loading task, not the document.** Calling it on the
  document does not compile, and skipping it leaks a copy of every PDF inside the worker.
  `isEvalSupported` was also dropped from the v6 options type. `src/lib/pdf.ts`
- **The pdf.js worker must be bundled, not fetched.** Vite's `?url` import serves it from the
  app; the default would reach out to a CDN, which is slower and a privacy problem in a mail
  client. `src/lib/pdf.ts`
- **Hiding a thumbnail variant in CSS loses its fallback.** The spreadsheet miniature was
  hidden on tiny pills with `display: none`, which left the pill empty rather than showing the
  type label, because the component had already decided not to render the fallback. Whether a
  variant is shown is a component decision, not a stylesheet one.
  `src/components/Thumbnail.tsx`
- **Synthetic mouse events do not drive React pointer handlers.** Browser automation that
  "drags" a resizer changes nothing, which looks like a broken feature. Verified instead by
  dispatching real `PointerEvent`s and checking the grid template and stored width.
  `src/components/Resizer.tsx`
- **The text version of a message included its quotes and signature.** `body` was derived
  from the whole HTML before splitting, so list previews showed quoted junk and anything built
  on that text inherited the noise. It is now the text of the split body.
  `src-tauri/src/mailbox/mod.rs`
- **"Designed mail" cannot be detected reliably, and trying was the mistake.** Three
  successive heuristics (any table, then wide tables, then image counts) each framed ordinary
  replies, because a corporate signature is structurally identical to a small newsletter: real
  mail here carried two tables, fourteen cells and eighteen images, including 487px and 420px
  banners, for three lines of text. The fix was to stop classifying and let the reader ask.
  `src-tauri/src/mailbox/html.rs`
- **`mso-` styles and Outlook conditional comments are not a marker of designed mail.**
  Outlook stamps them on everything it sends, so treating them as a signal frames ordinary
  two-line replies from anyone in an Outlook office, which is most people. The signals that
  actually separate a campaign from a reply are a `@media` block, a table pinned to 500px or
  wider, four or more images, or twenty-plus cells. `src-tauri/src/mailbox/html.rs`
- **A table does not mean designed mail.** Nearly every corporate signature is a table with a
  background colour and a logo, so "contains `<table>`" frames ordinary replies. The real
  marker is a table pinned to a layout width of 500px or more; signatures are narrow or set to
  a percentage. `src-tauri/src/mailbox/html.rs`
- **A quoted block starts with its own marker.** Searching for the next `gmail_quote` from the
  beginning finds the container's own opening tag, cuts at position zero, splits off nothing
  and loops without progress. The search has to skip cuts at the start of the chunk.
  `src-tauri/src/mailbox/html.rs`
- **`to_lowercase` can change a string's byte length; `to_ascii_lowercase` cannot.** Any offset
  found in a lowercased copy and then used to slice the original risks landing mid-character
  and panicking. All the markers are ASCII, so ASCII-only lowercasing is both sufficient and
  safe. `src-tauri/src/mailbox/html.rs`
- **Blocked images render as broken-image boxes, not as nothing.** On a dark signature table
  that means large black rectangles in the middle of the message, which looks like a rendering
  failure. They are hidden outright while blocked. `src/components/HtmlBody.tsx`
- **Escaping text before decoding entities double-escapes it.** `&nbsp;` becomes a visible
  "&nbsp;" unless the source entity is resolved first and the *result* escaped.
  `src-tauri/src/mailbox/html.rs`
- **`allow-same-origin` is only safe without `allow-scripts`.** The frame needs the former to
  be measured for height; granting both together would let mail HTML reach the app's own
  context. `src/components/HtmlBody.tsx`
- **Inline images are attachments with a `Content-ID`.** Treated as ordinary files they flood
  the Files view with tracking pixels and signature logos, so they are stored but hidden.
  `src-tauri/src/mailbox/mod.rs`
- **`ø` and `æ` survive Unicode NFD normalisation.** Stripping combining marks folds å to a
  and ä to a, but ø and æ carry no separate mark and come through untouched, so an accent-folding
  search misses Norwegian names unless they are replaced explicitly. `src/lib/search.ts`
- **Threading by subject splits a group conversation into one thread per participant.** The
  provider's own thread id is the only thing that keeps a four-person exchange together;
  subject matching is a fallback for fixtures and for providers with no server-side threading.
  `src/lib/threads.ts`, `src-tauri/src/mailbox/mod.rs`
- **Quote attribution lines are localised too.** "Den 1 sep. skrev Asgeir:" and
  "-----Ursprungligt meddelande-----" are what a Nordic mailbox actually contains, and an
  English-only rule leaves exactly the mail that needs help fully quoted. `src/lib/quotes.ts`
- **A lone `>` is not a quote.** Pasted shell output and stray characters trip a naive rule,
  so two consecutive quoted lines are required. Likewise an attribution only counts when
  quoted material actually follows it, or every sentence ending in "wrote:" truncates the
  message. `src/lib/quotes.ts`
- **Reply prefixes are localised.** Swedish and Norwegian clients write `SV:` and `VS:`, not
  `Re:`, so a threading rule that strips only `Re:` and `Fwd:` splits a Nordic thread in half.
  `src/lib/threads.ts`
- **Inline spans will not ellipsis inside a flex card.** File names ran straight over the
  sender name until `.thing-body` and `.thing-meta` got `display: block` and the flex child
  got `min-width: 0`. All three are needed; two look like they work and do not.
  `src/styles.css`
- **Hidden hover actions left a hole in every card.** `opacity: 0` still reserves the height,
  so each obligation card had dead space, and "Done" was undiscoverable. They now sit at half
  opacity and come up on hover. `src/styles.css`
- **Locale short dates already end in a full stop** in Swedish ("20 aug."), so appending one
  produces "20 aug.." `src/views/PersonView.tsx`
- **IMAP has no threads and no labels.** Threading must be rebuilt from `References` and
  `In-Reply-To` headers, and folders are not labels. The neutral model has to fit IMAP, with
  Gmail's threads and labels treated as a bonus, not the baseline. Modelling on Gmail first
  and retrofitting IMAP means rewriting the schema.

## Remaining

Ordered. Each phase is usable on its own.

**Phase 0 is done.** See `## Built`. Not yet checked: the app has never been launched as a
window, only compiled and unit-tested. Run `pnpm tauri dev` once to confirm it opens and the
database file appears.

**UI on fixtures is done.** Both modes render and navigate, verified in a browser at 1440x920
and running in the Tauri window. Light and dark both checked. Not done: no keyboard
navigation, no compose or reply UI, no search field, no attachment preview, no responsive work
below ~900px (the narrow-window rule that collapsed the people list to avatars was dropped
when the columns became user-controlled, and has not been replaced), no search in Mail or
People (only Files has it), links in rendered HTML do nothing because the sandbox blocks navigation, no tests
for the quote parser
(the frontend has no test runner configured, and this is the code most likely to be subtly
wrong on real mail),  and neither mode
can mark anything read, archive, delete or reply.

**The four-pane narrow collapse is unverified.** The rule that turns the people list into
avatars below 1240px is written but was never seen working: the browser used for checking
would not resize below its own minimum. Confirm it by dragging the real window narrow.

**Threading in Classic is crude.** It groups by person plus subject. Real threading uses
`In-Reply-To` and `References`, which the provider types already carry, and must replace this
before real mail arrives. `src/lib/threads.ts`

**Phases 1 and 2 are done.** See `## Built`. Sync is not incremental: it re-fetches the
60-day window every run and upserts. Correct but wasteful, and it must move to
`history.list` before it meets a real mailbox at size.

**Phase 3, reading.**
- Thread list, thread reader, folder/label sidebar, keyboard navigation.
- Quoted-text collapsing, signature trimming, and the ugly cases: nested quotes, top-posting,
  plain-text-only, `multipart/alternative`.
- HTML bodies in a locked-down sandbox: no remote images until asked, no scripts, no top-level
  navigation. Main security surface in the app.

**Phase 4, search.**
- SQLite FTS5 over subject, sender, body. Local, instant, offline.
- Operators: `from:`, `to:`, `has:attachment`, `label:`, `before:`, `after:`.

**Phase 5, attachments.**
- Download and cache to disk, indexed by type, sender and date.
- A browser view across the whole mailbox, not per message. The feature no other client has
  and the reason the project exists.
- Inline preview for images and PDFs.

**Phase 6, writing.**
- Compose, reply, reply all, forward, drafts.
- RFC 2822 building, correct `In-Reply-To` and `References` so threads do not break.
- Send via `messages.send`, drafts via the drafts API so they show up in Gmail too.

**Phase 7, second provider: generic IMAP + SMTP.**
- One adapter unlocks iCloud, Fastmail, Yahoo and every custom domain.
- Expect the swamp: servers that lie about capabilities, slow or broken SERVER search,
  threading rebuilt locally, app-specific passwords for iCloud.
- Unified inbox across accounts becomes real here. This is the pitch Gmail web cannot match.

**Phase 8, third provider: Microsoft Graph.**
- Outlook, Microsoft 365, Hotmail. Basic auth is dead, Graph only.
- Separate Azure app registration, separate consent screen, separate publisher verification.

**Phase 9, shipping.**
- Signed and notarised macOS build. Windows and Linux if wanted.
- Auto-update via `tauri-plugin-updater`.
- Crash reporting that never sends message content.

**Phase 10, going public.** Only worth starting once the app is worth the audit.
- Verified domain, homepage, privacy policy, demo video of the consent flow.
- Google OAuth verification for restricted scopes.
- CASA Tier 2 assessment, paid and annual, weeks to months.
- Until then: Testing mode, hard cap of 100 test users, unverified-app warning on consent.

**No adapter exists yet.** Nothing has run against a real mail API. The provider trait has
no implementations, so it is unproven: expect it to need changes when the Gmail adapter
lands, and again when IMAP does.

## Open questions

- **If Focus ever comes back, where do obligations come from?** Deciding "owed" is mostly
  conversation state (who sent last, did you reply, To vs Cc, human vs no-reply) and needs no
  model. Writing the one-line ask does. Options were metadata only with the subject as text, a
  local model, a cloud model, or manual marking. Unanswered, and parked with the view.
- **Day one, if Focus returns.** Every unanswered mail in a real history qualifies, so a naive
  pass claims you owe hundreds of people. Needs a cutoff, probably 14 days.
- **Name.** Klarva dropped (Klarna collision). 38 candidates checked against Google; only
  Glassine and Skua came back clean in the software and email class. Real remaining gate is a
  trademark class search (EUIPO and USPTO) plus domain availability, not more web searching.
- Windows and Linux at launch, or macOS first? Affects keychain and installer work.
- Multiple accounts in one window from Phase 1, or one account until Phase 7?
- Permanent delete ever needed? If yes, scope widens to `https://mail.google.com/` and the
  consent screen gets much scarier. Current plan says no.
- Encrypt the local SQLite file, or rely on OS disk encryption? SQLCipher costs build
  complexity and rules out some tooling.
- Who pays for CASA, and when do we decide to start it?

## Decisions

- **No competitor research, deliberately** — Epistles Mail (epistles.net) ships a similar
  local-first multi-account client. Not evaluated, on purpose: studying it risks inheriting
  its way of thinking, and UX originality is the point of this project. Do not "helpfully"
  go look later.
- **Provider-neutral core, Gmail adapter first** — the trait and the schema are defined before
  any Gmail code, so IMAP and Graph slot in without a rewrite. Only Gmail ships in v1.
- **Neutral model fits IMAP, not Gmail** — Gmail's threads and labels are the bonus case.
  The reverse means rewriting the schema at Phase 7.
- **Tauri, not Electron** — 10 MB installer against 150 MB, far lower memory, and speed was
  the top complaint about the Gmail web app.
- **Full local mirror, not fetch on demand** — instant search and scroll, works offline. Costs
  disk and a slow first sync, a one-time price.
- **`gmail.modify` plus `gmail.send`, not full mailbox access** — same capability minus
  permanent delete, milder consent wording, smaller audit surface.
- **Standalone desktop app, no backend** — no accounts, no sessions, no user database, nothing
  of ours to breach. Mail never leaves the user's machine.
- **PKCE public client** — a downloaded binary cannot keep a secret, and Google supports this
  explicitly for installed apps.
- **Two modes: Mail and People, Mail as the default** — the traditional view is the floor, so
  the app is never worse than what it replaces. People is the one genuinely different idea kept
  in the product: everything from one person, subject lines ignored.
- **Focus mode parked, not deleted** — the obligation home screen did not earn its place on
  looking at it. Kept on disk under `src/parked/` because there is no git history to recover it
  from and the idea may return.
- **People is a mail list, not a chat log** — an earlier version merged everything with a
  person into conversation bubbles with subject lines demoted. Replaced on request: messages
  stay discrete mail, subjects stay headings, and reading happens in its own pane.
- **Newest at the top of a thread, history descending** — you open a conversation to see what
  just happened, and scrolling down walks backwards through how it got there.
- **Quote stripping is conservative and always reversible** — it cuts only on unambiguous
  markers, never leaves an empty body, and keeps the original one click away. Being wrong
  costs a click rather than losing text.
- **Search folds accents, and that is a search-only decision** — ö is its own letter in
  Swedish, not a decorated o, so folding would be wrong for sorting. For finding a file it is
  right, because people type what is on their keyboard.
- **The audience line is worth a column of space** — "someone asked you" and "someone kept you
  informed" are different situations, and a client that hides the difference makes you open
  mail to find out which it was.
- **The modes are derived, not duplicated** — one set of messages, two readings. Threads are
  computed from subject, obligations from their own list, and neither is stored twice.
- **Radical structure, conventional controls** — the organising principle is new, the clicking,
  scrolling and keyboard behaviour deliberately are not. Novel gestures are exciting for a day
  and exhausting by Thursday.
- **No competitor was looked at** — see the decision above. The concept was reached from the
  user's own working problems, not from anyone else's product.
- **Colour is split into meaningful and decorative, and the two never mix** — the accent and
  the age scale say something, so they appear only where it is true; avatars and file tints
  carry identity, so they can be as colourful as they like. Mixing them is how an interface
  ends up busy and meaning nothing.
- **UI built on fixtures before OAuth** — lets the awkward cases (three-week-old asks, six
  attachments, no subject, three languages) be designed for on purpose rather than waited for.
- **React and TypeScript for the frontend** — a mail client needs virtualised lists over tens
  of thousands of rows, and that ecosystem is the deepest. No UI framework or component
  library picked yet; the shell is hand-written CSS.
- **Bundled SQLite, not the system one** — FTS5 and behaviour are then identical on every
  machine instead of depending on what the OS ships.
