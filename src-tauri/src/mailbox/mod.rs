//! Read the local database into the shapes the interface already uses.
//!
//! The UI is organised around *people*, but mail is organised around *addresses*, so this is
//! where one becomes the other: for every message it works out who the counterpart is (the
//! human at the other end), and everything else is grouped under them.

use std::collections::HashMap;

use rusqlite::params;
use serde::Serialize;

use crate::db::{Db, DbError};

pub mod html;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub id: String,
    pub name: String,
    pub email: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub is_broadcast: bool,
}

/// One person on a message, as written in the header.
///
/// The address travels with the name because a name alone cannot be checked: two Kristins,
/// a colleague and a stranger with the same display name, or a reply-to that quietly goes
/// somewhere else are all invisible without it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Address {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Audience {
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub cc: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub others: Vec<String>,
    /// Everyone the message was addressed to, you included, with their addresses.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub to: Vec<Address>,
    /// Everyone on copy.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub copies: Vec<Address>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    /// The provider's thread id. Real threading comes from this, not from subject matching,
    /// which is what makes a conversation between four people stay one conversation.
    pub thread_id: Option<String>,
    pub person_id: String,
    pub from_me: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    pub body: String,
    /// The message as allowlisted inline markup, in the app's own design.
    ///
    /// Always this, never the sender's layout. Deciding automatically which mail "deserves"
    /// its original rendering turned out to be unwinnable: a corporate signature is
    /// structurally identical to a small newsletter, so every heuristic misfired on ordinary
    /// replies. The sender's version is available on request via `original_html`.
    ///
    /// `body` stays the text version regardless: previews, search and quote folding all need
    /// text, and a message that renders as markup must still be searchable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_html: Option<String>,
    /// Whether a sender's-layout version exists to ask for.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub has_original: bool,
    /// The sender's signature, split off so it can be hidden.
    ///
    /// In a thread of eight replies the same signature block appears eight times, and it is
    /// routinely longer than anything anyone wrote.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature_html: Option<String>,
    /// The earlier messages this one quotes, one entry per level of the chain.
    ///
    /// Always inline, never framed: quoted history is reference material, so it is rendered
    /// in the app's own design rather than preserving whichever client produced it.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub quoted: Vec<html::QuotedMessage>,
    pub sent_at: String,
    pub attachment_ids: Vec<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub unread: bool,
    /// Never sent to anyone. Gmail keeps an autosaved draft as a message of its own, so
    /// without this a half-typed sentence appears in a conversation as if it had been sent.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub is_draft: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audience: Option<Audience>,
    /// Who actually sent it, address included. Not derivable from `person_id`: on your own
    /// messages that is the person you wrote to, not you.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sender: Option<Address>,
    /// What the message was sorted as, once something has sorted it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    /// "rule" or "model". The label in the list says which, because calling a decision the
    /// model never made an AI one would be a small lie told on every row.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_source: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Thing {
    pub id: String,
    pub filename: String,
    pub kind: String,
    pub size_bytes: i64,
    pub person_id: String,
    pub message_id: String,
    pub received_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mailbox {
    pub account: Option<String>,
    pub people: Vec<Person>,
    pub messages: Vec<Message>,
    pub things: Vec<Thing>,
}

struct RawMessage {
    row_id: i64,
    remote_id: String,
    thread_remote_id: Option<String>,
    subject: Option<String>,
    sent_at: i64,
    snippet: Option<String>,
    body_text: Option<String>,
    body_html: Option<String>,
    unread: bool,
    category: Option<String>,
    category_source: Option<String>,
    is_draft: bool,
}

struct RawAddress {
    kind: String,
    name: Option<String>,
    email: String,
}

/// Record messages as read locally.
///
/// Done before the server is told, so the interface never waits on the network to update
/// something the user just did. If the server call then fails the local state stands; the
/// next proper incremental sync reconciles it.
pub fn mark_read(db: &Db, remote_ids: &[String]) -> Result<(), DbError> {
    db.with_conn(|conn| {
        for id in remote_ids {
            conn.execute(
                "UPDATE messages SET is_read = 1 WHERE remote_id = ?1",
                params![id],
            )?;
            // The UNREAD label is stored as a folder membership too; leaving it would make
            // the two views of the same fact disagree.
            conn.execute(
                "DELETE FROM message_folders
                  WHERE message_id IN (SELECT id FROM messages WHERE remote_id = ?1)
                    AND folder_id IN (SELECT id FROM folders WHERE remote_id = 'UNREAD')",
                params![id],
            )?;
        }
        Ok(())
    })
}

/// Which accounts are signed in.
///
/// Deliberately from the database rather than the keychain: answering "is anyone signed in"
/// must not make the operating system prompt for keychain access.
pub fn accounts(db: &Db) -> Result<Vec<String>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare("SELECT email FROM accounts ORDER BY created_at")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect()
    })
}

/// The sender's own HTML for one message, sanitised for a sandboxed frame.
///
/// Fetched on request rather than sent with every message: full mail HTML runs to tens of
/// kilobytes each, and almost none of it is ever looked at.
pub fn original_html(db: &Db, remote_id: &str) -> Result<Option<String>, DbError> {
    db.with_conn(|conn| {
        let stored: Option<String> = conn
            .query_row(
                "SELECT body_html FROM messages WHERE remote_id = ?1",
                params![remote_id],
                |row| row.get(0),
            )
            .unwrap_or(None);
        Ok(stored.as_deref().map(html::sanitize))
    })
}

/// Everything for the signed-in account, ready to hand to the frontend.
pub fn load(db: &Db, account_email: Option<&str>) -> Result<Mailbox, DbError> {
    let Some(me) = account_email else {
        return Ok(Mailbox {
            account: None,
            people: Vec::new(),
            messages: Vec::new(),
            things: Vec::new(),
        });
    };
    let me_lower = me.to_lowercase();

    db.with_conn(|conn| {
        let account_id: Option<i64> = conn
            .query_row(
                "SELECT id FROM accounts WHERE email = ?1",
                params![me],
                |row| row.get(0),
            )
            .ok();

        let Some(account_id) = account_id else {
            return Ok(Mailbox {
                account: Some(me.to_string()),
                people: Vec::new(),
                messages: Vec::new(),
                things: Vec::new(),
            });
        };

        let mut stmt = conn.prepare(
            "SELECT m.id, m.remote_id, t.remote_id, m.subject, m.sent_at, m.snippet,
                    m.body_text, m.body_html, m.is_read, m.category, m.category_source,
                    m.is_draft
               FROM messages m
               JOIN threads t ON t.id = m.thread_id
              WHERE m.account_id = ?1
              ORDER BY m.sent_at DESC",
        )?;
        let raw_messages: Vec<RawMessage> = stmt
            .query_map(params![account_id], |row| {
                Ok(RawMessage {
                    row_id: row.get(0)?,
                    remote_id: row.get(1)?,
                    thread_remote_id: row.get(2)?,
                    subject: row.get(3)?,
                    sent_at: row.get(4)?,
                    snippet: row.get(5)?,
                    body_text: row.get(6)?,
                    body_html: row.get(7)?,
                    unread: row.get::<_, i64>(8)? == 0,
                    category: row.get(9)?,
                    category_source: row.get(10)?,
                    is_draft: row.get::<_, i64>(11)? != 0,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;

        // Addresses for every message in one pass rather than a query per message.
        let mut stmt = conn.prepare(
            "SELECT a.message_id, a.kind, a.name, a.email
               FROM message_addresses a
               JOIN messages m ON m.id = a.message_id
              WHERE m.account_id = ?1",
        )?;
        let mut addresses: HashMap<i64, Vec<RawAddress>> = HashMap::new();
        let mut rows = stmt.query(params![account_id])?;
        while let Some(row) = rows.next()? {
            addresses.entry(row.get(0)?).or_default().push(RawAddress {
                kind: row.get(1)?,
                name: row.get(2)?,
                email: row.get(3)?,
            });
        }

        // Which message each attachment belongs to, for the embedded check below.
        let bodies: HashMap<i64, String> = raw_messages
            .iter()
            .filter_map(|m| m.body_html.as_ref().map(|html| (m.row_id, html.clone())))
            .collect();

        let mut stmt = conn.prepare(
            "SELECT t.id, t.message_id, t.filename, t.mime_type, t.size_bytes, t.is_inline,
                    t.content_id
               FROM attachments t
               JOIN messages m ON m.id = t.message_id
              WHERE m.account_id = ?1",
        )?;
        let mut attachments: HashMap<i64, Vec<(i64, String, String, i64)>> = HashMap::new();
        let mut rows = stmt.query(params![account_id])?;
        while let Some(row) = rows.next()? {
            let message_id: i64 = row.get(1)?;
            let inline: i64 = row.get(5)?;
            let content_id: Option<String> = row.get(6)?;

            // An image is part of the body only if the body actually points at it. Gmail
            // gives every attached image a Content-ID whether or not the message embeds it,
            // so trusting that flag alone made eight photographs disappear: not drawn in the
            // text, and not listed as attachments either.
            if inline == 1 {
                let embedded = content_id.as_deref().is_some_and(|id| {
                    bodies
                        .get(&message_id)
                        .is_some_and(|html: &String| html.contains(&format!("cid:{id}")))
                });
                if embedded {
                    continue;
                }
            }

            attachments
                .entry(message_id)
                .or_default()
                .push((row.get(0)?, row.get(2)?, row.get(3)?, row.get(4)?));
        }

        let mut people: HashMap<String, Person> = HashMap::new();
        let mut messages = Vec::new();
        let mut things = Vec::new();

        for raw in raw_messages {
            let empty = Vec::new();
            let addrs = addresses.get(&raw.row_id).unwrap_or(&empty);

            let from = addrs.iter().find(|a| a.kind == "from");
            let from_me = from.map(|a| a.email == me_lower).unwrap_or(false);

            // The counterpart is the human at the other end: the sender when they wrote to
            // you, and the first recipient when you wrote to them.
            let counterpart = if from_me {
                addrs.iter().find(|a| a.kind == "to" && a.email != me_lower)
            } else {
                from
            };

            let Some(counterpart) = counterpart else {
                // Mail with no usable counterpart (a draft with no recipient, a malformed
                // header) has nowhere to live in a people-shaped interface.
                continue;
            };

            let person_id = counterpart.email.clone();
            people.entry(person_id.clone()).or_insert_with(|| Person {
                id: person_id.clone(),
                name: display_name(counterpart),
                email: counterpart.email.clone(),
                role: None,
                is_broadcast: is_broadcast(&counterpart.email, raw.body_html.as_deref()),
            });

            let others: Vec<String> = addrs
                .iter()
                .filter(|a| matches!(a.kind.as_str(), "to" | "cc"))
                .filter(|a| a.email != me_lower && a.email != person_id)
                .map(display_name)
                .collect();

            let addresses_of = |kind: &str| -> Vec<Address> {
                addrs
                    .iter()
                    .filter(|a| a.kind == kind)
                    .map(|a| Address { name: display_name(a), email: a.email.clone() })
                    .collect()
            };
            let to = addresses_of("to");
            let copies = addresses_of("cc");

            let sender = from.map(|a| Address { name: display_name(a), email: a.email.clone() });

            let only_cc = addrs
                .iter()
                .any(|a| a.kind == "cc" && a.email == me_lower)
                && !addrs.iter().any(|a| a.kind == "to" && a.email == me_lower);

            // Kept even for a plain one-to-one message now: the addresses are the point,
            // and "who else saw this" is answered by their absence.
            let audience = if others.is_empty() && !only_cc && to.is_empty() && copies.is_empty() {
                None
            } else {
                Some(Audience { cc: only_cc, others, to, copies })
            };

            // Quote first, then signature: the signature belongs to *this* message, and
            // searching the whole thing would find one inside the quoted history instead.
            let (body_html, signature_html, quoted, own_text) = match raw.body_html.as_deref() {
                None => (None, None, Vec::new(), None),
                Some(source) => {
                    let (own, quoted) = html::split_quote(source);
                    let (own, signature) = html::split_signature(&own);

                    let quoted = if quoted.trim().is_empty() {
                        Vec::new()
                    } else {
                        html::explode_quotes(&quoted)
                    };
                    let signature = if signature.trim().is_empty() {
                        None
                    } else {
                        Some(html::to_inline(&signature))
                    };

                    (Some(html::to_inline(&own)), signature, quoted, Some(html::to_text(&own)))
                }
            };

            let attachment_rows = attachments.get(&raw.row_id).cloned().unwrap_or_default();
            for (id, filename, mime_type, size) in &attachment_rows {
                things.push(Thing {
                    id: id.to_string(),
                    filename: filename.clone(),
                    kind: kind_for(filename, mime_type),
                    size_bytes: *size,
                    person_id: person_id.clone(),
                    message_id: raw.remote_id.clone(),
                    received_at: to_iso(raw.sent_at),
                });
            }

            messages.push(Message {
                id: raw.remote_id.clone(),
                thread_id: raw.thread_remote_id.clone(),
                person_id,
                from_me,
                subject: raw.subject.clone(),
                // Text of what this message actually says, with the quoted history and the
                // signature already removed. List previews and the timeline both want the
                // words someone wrote, not eight repetitions of a footer.
                body: own_text.clone().unwrap_or_else(|| body_of(&raw)),
                body_html,
                has_original: raw.body_html.is_some(),
                signature_html,
                quoted,
                sent_at: to_iso(raw.sent_at),
                attachment_ids: attachment_rows.iter().map(|(id, ..)| id.to_string()).collect(),
                unread: raw.unread,
                audience,
                sender,
                category: raw.category.clone(),
                category_source: raw.category_source.clone(),
                is_draft: raw.is_draft,
            });
        }

        let mut people: Vec<Person> = people.into_values().collect();
        people.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

        Ok(Mailbox {
            account: Some(me.to_string()),
            people,
            messages,
            things,
        })
    })
}

fn display_name(address: &RawAddress) -> String {
    match &address.name {
        Some(name) if !name.trim().is_empty() => name.trim().to_string(),
        // Better than showing a bare address: "asgeir.heart" reads as a name at a glance.
        _ => address
            .email
            .split('@')
            .next()
            .unwrap_or(&address.email)
            .replace(['.', '_'], " ")
            .to_string(),
    }
}

/// Senders that never expect a reply. Kept apart from people, because a newsletter is not a
/// correspondent and letting them compete for the top of the list is what makes an inbox
/// feel crowded.
///
/// Two signals. The address alone misses a lot: Klaviyo's reports come from
/// `marketing-responses@`, which no list of no-reply spellings would catch. The body is the
/// better tell: bulk mail carries an unsubscribe link, and mail from a person never does.
fn is_broadcast(email: &str, body_html: Option<&str>) -> bool {
    let local = email.split('@').next().unwrap_or("").to_lowercase();
    let by_address = [
        "no-reply", "noreply", "donotreply", "do-not-reply", "mailer-daemon", "bounce",
        "notifications", "notification", "newsletter", "marketing", "news@", "hello@", "info@",
        "digest", "updates", "alerts",
    ]
    .iter()
    .any(|marker| marker.ends_with('@') && format!("{local}@") == *marker || !marker.ends_with('@') && local.contains(marker));

    let by_body = body_html
        .map(|html| {
            let lower = html.to_ascii_lowercase();
            ["unsubscribe", "avsluta prenumeration", "avregistrer", "avprenumerer", "abmelden", "manage preferences"]
                .iter()
                .any(|marker| lower.contains(marker))
        })
        .unwrap_or(false);

    by_address || by_body
}

/// Plain text if the sender provided it, otherwise the HTML with its tags removed.
///
/// Crude on purpose: rendering real HTML mail safely needs a sandboxed frame and is its own
/// piece of work. This keeps the message readable until that exists.
fn body_of(raw: &RawMessage) -> String {
    if let Some(text) = &raw.body_text {
        if !text.trim().is_empty() {
            return text.trim().to_string();
        }
    }
    if let Some(source) = &raw.body_html {
        let stripped = html::to_text(source);
        if !stripped.trim().is_empty() {
            return stripped;
        }
    }
    raw.snippet.clone().unwrap_or_default()
}

fn kind_for(filename: &str, mime_type: &str) -> String {
    let extension = filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase();

    match extension.as_str() {
        "pdf" => "pdf",
        "csv" | "xls" | "xlsx" | "numbers" | "tsv" => "sheet",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "heic" | "svg" => "image",
        "doc" | "docx" | "pages" | "rtf" | "txt" | "md" => "doc",
        "zip" | "gz" | "tar" | "rar" | "7z" => "archive",
        _ if mime_type.starts_with("image/") => "image",
        _ if mime_type == "application/pdf" => "pdf",
        _ => "other",
    }
    .to_string()
}

/// Unix seconds to the ISO 8601 the frontend parses. Hand-rolled to avoid a date crate for
/// one conversion; days-from-civil is Howard Hinnant's algorithm.
fn to_iso(unix_seconds: i64) -> String {
    let days = unix_seconds.div_euclid(86_400);
    let seconds = unix_seconds.rem_euclid(86_400);

    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };

    format!(
        "{year:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        seconds / 3600,
        (seconds % 3600) / 60,
        seconds % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_conversion_matches_known_timestamps() {
        assert_eq!(to_iso(0), "1970-01-01T00:00:00Z");
        assert_eq!(to_iso(1_700_000_000), "2023-11-14T22:13:20Z");
    }

    #[test]
    fn no_reply_senders_are_broadcast() {
        assert!(is_broadcast("no-reply@klaviyo.com", None));
        assert!(is_broadcast("notifications@linear.app", None));
        assert!(!is_broadcast("asgeir@bambusa.no", None));
    }

    #[test]
    fn bulk_mail_is_recognised_by_its_unsubscribe_link_when_the_address_looks_personal() {
        // Klaviyo's reports come from an address no no-reply pattern catches.
        let newsletter = "<p>Se hur du presterade</p><a href=\"https://x/unsubscribe\">Unsubscribe</a>";
        assert!(is_broadcast("marketing-responses@klaviyo.com", Some(newsletter)));
        // A colleague mentioning the word in prose is still a colleague.
        assert!(!is_broadcast("asgeir@bambusa.no", Some("<p>Hei Hannes</p>")));
    }
}

#[cfg(test)]
mod debug_test;
