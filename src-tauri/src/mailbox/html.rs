//! Turning mail HTML into something readable.
//!
//! Two jobs, deliberately separate:
//!
//! - [`to_text`] produces plain text for list previews, search and the fallback when a
//!   message has no plain-text part.
//! - [`sanitize`] produces HTML safe to hand to a sandboxed frame for actual rendering.
//!
//! Mail HTML is not web HTML. It is decades of table layouts, Outlook conditional comments,
//! tracking pixels and deliberate obfuscation, and it has to be treated as hostile.

/// Characters that exist only to manipulate what an inbox preview shows.
///
/// Marketing platforms pad the top of a message with hundreds of zero-width non-joiners and
/// non-breaking spaces, so the preview line shows their headline and nothing after it. In a
/// rendered email they are invisible. In extracted text they are a wall of noise.
const INVISIBLE: [char; 6] = [
    '\u{200B}', // zero width space
    '\u{200C}', // zero width non-joiner  (&zwnj;)
    '\u{200D}', // zero width joiner
    '\u{2060}', // word joiner
    '\u{FEFF}', // byte order mark
    '\u{00AD}', // soft hyphen
];

/// Tags whose end implies a line break. Everything else is inline.
const BLOCK_TAGS: [&str; 20] = [
    "p", "div", "br", "tr", "li", "ul", "ol", "table", "blockquote", "h1", "h2", "h3", "h4", "h5",
    "h6", "section", "article", "header", "footer", "hr",
];

/// Tags whose entire contents are machinery, not text.
const DROP_CONTENT: [&str; 5] = ["script", "style", "head", "title", "noscript"];

/// How a message wants to be shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Layout {
    /// Ordinary mail from a person: paragraphs, some bold, a link. Belongs in the app's own
    /// typography, not in a frame.
    Inline,
    /// Mail that was designed: table layouts, background colours, images placed to a grid.
    /// Only this needs an isolated frame, and only this looks wrong without one.
    Frame,
}

/// Decide which of the two a message is.
///
/// Biased towards Inline. Getting it wrong for a newsletter costs some broken layout;
/// getting it wrong for a colleague's reply puts a white box around two sentences, which is
/// far more jarring and far more common.
pub fn classify(html: &str) -> Layout {
    let lower = html.to_ascii_lowercase();

    // Deliberately NOT a signal: `mso-` styles and `<!--[if mso]>` conditional comments.
    // Outlook stamps those on everything it sends, including two-line replies, so treating
    // them as "designed" frames ordinary mail from anyone using Outlook. That is most people.

    // A responsive stylesheet means someone laid this out for several screen sizes, which
    // nobody does when replying to a colleague.
    if lower.contains("@media") {
        return Layout::Frame;
    }

    // A table is not enough on its own either: almost every corporate signature is a table
    // with a background colour. A table pinned to a layout width is the real marker, because
    // campaign layouts fix themselves at 500-700px and signatures do not.
    if has_wide_table(&lower) {
        return Layout::Frame;
    }

    // A logo and a photo is a signature. Four is a layout.
    if lower.matches("<img").count() >= 4 {
        return Layout::Frame;
    }

    // A lot of cells means a grid, not a signature block.
    if lower.matches("<td").count() >= 20 {
        return Layout::Frame;
    }

    Layout::Inline
}

/// Is there a table pinned to a layout-sized width?
///
/// Looks at `width=` attributes and `width:` in inline styles, and only counts values of
/// 500px or more. A signature table is either narrow or set to a percentage.
fn has_wide_table(lower: &str) -> bool {
    for start in lower.match_indices("<table").map(|(i, _)| i) {
        let end = lower[start..].find('>').map(|p| start + p).unwrap_or(lower.len());
        let tag = &lower[start..end];

        for marker in ["width=", "width:"] {
            let mut from = 0;
            while let Some(at) = tag[from..].find(marker) {
                let after = &tag[from + at + marker.len()..];
                let digits: String = after
                    .chars()
                    .skip_while(|c| *c == '"' || *c == '\'' || c.is_whitespace())
                    .take_while(|c| c.is_ascii_digit())
                    .collect();
                if digits.parse::<u32>().unwrap_or(0) >= 500 {
                    return true;
                }
                from += at + marker.len();
            }
        }
    }
    false
}

/// Markers that begin a quoted earlier message.
///
/// Each mail client announces the quote differently, and the ones here cover Gmail, Apple
/// Mail, Thunderbird, Outlook and the Nordic localisations that a Bambusa mailbox is full of.
const QUOTE_MARKERS: [&str; 15] = [
    "gmail_quote",
    "yahoo_quoted",
    "moz-cite-prefix",
    "outlookmessageheader",
    "divrplyfwdmsg",
    "<blockquote",
    ">from:",
    ">från:",
    ">fra:",
    ">von:",
    "-----original message-----",
    "-----ursprungligt meddelande-----",
    "-----opprinnelig melding-----",
    "wrote:</",
    "skrev:</",
];

/// One earlier message pulled out of a quoted block.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotedMessage {
    /// The attribution line the sending client wrote, if there was a recognisable one:
    /// "Den 10 sep. 2026 skrev Hannes:" or an Outlook "Från: ..." header.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub attribution: String,
    /// The message itself, as allowlisted inline markup.
    pub html: String,
}

/// How deep to unpick a quoted chain before treating the rest as one block.
///
/// Ten is already an absurd thread; beyond that the value of separating levels is gone and
/// the cost of getting the splits wrong is not.
const MAX_QUOTE_LEVELS: usize = 10;

/// Break a quoted block into the individual earlier messages it contains.
///
/// A reply quotes a reply that quotes a reply. Rendered as one blob it is unreadable, and it
/// looks like foreign markup pasted into the app. Split into levels, each can be shown in the
/// app's own design, which is the point.
pub fn explode_quotes(html: &str) -> Vec<QuotedMessage> {
    let mut out = Vec::new();
    let mut remaining = html.to_string();

    for _ in 0..MAX_QUOTE_LEVELS {
        // Search from 1: the block always *starts* with a marker, and matching it would
        // split off an empty level every time.
        match next_marker(&remaining, 1) {
            Some(cut) => {
                let head = remaining[..cut].to_string();
                remaining = remaining[cut..].to_string();
                push_level(&mut out, &head);
            }
            None => {
                push_level(&mut out, &remaining);
                return out;
            }
        }
    }

    if !remaining.trim().is_empty() {
        push_level(&mut out, &remaining);
    }
    out
}

fn push_level(out: &mut Vec<QuotedMessage>, chunk: &str) {
    let text = to_text(chunk);
    if text.trim().is_empty() {
        return;
    }

    let (attribution, body) = take_attribution(chunk, &text);
    out.push(QuotedMessage {
        attribution,
        html: to_inline(&body),
    });
}

/// Pull the attribution off the front of a quoted level so it can be shown as a header
/// rather than as the first line of the body.
fn take_attribution(chunk: &str, text: &str) -> (String, String) {
    let Some(first) = text.lines().find(|l| !l.trim().is_empty()) else {
        return (String::new(), chunk.to_string());
    };
    let first = first.trim();

    let looks_like_attribution = first.len() < 200
        && (first.ends_with(':')
            || first.to_lowercase().contains(" skrev ")
            || first.to_lowercase().contains(" wrote:")
            || first.to_lowercase().starts_with("from:")
            || first.to_lowercase().starts_with("från:")
            || first.to_lowercase().starts_with("fra:"));

    if !looks_like_attribution {
        return (String::new(), chunk.to_string());
    }

    // Remove the attribution from the markup by cutting at the end of the text that produced
    // it. Falls back to leaving it in place if it cannot be located cleanly.
    match find_after_text(chunk, first) {
        Some(at) => (first.to_string(), chunk[at..].to_string()),
        None => (first.to_string(), chunk.to_string()),
    }
}

/// Byte offset just past the markup that rendered `needle` as text.
///
/// Walks the markup and the text together rather than searching for the string: the text has
/// had entities decoded and tags removed, so it does not appear verbatim in the source.
fn find_after_text(html: &str, needle: &str) -> Option<usize> {
    let target: String = needle.split_whitespace().collect();
    let mut seen = String::new();
    let mut in_tag = false;

    for (index, ch) in html.char_indices() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                if seen.len() >= target.len() {
                    return Some(index + 1);
                }
            }
            c if !in_tag && !c.is_whitespace() => {
                seen.push(c);
                if seen.len() >= target.len() {
                    return Some(index + 1);
                }
            }
            _ => {}
        }
    }
    None
}

/// The next quote marker after `from`, aligned to the start of its element.
///
/// Only cuts strictly after the start of the chunk. A quoted block *begins* with a marker
/// (`<div class="gmail_quote">`), so a cut at zero splits off nothing and the caller loops
/// forever making no progress.
fn next_marker(html: &str, from: usize) -> Option<usize> {
    if from >= html.len() {
        return None;
    }
    // ASCII-only lowercasing: the markers are all ASCII, and unlike `to_lowercase` it cannot
    // change the byte length, so indices found here stay valid in the original string.
    let lower = html.to_ascii_lowercase();
    let mut best: Option<usize> = None;

    for needle in QUOTE_MARKERS {
        let mut search = from;
        while let Some(offset) = lower[search..].find(needle) {
            let at = search + offset;
            let cut = html[..at].rfind('<').unwrap_or(at);
            if cut > 0 {
                best = Some(best.map_or(cut, |current: usize| current.min(cut)));
                break;
            }
            // This occurrence is the chunk's own opening tag. Keep looking past it.
            search = at + needle.len();
        }
    }

    best
}

/// Split HTML into what this message says and the earlier messages it quotes.
///
/// The same idea as the plain-text splitter: a reply carries a copy of everything before it,
/// and hiding the copy is what makes a long thread readable. Conservative in the same way,
/// too: if the cut would leave nothing, there is no cut.
pub fn split_quote(html: &str) -> (String, String) {
    // ASCII-only: `to_lowercase` can change a string's byte length for some non-ASCII
    // characters, which would make these offsets point into the middle of a character.
    let lower = html.to_ascii_lowercase();

    let Some(marker_at) = QUOTE_MARKERS
        .iter()
        .filter_map(|needle| lower.find(needle))
        .min()
    else {
        return (html.to_string(), String::new());
    };

    // Cut at the start of the element containing the marker, not mid-tag, or the quoted
    // block is left with a dangling open tag.
    let cut = html[..marker_at].rfind('<').unwrap_or(marker_at);

    let body = html[..cut].to_string();
    let quoted = html[cut..].to_string();

    // A marker in the first few characters means the whole message is quotation, which
    // usually means the detection was wrong rather than that the sender wrote nothing.
    if to_text(&body).trim().is_empty() {
        return (html.to_string(), String::new());
    }

    (body, quoted)
}

/// Reduce mail HTML to a small allowlist that can be rendered directly by the app.
///
/// Everything not on the list is dropped, tag and all attributes, so the result carries no
/// styling, no scripts, no remote references and no layout of its own. That is the point:
/// this markup is meant to inherit the app's typography rather than impose its own.
pub fn to_inline(html: &str) -> String {
    const KEEP: [&str; 18] = [
        "p", "br", "b", "strong", "i", "em", "u", "a", "ul", "ol", "li", "blockquote", "code",
        "pre", "h1", "h2", "h3", "h4",
    ];

    let mut out = String::with_capacity(html.len());
    let chars: Vec<char> = html.chars().collect();
    let mut i = 0;
    let mut skipping: Option<&'static str> = None;

    while i < chars.len() {
        if chars[i] == '<' {
            let Some(end) = find_tag_end(&chars, i) else { break };
            let tag: String = chars[i + 1..end].iter().collect();
            let name = tag_name(&tag);
            let closing = tag.starts_with('/');

            if let Some(open) = skipping {
                if closing && name == open {
                    skipping = None;
                }
                i = end + 1;
                continue;
            }

            if DROP_CONTENT.contains(&name.as_str()) && !closing {
                skipping = Some(leak(&name));
                i = end + 1;
                continue;
            }

            if KEEP.contains(&name.as_str()) {
                out.push('<');
                if closing {
                    out.push('/');
                }
                out.push_str(&name);
                // Only a link's destination survives, and only if it is safe to follow.
                if !closing && name == "a" {
                    if let Some(href) = safe_href(&tag) {
                        out.push_str(&format!(" href=\"{href}\""));
                    }
                }
                out.push('>');
            } else if !closing && BLOCK_TAGS.contains(&name.as_str()) {
                // An unlisted block tag still ended a line, so keep the break it implied.
                out.push_str("<br>");
            }

            i = end + 1;
            continue;
        }

        if skipping.is_none() {
            // Source entities are decoded first, then the result re-escaped. Escaping the
            // raw `&` instead would turn `&nbsp;` into a visible "&nbsp;".
            if chars[i] == '&' {
                let limit = (i + 12).min(chars.len());
                if let Some(semi) = chars[i..limit].iter().position(|c| *c == ';').map(|p| i + p) {
                    let entity: String = chars[i + 1..semi].iter().collect();
                    if let Some(decoded) = resolve_entity(&entity) {
                        push_escaped(&mut out, &decoded);
                        i = semi + 1;
                        continue;
                    }
                }
                out.push_str("&amp;");
                i += 1;
                continue;
            }

            push_escaped(&mut out, &chars[i].to_string());
        }
        i += 1;
    }

    collapse_breaks(&strip_invisible(&out))
}

/// Pull `href` out of a tag, keeping only schemes that are safe to hand to a browser.
fn safe_href(tag: &str) -> Option<String> {
    let lower = tag.to_lowercase();
    let at = lower.find("href")?;
    let rest = &tag[at + 4..];
    let eq = rest.find('=')?;
    let value = rest[eq + 1..].trim_start();

    let url = if let Some(stripped) = value.strip_prefix('"') {
        stripped.split('"').next()?
    } else if let Some(stripped) = value.strip_prefix('\'') {
        stripped.split('\'').next()?
    } else {
        value.split_whitespace().next()?
    };

    let scheme = url.to_lowercase();
    if scheme.starts_with("http://") || scheme.starts_with("https://") || scheme.starts_with("mailto:") {
        Some(url.replace('"', "%22"))
    } else {
        None
    }
}

/// Escape text so that content which merely looks like markup cannot become markup.
fn push_escaped(out: &mut String, text: &str) {
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            other => out.push(other),
        }
    }
}

fn strip_invisible(html: &str) -> String {
    html.chars().filter(|c| !INVISIBLE.contains(c)).collect()
}

/// Collapse the line breaks that table layouts leave behind.
///
/// A campaign email is tables nested five deep, and every cell, row and table boundary
/// became a `<br>`, with the source's indentation whitespace between them. Fifty breaks in a
/// row is a screen and a half of nothing between the first sentence and the second, which
/// reads as "the message is one line long". Any run of breaks and whitespace becomes at
/// most one blank line, and the message never starts or ends with one.
fn collapse_breaks(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut pending_breaks = 0usize;
    let mut pending_space = false;
    let mut started = false;
    let mut rest = html.replace("<p></p>", "");
    rest = rest.replace("<br/>", "<br>").replace("<br />", "<br>");

    let mut i = 0;
    let bytes = rest.as_bytes();
    while i < bytes.len() {
        if rest[i..].starts_with("<br>") {
            pending_breaks += 1;
            i += 4;
            continue;
        }
        let ch = rest[i..].chars().next().unwrap();
        if ch.is_whitespace() {
            pending_space = true;
            i += ch.len_utf8();
            continue;
        }

        // Real content follows: flush the separator it was preceded by.
        if started {
            match pending_breaks {
                0 => {
                    if pending_space {
                        out.push(' ');
                    }
                }
                1 => out.push_str("<br>"),
                _ => out.push_str("<br><br>"),
            }
        }
        pending_breaks = 0;
        pending_space = false;
        started = true;

        out.push(ch);
        i += ch.len_utf8();
    }

    out
}

/// Extract readable text from mail HTML.
pub fn to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let bytes: Vec<char> = html.chars().collect();
    let lower = html.to_lowercase();

    let mut i = 0;
    let mut skipping: Option<&str> = None;

    while i < bytes.len() {
        if bytes[i] == '<' {
            let Some(end) = find_tag_end(&bytes, i) else {
                break;
            };
            let tag: String = bytes[i + 1..end].iter().collect();
            let name = tag_name(&tag);

            if let Some(open) = skipping {
                // Only the matching close tag ends a skipped region; nested markup inside
                // <style> is not markup at all.
                if tag.starts_with('/') && name == open {
                    skipping = None;
                }
            } else if DROP_CONTENT.contains(&name.as_str()) && !tag.starts_with('/') {
                skipping = Some(leak(&name));
            } else if BLOCK_TAGS.contains(&name.as_str()) {
                push_break(&mut out);
            }

            i = end + 1;
            continue;
        }

        if skipping.is_none() {
            out.push(bytes[i]);
        }
        i += 1;
    }

    let _ = lower;
    tidy(&decode_entities(&out))
}

/// Strip what a sandboxed frame should never see, and neutralise what it might act on.
///
/// The frame's own sandbox and content policy are the real defence; this is the second
/// layer, so that a gap in either does not immediately mean script execution.
pub fn sanitize(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let bytes: Vec<char> = html.chars().collect();

    let mut i = 0;
    let mut skipping: Option<&str> = None;

    while i < bytes.len() {
        if bytes[i] == '<' {
            let Some(end) = find_tag_end(&bytes, i) else {
                break;
            };
            let tag: String = bytes[i + 1..end].iter().collect();
            let name = tag_name(&tag);

            if let Some(open) = skipping {
                if tag.starts_with('/') && name == open {
                    skipping = None;
                }
                i = end + 1;
                continue;
            }

            // Anything that can execute, navigate or embed is removed with its contents.
            if matches!(name.as_str(), "script" | "iframe" | "object" | "embed" | "applet" | "form")
            {
                if !tag.starts_with('/') && !tag.ends_with('/') {
                    skipping = Some(leak(&name));
                }
                i = end + 1;
                continue;
            }

            out.push('<');
            out.push_str(&strip_dangerous_attributes(&tag));
            out.push('>');
            i = end + 1;
            continue;
        }

        if skipping.is_none() {
            out.push(bytes[i]);
        }
        i += 1;
    }

    out
}

/// Drop `on*` handlers and `javascript:` URLs.
fn strip_dangerous_attributes(tag: &str) -> String {
    let lower = tag.to_lowercase();
    if !lower.contains("on") && !lower.contains("javascript:") {
        return tag.to_string();
    }

    let mut out = String::with_capacity(tag.len());
    let chars: Vec<char> = tag.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        // An attribute name starts after whitespace.
        if chars[i].is_whitespace() {
            let start = i;
            let mut j = i + 1;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            let name_start = j;
            while j < chars.len() && (chars[j].is_alphanumeric() || chars[j] == '-') {
                j += 1;
            }
            let name: String = chars[name_start..j].iter().collect::<String>().to_lowercase();

            if name.starts_with("on") {
                // Skip the whole attribute, value and all.
                i = skip_attribute_value(&chars, j);
                continue;
            }

            out.extend(&chars[start..j]);
            i = j;
            continue;
        }

        out.push(chars[i]);
        i += 1;
    }

    // Cheap and total: a javascript: URL anywhere in the tag is defanged rather than parsed.
    out.replace("javascript:", "about:blank#")
        .replace("JavaScript:", "about:blank#")
}

fn skip_attribute_value(chars: &[char], from: usize) -> usize {
    let mut i = from;
    while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
    }
    if i >= chars.len() || chars[i] != '=' {
        return i;
    }
    i += 1;
    while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
    }
    match chars.get(i) {
        Some('"') => chars[i + 1..].iter().position(|c| *c == '"').map_or(chars.len(), |p| i + p + 2),
        Some('\'') => chars[i + 1..].iter().position(|c| *c == '\'').map_or(chars.len(), |p| i + p + 2),
        _ => {
            while i < chars.len() && !chars[i].is_whitespace() {
                i += 1;
            }
            i
        }
    }
}

/// The end of a tag, skipping `>` that sits inside a quoted attribute value.
fn find_tag_end(chars: &[char], start: usize) -> Option<usize> {
    let mut i = start + 1;
    let mut quote: Option<char> = None;

    while i < chars.len() {
        let c = chars[i];
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => {}
            None if c == '"' || c == '\'' => quote = Some(c),
            None if c == '>' => return Some(i),
            None => {}
        }
        i += 1;
    }
    None
}

fn tag_name(tag: &str) -> String {
    tag.trim_start_matches('/')
        .chars()
        .take_while(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_lowercase()
}

/// `DROP_CONTENT` and the tag list are `&'static str`, but the name we matched is owned.
/// Map it back to the static so the "currently skipping" marker can borrow for 'static.
fn leak(name: &str) -> &'static str {
    for candidate in DROP_CONTENT
        .iter()
        .chain(["script", "iframe", "object", "embed", "applet", "form"].iter())
    {
        if *candidate == name {
            return candidate;
        }
    }
    "script"
}

fn push_break(out: &mut String) {
    if !out.ends_with('\n') {
        out.push('\n');
    }
}

/// The named entities that actually appear in mail, plus numeric forms.
fn decode_entities(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        if chars[i] != '&' {
            out.push(chars[i]);
            i += 1;
            continue;
        }

        // Entities are short; anything longer is a stray ampersand.
        let limit = (i + 12).min(chars.len());
        let Some(semi) = chars[i..limit].iter().position(|c| *c == ';').map(|p| i + p) else {
            out.push('&');
            i += 1;
            continue;
        };

        let entity: String = chars[i + 1..semi].iter().collect();
        match resolve_entity(&entity) {
            Some(decoded) => {
                out.push_str(&decoded);
                i = semi + 1;
            }
            None => {
                out.push('&');
                i += 1;
            }
        }
    }

    out
}

fn resolve_entity(entity: &str) -> Option<String> {
    if let Some(rest) = entity.strip_prefix('#') {
        let code = if let Some(hex) = rest.strip_prefix('x').or_else(|| rest.strip_prefix('X')) {
            u32::from_str_radix(hex, 16).ok()?
        } else {
            rest.parse::<u32>().ok()?
        };
        return char::from_u32(code).map(String::from);
    }

    let decoded = match entity.to_lowercase().as_str() {
        "amp" => "&",
        "lt" => "<",
        "gt" => ">",
        "quot" => "\"",
        "apos" => "'",
        "nbsp" => " ",
        "zwnj" | "zwj" | "shy" => "",
        "mdash" => "—",
        "ndash" => "–",
        "hellip" => "…",
        "lsquo" => "\u{2018}",
        "rsquo" => "\u{2019}",
        "ldquo" => "\u{201C}",
        "rdquo" => "\u{201D}",
        "bull" => "•",
        "middot" => "·",
        "trade" => "™",
        "copy" => "©",
        "reg" => "®",
        "euro" => "€",
        "pound" => "£",
        "deg" => "°",
        "aring" => "å",
        "auml" => "ä",
        "ouml" => "ö",
        "oslash" => "ø",
        "aelig" => "æ",
        _ => return None,
    };
    Some(decoded.to_string())
}

/// Collapse the whitespace that table layouts and preheader padding leave behind.
fn tidy(text: &str) -> String {
    let cleaned: String = text.chars().filter(|c| !INVISIBLE.contains(c)).collect();

    let mut lines: Vec<String> = Vec::new();
    for line in cleaned.lines() {
        // Non-breaking spaces have already become ordinary ones, so a padding line is now
        // simply blank.
        let squeezed = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if squeezed.is_empty() {
            // At most one blank line in a row: mail HTML produces dozens.
            if lines.last().map(|l| l.is_empty()).unwrap_or(true) {
                continue;
            }
            lines.push(String::new());
        } else {
            lines.push(squeezed);
        }
    }

    while lines.last().map(|l| l.is_empty()).unwrap_or(false) {
        lines.pop();
    }

    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_the_entities_mail_actually_uses() {
        let html = "<p>Matthew &amp; the team said &quot;hi&quot; &#39;today&#39;</p>";
        assert_eq!(to_text(html), "Matthew & the team said \"hi\" 'today'");
    }

    #[test]
    fn preheader_padding_disappears() {
        // The exact shape marketing tools emit: a headline, then hundreds of invisible
        // characters to stop the preview showing anything else.
        let padding = "&nbsp;&zwnj;".repeat(200);
        let html = format!("<div>Big tech hates this one weird trick{padding}</div><p>Real content</p>");
        let text = to_text(&html);

        assert!(text.contains("Big tech hates this one weird trick"));
        assert!(text.contains("Real content"));
        assert!(!text.contains('\u{200C}'), "zero-width joiners survived");
        assert!(text.len() < 90, "padding was not collapsed: {text:?}");
    }

    #[test]
    fn block_tags_become_line_breaks() {
        let html = "<h1>Title</h1><p>One</p><p>Two</p><ul><li>a</li><li>b</li></ul>";
        assert_eq!(to_text(html), "Title\nOne\nTwo\na\nb");
    }

    #[test]
    fn style_and_script_contents_never_appear() {
        let html = "<style>.a{color:red}</style><script>alert(1)</script><p>Only this</p>";
        assert_eq!(to_text(html), "Only this");
    }

    #[test]
    fn a_greater_than_inside_an_attribute_does_not_end_the_tag() {
        // r##..##: the fragment href contains `"#`, which would close a plain r#" literal.
        let html = r##"<a title="5 > 3" href="#">link</a> after"##;
        assert_eq!(to_text(html), "link after");
    }

    #[test]
    fn sanitize_removes_scripts_and_handlers() {
        let html = r#"<div onclick="steal()"><script>bad()</script><a href="javascript:go()">x</a></div>"#;
        let safe = sanitize(html);

        assert!(!safe.contains("script"), "{safe}");
        assert!(!safe.contains("onclick"), "{safe}");
        assert!(!safe.contains("javascript:"), "{safe}");
        assert!(safe.contains("<a"), "the link itself should survive: {safe}");
    }

    #[test]
    fn a_colleagues_reply_renders_inline_not_in_a_frame() {
        let html = "<div><p>Hei Hannes,</p><p>Kan du se p&aring; <b>flow B</b>?</p></div>";
        assert_eq!(classify(html), Layout::Inline);

        let inline = to_inline(html);
        assert!(inline.contains("<b>flow B</b>"), "{inline}");
        assert!(inline.contains("Kan du se på"), "entities must be decoded: {inline}");
        assert!(!inline.contains("&amp;aring"), "entities must not be double-escaped: {inline}");
    }

    #[test]
    fn a_campaign_newsletter_asks_for_a_frame() {
        assert_eq!(classify("<table width=600><tr><td>hi</td></tr></table>"), Layout::Frame);
        assert_eq!(classify("<table style=\"width:640px\"><tr><td>x</td></tr></table>"), Layout::Frame);
        assert_eq!(classify("<style>@media screen{.a{}}</style><p>hi</p>"), Layout::Frame);
    }

    #[test]
    fn an_outlook_reply_is_not_designed_mail() {
        // Outlook stamps mso styles and conditional comments on everything it sends, so
        // treating either as a marker framed ordinary replies from most of the office.
        let outlook_reply = concat!(
            "<!--[if gte mso 9]><xml><o:OfficeDocumentSettings/></xml><![endif]-->",
            "<div style=\"mso-line-height-rule:exactly\">",
            "<p>Hej,</p><p>Vill f&ouml;lja upp nedan.</p></div>",
        );
        assert_eq!(classify(outlook_reply), Layout::Inline);
    }

    #[test]
    fn a_signature_table_does_not_make_a_reply_designed() {
        // Every corporate signature looks like this, and framing them was the bug.
        // r##..##: the colour literal contains `"#`, which closes a plain r#" string.
        let reply = r##"<div><p>Tack för snabbt svar!</p>
            <table bgcolor="#000000" width="100%"><tr><td><img src="logo.png"></td></tr></table></div>"##;
        assert_eq!(classify(reply), Layout::Inline);
    }

    #[test]
    fn html_quotes_are_split_off() {
        let html = r#"<div><p>Tack för snabbt svar!</p></div>
            <div class="gmail_quote"><p>Den 10 sep skrev Hannes:</p><p>Hej!</p></div>"#;
        let (body, quoted) = split_quote(html);

        assert!(to_text(&body).contains("Tack för snabbt svar"));
        assert!(!to_text(&body).contains("Hej!"), "quote leaked into the body: {body}");
        assert!(to_text(&quoted).contains("Hej!"));
    }

    #[test]
    fn an_outlook_header_block_starts_the_quote() {
        let html = "<div><p>Se nedan.</p></div><hr><div><b>Från:</b> Hannes<br><b>Ämne:</b> Re: x</div>";
        let (body, quoted) = split_quote(html);

        assert_eq!(to_text(&body).trim(), "Se nedan.");
        assert!(to_text(&quoted).contains("Från:"));
    }

    #[test]
    fn a_quoted_chain_is_split_into_its_levels() {
        let html = r#"<div class="gmail_quote"><p>Den 10 sep skrev Hannes:</p><p>Andra svaret</p>
            <div class="gmail_quote"><p>Den 9 sep skrev Annika:</p><p>Första svaret</p></div></div>"#;
        let levels = explode_quotes(html);

        assert_eq!(levels.len(), 2, "{levels:#?}");
        assert_eq!(levels[0].attribution, "Den 10 sep skrev Hannes:");
        assert!(to_text(&levels[0].html).contains("Andra svaret"));
        assert!(!to_text(&levels[0].html).contains("Första svaret"), "levels bled together");
        assert_eq!(levels[1].attribution, "Den 9 sep skrev Annika:");
        assert!(to_text(&levels[1].html).contains("Första svaret"));
    }

    #[test]
    fn a_quote_without_an_attribution_keeps_all_its_text() {
        let levels = explode_quotes("<blockquote><p>bara text</p></blockquote>");
        assert_eq!(levels.len(), 1);
        assert!(levels[0].attribution.is_empty());
        assert!(to_text(&levels[0].html).contains("bara text"));
    }

    #[test]
    fn a_message_that_is_entirely_quotation_is_left_alone() {
        let html = r#"<div class="gmail_quote"><p>only history</p></div>"#;
        let (body, quoted) = split_quote(html);

        assert!(quoted.is_empty());
        assert!(to_text(&body).contains("only history"));
    }

    #[test]
    fn inline_keeps_safe_links_and_drops_the_rest() {
        let html = r#"<p><a href="https://bambusa.se" style="color:red" onclick="x()">site</a>
                      <a href="javascript:go()">bad</a></p>"#;
        let inline = to_inline(html);

        assert!(inline.contains(r#"<a href="https://bambusa.se">site</a>"#), "{inline}");
        assert!(!inline.contains("style"), "{inline}");
        assert!(!inline.contains("javascript"), "{inline}");
        assert!(inline.contains("<a>bad</a>"), "an unsafe link keeps its text: {inline}");
    }

    #[test]
    fn table_layout_breaks_collapse_to_one_blank_line() {
        // The shape a campaign tool produces: cells and rows separated by indentation.
        let html = "<table><tr><td>First</td></tr></table>\n   \n<table><tr><td>\n  \n</td></tr>\n<tr><td>Second</td></tr></table>";
        let inline = to_inline(html);
        assert!(!inline.contains("<br><br><br>"), "{inline}");
        assert!(inline.starts_with("First"), "must not start with breaks: {inline}");
        assert!(inline.contains("First<br><br>Second") || inline.contains("First<br>Second"), "{inline}");
    }

    #[test]
    fn inline_escapes_content_that_looks_like_markup() {
        let inline = to_inline("<p>use &lt;script&gt; carefully</p>");
        assert!(inline.contains("&lt;script&gt;"), "{inline}");
    }

    #[test]
    fn sanitize_keeps_ordinary_markup_intact() {
        let html = r#"<p class="lead">Hej <b>då</b></p>"#;
        assert_eq!(sanitize(html), html);
    }
}

/// Explicit signature containers, as the major clients mark them.
const SIGNATURE_MARKERS: [&str; 6] = [
    "class=\"signature",
    "class='signature",
    "gmail_signature",
    "id=\"signature",
    "ms-outlook-mobile-signature",
    "class=\"protonmail_signature",
];

/// Sign-off phrases, in the languages this mailbox sees.
const SIGN_OFFS: [&str; 12] = [
    "med vänlig hälsning",
    "vänliga hälsningar",
    "bästa hälsningar",
    "med vennlig hilsen",
    "vennlig hilsen",
    "best regards",
    "kind regards",
    "mit freundlichen grüßen",
    "skickat från min",
    "sendt fra min",
    "sent from my",
    "hämtat från",
];

/// Split a signature off the end of an HTML message.
///
/// Explicit containers are trusted anywhere; a sign-off phrase is only trusted in the last
/// third of the message, because "Best regards" can appear mid-sentence and cutting there
/// would eat the content.
pub fn split_signature(html: &str) -> (String, String) {
    let lower = html.to_ascii_lowercase();

    let explicit = SIGNATURE_MARKERS
        .iter()
        .filter_map(|needle| lower.find(needle))
        .filter(|at| *at > 0)
        .min();

    // Not "in the last third": a two-line message puts its sign-off near the middle. What
    // actually distinguishes a sign-off from the phrase appearing mid-sentence is how little
    // follows it, which is the same rule the plain-text splitter uses.
    let phrase = SIGN_OFFS
        .iter()
        .filter_map(|needle| lower.rfind(needle))
        .filter(|at| {
            let after = to_text(&html[*at..]);
            after.lines().filter(|l| !l.trim().is_empty()).count() <= 8
        })
        .min();

    let Some(marker_at) = explicit.into_iter().chain(phrase).min() else {
        return (html.to_string(), String::new());
    };

    let cut = html[..marker_at].rfind('<').unwrap_or(marker_at);
    let body = html[..cut].to_string();
    let signature = html[cut..].to_string();

    // Cutting away everything means the detection was wrong, not that the sender wrote only
    // a signature.
    if to_text(&body).trim().is_empty() {
        return (html.to_string(), String::new());
    }

    (body, signature)
}

#[cfg(test)]
mod signature_tests {
    use super::*;

    #[test]
    fn an_explicit_signature_container_is_split_off() {
        let html = r#"<div><p>Kan du kolla detta?</p></div><div class="gmail_signature"><p>Hannes Alm</p></div>"#;
        let (body, signature) = split_signature(html);

        assert_eq!(to_text(&body).trim(), "Kan du kolla detta?");
        assert!(to_text(&signature).contains("Hannes Alm"));
    }

    #[test]
    fn a_sign_off_near_the_end_is_a_signature() {
        let html = "<p>Vill följa upp nedan.</p><p>Med vänlig hälsning,</p><p>Annika</p>";
        let (body, signature) = split_signature(html);

        assert_eq!(to_text(&body).trim(), "Vill följa upp nedan.");
        assert!(to_text(&signature).contains("Annika"));
    }

    #[test]
    fn a_sign_off_early_in_a_long_message_is_left_alone() {
        // "Best regards" quoted mid-message must not truncate everything after it.
        let html = format!(
            "<p>He wrote best regards and then carried on.</p>{}",
            "<p>Still the actual message, at length.</p>".repeat(12)
        );
        let (body, signature) = split_signature(&html);

        assert!(signature.is_empty(), "cut too early: {signature}");
        assert!(to_text(&body).contains("Still the actual message"));
    }
}
