//! Google OAuth for an installed app.
//!
//! A downloaded binary cannot keep a secret, so this is a **public client**: both the client
//! id and Google's so-called client secret ship inside the app, and PKCE is what stops an
//! intercepted authorization code from being redeemed by anyone else. Google requires the
//! secret in the token exchange anyway and documents it as not confidential for desktop
//! clients. This is their documented setup, not a workaround.
//!
//! The user never types a password into Lumen. They approve on Google's own page in their
//! own browser, and we receive a code on a loopback socket.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant, SystemTime};

use base64::Engine;
use rand::Rng;
use serde::Deserialize;
use sha2::{Digest, Sha256};

mod store;

pub use store::{delete_refresh_token, load_refresh_token, save_refresh_token};

const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT: &str = "https://oauth2.googleapis.com/revoke";
const USERINFO_ENDPOINT: &str = "https://www.googleapis.com/oauth2/v3/userinfo";

/// Narrowest set that still supports read, organise and send.
///
/// Deliberately not `https://mail.google.com/`: that adds permanent delete and IMAP, makes
/// the consent screen far more alarming, and widens the security assessment for no feature
/// this app offers.
const SCOPES: &str = concat!(
    "https://www.googleapis.com/auth/gmail.modify",
    " https://www.googleapis.com/auth/gmail.send",
    " https://www.googleapis.com/auth/userinfo.email",
);

/// Said when a build carries no Google credentials at all, which is what a fresh clone is:
/// they are supplied at build time and deliberately not in the repository.
const MISSING_CREDENTIALS: &str = "This build has no Google credentials. Put the OAuth client \
     id and secret in src-tauri/.cargo/config.toml (see docs/google-setup.md), or set \
     LUMEN_GOOGLE_CLIENT_ID and LUMEN_GOOGLE_CLIENT_SECRET.";

/// How long the user has to finish consenting before the loopback listener gives up.
const CONSENT_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("could not open a loopback port for the sign-in redirect: {0}")]
    Listener(#[source] std::io::Error),
    #[error("the browser did not come back within {0} seconds")]
    TimedOut(u64),
    #[error("sign-in was cancelled or denied: {0}")]
    Denied(String),
    #[error("the redirect did not match the request it answered")]
    StateMismatch,
    #[error("talking to Google failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Google rejected the token request: {0}")]
    Token(String),
    /// The refresh token is dead: revoked, or expired because the OAuth app is still in
    /// testing, where Google expires them after seven days. Nothing to retry; the account
    /// has to consent again.
    #[error("Lumen needs you to sign in to Google again. {0}")]
    SignInRequired(String),
    #[error("keychain: {0}")]
    Keychain(#[from] keyring::Error),
}

pub type Result<T> = std::result::Result<T, AuthError>;

/// The OAuth client id, from the runtime environment or baked in at build time.
///
/// Neither value is a secret in the usual sense. An installed app cannot keep one: whatever
/// is compiled in ships inside every copy of the binary and can be read out of it in
/// seconds, which is why Google's desktop flow leans on PKCE instead. They are kept out of
/// the source anyway, because a public repository is a different thing from a binary: the id
/// identifies *this* Cloud project, and anyone holding it can put this app's name on their
/// own consent screen.
///
/// Set `LUMEN_GOOGLE_CLIENT_ID` when building (see `src-tauri/.cargo/config.toml`, which is
/// not committed) or at runtime to point a build at a different project.
pub fn client_id() -> String {
    from_env("LUMEN_GOOGLE_CLIENT_ID", option_env!("LUMEN_GOOGLE_CLIENT_ID"))
}

/// Called a secret by Google, and required by their token exchange even with PKCE, but
/// their own documentation says it "is not treated as confidential" for desktop clients
/// because it necessarily ships inside the binary. PKCE, not this string, is what stops an
/// intercepted authorization code being redeemed.
pub fn client_secret() -> String {
    from_env("LUMEN_GOOGLE_CLIENT_SECRET", option_env!("LUMEN_GOOGLE_CLIENT_SECRET"))
}

/// Runtime environment first, then whatever was compiled in, then nothing.
///
/// Runtime first so a build can be pointed at another Cloud project without recompiling,
/// which is how the test projects are used.
fn from_env(name: &str, compiled: Option<&'static str>) -> String {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| compiled.map(str::to_string))
        .unwrap_or_default()
}

#[derive(Debug, Clone)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Wall clock, not `Instant`.
    ///
    /// `Instant` is monotonic and on macOS stops while the machine is asleep, so a laptop
    /// closed overnight woke with a token Google had expired hours earlier and an app that
    /// believed it had fifty minutes left. Google's hour is an hour of real time.
    pub expires_at: SystemTime,
}

impl Tokens {
    /// A minute of slack so a request never sets off with a token about to expire mid-flight.
    pub fn is_stale(&self) -> bool {
        SystemTime::now() + Duration::from_secs(60) >= self.expires_at
    }
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    expires_in: u64,
}

#[derive(Deserialize)]
struct UserInfo {
    email: String,
}

/// Run the whole consent flow. Returns the account's address and its tokens.
///
/// Blocking on purpose: it owns a socket and waits on a human. Callers run it off the UI
/// thread via `spawn_blocking`.
pub fn authorize(open_browser: impl FnOnce(&str)) -> Result<(String, Tokens)> {
    // Fail here rather than sending the user to a Google page that cannot work.
    if client_id().is_empty() {
        return Err(AuthError::Token(MISSING_CREDENTIALS.to_string()));
    }

    let verifier = random_string(64);
    let challenge = s256_challenge(&verifier);
    let state = random_string(32);

    // Port 0 lets the OS pick. Google allows any loopback port for Desktop clients, so
    // there is nothing to register and nothing to collide with.
    let listener = TcpListener::bind("127.0.0.1:0").map_err(AuthError::Listener)?;
    let port = listener.local_addr().map_err(AuthError::Listener)?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let auth_url = format!(
        "{AUTH_ENDPOINT}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}\
         &code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=consent",
        urlencode(&client_id()),
        urlencode(&redirect_uri),
        urlencode(SCOPES),
        urlencode(&state),
        urlencode(&challenge),
    );

    open_browser(&auth_url);

    let code = wait_for_code(&listener, &state)?;
    let tokens = exchange_code(&code, &verifier, &redirect_uri)?;
    let email = fetch_email(&tokens.access_token)?;

    Ok((email, tokens))
}

/// Accept exactly one request, pull `code` and `state` out of the request line, and answer
/// with a page the user can close.
fn wait_for_code(listener: &TcpListener, expected_state: &str) -> Result<String> {
    listener.set_nonblocking(true).map_err(AuthError::Listener)?;
    let deadline = Instant::now() + CONSENT_TIMEOUT;

    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                stream.set_nonblocking(false).map_err(AuthError::Listener)?;
                return handle_redirect(stream, expected_state);
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err(AuthError::TimedOut(CONSENT_TIMEOUT.as_secs()));
                }
                // Browsers also open speculative connections here; polling keeps this
                // simple without pulling in an async runtime for one socket.
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(e) => return Err(AuthError::Listener(e)),
        }
    }
}

fn handle_redirect(mut stream: TcpStream, expected_state: &str) -> Result<String> {
    let mut request_line = String::new();
    BufReader::new(&stream)
        .read_line(&mut request_line)
        .map_err(AuthError::Listener)?;

    // "GET /?code=...&state=... HTTP/1.1"
    let path = request_line.split_whitespace().nth(1).unwrap_or("/");
    let parsed = url::Url::parse(&format!("http://127.0.0.1{path}"))
        .map_err(|_| AuthError::Denied("malformed redirect".into()))?;

    let mut code = None;
    let mut state = None;
    let mut error = None;
    for (key, value) in parsed.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            "error" => error = Some(value.into_owned()),
            _ => {}
        }
    }

    let outcome = if let Some(err) = &error {
        Err(AuthError::Denied(err.clone()))
    } else if state.as_deref() != Some(expected_state) {
        // Guards against another page on the machine firing a request at our port.
        Err(AuthError::StateMismatch)
    } else if let Some(code) = code {
        Ok(code)
    } else {
        Err(AuthError::Denied("no authorization code in redirect".into()))
    };

    let body = match &outcome {
        Ok(_) => landing_page("Lumen is connected", "You can close this tab and go back to the app."),
        Err(e) => landing_page("Sign-in did not complete", &e.to_string()),
    };
    let _ = write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.flush();

    outcome
}

fn landing_page(title: &str, detail: &str) -> String {
    format!(
        "<!doctype html><meta charset=utf-8><title>{title}</title>\
         <body style=\"font:16px/1.6 -apple-system,system-ui,sans-serif;display:grid;\
         place-items:center;height:100vh;margin:0;background:#f7f5f1;color:#17150f\">\
         <div style=\"text-align:center;max-width:32ch\"><h1 style=\"font-size:20px\">{title}</h1>\
         <p style=\"color:#55504a\">{detail}</p></div>"
    )
}

fn exchange_code(code: &str, verifier: &str, redirect_uri: &str) -> Result<Tokens> {
    post_token(&[
        ("client_id", client_id().as_str()),
        ("client_secret", client_secret().as_str()),
        ("code", code),
        ("code_verifier", verifier),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri),
    ])
}

/// Swap a stored refresh token for a fresh access token.
///
/// Google does not return a new refresh token here, so the caller keeps the one it has.
pub fn refresh(refresh_token: &str) -> Result<Tokens> {
    let mut tokens = post_token(&[
        ("client_id", client_id().as_str()),
        ("client_secret", client_secret().as_str()),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ])?;
    tokens.refresh_token = Some(refresh_token.to_string());
    Ok(tokens)
}

fn post_token(form: &[(&str, &str)]) -> Result<Tokens> {
    let client = reqwest::blocking::Client::new();
    let response = client.post(TOKEN_ENDPOINT).form(form).send()?;

    if !response.status().is_success() {
        let body = response.text().unwrap_or_default();
        if body.contains("client_secret") && client_secret().is_empty() {
            return Err(AuthError::Token(MISSING_CREDENTIALS.to_string()));
        }
        // invalid_grant means the refresh token will never work again, so saying "Google
        // rejected the token request" with a page of JSON helps nobody. While the OAuth app
        // is unverified Google expires these after seven days, which makes this the most
        // likely failure a tester meets.
        if body.contains("invalid_grant") {
            return Err(AuthError::SignInRequired(
                "The previous sign-in has expired or been withdrawn. While the app is \
                 unverified by Google, a sign-in lasts seven days."
                    .to_string(),
            ));
        }
        return Err(AuthError::Token(body));
    }

    let body: TokenResponse = response.json()?;
    Ok(Tokens {
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        expires_at: SystemTime::now() + Duration::from_secs(body.expires_in),
    })
}

fn fetch_email(access_token: &str) -> Result<String> {
    let client = reqwest::blocking::Client::new();
    let info: UserInfo = client
        .get(USERINFO_ENDPOINT)
        .bearer_auth(access_token)
        .send()?
        .error_for_status()?
        .json()?;
    Ok(info.email)
}

/// Tell Google to forget us. Called on sign-out, alongside wiping local data.
pub fn revoke(token: &str) -> Result<()> {
    reqwest::blocking::Client::new()
        .post(REVOKE_ENDPOINT)
        .form(&[("token", token)])
        .send()?;
    Ok(())
}

fn random_string(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill(&mut buf[..]);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf)
}

fn s256_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

fn urlencode(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

#[cfg(test)]
mod token_tests {
    use super::*;

    fn token(valid_for: u64) -> Tokens {
        Tokens {
            access_token: "x".into(),
            refresh_token: Some("r".into()),
            expires_at: SystemTime::now() + Duration::from_secs(valid_for),
        }
    }

    #[test]
    fn a_fresh_token_is_not_stale() {
        assert!(!token(3600).is_stale());
    }

    #[test]
    fn the_last_minute_counts_as_stale() {
        // A request that sets off with 30 seconds left can easily arrive after expiry.
        assert!(token(30).is_stale());
        assert!(token(0).is_stale());
    }
}
