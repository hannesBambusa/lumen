//! Fetching attachments and turning them into something previewable.
//!
//! Bytes are cached on disk after the first fetch, so opening the same file twice costs one
//! network round trip rather than two. Previews are produced here rather than in the
//! frontend because the parsing, spreadsheets especially, has no business being in the UI.

use std::path::Path;

use base64::Engine;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use crate::db::{Db, DbError};
use crate::provider::gmail::GmailAccount;

/// Refuse to fetch anything larger. A 40MB archive is not a preview, and inlining it would
/// stall the window while the webview chewed through the data URL.
const MAX_FETCH_BYTES: i64 = 12 * 1024 * 1024;

/// Rows and columns shown from a spreadsheet. Enough to recognise a file, not a viewer.
const SHEET_ROWS: usize = 40;
const SHEET_COLS: usize = 14;

#[derive(Debug, thiserror::Error)]
pub enum PreviewError {
    #[error("database: {0}")]
    Db(#[from] DbError),
    #[error("gmail: {0}")]
    Gmail(#[from] crate::provider::gmail::GmailError),
    #[error("could not cache the attachment: {0}")]
    Io(#[from] std::io::Error),
    #[error("that attachment is no longer in the local database")]
    Missing,
    #[error("Gmail did not keep a downloadable copy of this attachment")]
    NotDownloadable,
}

pub type Result<T> = std::result::Result<T, PreviewError>;

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Preview {
    /// Inlined as a data URL. Images are the one type where showing the real thing is both
    /// cheap and exactly what was wanted.
    Image { filename: String, data_url: String },
    Pdf { filename: String, data_url: String },
    Sheet {
        filename: String,
        /// One entry per worksheet that had any content.
        sheets: Vec<SheetPreview>,
    },
    /// Nothing useful to show, with a reason rather than a blank box.
    Unsupported { filename: String, reason: String },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetPreview {
    pub name: String,
    pub rows: Vec<Vec<String>>,
    /// The sheet's real size, so the preview can say what it is not showing.
    pub total_rows: usize,
    pub total_cols: usize,
}

struct Attachment {
    row_id: i64,
    message_remote_id: String,
    remote_id: Option<String>,
    filename: String,
    mime_type: String,
    size_bytes: i64,
    local_path: Option<String>,
}

/// Fetch (or reuse) an attachment and build a preview of it.
pub fn preview(
    db: &Db,
    account: &mut GmailAccount,
    cache_dir: &Path,
    attachment_id: i64,
) -> Result<Preview> {
    let attachment = load(db, attachment_id)?;

    if attachment.size_bytes > MAX_FETCH_BYTES {
        return Ok(Preview::Unsupported {
            filename: attachment.filename,
            reason: format!(
                "Too large to preview ({} MB). Previews stop at {} MB.",
                attachment.size_bytes / 1_048_576,
                MAX_FETCH_BYTES / 1_048_576
            ),
        });
    }

    let bytes = bytes_for(db, account, cache_dir, &attachment)?;
    Ok(build(&attachment, bytes))
}

fn load(db: &Db, attachment_id: i64) -> Result<Attachment> {
    let found = db.with_conn(|conn| {
        conn.query_row(
            "SELECT a.id, m.remote_id, a.remote_id, a.filename, a.mime_type, a.size_bytes,
                    a.local_path
               FROM attachments a
               JOIN messages m ON m.id = a.message_id
              WHERE a.id = ?1",
            params![attachment_id],
            |row| {
                Ok(Attachment {
                    row_id: row.get(0)?,
                    message_remote_id: row.get(1)?,
                    remote_id: row.get(2)?,
                    filename: row.get(3)?,
                    mime_type: row.get(4)?,
                    size_bytes: row.get(5)?,
                    local_path: row.get(6)?,
                })
            },
        )
        // A missing row is an ordinary outcome here (the mailbox was wiped and resynced),
        // so it becomes None rather than a database error.
        .optional()
    })?;

    found.ok_or(PreviewError::Missing)
}

/// Cached bytes if there are any, otherwise fetch and cache them.
fn bytes_for(
    db: &Db,
    account: &mut GmailAccount,
    cache_dir: &Path,
    attachment: &Attachment,
) -> Result<Vec<u8>> {
    if let Some(path) = &attachment.local_path {
        if let Ok(bytes) = std::fs::read(path) {
            return Ok(bytes);
        }
        // The cache file was moved or deleted; fall through and fetch it again.
    }

    let remote = attachment
        .remote_id
        .as_deref()
        .ok_or(PreviewError::NotDownloadable)?;

    let bytes = account.fetch_attachment(&attachment.message_remote_id, remote)?;

    std::fs::create_dir_all(cache_dir)?;
    let path = cache_dir.join(format!("{}.bin", attachment.row_id));
    std::fs::write(&path, &bytes)?;

    db.with_conn(|conn| {
        conn.execute(
            "UPDATE attachments SET local_path = ?2 WHERE id = ?1",
            params![attachment.row_id, path.to_string_lossy()],
        )
    })?;

    Ok(bytes)
}

fn build(attachment: &Attachment, bytes: Vec<u8>) -> Preview {
    let filename = attachment.filename.clone();
    let extension = filename.rsplit('.').next().unwrap_or("").to_lowercase();

    if attachment.mime_type.starts_with("image/")
        || matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp")
    {
        return Preview::Image {
            data_url: data_url(&attachment.mime_type, "image/png", &bytes),
            filename,
        };
    }

    if attachment.mime_type == "application/pdf" || extension == "pdf" {
        return Preview::Pdf {
            data_url: data_url(&attachment.mime_type, "application/pdf", &bytes),
            filename,
        };
    }

    if matches!(extension.as_str(), "xlsx" | "xlsm" | "xls" | "ods" | "csv") {
        return match read_sheets(&bytes, &extension) {
            Ok(sheets) if !sheets.is_empty() => Preview::Sheet { filename, sheets },
            Ok(_) => Preview::Unsupported {
                filename,
                reason: "The spreadsheet has no readable sheets.".into(),
            },
            Err(e) => Preview::Unsupported {
                filename,
                reason: format!("Could not read the spreadsheet: {e}"),
            },
        };
    }

    Preview::Unsupported {
        filename,
        reason: "No preview for this file type yet.".into(),
    }
}

fn data_url(mime: &str, fallback: &str, bytes: &[u8]) -> String {
    // Some senders leave the MIME type off entirely; the extension already told us what it is.
    let mime = if mime.is_empty() { fallback } else { mime };
    format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

fn read_sheets(bytes: &[u8], extension: &str) -> std::result::Result<Vec<SheetPreview>, String> {
    use calamine::{Data, Reader};

    if extension == "csv" {
        return Ok(vec![read_csv(bytes)]);
    }

    let cursor = std::io::Cursor::new(bytes.to_vec());
    let mut workbook = calamine::open_workbook_auto_from_rs(cursor).map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for name in workbook.sheet_names().to_vec() {
        let Ok(range) = workbook.worksheet_range(&name) else {
            continue;
        };
        let (total_rows, total_cols) = range.get_size();
        if total_rows == 0 {
            continue;
        }

        let rows = range
            .rows()
            .take(SHEET_ROWS)
            .map(|row| {
                row.iter()
                    .take(SHEET_COLS)
                    .map(|cell| match cell {
                        Data::Empty => String::new(),
                        // Whole numbers arrive as floats, and "3" reads better than "3.0" in
                        // a column of quantities.
                        Data::Float(f) if f.fract() == 0.0 => format!("{}", *f as i64),
                        other => other.to_string(),
                    })
                    .collect()
            })
            .collect();

        out.push(SheetPreview {
            name,
            rows,
            total_rows,
            total_cols,
        });
    }

    Ok(out)
}

fn read_csv(bytes: &[u8]) -> SheetPreview {
    let text = String::from_utf8_lossy(bytes);
    let all: Vec<&str> = text.lines().collect();

    // Semicolons, because a Swedish Excel export uses them and splitting on commas would put
    // the whole row into one cell.
    let semicolons = all.first().map(|l| l.matches(';').count()).unwrap_or(0);
    let commas = all.first().map(|l| l.matches(',').count()).unwrap_or(0);
    let separator = if semicolons > commas { ';' } else { ',' };

    let rows: Vec<Vec<String>> = all
        .iter()
        .take(SHEET_ROWS)
        .map(|line| {
            line.split(separator)
                .take(SHEET_COLS)
                .map(|cell| cell.trim().trim_matches('"').to_string())
                .collect()
        })
        .collect();

    let total_cols = rows.iter().map(|r| r.len()).max().unwrap_or(0);

    SheetPreview {
        name: "CSV".into(),
        rows,
        total_rows: all.len(),
        total_cols,
    }
}

/// Longest edge of a generated thumbnail, in pixels.
///
/// Twice the tile's drawn size, so it stays sharp on a Retina display without storing a
/// full-resolution copy of every photo anyone has ever sent.
const THUMB_EDGE: u32 = 320;

/// Skip thumbnailing anything larger. A 9MB photo costs a download and a decode for a
/// picture the size of a postage stamp, and the grid would crawl.
const MAX_THUMB_SOURCE_BYTES: i64 = 6 * 1024 * 1024;

/// Rows and columns in a spreadsheet's tile-sized preview.
const THUMB_SHEET_ROWS: usize = 6;
const THUMB_SHEET_COLS: usize = 4;

/// What a tile can show for one attachment.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Thumb {
    /// A downscaled JPEG, ready to drop into an `<img>`.
    Image { data_url: String },
    /// The document itself. PDFs are rendered in the frontend, where a renderer already
    /// exists in the shape of a canvas; doing it here would mean a native PDF library and
    /// a much heavier build.
    Pdf { data_url: String },
    /// The first few cells, drawn by the frontend as a miniature grid.
    Sheet { rows: Vec<Vec<String>> },
    /// Nothing to show. The caller falls back to the type label.
    None,
}

/// A tile-sized preview of an attachment.
///
/// Generated once and cached on disk beside the original bytes.
pub fn thumbnail(
    db: &Db,
    account: &mut GmailAccount,
    cache_dir: &Path,
    attachment_id: i64,
) -> Result<Thumb> {
    let attachment = load(db, attachment_id)?;

    if attachment.size_bytes > MAX_THUMB_SOURCE_BYTES {
        return Ok(Thumb::None);
    }

    let extension = attachment
        .filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase();

    let is_image = attachment.mime_type.starts_with("image/")
        || matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp");
    let is_pdf = attachment.mime_type == "application/pdf" || extension == "pdf";
    let is_sheet = matches!(extension.as_str(), "xlsx" | "xlsm" | "xls" | "ods" | "csv");

    if !is_image && !is_pdf && !is_sheet {
        return Ok(Thumb::None);
    }

    if is_image {
        let cached = cache_dir.join(format!("{}.thumb.jpg", attachment.row_id));
        if let Ok(bytes) = std::fs::read(&cached) {
            return Ok(Thumb::Image {
                data_url: data_url("image/jpeg", "image/jpeg", &bytes),
            });
        }
    }

    let source = bytes_for(db, account, cache_dir, &attachment)?;

    if is_pdf {
        return Ok(Thumb::Pdf {
            data_url: data_url("application/pdf", "application/pdf", &source),
        });
    }

    if is_sheet {
        let rows = read_sheets(&source, &extension)
            .ok()
            .and_then(|sheets| sheets.into_iter().next())
            .map(|sheet| {
                sheet
                    .rows
                    .into_iter()
                    .take(THUMB_SHEET_ROWS)
                    .map(|row| row.into_iter().take(THUMB_SHEET_COLS).collect())
                    .collect::<Vec<Vec<String>>>()
            })
            .unwrap_or_default();

        return Ok(if rows.is_empty() {
            Thumb::None
        } else {
            Thumb::Sheet { rows }
        });
    }

    let Ok(decoded) = image::load_from_memory(&source) else {
        // A file called .png that is not a PNG is common enough not to be an error.
        return Ok(Thumb::None);
    };

    let thumb = decoded.thumbnail(THUMB_EDGE, THUMB_EDGE);
    let mut encoded = Vec::new();
    if thumb
        .to_rgb8()
        .write_with_encoder(image::codecs::jpeg::JpegEncoder::new_with_quality(
            &mut encoded,
            72,
        ))
        .is_err()
    {
        return Ok(Thumb::None);
    }

    std::fs::create_dir_all(cache_dir)?;
    std::fs::write(cache_dir.join(format!("{}.thumb.jpg", attachment.row_id)), &encoded)?;

    Ok(Thumb::Image {
        data_url: data_url("image/jpeg", "image/jpeg", &encoded),
    })
}
