//! Local store. One SQLite file, opened once, shared behind a mutex.
//!
//! Everything the app shows is read from here, never from a provider directly. That is
//! what makes the UI instant and what makes it work offline.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;

/// Applied in order, tracked by `PRAGMA user_version`. Append only: never edit a migration
/// that has shipped, because it has already run on someone's machine.
const MIGRATIONS: &[(&str, &str)] = &[
    ("0001_init", include_str!("../../migrations/0001_init.sql")),
    ("0002_categories", include_str!("../../migrations/0002_categories.sql")),
    ("0003_category_table", include_str!("../../migrations/0003_category_table.sql")),
    ("0004_category_edited", include_str!("../../migrations/0004_category_edited.sql")),
    ("0005_thread_summaries", include_str!("../../migrations/0005_thread_summaries.sql")),
];

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("could not create data directory {path}: {source}")]
    DataDir {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("database lock poisoned")]
    LockPoisoned,
}

pub type Result<T> = std::result::Result<T, DbError>;

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    /// Open (creating if needed) the database inside `data_dir` and bring the schema up to date.
    pub fn open(data_dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(data_dir).map_err(|source| DbError::DataDir {
            path: data_dir.to_path_buf(),
            source,
        })?;

        let conn = Connection::open(data_dir.join("mail.db"))?;
        Self::from_connection(conn)
    }

    /// In-memory database, for tests.
    pub fn open_in_memory() -> Result<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(conn: Connection) -> Result<Self> {
        // WAL so a long sync write does not block the UI's reads.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        // Off by default in SQLite, and the schema leans on ON DELETE CASCADE.
        conn.pragma_update(None, "foreign_keys", "ON")?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<()> {
        let mut guard = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;

        let applied: i64 =
            guard.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        let applied = applied as usize;

        for (index, (name, sql)) in MIGRATIONS.iter().enumerate() {
            if index < applied {
                continue;
            }
            let tx = guard.transaction()?;
            tx.execute_batch(sql)?;
            // PRAGMA does not accept a bound parameter, hence the format.
            tx.pragma_update(None, "user_version", (index + 1) as i64)?;
            tx.commit()?;
            log::info!("applied migration {name}");
        }

        Ok(())
    }

    /// Run `f` with the connection held. Keep the closure short: it blocks every other caller.
    pub fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T> {
        let guard = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        Ok(f(&guard)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_apply_and_are_idempotent() {
        let db = Db::open_in_memory().expect("open");
        // Running again must be a no-op rather than an error.
        db.migrate().expect("second migrate");

        let version: i64 = db
            .with_conn(|c| c.query_row("PRAGMA user_version", [], |r| r.get(0)))
            .expect("version");
        assert_eq!(version, MIGRATIONS.len() as i64);
    }

    #[test]
    fn fts_index_tracks_messages() {
        let db = Db::open_in_memory().expect("open");
        db.with_conn(|c| {
            c.execute_batch(
                "INSERT INTO accounts (id, provider, email, created_at)
                   VALUES (1, 'gmail', 'a@b.se', 0);
                 INSERT INTO threads (id, account_id, subject, last_message_at)
                   VALUES (1, 1, 'Fakturan', 0);
                 INSERT INTO messages (id, account_id, thread_id, remote_id, subject, body_text, sent_at)
                   VALUES (1, 1, 1, 'r1', 'Fakturan', 'betalas senast fredag', 0);",
            )
        })
        .expect("seed");

        let hits: i64 = db
            .with_conn(|c| {
                c.query_row(
                    "SELECT count(*) FROM messages_fts WHERE messages_fts MATCH 'fredag'",
                    [],
                    |r| r.get(0),
                )
            })
            .expect("search");
        assert_eq!(hits, 1, "insert trigger should have indexed the body");

        db.with_conn(|c| c.execute("DELETE FROM messages WHERE id = 1", []))
            .expect("delete");

        let hits: i64 = db
            .with_conn(|c| {
                c.query_row(
                    "SELECT count(*) FROM messages_fts WHERE messages_fts MATCH 'fredag'",
                    [],
                    |r| r.get(0),
                )
            })
            .expect("search after delete");
        assert_eq!(hits, 0, "delete trigger should have removed the row");
    }
}
