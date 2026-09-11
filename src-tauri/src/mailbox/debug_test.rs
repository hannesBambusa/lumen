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
