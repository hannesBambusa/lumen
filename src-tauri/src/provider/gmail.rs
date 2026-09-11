//! Gmail adapter: the REST API in, neutral types out.
//!
//! Nothing above this file knows about `labelIds`, `threadId` or base64url payloads. When an
//! IMAP or Graph adapter lands it produces the same [`RemoteMessage`] values from completely
//! different wire formats.

use std::thread;
use std::time::{Duration, Instant};

use base64::Engine;
use serde::Deserialize;

use crate::auth::{self, Tokens};
use crate::provider::types::*;

const API: &str = "https://gmail.googleapis.com/gmail/v1/users/me";

/// One page of message ids. 100 is Gmail's comfortable batch and keeps each request short.
const PAGE_SIZE: usize = 100;

/// Minimum spacing between requests.
///
/// Gmail's published cost is 5 units per call against 6000 units per minute per user, which
/// suggests 20 requests per second is fine. In practice this account was throttled well
/// below that, so the published figures are a ceiling rather than a promise and the real
/// budget is tighter. 150ms (about 7 requests per second) has headroom for that.
const MIN_REQUEST_SPACING: Duration = Duration::from_millis(150);

/// Attempts per request before giving up, including the first.
const MAX_ATTEMPTS: u32 = 5;

/// First backoff step. Doubles each attempt: 5s, 10s, 20s, 40s.
///
/// Seconds, not milliseconds: the limit that trips is measured **per minute**, so a backoff
/// totalling a few seconds retries inside the same exhausted window and fails again. The
/// sequence has to be long enough to cross into a fresh minute.
const BASE_BACKOFF: Duration = Duration::from_secs(5);

#[derive(Debug, thiserror::Error)]
pub enum GmailError {
    #[error("authentication: {0}")]
    Auth(#[from] auth::AuthError),
    #[error("network: {0}")]
    Http(#[from] reqwest::Error),
    /// Still rate limited after every retry. Distinct from a generic API error because it is
    /// not a failure the user can do anything about except wait, and the message says so.
    #[error("Gmail is rate limiting this account. Waited and retried {attempts} times. Leave it a minute and sync again; anything already fetched has been kept.")]
    RateLimited { attempts: u32 },
    #[error("Gmail returned {status}: {body}")]
    Api { status: u16, body: String },
}

pub type Result<T> = std::result::Result<T, GmailError>;

/// A signed-in Gmail account. Owns its tokens and refreshes them itself, so callers never
/// see a token and there is exactly one place that knows how to get a fresh one.
pub struct GmailAccount {
    email: String,
    tokens: Tokens,
    http: reqwest::blocking::Client,
    /// When the next request is allowed to leave. See [`MIN_REQUEST_SPACING`].
    next_slot: Instant,
}

impl GmailAccount {
    pub fn new(email: String, tokens: Tokens) -> Self {
        Self {
            email,
            tokens,
            http: reqwest::blocking::Client::new(),
            next_slot: Instant::now(),
        }
    }

    /// Restore a session from the refresh token in the keychain.
    pub fn resume(email: &str, refresh_token: &str) -> Result<Self> {
        let tokens = auth::refresh(refresh_token)?;
        Ok(Self::new(email.to_string(), tokens))
    }

    pub fn email(&self) -> &str {
        &self.email
    }

    fn access_token(&mut self) -> Result<&str> {
        if self.tokens.is_stale() {
            self.refresh_now()?;
        }
        Ok(&self.tokens.access_token)
    }

    /// Swap the refresh token for a new access token, whatever the expiry says.
    ///
    /// Used both when the token is known to be old and when Gmail rejects one that looked
    /// fine: the expiry is our arithmetic, the 401 is Google's answer, and Google wins.
    fn refresh_now(&mut self) -> Result<()> {
        // The refresh token is the durable one; Google does not reissue it here.
        let existing = self.tokens.refresh_token.clone().ok_or(GmailError::Api {
            status: 401,
            body: "this account has no refresh token, so sign in again".to_string(),
        })?;
        self.tokens = auth::refresh(&existing)?;
        Ok(())
    }

    fn get(&mut self, url: &str) -> Result<String> {
        self.request(url, None)
    }

    fn post_json(&mut self, url: &str, body: &serde_json::Value) -> Result<String> {
        self.request(url, Some(body))
    }

    /// One request, throttled, with backoff on rate limits.
    ///
    /// Everything this adapter sends goes through here, so the pacing and the retry policy
    /// live in exactly one place. A body makes it a POST.
    fn request(&mut self, url: &str, body: Option<&serde_json::Value>) -> Result<String> {
        let mut attempt = 0;
        let mut refreshed = false;

        loop {
            attempt += 1;
            self.wait_for_slot();

            let token = self.access_token()?.to_string();
            let request = match body {
                Some(json) => self.http.post(url).json(json),
                None => self.http.get(url),
            };
            let response = request.bearer_auth(token).send()?;
            let status = response.status();
            let retry_after = response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok());
            let body = response.text()?;

            if status.is_success() {
                return Ok(body);
            }

            // Gmail says the token is no good even though the expiry said otherwise: a
            // clock that moved, a token revoked elsewhere, a session resumed from a sleeping
            // laptop. Refresh once and try again rather than handing the user a 401 they can
            // do nothing with.
            if status.as_u16() == 401 && !refreshed {
                refreshed = true;
                log::warn!("Gmail rejected the access token; refreshing and retrying");
                self.refresh_now()?;
                continue;
            }

            if is_rate_limited(status.as_u16(), &body) {
                if attempt >= MAX_ATTEMPTS {
                    return Err(GmailError::RateLimited { attempts: attempt });
                }
                // Honour Retry-After when Gmail sends one, otherwise double each time.
                let wait = retry_after
                    .map(Duration::from_secs)
                    .unwrap_or(BASE_BACKOFF * 2u32.pow(attempt - 1));
                log::warn!("rate limited by Gmail, waiting {}s (attempt {attempt})", wait.as_secs());
                thread::sleep(wait);
                continue;
            }

            return Err(GmailError::Api {
                status: status.as_u16(),
                body,
            });
        }
    }

    /// Block until the next request slot. Cheap and exact enough: one sync is a single
    /// thread making one request at a time.
    fn wait_for_slot(&mut self) {
        let now = Instant::now();
        if self.next_slot > now {
            thread::sleep(self.next_slot - now);
        }
        self.next_slot = Instant::now() + MIN_REQUEST_SPACING;
    }

    /// Ids of messages matching a Gmail search query, newest first.
    ///
    /// `query` is Gmail's own syntax, so the caller can say `newer_than:60d -in:spam` and let
    /// the server do the filtering rather than downloading a decade of mail to throw away.
    pub fn list_message_ids(&mut self, query: &str, limit: usize) -> Result<Vec<String>> {
        let mut ids = Vec::new();
        let mut page_token: Option<String> = None;

        while ids.len() < limit {
            let want = PAGE_SIZE.min(limit - ids.len());
            let mut url = format!(
                "{API}/messages?maxResults={want}&q={}",
                urlencode(query)
            );
            if let Some(token) = &page_token {
                url.push_str(&format!("&pageToken={}", urlencode(token)));
            }

            let page: MessageList = serde_json::from_str(&self.get(&url)?).unwrap_or_default();
            if page.messages.is_empty() {
                break;
            }
            ids.extend(page.messages.into_iter().map(|m| m.id));

            match page.next_page_token {
                Some(token) => page_token = Some(token),
                // No further pages: the mailbox ran out before the limit did.
                None => break,
            }
        }

        Ok(ids)
    }

    pub fn fetch_message(&mut self, id: &str) -> Result<RemoteMessage> {
        let raw = self.get(&format!("{API}/messages/{id}?format=full"))?;
        let wire: WireMessage = serde_json::from_str(&raw).map_err(|e| GmailError::Api {
            status: 0,
            body: format!("could not parse message {id}: {e}"),
        })?;
        Ok(wire.into_neutral())
    }

    /// Mark messages read on the server by removing Gmail's `UNREAD` label.
    ///
    /// `batchModify` takes up to 1000 ids in one call and answers 204 with no body, so a
    /// whole thread costs one request rather than one per message.
    pub fn mark_read(&mut self, ids: &[String]) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        for chunk in ids.chunks(1000) {
            let body = serde_json::json!({ "ids": chunk, "removeLabelIds": ["UNREAD"] });
            self.post_json(&format!("{API}/messages/batchModify"), &body)?;
        }
        Ok(())
    }

    pub fn fetch_attachment(&mut self, message_id: &str, attachment_id: &str) -> Result<Vec<u8>> {
        let raw = self.get(&format!(
            "{API}/messages/{message_id}/attachments/{attachment_id}"
        ))?;
        let body: WireAttachmentBody = serde_json::from_str(&raw).unwrap_or_default();
        Ok(decode_b64(&body.data))
    }
}

// ---------------------------------------------------------------------------------------
// Wire types. Only the fields actually used; Gmail sends a great deal more.
// ---------------------------------------------------------------------------------------

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MessageList {
    #[serde(default)]
    messages: Vec<MessageRef>,
    #[serde(default)]
    next_page_token: Option<String>,
}

#[derive(Deserialize)]
struct MessageRef {
    id: String,
}

#[derive(Default, Deserialize)]
struct WireAttachmentBody {
    #[serde(default)]
    data: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireMessage {
    id: String,
    thread_id: String,
    #[serde(default)]
    label_ids: Vec<String>,
    #[serde(default)]
    snippet: String,
    /// Milliseconds since the epoch, as a string. Gmail sends every number as a string here.
    #[serde(default)]
    internal_date: String,
    payload: Option<WirePart>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WirePart {
    #[serde(default)]
    mime_type: String,
    #[serde(default)]
    filename: String,
    #[serde(default)]
    headers: Vec<WireHeader>,
    #[serde(default)]
    body: WireBody,
    #[serde(default)]
    parts: Vec<WirePart>,
}

#[derive(Deserialize)]
struct WireHeader {
    name: String,
    value: String,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireBody {
    #[serde(default)]
    size: u64,
    #[serde(default)]
    data: String,
    #[serde(default)]
    attachment_id: Option<String>,
}

impl WireMessage {
    fn into_neutral(self) -> RemoteMessage {
        let payload = self.payload.unwrap_or(WirePart {
            mime_type: String::new(),
            filename: String::new(),
            headers: Vec::new(),
            body: WireBody::default(),
            parts: Vec::new(),
        });

        let header = |name: &str| {
            payload
                .headers
                .iter()
                .find(|h| h.name.eq_ignore_ascii_case(name))
                .map(|h| h.value.clone())
        };

        let mut addresses = Vec::new();
        for (kind, name) in [
            (AddressKind::From, "From"),
            (AddressKind::To, "To"),
            (AddressKind::Cc, "Cc"),
            (AddressKind::ReplyTo, "Reply-To"),
        ] {
            if let Some(raw) = header(name) {
                for address in parse_address_list(&raw) {
                    addresses.push((kind, address));
                }
            }
        }

        let mut text = None;
        let mut html = None;
        let mut attachments = Vec::new();
        walk(&payload, &mut text, &mut html, &mut attachments);

        RemoteMessage {
            id: RemoteMessageId(self.id),
            thread_id: Some(self.thread_id),
            message_id_header: header("Message-ID"),
            in_reply_to: header("In-Reply-To"),
            references: header("References")
                .map(|r| r.split_whitespace().map(str::to_string).collect())
                .unwrap_or_default(),
            subject: header("Subject"),
            // internalDate is milliseconds; everything downstream works in seconds.
            sent_at: self.internal_date.parse::<i64>().unwrap_or(0) / 1000,
            snippet: Some(decode_entities(&self.snippet)),
            body_text: text,
            body_html: html,
            addresses,
            attachments,
            folders: self.label_ids.iter().cloned().map(RemoteFolderId).collect(),
            is_read: !self.label_ids.iter().any(|l| l == "UNREAD"),
            is_flagged: self.label_ids.iter().any(|l| l == "STARRED"),
            is_draft: self.label_ids.iter().any(|l| l == "DRAFT"),
        }
    }
}

/// Depth-first walk of the MIME tree.
///
/// A part is an attachment when it has a filename or an `attachmentId`, and body text
/// otherwise. Inline images have both a filename and a `Content-ID`, so they are collected as
/// attachments and flagged inline rather than being mistaken for the body.
fn walk(
    part: &WirePart,
    text: &mut Option<String>,
    html: &mut Option<String>,
    attachments: &mut Vec<RemoteAttachment>,
) {
    let content_id = part
        .headers
        .iter()
        .find(|h| h.name.eq_ignore_ascii_case("Content-ID"))
        .map(|h| h.value.trim_matches(|c| c == '<' || c == '>').to_string());

    let is_attachment = !part.filename.is_empty() || part.body.attachment_id.is_some();

    if is_attachment {
        attachments.push(RemoteAttachment {
            id: part.body.attachment_id.clone().map(RemoteAttachmentId),
            filename: if part.filename.is_empty() {
                "attachment".to_string()
            } else {
                part.filename.clone()
            },
            mime_type: part.mime_type.clone(),
            size_bytes: part.body.size,
            is_inline: content_id.is_some(),
            content_id,
        });
    } else if !part.body.data.is_empty() {
        let decoded = String::from_utf8_lossy(&decode_b64(&part.body.data)).into_owned();
        // First one wins: Gmail nests multipart/alternative deepest-last, and the outermost
        // text part is the one meant to be shown.
        match part.mime_type.as_str() {
            "text/plain" if text.is_none() => *text = Some(decoded),
            "text/html" if html.is_none() => *html = Some(decoded),
            _ => {}
        }
    }

    for child in &part.parts {
        walk(child, text, html, attachments);
    }
}

/// Split a header value into addresses.
///
/// Deliberately simple: it handles `Name <a@b.c>`, bare addresses, quoted display names and
/// comma separation, which covers real mail. It does not implement RFC 5322 in full, and a
/// comma inside an unquoted display name will split wrongly. Worth replacing with a real
/// parser before this ships to anyone.
fn parse_address_list(raw: &str) -> Vec<Address> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;

    for ch in raw.chars() {
        match ch {
            '"' => {
                in_quotes = !in_quotes;
                current.push(ch);
            }
            ',' if !in_quotes => {
                push_address(&mut out, &current);
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    push_address(&mut out, &current);
    out
}

fn push_address(out: &mut Vec<Address>, raw: &str) {
    let raw = raw.trim();
    if raw.is_empty() {
        return;
    }

    if let (Some(start), Some(end)) = (raw.rfind('<'), raw.rfind('>')) {
        if start < end {
            let email = raw[start + 1..end].trim().to_string();
            let name = raw[..start].trim().trim_matches('"').trim().to_string();
            out.push(Address {
                name: if name.is_empty() { None } else { Some(name) },
                email,
            });
            return;
        }
    }

    out.push(Address {
        name: None,
        email: raw.to_string(),
    });
}

/// Gmail uses base64url and omits padding inconsistently, so pad before decoding rather than
/// trusting either engine to cope.
fn decode_b64(data: &str) -> Vec<u8> {
    let cleaned: String = data.chars().filter(|c| !c.is_whitespace()).collect();
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(cleaned.trim_end_matches('='))
        .unwrap_or_default()
}

/// Snippets come back HTML-escaped even though they are plain text.
fn decode_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

fn urlencode(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

/// Gmail signals rate limiting two ways: 429, and a 403 whose body says `rateLimitExceeded`
/// or `userRateLimitExceeded`. Treating the 403 as a permission error, which is what its
/// status code claims, turns a temporary pause into an apparent failure.
fn is_rate_limited(status: u16, body: &str) -> bool {
    if status == 429 {
        return true;
    }
    status == 403
        && (body.contains("rateLimitExceeded")
            || body.contains("userRateLimitExceeded")
            || body.contains("RATE_LIMIT_EXCEEDED"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_display_names_and_bare_addresses() {
        let parsed = parse_address_list("Asgeir Heart <asgeir@bambusa.no>, plain@example.com");
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].name.as_deref(), Some("Asgeir Heart"));
        assert_eq!(parsed[0].email, "asgeir@bambusa.no");
        assert_eq!(parsed[1].name, None);
        assert_eq!(parsed[1].email, "plain@example.com");
    }

    #[test]
    fn a_comma_inside_a_quoted_name_does_not_split() {
        let parsed = parse_address_list("\"Nilsen, Håvard\" <havard@bambusa.no>");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].email, "havard@bambusa.no");
    }

    #[test]
    fn a_403_about_rate_limits_is_not_a_permission_error() {
        let body = r#"{"error":{"code":403,"status":"PERMISSION_DENIED","errors":[{"reason":"rateLimitExceeded"}]}}"#;
        assert!(is_rate_limited(403, body));
        assert!(is_rate_limited(429, ""));
        // A real permission problem must still surface as one.
        assert!(!is_rate_limited(403, r#"{"error":{"reason":"insufficientPermissions"}}"#));
    }

    #[test]
    fn decodes_unpadded_base64url() {
        assert_eq!(decode_b64("aGVqIHDDpSBkaWc"), "hej på dig".as_bytes());
    }
}
