//! Neutral wire types crossing the provider boundary.
//!
//! These are what an adapter produces and what sync consumes. They carry no provider
//! vocabulary: no `labelIds`, no `uid`, no `historyId`.

use serde::{Deserialize, Serialize};

/// Opaque provider-side id. A Gmail message id, an IMAP UID rendered as text, a Graph id.
/// Never parsed by anything outside the adapter that produced it.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RemoteMessageId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RemoteFolderId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RemoteAttachmentId(pub String);

/// Where a folder sits in the standard set, so the UI does not string-match on names that
/// differ per provider and per language ("Sent", "Skickat", "[Gmail]/Sent Mail").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FolderKind {
    Inbox,
    Sent,
    Drafts,
    Trash,
    Spam,
    Archive,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteFolder {
    pub id: RemoteFolderId,
    pub name: String,
    pub kind: FolderKind,
    pub parent: Option<RemoteFolderId>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Address {
    pub name: Option<String>,
    pub email: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AddressKind {
    From,
    To,
    Cc,
    Bcc,
    ReplyTo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteAttachment {
    pub id: Option<RemoteAttachmentId>,
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: u64,
    /// Set when the part is referenced from the HTML body by `cid:`.
    pub content_id: Option<String>,
    pub is_inline: bool,
}

/// A message as the provider describes it.
///
/// `body_text` and `body_html` are `None` when only metadata was fetched. The threading
/// headers are always carried, even from providers that thread server-side, because a
/// mailbox can hold messages synced by more than one adapter over its life.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteMessage {
    pub id: RemoteMessageId,
    /// Server-side thread id where one exists. `None` on IMAP: threading is derived from
    /// `message_id`, `in_reply_to` and `references` instead.
    pub thread_id: Option<String>,

    pub message_id_header: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Vec<String>,

    pub subject: Option<String>,
    /// Unix seconds.
    pub sent_at: i64,
    pub snippet: Option<String>,
    pub body_text: Option<String>,
    pub body_html: Option<String>,

    pub addresses: Vec<(AddressKind, Address)>,
    pub attachments: Vec<RemoteAttachment>,
    pub folders: Vec<RemoteFolderId>,

    pub is_read: bool,
    pub is_flagged: bool,
    pub is_draft: bool,
}

/// One page of a backfill. `next_cursor` is `None` when the folder is exhausted.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
}

/// What changed since a cursor.
///
/// Deletions carry ids only: the message is gone, so there is nothing else to report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Changes {
    pub upserted: Vec<RemoteMessage>,
    pub deleted: Vec<RemoteMessageId>,
    pub next_cursor: String,
}

/// `None` leaves a flag untouched, so a caller can mark read without disturbing stars.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct FlagUpdate {
    pub is_read: Option<bool>,
    pub is_flagged: Option<bool>,
}
