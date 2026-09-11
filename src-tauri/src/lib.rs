//! Lumen: local-first desktop mail client.
//!
//! Layering, top to bottom: the UI calls Tauri commands, commands read and write [`db`], and
//! only [`sync`] talks to a [`provider`]. No Gmail vocabulary exists above `provider`, so
//! IMAP and Graph adapters can slot in without touching anything else.

pub mod assistant;
pub mod attachments;
pub mod auth;
pub mod categorize;
pub mod commands;
pub mod db;
pub mod mailbox;
pub mod provider;
pub mod sync;

use std::sync::{Arc, Mutex};

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Per-user application data directory, created on first launch.
            let data_dir = app.path().app_data_dir()?;
            let db = db::Db::open(&data_dir)?;

            app.manage(commands::AppState {
                db: Arc::new(db),
                assistant: assistant::Assistant::open(&data_dir),
                cache_dir: data_dir.join("attachments"),
                session: Arc::new(Mutex::new(None)),
            });
            log::info!("store ready at {}", data_dir.display());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::current_account,
            commands::connect_account,
            commands::sync_now,
            commands::load_mailbox,
            commands::original_html,
            commands::mark_read,
            commands::assistant_status,
            commands::assistant_set_enabled,
            commands::assistant_set_features,
            commands::assistant_set_model,
            commands::assistant_set_translation_model,
            commands::assistant_set_translation_backend,
            commands::categorize_batch,
            commands::categorize_progress,
            commands::list_categories,
            commands::create_category,
            commands::update_category,
            commands::delete_category,
            commands::set_message_category,
            commands::resort_mailbox,
            commands::thread_contents,
            commands::thread_summary,
            commands::save_thread_summary,
            commands::assistant_download_start,
            commands::assistant_download_pause,
            commands::assistant_download_cancel,
            commands::assistant_remove_model,
            commands::assistant_run,
            commands::preview_attachment,
            commands::attachment_thumbnail,
            commands::sign_out,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
