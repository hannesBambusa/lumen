//! The Mac's own translator.
//!
//! macOS translates on-device with models Apple ships and keeps updated. For a mail client
//! that is a better deal than anything we can bundle: better output than a 4B model, no
//! gigabytes to download, and it works the moment the app is installed.
//!
//! It cannot be called from Rust. A `TranslationSession` comes only from SwiftUI's
//! `.translationTask`, so the actual work happens in `macos/lumen-translate.swift`, built
//! alongside the app and spawned per request. One process per translation is not free, but
//! it is a few milliseconds against a few seconds of translating, and a helper that
//! wedges itself cannot take the mail client with it.

#[cfg(target_os = "macos")]
mod imp {
    use std::io::Write;
    use std::path::PathBuf;
    use std::process::{Command, Stdio};

    use serde::{Deserialize, Serialize};

    #[derive(Serialize)]
    struct Request<'a> {
        #[serde(skip_serializing_if = "Option::is_none")]
        source: Option<&'a str>,
        target: &'a str,
        text: &'a str,
    }

    #[derive(Deserialize)]
    struct Reply {
        ok: bool,
        text: Option<String>,
        error: Option<String>,
    }

    /// Next to the app binary, which is where it lands both in `target/debug` during
    /// development and in `Lumen.app/Contents/MacOS` once bundled.
    fn helper() -> Option<PathBuf> {
        let exe = std::env::current_exe().ok()?;
        let dir = exe.parent()?;
        for name in ["lumen-translate", "lumen-translate-aarch64-apple-darwin"] {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        None
    }

    pub fn available() -> bool {
        helper().is_some()
    }

    pub fn translate(text: &str, source: Option<&str>, target: &str) -> Result<String, String> {
        let helper = helper().ok_or_else(|| "the translation helper is missing".to_string())?;
        let payload = serde_json::to_vec(&Request { source, target, text })
            .map_err(|e| e.to_string())?;

        let mut child = Command::new(helper)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("could not start the translation helper: {e}"))?;

        child
            .stdin
            .take()
            .ok_or_else(|| "no stdin on the helper".to_string())?
            .write_all(&payload)
            .map_err(|e| e.to_string())?;

        let output = child
            .wait_with_output()
            .map_err(|e| format!("the translation helper failed: {e}"))?;

        let reply: Reply = serde_json::from_slice(&output.stdout)
            .map_err(|_| "the translation helper answered with nonsense".to_string())?;

        if reply.ok {
            reply.text.ok_or_else(|| "empty translation".to_string())
        } else {
            Err(reply.error.unwrap_or_else(|| "translation failed".to_string()))
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub fn available() -> bool {
        false
    }

    pub fn translate(_text: &str, _source: Option<&str>, _target: &str) -> Result<String, String> {
        Err("the built-in translator is only on macOS".to_string())
    }
}

pub use imp::{available, translate};

/// The language tag for one of the names the interface offers, and the names `whatlang`
/// reports for a detected source. Anything not listed means "let the Mac work it out",
/// which it does well enough for a whole paragraph.
pub fn language_code(name: &str) -> Option<&'static str> {
    Some(match name {
        "English" => "en",
        "Swedish" => "sv",
        // Bokmål: the written standard almost all Norwegian mail is in.
        "Norwegian" => "nb",
        "Danish" => "da",
        "German" => "de",
        "French" => "fr",
        "Spanish" => "es",
        "Finnish" => "fi",
        "Dutch" => "nl",
        "Italian" => "it",
        "Portuguese" => "pt",
        "Polish" => "pl",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    /// Talks to the real helper, so it needs a copy of it next to the test binary:
    /// `cp target/debug/lumen-translate target/debug/deps/` then
    /// `cargo test apple -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn translates_through_the_mac() {
        if !super::available() {
            eprintln!("helper not next to the test binary, skipping");
            return;
        }
        let out = super::translate("Hei! Kan du se på dette før fredag?", Some("nb"), "sv")
            .expect("translate");
        eprintln!("--- {out} ---");
        assert!(!out.is_empty());
        assert!(out.contains("fredag"));
    }

    #[test]
    fn language_names_map_to_tags() {
        assert_eq!(super::language_code("Norwegian"), Some("nb"));
        assert_eq!(super::language_code("Swedish"), Some("sv"));
        assert_eq!(super::language_code("Klingon"), None);
    }
}
