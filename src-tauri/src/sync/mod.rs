//! Pull messages from a provider into the local database.
//!
//! Everything the UI shows is read from SQLite, never from a provider directly. That is what
//! makes the app fast and what makes it work offline.

use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension};

use crate::db::Db;
use crate::provider::gmail::GmailAccount;
use crate::provider::types::*;

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("gmail: {0}")]
    Gmail(#[from] crate::provider::gmail::GmailError),
    #[error("database: {0}")]
    Db(#[from] crate::db::DbError),
    #[error("database: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

pub type Result<T> = std::result::Result<T, SyncError>;

/// How far back a sync reaches, and how much it will pull.
///
/// A cutoff rather than the whole mailbox by default: a decade of mail takes a very long
/// time to download and nobody needs it to start using the app. But the cutoff has to be
/// visible and changeable, because "my mailbox has thousands of messages and this shows 244"
/// is indistinguishable from a bug when nothing says otherwise.
///
/// The ceiling scales with the window rather than being one number: a wider window is a
/// deliberate request for more, and a cap that did not move with it would silently truncate
/// exactly the people who asked.
#[derive(Debug, Clone, Copy)]
pub struct Window {
    /// How many days back, or `None` for everything.
    pub days: Option<u32>,
}

impl Default for Window {
    fn default() -> Self {
        Self { days: Some(60) }
    }
}

impl Window {
    fn query(&self) -> String {
        match self.days {
            Some(days) => format!("newer_than:{days}d -in:spam -in:trash"),
            None => "-in:spam -in:trash".to_string(),
        }
    }

    /// Deliberately generous. A run that stops at the ceiling reports itself as partial and
    /// the next one carries on, because already-stored messages are skipped.
    fn limit(&self) -> usize {
        match self.days {
            Some(days) if days <= 30 => 600,
            Some(days) if days <= 60 => 1_000,
            Some(days) if days <= 180 => 3_000,
            Some(_) => 6_000,
            None => 20_000,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub fetched: usize,
    pub stored: usize,
    /// True when the run stopped early. Everything stored before that point is kept, so
    /// syncing again picks up where it left off rather than starting over.
    pub partial: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stopped_because: Option<String>,
}

/// Fetch recent mail for an account and store it.
///
/// Listing ids is cheap; fetching a message is not. So the ids already in the database are
/// skipped, which makes a repeat sync almost free and, more importantly, stops a resync
/// spending the account's quota re-downloading mail it already has.
///
/// The cost of that shortcut: changes to an *existing* message (read state, labels, stars)
/// are not picked up. Proper incremental sync via `history.list` reports exactly those and
/// must replace this.
/// Drop local drafts that Gmail no longer has.
///
/// Gmail autosaves a half-written reply as a message of its own and deletes it the moment
/// you send. This sync only ever adds, so without this the abandoned draft stays forever and
/// shows up beside the real reply, a minute older and cut off mid-sentence, looking exactly
/// like you sent the same mail twice.
///
/// Only drafts, deliberately. They are few, so this is one cheap request, and they are the
/// only kind of message that disappears as part of normal use. Reconciling the whole mailbox
/// needs `history.list`, which is a different piece of work.
fn reconcile_drafts(db: &Db, account: &mut GmailAccount, account_id: i64) -> Result<usize> {
    let local: Vec<String> = db.with_conn(|conn| {
        let mut statement = conn.prepare(
            "SELECT remote_id FROM messages WHERE account_id = ?1 AND is_draft = 1",
        )?;
        let rows = statement.query_map([account_id], |row| row.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })?;

    if local.is_empty() {
        return Ok(0);
    }

    // A mailbox with hundreds of live drafts is not a thing, and the cap keeps one strange
    // account from turning this into a long request.
    let remote = account.list_message_ids("in:draft", 200)?;
    let gone: Vec<&String> = local.iter().filter(|id| !remote.contains(id)).collect();
    if gone.is_empty() {
        return Ok(0);
    }

    db.with_conn(|conn| {
        for id in &gone {
            // Addresses, attachments and folder rows go with it: the schema cascades.
            conn.execute(
                "DELETE FROM messages WHERE account_id = ?1 AND remote_id = ?2",
                params![account_id, id],
            )?;
        }
        Ok(())
    })?;

    Ok(gone.len())
}

/// Pull mail, reporting each message as it lands.
///
/// `on_stored` is called with (stored so far, total to fetch) after every message is
/// written. A first sync can run for minutes, and without this it is indistinguishable from
/// a hung app: the messages are arriving and being stored the whole time, and nothing said
/// so.
pub fn sync_account(
    db: &Db,
    account: &mut GmailAccount,
    window: Window,
    on_stored: impl Fn(u32, u32),
) -> Result<SyncReport> {
    let account_id = db.with_conn(|conn| upsert_account(conn, account.email()))?;

    let listed = account.list_message_ids(&window.query(), window.limit())?;
    let known = db.with_conn(|conn| known_remote_ids(conn, account_id))?;

    // Drafts first: they are the one class of message Gmail routinely deletes behind your
    // back, and nothing else here ever removes anything.
    let removed_drafts = reconcile_drafts(db, account, account_id)?;
    if removed_drafts > 0 {
        log::info!("removed {removed_drafts} draft(s) that no longer exist in Gmail");
    }

    let ids: Vec<String> = listed.into_iter().filter(|id| !known.contains(id)).collect();
    let fetched = ids.len();
    let mut stored = 0;

    if ids.is_empty() {
        log::info!("nothing new to fetch");
    }

    for id in ids {
        match account.fetch_message(&id) {
            Ok(message) => {
                db.with_conn(|conn| store_message(conn, account_id, &message))?;
                stored += 1;
                on_stored(stored as u32, fetched as u32);
            }
            // Rate limiting is not this message's fault and will not clear by trying the
            // next one, so stop and keep what is already stored.
            Err(e @ crate::provider::gmail::GmailError::RateLimited { .. }) => {
                log::warn!("stopping sync early: {e}");
                return Ok(SyncReport {
                    fetched,
                    stored,
                    partial: true,
                    stopped_because: Some(e.to_string()),
                });
            }
            // One unparseable message is common and losing the other 399 over it would not
            // be, so skip it and carry on.
            Err(e) => log::warn!("skipping message {id}: {e}"),
        }
    }

    Ok(SyncReport {
        fetched,
        stored,
        partial: false,
        stopped_because: None,
    })
}

/// Every message id already stored for this account.
///
/// One query rather than a lookup per message: 400 round trips to SQLite would be silly, and
/// a 60-day window is a few hundred rows.
fn known_remote_ids(conn: &Connection, account_id: i64) -> rusqlite::Result<HashSet<String>> {
    let mut stmt = conn.prepare("SELECT remote_id FROM messages WHERE account_id = ?1")?;
    let rows = stmt.query_map(params![account_id], |row| row.get::<_, String>(0))?;
    rows.collect()
}

fn upsert_account(conn: &Connection, email: &str) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO accounts (provider, email, created_at)
         VALUES ('gmail', ?1, strftime('%s','now'))
         ON CONFLICT (provider, email) DO NOTHING",
        params![email],
    )?;
    conn.query_row(
        "SELECT id FROM accounts WHERE provider = 'gmail' AND email = ?1",
        params![email],
        |row| row.get(0),
    )
}

fn store_message(conn: &Connection, account_id: i64, message: &RemoteMessage) -> rusqlite::Result<()> {
    let thread_id = upsert_thread(conn, account_id, message)?;

    conn.execute(
        "INSERT INTO messages (
             account_id, thread_id, remote_id, message_id_hdr, in_reply_to, references_hdr,
             subject, sent_at, snippet, body_text, body_html,
             is_read, is_flagged, is_draft, has_attachments
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
         ON CONFLICT (account_id, remote_id) DO UPDATE SET
             subject = excluded.subject,
             snippet = excluded.snippet,
             body_text = excluded.body_text,
             body_html = excluded.body_html,
             is_read = excluded.is_read,
             is_flagged = excluded.is_flagged",
        params![
            account_id,
            thread_id,
            message.id.0,
            message.message_id_header,
            message.in_reply_to,
            if message.references.is_empty() { None } else { Some(message.references.join(" ")) },
            message.subject,
            message.sent_at,
            message.snippet,
            message.body_text,
            message.body_html,
            message.is_read as i32,
            message.is_flagged as i32,
            message.is_draft as i32,
            !message.attachments.is_empty() as i32,
        ],
    )?;

    let message_row: i64 = conn.query_row(
        "SELECT id FROM messages WHERE account_id = ?1 AND remote_id = ?2",
        params![account_id, message.id.0],
        |row| row.get(0),
    )?;

    // Addresses and attachments are replaced wholesale. They never change for a given
    // message, and replacing is simpler than diffing.
    conn.execute("DELETE FROM message_addresses WHERE message_id = ?1", params![message_row])?;
    for (kind, address) in &message.addresses {
        conn.execute(
            "INSERT INTO message_addresses (message_id, kind, name, email)
             VALUES (?1, ?2, ?3, ?4)",
            params![message_row, kind_str(*kind), address.name, address.email.to_lowercase()],
        )?;
    }

    conn.execute("DELETE FROM attachments WHERE message_id = ?1", params![message_row])?;
    for attachment in &message.attachments {
        conn.execute(
            "INSERT INTO attachments
                 (message_id, remote_id, filename, mime_type, size_bytes, content_id, is_inline)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![
                message_row,
                attachment.id.as_ref().map(|a| a.0.clone()),
                attachment.filename,
                attachment.mime_type,
                attachment.size_bytes as i64,
                attachment.content_id,
                attachment.is_inline as i32,
            ],
        )?;
    }

    for folder in &message.folders {
        let folder_row = upsert_folder(conn, account_id, &folder.0)?;
        conn.execute(
            "INSERT OR IGNORE INTO message_folders (message_id, folder_id) VALUES (?1, ?2)",
            params![message_row, folder_row],
        )?;
    }

    Ok(())
}

fn upsert_thread(conn: &Connection, account_id: i64, message: &RemoteMessage) -> rusqlite::Result<i64> {
    let remote = message.thread_id.clone();

    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM threads WHERE account_id = ?1 AND remote_id IS ?2",
            params![account_id, remote],
            |row| row.get(0),
        )
        .optional()?;

    if let Some(id) = existing {
        // Keep the thread's timestamp on its newest message so lists sort correctly.
        conn.execute(
            "UPDATE threads
                SET last_message_at = MAX(last_message_at, ?2),
                    subject = COALESCE(subject, ?3)
              WHERE id = ?1",
            params![id, message.sent_at, message.subject],
        )?;
        return Ok(id);
    }

    conn.execute(
        "INSERT INTO threads (account_id, remote_id, subject, last_message_at, message_count)
         VALUES (?1, ?2, ?3, ?4, 0)",
        params![account_id, remote, message.subject, message.sent_at],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Gmail label ids double as folder ids. System labels get a known kind; user labels are
/// Custom, which is all the UI needs to show them.
fn upsert_folder(conn: &Connection, account_id: i64, label: &str) -> rusqlite::Result<i64> {
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM folders WHERE account_id = ?1 AND remote_id = ?2",
            params![account_id, label],
            |row| row.get(0),
        )
        .optional()?;

    if let Some(id) = existing {
        return Ok(id);
    }

    let (name, kind) = match label {
        "INBOX" => ("Inbox", "inbox"),
        "SENT" => ("Sent", "sent"),
        "DRAFT" => ("Drafts", "drafts"),
        "TRASH" => ("Trash", "trash"),
        "SPAM" => ("Spam", "spam"),
        other => (other, "custom"),
    };

    conn.execute(
        "INSERT INTO folders (account_id, remote_id, name, kind) VALUES (?1, ?2, ?3, ?4)",
        params![account_id, label, name, kind],
    )?;
    Ok(conn.last_insert_rowid())
}

fn kind_str(kind: AddressKind) -> &'static str {
    match kind {
        AddressKind::From => "from",
        AddressKind::To => "to",
        AddressKind::Cc => "cc",
        AddressKind::Bcc => "bcc",
        AddressKind::ReplyTo => "reply_to",
    }
}
