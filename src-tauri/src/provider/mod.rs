//! The provider boundary.
//!
//! Nothing above this module knows what Gmail is. Adding IMAP or Microsoft Graph later
//! means writing a new `MailProvider` impl, not touching sync, storage or UI.
//!
//! The types here are deliberately the *intersection* of what providers offer, not the
//! union. Gmail extras (server-side threads, labels, server search) are expressed as
//! optional capabilities rather than assumed, because IMAP has none of them.

use std::fmt;

use serde::{Deserialize, Serialize};

pub mod gmail;
pub mod types;

pub use types::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderKind {
    Gmail,
    Imap,
    Graph,
}

impl fmt::Display for ProviderKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            ProviderKind::Gmail => "gmail",
            ProviderKind::Imap => "imap",
            ProviderKind::Graph => "graph",
        };
        f.write_str(s)
    }
}

/// What a given provider can actually do, so callers ask instead of assuming.
///
/// Every one of these is false for plain IMAP. Code that reads a capability flag stays
/// correct when a new adapter lands; code that assumes Gmail behaviour does not.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Capabilities {
    /// Server groups messages into threads and gives them a stable id.
    pub server_threads: bool,
    /// A message can belong to several folders at once (Gmail labels).
    pub multi_folder: bool,
    /// Incremental sync via a cursor, rather than re-listing a folder.
    pub delta_sync: bool,
    /// Server-side search worth using. IMAP SEARCH is slow or broken often enough that
    /// the local FTS index is the default path regardless.
    pub server_search: bool,
    /// Drafts written through the API show up in the provider's own clients.
    pub remote_drafts: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("authentication failed or expired: {0}")]
    Auth(String),
    #[error("network failure: {0}")]
    Network(String),
    /// The cursor is no longer valid and the folder must be resynced from scratch.
    /// Gmail returns 404 for an expired historyId; IMAP signals it via UIDVALIDITY change.
    #[error("sync cursor expired, full resync required")]
    CursorExpired,
    #[error("rate limited, retry after {retry_after_secs}s")]
    RateLimited { retry_after_secs: u64 },
    #[error("provider rejected the request: {0}")]
    Rejected(String),
    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, ProviderError>;

/// One mail account, at one provider.
///
/// Implementations hold their own credentials and refresh them internally. Callers never
/// see a token, which is what keeps token handling in one place per provider.
#[async_trait::async_trait]
pub trait MailProvider: Send + Sync {
    fn kind(&self) -> ProviderKind;
    fn capabilities(&self) -> Capabilities;

    /// The address this account sends from. Used to tell "me" from everyone else.
    fn account_email(&self) -> &str;

    async fn list_folders(&self) -> Result<Vec<RemoteFolder>>;

    /// Walk a folder from the beginning. `cursor` is this provider's own opaque paging
    /// token, `None` to start. Returns `None` for `next_cursor` when the folder is done.
    async fn backfill(&self, folder: &RemoteFolderId, cursor: Option<&str>)
        -> Result<Page<RemoteMessage>>;

    /// Changes since `cursor`. Returns [`ProviderError::CursorExpired`] when the cursor is
    /// too old, which callers must handle by falling back to [`MailProvider::backfill`].
    async fn changes_since(&self, cursor: &str) -> Result<Changes>;

    /// Full message including bodies. `backfill` may return metadata only, so the reader
    /// calls this when a message is opened.
    async fn fetch_message(&self, id: &RemoteMessageId) -> Result<RemoteMessage>;

    async fn fetch_attachment(
        &self,
        message: &RemoteMessageId,
        attachment: &RemoteAttachmentId,
    ) -> Result<Vec<u8>>;

    async fn set_flags(&self, ids: &[RemoteMessageId], flags: FlagUpdate) -> Result<()>;

    /// Add to and remove from folders in one call. On single-folder providers a move is
    /// one add plus one remove; on Gmail this is a label change.
    async fn change_folders(
        &self,
        ids: &[RemoteMessageId],
        add: &[RemoteFolderId],
        remove: &[RemoteFolderId],
    ) -> Result<()>;

    /// Send an already-built RFC 5322 message. Building it is the caller's job so that
    /// threading headers are produced identically for every provider.
    async fn send(&self, raw_rfc5322: &[u8]) -> Result<RemoteMessageId>;

    async fn save_draft(
        &self,
        raw_rfc5322: &[u8],
        replace: Option<&RemoteMessageId>,
    ) -> Result<RemoteMessageId>;
}
