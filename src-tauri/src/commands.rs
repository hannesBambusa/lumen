//! The frontend's entire surface onto the backend.
//!
//! Every command is `async` and does its real work on a blocking thread. Signing in waits on
//! a human and a socket; a sync waits on a few hundred HTTP round trips. Neither belongs on
//! the thread that draws the window.

use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{Emitter, State};

use crate::auth;
use crate::categorize;
use crate::db::Db;
use crate::mailbox::{self, Mailbox};
use crate::provider::gmail::GmailAccount;
use crate::sync::{self, SyncReport};

pub struct AppState {
    pub db: Arc<Db>,
    pub assistant: Arc<crate::assistant::Assistant>,
    /// Where fetched attachments are kept, so opening one twice costs one round trip.
    pub cache_dir: std::path::PathBuf,
    /// The signed-in account, once there is one. Behind a mutex because a sync mutates it
    /// (refreshing tokens) while the UI may be asking whether anyone is signed in.
    pub session: Arc<Mutex<Option<GmailAccount>>>,
}

/// Commands report failure as a plain string: the frontend shows it and has no branching to
/// do on the variant.
type CmdResult<T> = Result<T, String>;

fn describe(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// The address of the signed-in account, if the keychain remembers one.
///
/// Called on startup, so it deliberately does not touch the network: it answers "is anyone
/// signed in", not "are the tokens still good".
#[tauri::command]
pub async fn current_account(state: State<'_, AppState>) -> CmdResult<Option<String>> {
    if let Some(account) = state.session.lock().map_err(describe)?.as_ref() {
        return Ok(Some(account.email().to_string()));
    }
    let accounts = mailbox::accounts(&state.db).map_err(describe)?;
    Ok(accounts.into_iter().next())
}

/// Run the Google consent flow and remember the account.
///
/// Opens the user's own browser. Lumen never sees a password, and the refresh token goes
/// straight to the OS keychain.
#[tauri::command]
pub async fn connect_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<String> {
    let session = state.session.clone();
    let db = state.db.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let (email, tokens) = auth::authorize(|url| {
            if let Err(e) = tauri_plugin_opener::open_url(url, None::<&str>) {
                // Not fatal: the URL is still printed, and a user can paste it by hand.
                log::error!("could not open the browser: {e}. URL: {url}");
            }
            let _ = &app;
        })
        .map_err(describe)?;

        let refresh_token = tokens
            .refresh_token
            .clone()
            .ok_or_else(|| {
                "Google did not return a refresh token. This happens when the account has \
                 already granted access; revoke Lumen at myaccount.google.com/permissions \
                 and try again."
                    .to_string()
            })?;

        auth::save_refresh_token(&email, &refresh_token).map_err(describe)?;
        // Recorded here too, so later launches can answer "who is signed in" without
        // touching the keychain and triggering an OS permission prompt.
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO accounts (provider, email, created_at)
                 VALUES ('gmail', ?1, strftime('%s','now'))
                 ON CONFLICT (provider, email) DO NOTHING",
                [&email],
            )
        })
        .map_err(describe)?;
        *session.lock().map_err(describe)? = Some(GmailAccount::new(email.clone(), tokens));

        Ok(email)
    })
    .await
    .map_err(describe)?
}

/// Pull recent mail into the local database.
#[tauri::command]
pub async fn sync_now(state: State<'_, AppState>) -> CmdResult<SyncReport> {
    let db = state.db.clone();
    let session = state.session.clone();

    tauri::async_runtime::spawn_blocking(move || {
        ensure_session(&db, &session)?;

        let mut guard = session.lock().map_err(describe)?;
        let account = guard.as_mut().ok_or("no account is connected")?;
        sync::sync_account(&db, account).map_err(describe)
    })
    .await
    .map_err(describe)?
}

/// Everything the interface renders, read from the local database.
#[tauri::command]
pub async fn load_mailbox(state: State<'_, AppState>) -> CmdResult<Mailbox> {
    let db = state.db.clone();
    let session = state.session.clone();

    tauri::async_runtime::spawn_blocking(move || {
        // Reading works with no live session at all, which is what makes the app usable
        // offline and instant on launch: the tokens only matter when syncing.
        let email = match session.lock().map_err(describe)?.as_ref() {
            Some(account) => Some(account.email().to_string()),
            None => mailbox::accounts(&db).map_err(describe)?.into_iter().next(),
        };

        mailbox::load(&db, email.as_deref()).map_err(describe)
    })
    .await
    .map_err(describe)?
}

/// Mark messages read: locally at once, then on the server.
///
/// The local update is not rolled back if Gmail refuses. The user opened the mail and it
/// *is* read; a server hiccup should not make it flip back unread under them.
#[tauri::command]
pub async fn mark_read(state: State<'_, AppState>, message_ids: Vec<String>) -> CmdResult<()> {
    let db = state.db.clone();
    let session = state.session.clone();

    tauri::async_runtime::spawn_blocking(move || {
        mailbox::mark_read(&db, &message_ids).map_err(describe)?;

        ensure_session(&db, &session)?;
        let mut guard = session.lock().map_err(describe)?;
        let account = guard.as_mut().ok_or("no account is connected")?;
        account.mark_read(&message_ids).map_err(describe)
    })
    .await
    .map_err(describe)?
}

/// The sender's own rendering of one message, for the "show original" control.
#[tauri::command]
pub async fn original_html(state: State<'_, AppState>, message_id: String) -> CmdResult<Option<String>> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        mailbox::original_html(&db, &message_id).map_err(describe)
    })
    .await
    .map_err(describe)?
}

/// Fetch an attachment and build a preview of it.
#[tauri::command]
pub async fn preview_attachment(
    state: State<'_, AppState>,
    attachment_id: i64,
) -> CmdResult<crate::attachments::Preview> {
    let db = state.db.clone();
    let session = state.session.clone();
    let cache_dir = state.cache_dir.clone();

    tauri::async_runtime::spawn_blocking(move || {
        ensure_session(&db, &session)?;

        let mut guard = session.lock().map_err(describe)?;
        let account = guard.as_mut().ok_or("no account is connected")?;
        crate::attachments::preview(&db, account, &cache_dir, attachment_id).map_err(describe)
    })
    .await
    .map_err(describe)?
}

/// A small preview image for an attachment, or `None` when there is nothing to show.
#[tauri::command]
pub async fn attachment_thumbnail(
    state: State<'_, AppState>,
    attachment_id: i64,
) -> CmdResult<crate::attachments::Thumb> {
    let db = state.db.clone();
    let session = state.session.clone();
    let cache_dir = state.cache_dir.clone();

    tauri::async_runtime::spawn_blocking(move || {
        ensure_session(&db, &session)?;

        let mut guard = session.lock().map_err(describe)?;
        let account = guard.as_mut().ok_or("no account is connected")?;
        crate::attachments::thumbnail(&db, account, &cache_dir, attachment_id).map_err(describe)
    })
    .await
    .map_err(describe)?
}

/// Where the assistant is: switches, chosen models, every model's download state.
#[tauri::command]
pub async fn assistant_status(state: State<'_, AppState>) -> CmdResult<crate::assistant::Status> {
    Ok(state.assistant.status())
}

/// The master switch. Does not download anything: that is a separate, explicit action.
#[tauri::command]
pub async fn assistant_set_enabled(
    state: State<'_, AppState>,
    enabled: bool,
) -> CmdResult<crate::assistant::Status> {
    state.assistant.set_enabled(enabled).map_err(describe)?;
    Ok(state.assistant.status())
}

#[tauri::command]
pub async fn assistant_set_features(
    state: State<'_, AppState>,
    features: crate::assistant::Features,
) -> CmdResult<crate::assistant::Status> {
    state.assistant.set_features(features).map_err(describe)?;
    Ok(state.assistant.status())
}

/// Which general model does the writing tools.
#[tauri::command]
pub async fn assistant_set_model(
    state: State<'_, AppState>,
    model_id: String,
) -> CmdResult<crate::assistant::Status> {
    state.assistant.set_model(&model_id).map_err(describe)?;
    Ok(state.assistant.status())
}

/// Which model does Translate: a specialist, or `None` for the general model.
#[tauri::command]
pub async fn assistant_set_translation_model(
    state: State<'_, AppState>,
    model_id: Option<String>,
) -> CmdResult<crate::assistant::Status> {
    state.assistant.set_translation_model(model_id.as_deref()).map_err(describe)?;
    Ok(state.assistant.status())
}

/// What one batch of sorting achieved, and where the whole job stands.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategorizeReport {
    /// Sorted in this batch.
    pub sorted: u32,
    /// Considered in this batch. Fewer than `sorted` means some were left for a retry.
    pub looked_at: u32,
    /// Sorted in the whole mailbox.
    pub done: u32,
    pub total: u32,
}

/// Sort mail into categories, a batch at a time.
///
/// A batch rather than the whole mailbox: four hundred messages is minutes of work even on
/// a fast machine, and a command that runs for minutes cannot be stopped, cannot report
/// progress and blocks a shutdown. The interface calls this again while there is more to
/// do, which makes stopping simply a matter of not calling it again.
#[tauri::command]
pub async fn categorize_batch(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> CmdResult<CategorizeReport> {
    let db = state.db.clone();
    let assistant = state.assistant.clone();
    let limit = limit.unwrap_or(20).clamp(1, 200);

    tauri::async_runtime::spawn_blocking(move || {
        let categories = categorize::all(&db).map_err(describe)?;
        let pending = categorize::pending(&db, limit).map_err(describe)?;
        let mut sorted = 0u32;

        for candidate in &pending {
            let Some((category, source)) = categorize::categorize(&assistant, &categories, candidate)
            else {
                // The model refused or answered with something unrecognised. Leaving the
                // row untouched means the next pass tries again rather than storing a
                // guess, and a message with no category still shows in "All".
                continue;
            };
            categorize::store(&db, candidate.id, &category, source).map_err(describe)?;
            sorted += 1;

            let (done, total) = categorize::progress(&db).map_err(describe)?;
            let _ = app.emit("categorize-progress", (done, total));
        }

        let (done, total) = categorize::progress(&db).map_err(describe)?;
        Ok(CategorizeReport {
            sorted,
            looked_at: pending.len() as u32,
            done,
            total,
        })
    })
    .await
    .map_err(describe)?
}

/// A summary kept from last time, and whether the conversation has moved on since.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSummary {
    pub summary: String,
    /// How many messages it was made from.
    pub message_count: u32,
    /// When it was made, as a Unix timestamp. Shown, so the reader can judge for
    /// themselves how much the thread is likely to have moved.
    pub created_at: i64,
    /// True when messages have arrived since, so the summary describes an older thread.
    pub stale: bool,
}

/// Fetch the summary for a conversation, if one was made in this language.
#[tauri::command]
pub async fn thread_summary(
    state: State<'_, AppState>,
    thread_key: String,
    language: String,
    message_count: u32,
    newest_at: String,
) -> CmdResult<Option<StoredSummary>> {
    state
        .db
        .with_conn(|conn| {
            let found = conn
                .query_row(
                    "SELECT summary, message_count, newest_at, created_at
                       FROM thread_summaries WHERE thread_key = ?1 AND language = ?2",
                    rusqlite::params![thread_key, language],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, i64>(1)? as u32,
                            row.get::<_, String>(2)?,
                            row.get::<_, i64>(3)?,
                        ))
                    },
                )
                .ok();

            Ok(found.map(|(summary, count, newest, created_at)| StoredSummary {
                summary,
                message_count: count,
                created_at,
                // Either more messages or a newer one: both mean it was written about a
                // conversation that has since moved.
                stale: count != message_count || newest != newest_at,
            }))
        })
        .map_err(describe)
}

/// Keep a summary, replacing whatever was there for this conversation and language.
#[tauri::command]
pub async fn save_thread_summary(
    state: State<'_, AppState>,
    thread_key: String,
    language: String,
    summary: String,
    message_count: u32,
    newest_at: String,
) -> CmdResult<()> {
    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO thread_summaries
                     (thread_key, language, summary, message_count, newest_at, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT (thread_key, language) DO UPDATE SET
                     summary = excluded.summary,
                     message_count = excluded.message_count,
                     newest_at = excluded.newest_at,
                     created_at = excluded.created_at",
                rusqlite::params![
                    thread_key,
                    language,
                    summary,
                    message_count as i64,
                    newest_at,
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0)
                ],
            )?;
            Ok(())
        })
        .map_err(describe)
}

/// The categories, in the order they are shown.
#[tauri::command]
pub async fn list_categories(
    state: State<'_, AppState>,
) -> CmdResult<Vec<categorize::Category>> {
    categorize::all(&state.db).map_err(describe)
}

/// Add a category. The description is what the assistant sorts by, so an empty one means
/// the category is yours to fill by hand.
#[tauri::command]
pub async fn create_category(
    state: State<'_, AppState>,
    name: String,
    description: String,
    auto_sort: bool,
) -> CmdResult<Vec<categorize::Category>> {
    if name.trim().is_empty() {
        return Err("a category needs a name".into());
    }
    let slug = categorize::slugify(&name);
    if slug.is_empty() {
        return Err("that name has no letters or numbers in it".into());
    }

    let existing = categorize::all(&state.db).map_err(describe)?;
    if existing.iter().any(|c| c.slug == slug) {
        return Err(format!("there is already a category called {name}"));
    }

    // With no description the model has nothing to sort by, so it would sort at random.
    let auto_sort = auto_sort && !description.trim().is_empty();
    categorize::create(&state.db, &name, &description, auto_sort).map_err(describe)?;
    categorize::all(&state.db).map_err(describe)
}

#[tauri::command]
pub async fn update_category(
    state: State<'_, AppState>,
    slug: String,
    name: String,
    description: String,
    auto_sort: bool,
) -> CmdResult<Vec<categorize::Category>> {
    if name.trim().is_empty() {
        return Err("a category needs a name".into());
    }
    let auto_sort = auto_sort && !description.trim().is_empty();
    categorize::update(&state.db, &slug, &name, &description, auto_sort).map_err(describe)?;
    categorize::all(&state.db).map_err(describe)
}

/// Remove a category. Everything in it becomes unsorted, so it can be sorted again into
/// whatever is left.
#[tauri::command]
pub async fn delete_category(
    state: State<'_, AppState>,
    slug: String,
) -> CmdResult<Vec<categorize::Category>> {
    categorize::delete(&state.db, &slug).map_err(describe)?;
    categorize::all(&state.db).map_err(describe)
}

/// Put messages in a category by hand. `slug` of `None` clears it.
///
/// What you set this way is marked as yours and no sorting pass touches it again, which is
/// the whole point: correcting the model once should stick.
#[tauri::command]
pub async fn set_message_category(
    state: State<'_, AppState>,
    message_ids: Vec<String>,
    slug: Option<String>,
) -> CmdResult<u32> {
    categorize::set_by_hand(&state.db, &message_ids, slug.as_deref()).map_err(describe)
}

/// Forget what the rules and the model decided, so the mailbox is sorted again. What you
/// set by hand is kept.
#[tauri::command]
pub async fn resort_mailbox(state: State<'_, AppState>) -> CmdResult<u32> {
    categorize::reset(&state.db).map_err(describe)
}

/// How much of the mailbox is sorted, without doing any sorting.
#[tauri::command]
pub async fn categorize_progress(state: State<'_, AppState>) -> CmdResult<CategorizeReport> {
    let (done, total) = categorize::progress(&state.db).map_err(describe)?;
    Ok(CategorizeReport { sorted: 0, looked_at: 0, done, total })
}

/// Choose what performs a translation: a downloaded model, or the Mac's own translator.
#[tauri::command]
pub async fn assistant_set_translation_backend(
    state: State<'_, AppState>,
    backend: crate::assistant::Backend,
) -> CmdResult<crate::assistant::Status> {
    state.assistant.set_translation_backend(backend).map_err(describe)?;
    Ok(state.assistant.status())
}

/// Start or resume a model's download in the background.
///
/// Returns at once; progress arrives as `assistant-progress` events carrying the model id,
/// and the end, however it ended, as `assistant-changed`, after which the interface re-reads
/// the status.
#[tauri::command]
pub async fn assistant_download_start(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    model_id: String,
) -> CmdResult<crate::assistant::Status> {
    use tauri::Emitter;

    let assistant = state.assistant.clone();
    let app = app.clone();
    let id = model_id.clone();
    std::thread::spawn(move || {
        let result = assistant.ensure_downloaded(&id, |done, total| {
            let _ = app.emit("assistant-progress", (id.as_str(), done, total));
        });
        let _ = app.emit("assistant-changed", result.is_ok());
    });
    // Give the thread a moment to flip the flag so the returned status already says
    // "downloading" rather than the state from a millisecond earlier.
    std::thread::sleep(std::time::Duration::from_millis(50));
    Ok(state.assistant.status())
}

#[tauri::command]
pub async fn assistant_download_pause(state: State<'_, AppState>, model_id: String) -> CmdResult<()> {
    state.assistant.pause_download(&model_id).map_err(describe)
}

#[tauri::command]
pub async fn assistant_download_cancel(state: State<'_, AppState>, model_id: String) -> CmdResult<()> {
    state.assistant.cancel_download(&model_id).map_err(describe)
}

#[tauri::command]
pub async fn assistant_remove_model(
    state: State<'_, AppState>,
    model_id: String,
) -> CmdResult<crate::assistant::Status> {
    state.assistant.remove_model(&model_id).map_err(describe)?;
    Ok(state.assistant.status())
}

/// Run one task, streaming pieces as `assistant-token` events tagged with `job_id`, and
/// returning the cleaned complete text at the end.
#[tauri::command]
pub async fn assistant_run(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    task: crate::assistant::Task,
) -> CmdResult<String> {
    use tauri::Emitter;

    let assistant = state.assistant.clone();
    tauri::async_runtime::spawn_blocking(move || {
        assistant
            .run(&task, |piece| {
                let _ = app.emit("assistant-token", (job_id.as_str(), piece));
            })
            .map_err(describe)
    })
    .await
    .map_err(describe)?
}

/// Forget the account: revoke at Google, drop the keychain entry, wipe the local mail.
#[tauri::command]
pub async fn sign_out(state: State<'_, AppState>) -> CmdResult<()> {
    let db = state.db.clone();
    let session = state.session.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let email = match session.lock().map_err(describe)?.take() {
            Some(account) => Some(account.email().to_string()),
            None => mailbox::accounts(&db).map_err(describe)?.into_iter().next(),
        };

        let Some(email) = email else {
            return Ok(());
        };

        if let Ok(Some(refresh_token)) = auth::load_refresh_token(&email) {
            // Best effort: if Google is unreachable the local side must still be cleaned up,
            // otherwise "sign out" leaves mail on disk.
            if let Err(e) = auth::revoke(&refresh_token) {
                log::warn!("could not revoke the token with Google: {e}");
            }
        }

        auth::delete_refresh_token(&email).map_err(describe)?;

        // ON DELETE CASCADE takes the messages, addresses and attachments with it.
        db.with_conn(|conn| conn.execute("DELETE FROM accounts WHERE email = ?1", [&email]))
            .map_err(describe)?;

        Ok(())
    })
    .await
    .map_err(describe)?
}

/// Bring a session back from the keychain if one is not already live.
fn ensure_session(db: &Arc<Db>, session: &Arc<Mutex<Option<GmailAccount>>>) -> Result<(), String> {
    if session.lock().map_err(describe)?.is_some() {
        return Ok(());
    }

    let email = mailbox::accounts(db)
        .map_err(describe)?
        .into_iter()
        .next()
        .ok_or("no account is connected")?;

    let refresh_token = auth::load_refresh_token(&email)
        .map_err(describe)?
        .ok_or("the saved sign-in is missing from the keychain; connect the account again")?;

    let account = GmailAccount::resume(&email, &refresh_token).map_err(describe)?;
    *session.lock().map_err(describe)? = Some(account);
    Ok(())
}
