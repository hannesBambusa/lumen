-- Provider-neutral mail schema.
--
-- Modelled on the WEAKEST provider (IMAP), not on Gmail. IMAP has no threads and no
-- labels, so threads are computed locally and "labels" are just folders a message can
-- belong to more than one of. Gmail's server-side threads and labels map onto this as a
-- bonus: its thread id lands in threads.remote_id, its labels become folders.
--
-- Modelling on Gmail first and retrofitting IMAP would mean rewriting this file.

CREATE TABLE accounts (
    id            INTEGER PRIMARY KEY,
    provider      TEXT    NOT NULL,          -- 'gmail' | 'imap' | 'graph'
    email         TEXT    NOT NULL,
    display_name  TEXT,
    -- Credentials NEVER live here. The OS keychain holds them, keyed by this account id.
    created_at    INTEGER NOT NULL,
    UNIQUE (provider, email)
);

-- Folders and labels are the same thing. IMAP gives a message exactly one; Gmail gives it
-- several. The join table below is what makes both work without a second code path.
CREATE TABLE folders (
    id            INTEGER PRIMARY KEY,
    account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    remote_id     TEXT    NOT NULL,          -- IMAP mailbox name, or Gmail label id
    name          TEXT    NOT NULL,          -- what the user sees
    kind          TEXT    NOT NULL,          -- inbox|sent|drafts|trash|spam|archive|custom
    parent_id     INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    UNIQUE (account_id, remote_id)
);

CREATE TABLE threads (
    id              INTEGER PRIMARY KEY,
    account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    -- NULL for IMAP: no server-side thread exists, we derive it from message headers.
    remote_id       TEXT,
    subject         TEXT,
    last_message_at INTEGER NOT NULL,
    message_count   INTEGER NOT NULL DEFAULT 0,
    UNIQUE (account_id, remote_id)
);
CREATE INDEX idx_threads_recent ON threads (account_id, last_message_at DESC);

CREATE TABLE messages (
    id             INTEGER PRIMARY KEY,
    account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    thread_id      INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    remote_id      TEXT    NOT NULL,         -- Gmail message id, or IMAP UID as text

    -- RFC 5322 headers. These are how threading is rebuilt when the server offers none,
    -- so they are stored raw rather than parsed away.
    message_id_hdr TEXT,
    in_reply_to    TEXT,
    references_hdr TEXT,

    subject        TEXT,
    sent_at        INTEGER NOT NULL,
    snippet        TEXT,
    body_text      TEXT,
    body_html      TEXT,

    is_read        INTEGER NOT NULL DEFAULT 0,
    is_flagged     INTEGER NOT NULL DEFAULT 0,
    is_draft       INTEGER NOT NULL DEFAULT 0,
    has_attachments INTEGER NOT NULL DEFAULT 0,

    UNIQUE (account_id, remote_id)
);
CREATE INDEX idx_messages_thread ON messages (thread_id, sent_at);
CREATE INDEX idx_messages_msgid  ON messages (account_id, message_id_hdr);

-- Many-to-many on purpose: one row per message for IMAP, several for Gmail labels.
CREATE TABLE message_folders (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    folder_id  INTEGER NOT NULL REFERENCES folders(id)  ON DELETE CASCADE,
    PRIMARY KEY (message_id, folder_id)
);
CREATE INDEX idx_message_folders_folder ON message_folders (folder_id);

CREATE TABLE message_addresses (
    id         INTEGER PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL,             -- from|to|cc|bcc|reply_to
    name       TEXT,
    email      TEXT    NOT NULL
);
CREATE INDEX idx_addresses_message ON message_addresses (message_id, kind);
CREATE INDEX idx_addresses_email   ON message_addresses (email);

-- Rows exist as soon as a message is synced; local_path stays NULL until downloaded.
-- The whole-mailbox attachment browser reads this table, which is why it is indexed by
-- type and date rather than only by message.
CREATE TABLE attachments (
    id          INTEGER PRIMARY KEY,
    message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    remote_id   TEXT,
    filename    TEXT    NOT NULL,
    mime_type   TEXT    NOT NULL,
    size_bytes  INTEGER NOT NULL DEFAULT 0,
    content_id  TEXT,                        -- set for inline images referenced by cid:
    is_inline   INTEGER NOT NULL DEFAULT 0,
    local_path  TEXT
);
CREATE INDEX idx_attachments_message ON attachments (message_id);
CREATE INDEX idx_attachments_browse  ON attachments (mime_type, id DESC);

-- One cursor per folder. Gmail stores a historyId here, IMAP a UIDVALIDITY/UIDNEXT pair,
-- Graph a delta link. The sync layer treats it as an opaque string.
CREATE TABLE sync_state (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    folder_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,
    cursor     TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, folder_id)
);

-- Local search. External-content table: FTS owns no copy of the text, it points at
-- messages.rowid, so the triggers below keep them in step.
CREATE VIRTUAL TABLE messages_fts USING fts5 (
    subject,
    body_text,
    content = 'messages',
    content_rowid = 'id',
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts (rowid, subject, body_text)
    VALUES (new.id, new.subject, new.body_text);
END;

CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts (messages_fts, rowid, subject, body_text)
    VALUES ('delete', old.id, old.subject, old.body_text);
END;

CREATE TRIGGER messages_fts_update AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts (messages_fts, rowid, subject, body_text)
    VALUES ('delete', old.id, old.subject, old.body_text);
    INSERT INTO messages_fts (rowid, subject, body_text)
    VALUES (new.id, new.subject, new.body_text);
END;
