//! Sorting mail into categories, so the list can be filtered.
//!
//! Rules first, model second, and your own decision above both. Most of a mailbox can be
//! sorted with certainty and no computation at all: a no-reply address with an unsubscribe
//! link is a newsletter, an invitation carries a calendar part, your own sent mail is not
//! asking you for anything. Only what is left goes to the model, which costs a second or
//! two per message and is wrong often enough to be worth avoiding where something certain
//! exists.
//!
//! The categories themselves are rows, not code: they can be added, renamed and removed,
//! and the model's prompt is built from whatever the table holds. That is also why each one
//! carries a description. The name is for you, the description is what the model sorts by,
//! and a category described vaguely sorts badly.
//!
//! Measured on 14 real messages: the model alone got 12, and both misses were bulk mail
//! that the rules catch outright.

use serde::{Deserialize, Serialize};

use crate::assistant::{Assistant, Task};
use crate::db::Db;

/// Set by hand. Outranks everything and is never revisited by a sorting pass.
pub const SOURCE_USER: &str = "user";
pub const SOURCE_RULE: &str = "rule";
pub const SOURCE_MODEL: &str = "model";

/// Past this the model starts confusing options with each other, and every extra line is
/// prompt it has to read for every message. The interface says so rather than enforcing it
/// somewhere invisible.
pub const MAX_AUTO_SORTED: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub slug: String,
    /// The English name. Built-in ones are translated in the interface by slug; one you
    /// typed yourself is shown exactly as you typed it.
    pub name: String,
    /// The line handed to the model. This is what it sorts by.
    pub description: String,
    /// Built-in categories have deterministic rules behind them that a made-up one cannot.
    pub is_builtin: bool,
    /// Whether the assistant may sort into it, or only you.
    pub auto_sort: bool,
    /// Whether you have reworded it.
    ///
    /// A built-in you have not touched is shown translated, because what the assistant
    /// reads stays English on purpose: with Swedish descriptions the model started
    /// reasoning instead of answering and lost 6 of 14. Once you reword one, your wording
    /// is what it reads and the interface shows exactly that.
    pub edited: bool,
    pub position: i64,
}

pub fn all(db: &Db) -> crate::db::Result<Vec<Category>> {
    db.with_conn(|conn| {
        let mut statement = conn.prepare(
            "SELECT slug, name, description, is_builtin, auto_sort, position, edited
               FROM categories ORDER BY position, slug",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(Category {
                slug: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                is_builtin: row.get::<_, i64>(3)? != 0,
                auto_sort: row.get::<_, i64>(4)? != 0,
                position: row.get(5)?,
                edited: row.get::<_, i64>(6)? != 0,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })
}

/// A name turned into a stable key. Two categories cannot share one, which is also how a
/// duplicate name is rejected.
pub fn slugify(name: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = true;
    for ch in name.trim().to_lowercase().chars() {
        if ch.is_alphanumeric() {
            slug.push(ch);
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }
    slug.trim_matches('-').chars().take(40).collect()
}

pub fn create(
    db: &Db,
    name: &str,
    description: &str,
    auto_sort: bool,
) -> crate::db::Result<Category> {
    let slug = slugify(name);

    db.with_conn(|conn| {
        // After the built-ins, in creation order.
        let next: i64 = conn.query_row(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM categories",
            [],
            |row| row.get(0),
        )?;
        conn.execute(
            "INSERT INTO categories (slug, name, description, is_builtin, auto_sort, position)
             VALUES (?1, ?2, ?3, 0, ?4, ?5)",
            rusqlite::params![slug, name.trim(), description.trim(), auto_sort as i64, next],
        )?;
        Ok(())
    })?;

    Ok(Category {
        slug,
        name: name.trim().to_string(),
        description: description.trim().to_string(),
        is_builtin: false,
        auto_sort,
        edited: true,
        position: 0,
    })
}

/// Rename a category, reword what the model is told, or stop it sorting into it. The slug
/// never changes: messages point at it, and renaming should not lose them.
pub fn update(
    db: &Db,
    slug: &str,
    name: &str,
    description: &str,
    auto_sort: bool,
) -> crate::db::Result<()> {
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE categories SET name = ?2, description = ?3, auto_sort = ?4, edited = 1
              WHERE slug = ?1",
            rusqlite::params![slug, name.trim(), description.trim(), auto_sort as i64],
        )?;
        Ok(())
    })
}

/// Remove a category and un-sort everything that was in it, so those messages come back as
/// unsorted rather than pointing at something that no longer exists.
pub fn delete(db: &Db, slug: &str) -> crate::db::Result<()> {
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE messages SET category = NULL, category_source = NULL WHERE category = ?1",
            rusqlite::params![slug],
        )?;
        conn.execute("DELETE FROM categories WHERE slug = ?1", rusqlite::params![slug])?;
        Ok(())
    })
}

/// One message, as much of it as sorting needs.
pub struct Candidate {
    pub id: i64,
    pub subject: String,
    pub from_email: String,
    pub from_me: bool,
    pub body: String,
    pub has_calendar_part: bool,
    pub has_unsubscribe: bool,
}

/// Senders whose mail is a machine talking, whatever the body says.
const AUTOMATED_MARKERS: &[&str] = &[
    "notifications@", "notification@", "noreply@github", "no-reply@github", "alerts@",
    "alert@", "monitoring@", "builds@", "ci@", "jenkins@", "mailer-daemon@", "postmaster@",
];

/// Words that mean money, in the languages this mailbox actually uses.
const INVOICE_WORDS: &[&str] = &[
    "faktura", "fakturanummer", "invoice", "receipt", "kvitto", "kvittering", "betalning",
    "betaling", "payment", "order confirmation", "orderbekräftelse", "ordrebekreftelse",
    "purchase", "payout", "utbetalning",
];

/// What can be decided without asking a model, as a built-in slug. `None` means it has to
/// be read.
///
/// Order matters: a campaign that mentions "faktura" is still a campaign, so bulk mail is
/// settled before anything looks for money words.
pub fn by_rule(candidate: &Candidate) -> Option<&'static str> {
    if candidate.from_me {
        // Your own sent mail is never asking you for anything, and the model reliably
        // decides otherwise because it reads like a request.
        return Some("fyi");
    }

    let from = candidate.from_email.to_lowercase();
    let subject = candidate.subject.to_lowercase();

    // A calendar part is proof, not a guess.
    if candidate.has_calendar_part {
        return Some("meeting");
    }

    // Bulk mail identifies itself: nobody puts an unsubscribe link on a message meant for
    // one person.
    if candidate.has_unsubscribe {
        return Some("newsletter");
    }

    if AUTOMATED_MARKERS.iter().any(|marker| from.contains(marker)) {
        return Some("automated");
    }

    // Only on the subject line: bodies quote invoices in passing all the time, and a
    // colleague asking about one is a question, not an invoice.
    if INVOICE_WORDS.iter().any(|word| subject.contains(word)) {
        return Some("invoice");
    }

    None
}

/// Sort one message, using the model only when the rules cannot settle it.
///
/// `categories` is passed in rather than read here: a batch sorts hundreds of messages and
/// the list is the same for every one of them.
pub fn categorize(
    assistant: &Assistant,
    categories: &[Category],
    candidate: &Candidate,
) -> Option<(String, &'static str)> {
    if let Some(slug) = by_rule(candidate) {
        // A rule whose category has been deleted, or told not to sort itself, falls through
        // to the model, which sorts into whatever is actually there.
        if categories.iter().any(|c| c.slug == slug && c.auto_sort) {
            return Some((slug.to_string(), SOURCE_RULE));
        }
    }

    let options: Vec<(String, String)> = categories
        .iter()
        .filter(|c| c.auto_sort)
        .take(MAX_AUTO_SORTED)
        .map(|c| (c.slug.clone(), c.description.clone()))
        .collect();

    if options.is_empty() {
        return None;
    }

    let task = Task::Categorize {
        subject: candidate.subject.clone(),
        from: candidate.from_email.clone(),
        // A category is decided by the opening, not by the fifth paragraph, and a shorter
        // prompt is a faster one.
        text: candidate.body.chars().take(600).collect(),
        options,
    };

    let answer = assistant.run(&task, |_| {}).ok()?;
    match_answer(&answer, categories).map(|slug| (slug, SOURCE_MODEL))
}

/// Read the model's answer against the categories that exist.
///
/// It is told to reply with one slug and mostly does, but it sometimes wraps it in a
/// sentence, so the first word that names a category wins. Anything unrecognised is `None`,
/// which leaves the message unsorted for a later retry rather than storing a guess.
pub fn match_answer(raw: &str, categories: &[Category]) -> Option<String> {
    let lower = raw.to_lowercase();
    for word in lower.split(|c: char| !c.is_alphanumeric() && c != '-') {
        if word.is_empty() {
            continue;
        }
        if let Some(found) = categories.iter().find(|c| c.slug == word && c.auto_sort) {
            return Some(found.slug.clone());
        }
    }
    None
}

/// Messages with no category yet, newest first so a half-finished pass leaves the mail you
/// are actually looking at sorted rather than a random scatter.
pub fn pending(db: &Db, limit: usize) -> crate::db::Result<Vec<Candidate>> {
    db.with_conn(|conn| {
        let mut statement = conn.prepare(
            "SELECT m.id,
                    COALESCE(m.subject, ''),
                    COALESCE(f.email, ''),
                    COALESCE(m.body_text, m.snippet, ''),
                    EXISTS (SELECT 1 FROM attachments a
                             WHERE a.message_id = m.id
                               AND (a.mime_type LIKE '%calendar%' OR a.filename LIKE '%.ics')),
                    COALESCE(m.body_html, '') LIKE '%unsubscribe%'
                      OR COALESCE(m.body_text, '') LIKE '%unsubscribe%'
                      OR COALESCE(m.body_html, '') LIKE '%avregistrera%'
                      OR COALESCE(m.body_html, '') LIKE '%avmeld%',
                    COALESCE(f.email, '') = COALESCE(acc.email, '')
               FROM messages m
               JOIN accounts acc ON acc.id = m.account_id
               LEFT JOIN message_addresses f
                      ON f.message_id = m.id AND f.kind = 'from'
              WHERE m.category IS NULL
              ORDER BY m.sent_at DESC
              LIMIT ?1",
        )?;

        let rows = statement.query_map([limit as i64], |row| {
            Ok(Candidate {
                id: row.get(0)?,
                subject: row.get(1)?,
                from_email: row.get(2)?,
                body: row.get(3)?,
                has_calendar_part: row.get(4)?,
                has_unsubscribe: row.get(5)?,
                from_me: row.get(6)?,
            })
        })?;

        rows.collect::<rusqlite::Result<Vec<_>>>()
    })
}

pub fn store(db: &Db, id: i64, slug: &str, source: &str) -> crate::db::Result<()> {
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE messages SET category = ?2, category_source = ?3 WHERE id = ?1",
            rusqlite::params![id, slug, source],
        )?;
        Ok(())
    })
}

/// Put a message, or a whole conversation, in a category by hand.
///
/// Marked as yours, which is what stops a later pass overwriting it. `None` clears it
/// instead, sending the message back to be sorted again.
pub fn set_by_hand(db: &Db, remote_ids: &[String], slug: Option<&str>) -> crate::db::Result<u32> {
    db.with_conn(|conn| {
        let mut changed = 0u32;
        for remote_id in remote_ids {
            changed += conn.execute(
                "UPDATE messages SET category = ?2, category_source = ?3 WHERE remote_id = ?1",
                rusqlite::params![remote_id, slug, slug.map(|_| SOURCE_USER)],
            )? as u32;
        }
        Ok(changed)
    })
}

/// How much is left to do, and how much is done: the numbers behind the progress line.
pub fn progress(db: &Db) -> crate::db::Result<(u32, u32)> {
    db.with_conn(|conn| {
        let done: u32 = conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE category IS NOT NULL",
            [],
            |row| row.get(0),
        )?;
        let total: u32 = conn.query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))?;
        Ok((done, total))
    })
}

/// Throw away what the rules and the model decided, keeping what you decided yourself.
///
/// For after a category is added or reworded: the mailbox needs sorting again, but nothing
/// you set by hand should be undone by it.
pub fn reset(db: &Db) -> crate::db::Result<u32> {
    db.with_conn(|conn| {
        let cleared = conn.execute(
            "UPDATE messages SET category = NULL, category_source = NULL
              WHERE category_source IS NULL OR category_source <> ?1",
            rusqlite::params![SOURCE_USER],
        )?;
        Ok(cleared as u32)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate() -> Candidate {
        Candidate {
            id: 1,
            subject: "Hei".into(),
            from_email: "kristin@bambusa.no".into(),
            from_me: false,
            body: "Kan du se på dette?".into(),
            has_calendar_part: false,
            has_unsubscribe: false,
        }
    }

    fn categories() -> Vec<Category> {
        ["reply", "fyi", "meeting", "invoice", "automated", "newsletter"]
            .iter()
            .enumerate()
            .map(|(index, slug)| Category {
                slug: (*slug).into(),
                name: (*slug).into(),
                description: "…".into(),
                is_builtin: true,
                auto_sort: true,
                edited: false,
                position: index as i64,
            })
            .collect()
    }

    #[test]
    fn a_calendar_part_settles_it() {
        let mut c = candidate();
        c.has_calendar_part = true;
        assert_eq!(by_rule(&c), Some("meeting"));
    }

    #[test]
    fn bulk_mail_wins_over_money_words() {
        let mut c = candidate();
        c.subject = "Faktura-tips: fyll på lagret".into();
        c.has_unsubscribe = true;
        assert_eq!(by_rule(&c), Some("newsletter"));
    }

    #[test]
    fn invoices_are_recognised_by_subject_only() {
        let mut c = candidate();
        c.subject = "Faktura nummer 119389 fra Bambusa AS".into();
        assert_eq!(by_rule(&c), Some("invoice"));

        let mut asking = candidate();
        asking.body = "Har du sett fakturaen fra i går?".into();
        assert_eq!(by_rule(&asking), None, "a question about an invoice is a question");
    }

    #[test]
    fn ordinary_mail_needs_the_model() {
        assert_eq!(by_rule(&candidate()), None);
    }

    #[test]
    fn the_models_answer_is_read_loosely() {
        let categories = categories();
        assert_eq!(match_answer("newsletter", &categories).as_deref(), Some("newsletter"));
        assert_eq!(match_answer("Category: reply.\n", &categories).as_deref(), Some("reply"));
        assert_eq!(match_answer("I think it is unclear", &categories), None);
    }

    #[test]
    fn an_answer_naming_a_category_that_is_gone_is_no_answer() {
        let without_invoice: Vec<Category> =
            categories().into_iter().filter(|c| c.slug != "invoice").collect();
        assert_eq!(match_answer("invoice", &without_invoice), None);
    }

    #[test]
    fn a_category_the_assistant_may_not_use_is_never_chosen() {
        let mut categories = categories();
        categories[0].auto_sort = false;
        assert_eq!(match_answer("reply", &categories), None);
    }

    #[test]
    fn custom_slugs_survive_the_round_trip() {
        assert_eq!(slugify("Kunder & leads"), "kunder-leads");
        assert_eq!(slugify("  Klaviyo  "), "klaviyo");

        let mut categories = categories();
        categories.push(Category {
            slug: "kunder-leads".into(),
            name: "Kunder & leads".into(),
            description: "mail from customers".into(),
            is_builtin: false,
            auto_sort: true,
            edited: true,
            position: 9,
        });
        assert_eq!(match_answer("kunder-leads", &categories).as_deref(), Some("kunder-leads"));
    }
}
