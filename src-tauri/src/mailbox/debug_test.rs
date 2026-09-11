//! Ad-hoc pipeline inspection. Ignored by default; run with
//! `LUMEN_DEBUG_HTML=/path/in.html cargo test debug_pipeline -- --ignored`.
//! Writes each stage's output next to the input so it can be opened and compared.

#[test]
#[ignore]
fn debug_pipeline() {
    use super::html;
    let Ok(path) = std::env::var("LUMEN_DEBUG_HTML") else { return };
    let raw = std::fs::read_to_string(&path).expect("read input");
    let dir = std::path::Path::new(&path).parent().unwrap().to_path_buf();

    let (own, quoted) = html::split_quote(&raw);
    let (own2, signature) = html::split_signature(&own);
    let inline = html::to_inline(&own2);
    let sanitized = html::sanitize(&own2);
    let text = html::to_text(&own2);

    std::fs::write(dir.join("stage_own_after_quote.html"), &own).unwrap();
    std::fs::write(dir.join("stage_quoted.html"), &quoted).unwrap();
    std::fs::write(dir.join("stage_signature.html"), &signature).unwrap();
    std::fs::write(dir.join("stage_inline.html"), &inline).unwrap();
    std::fs::write(dir.join("stage_sanitized.html"), &sanitized).unwrap();
    std::fs::write(dir.join("stage_text.txt"), &text).unwrap();

    eprintln!("raw={} own_after_quote={} quoted={} signature={} inline={} sanitized={} text={}",
        raw.len(), own.len(), quoted.len(), signature.len(), inline.len(), sanitized.len(), text.len());
}

#[cfg(test)]
mod inline_rule {
    /// The rule that decides whether an image is part of the body or a file you were sent.
    fn embedded(html: &str, content_id: Option<&str>) -> bool {
        content_id.is_some_and(|id| html.contains(&format!("cid:{id}")))
    }

    #[test]
    fn an_image_the_body_points_at_belongs_to_the_body() {
        let html = r#"<p>Se her</p><img src="cid:f_abc123">"#;
        assert!(embedded(html, Some("f_abc123")));
    }

    #[test]
    fn an_attached_image_the_body_ignores_is_an_attachment() {
        // Gmail gives every attached image a Content-ID, embedded or not. Eight product
        // photographs vanished because of that: dropped as "part of the body" by a body
        // that never mentioned them.
        let html = r#"<p>Her er bildene</p><img src="https://example.com/signature.png">"#;
        assert!(!embedded(html, Some("f_mtwmgp112")));
    }

    #[test]
    fn no_content_id_is_never_embedded() {
        assert!(!embedded("<p>hei</p>", None));
    }
}

#[cfg(test)]
mod startup {
    /// How long the mailbox the window waits for actually takes:
    /// `LUMEN_DATA_DIR="$HOME/Library/Application Support/se.bambusa.lumen" \
    ///  cargo test debug_load -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn debug_load() {
        let Ok(dir) = std::env::var("LUMEN_DATA_DIR") else { return };
        let dir = std::path::PathBuf::from(dir);

        let opened = std::time::Instant::now();
        let db = crate::db::Db::open(&dir).expect("db");
        eprintln!("open + migrate: {:?}", opened.elapsed());

        let account = crate::mailbox::accounts(&db).expect("accounts").first().cloned();
        for round in 1..=3 {
            let started = std::time::Instant::now();
            let mailbox = crate::mailbox::load(&db, account.as_deref()).expect("load");
            eprintln!(
                "load #{round}: {:?}  ({} messages, {} people, {} files)",
                started.elapsed(),
                mailbox.messages.len(),
                mailbox.people.len(),
                mailbox.things.len()
            );
        }
    }
}

#[cfg(test)]
mod startup_breakdown {
    /// Where the fourteen seconds go.
    #[test]
    #[ignore]
    fn debug_load_parts() {
        let Ok(dir) = std::env::var("LUMEN_DATA_DIR") else { return };
        let db = crate::db::Db::open(std::path::Path::new(&dir)).expect("db");

        let started = std::time::Instant::now();
        let rows: Vec<(Option<String>, Option<String>)> = db
            .with_conn(|conn| {
                let mut stmt = conn.prepare("SELECT body_text, body_html FROM messages")?;
                let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
                rows.collect::<rusqlite::Result<Vec<_>>>()
            })
            .expect("rows");
        eprintln!("read {} rows from sqlite: {:?}", rows.len(), started.elapsed());

        let total: usize = rows.iter().filter_map(|(_, h)| h.as_ref()).map(|h| h.len()).sum();
        eprintln!("total html: {:.1} MB", total as f64 / 1e6);

        let mut quote = 0u128;
        let mut signature = 0u128;
        let mut inline = 0u128;
        let mut text = 0u128;

        for (_, html) in &rows {
            let Some(html) = html else { continue };

            let at = std::time::Instant::now();
            let (own, _quoted) = crate::mailbox::html::split_quote(html);
            quote += at.elapsed().as_micros();

            let at = std::time::Instant::now();
            let (body, sig) = crate::mailbox::html::split_signature(&own);
            signature += at.elapsed().as_micros();

            let at = std::time::Instant::now();
            let _ = crate::mailbox::html::to_inline(&body);
            inline += at.elapsed().as_micros();

            let at = std::time::Instant::now();
            let _ = crate::mailbox::html::to_text(&body);
            text += at.elapsed().as_micros();
            let _ = sig;
        }
        eprintln!("split_quote      {:.2}s", quote as f64 / 1e6);
        eprintln!("split_signature  {:.2}s", signature as f64 / 1e6);
        eprintln!("to_inline        {:.2}s", inline as f64 / 1e6);
        eprintln!("to_text          {:.2}s", text as f64 / 1e6);
    }
}
