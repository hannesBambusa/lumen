//! What the assistant can be asked to do, and how each request is phrased to the model.
//!
//! The prompts are the product here. A small model follows a short, firm instruction well
//! and drifts on a long, clever one, so every prompt says what to do, what not to do, and
//! that the answer is the text and nothing else.

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Task {
    /// Translate into a language, keeping tone and formatting.
    Translate { text: String, target: String },
    /// Fix spelling and grammar only. Nothing else changes.
    Proofread { text: String },
    /// Rewrite for clarity and structure, same meaning, same language.
    Improve { text: String },
    /// A few sentences on what a conversation is about and what it needs.
    ///
    /// The language is named rather than left to the model. Told to answer "in its own
    /// language" it summarised a Norwegian thread in English, and it is the reader's
    /// language that matters here anyway, not the writers'.
    Summarize { text: String, language: String },
    /// Sort one message into a category, for filtering the mail list.
    ///
    /// The options travel with the task rather than living in the prompt: categories are
    /// rows in the database, so the list is whatever the user has made it.
    Categorize {
        subject: String,
        from: String,
        text: String,
        /// Slug and description, in the order they are offered.
        options: Vec<(String, String)>,
    },
}

impl Task {
    fn text(&self) -> &str {
        match self {
            Task::Translate { text, .. }
            | Task::Proofread { text }
            | Task::Improve { text }
            | Task::Summarize { text, .. }
            | Task::Categorize { text, .. } => text,
        }
    }

    pub fn system_prompt(&self) -> String {
        let job = match self {
            Task::Translate { target, .. } => format!(
                "You translate email text into {target}. Keep the meaning, tone and paragraph \
                 breaks. Keep names, product names, numbers, dates and links exactly as they are. \
                 Do not add greetings or explanations."
            ),
            Task::Proofread { .. } => "You correct spelling, grammar and punctuation in email text. \
                 Change nothing else: not the wording, not the tone, not the structure, not the \
                 language. If the text is already correct, return it unchanged."
                .to_string(),
            Task::Improve { .. } => "You improve email text so it is clearer and better \
                 structured. Keep the same meaning, the same language, the same level of \
                 formality, and roughly the same length. Keep names, numbers, dates and links \
                 exactly as they are. Do not add content the writer did not say."
                .to_string(),
            Task::Summarize { language, .. } => format!(
                "You summarise an email conversation in {language}. Say what it is about, what \
                 has been decided, and what is still being asked of the reader, in at most five \
                 short sentences."
            ),
            Task::Categorize { .. } => "You sort work email into exactly one category."
                .to_string(),
        };
        format!("{job} Reply with the result only: no preamble, no notes, no quotation marks around it.")
    }

    /// The user turn carries the instruction as well as the text.
    ///
    /// A small model weighs the user turn far more than the system prompt, and with the
    /// instruction only in the system prompt it tended to echo the text back. For
    /// translation between close languages (Norwegian to Swedish) it copied the source
    /// nearly verbatim, so that case names the languages explicitly and shows one example
    /// of the transformation it is being asked for.
    pub fn user_prompt(&self) -> String {
        let text = self.text().trim();
        let body = match self {
            Task::Translate { target, .. } => format!(
                "Translate the text below into {target}. Every word of your answer must be \
                 {target}. The text may be in Norwegian, Danish, English, German or another \
                 language; Norwegian and Danish are not {target}, so translate them fully \
                 rather than copying words that look similar.\n\n\
                 {example}Now translate this into {target}:\n\n{text}",
                example = translation_example(target),
            ),
            Task::Proofread { .. } => format!(
                "Correct the spelling, grammar and punctuation of the text below. Keep the \
                 wording, tone, structure and language exactly as they are. Return only the \
                 corrected text:\n\n{text}"
            ),
            Task::Improve { .. } => format!(
                "Rewrite the text below so it is clearer and better structured, in the same \
                 language and the same tone, keeping every fact. Return only the rewritten \
                 text:\n\n{text}"
            ),
            Task::Summarize { language, .. } => format!(
                "Summarise the conversation below in {language}. Every word of your answer must \
                 be {language}, whatever language the conversation itself is in. Say what it is \
                 about, what was decided, and what is still being asked of me, in at most five \
                 short sentences:\n\n{text}"
            ),
            // One word out, chosen from a list spelled out with its meaning. A small model
            // is reliable at picking from a short closed set and unreliable the moment it
            // is asked to invent a label, so it is never asked to. The list comes from the
            // database, because categories are the user's to add and remove.
            Task::Categorize { subject, from, options, .. } => {
                let list = options
                    .iter()
                    .map(|(slug, description)| format!("{slug} - {description}"))
                    .collect::<Vec<_>>()
                    .join("\n");
                format!(
                    "Sort this email into exactly one of these categories:\n\n{list}\n\n\
                     From: {from}\nSubject: {subject}\n\n{text}\n\n\
                     Answer with one word from the list and nothing else."
                )
            }
        };
        // "/no_think" is Qwen3's switch for skipping its reasoning phase. Without it the
        // model spends hundreds of tokens thinking about a two-line reply, which on the
        // target laptop is a minute of waiting for nothing the user will see.
        format!("{body}\n/no_think")
    }

    /// Generous relative to the input, since translations run long, but bounded: a stuck
    /// model must not be allowed to produce forever.
    pub fn max_tokens(&self) -> usize {
        let words = self.text().split_whitespace().count();
        match self {
            Task::Summarize { .. } => 240,
            // One word, and a budget that forbids an essay. A made-up category can be
            // several words long once slugged, so this is looser than it looks.
            Task::Categorize { .. } => 16,
            _ => (words * 3).clamp(64, 1500),
        }
    }
}

/// One worked example in the target language, when one exists.
///
/// The example must end in the target language: a Norwegian→Swedish example shown to a
/// model asked for English nudges it towards Swedish. No example beats a wrong one.
fn translation_example(target: &str) -> String {
    const INPUT: &str = "Heldigvis har vi tid enda på å sette opp tidslinjen. Vi starter med at \
                         Hannes setter opp oversikten.";
    let output = match target.to_ascii_lowercase().as_str() {
        "swedish" | "svenska" => "Lyckligtvis har vi fortfarande tid att sätta upp tidslinjen. Vi \
                                  börjar med att Hannes sätter upp översikten.",
        "english" | "engelska" => "Fortunately we still have time to set up the timeline. We start \
                                   with Hannes setting up the overview.",
        "german" | "deutsch" => "Zum Glück haben wir noch Zeit, den Zeitplan aufzustellen. Wir \
                                 beginnen damit, dass Hannes die Übersicht erstellt.",
        _ => return String::new(),
    };
    // Norwegian and Swedish share most of their vocabulary, and a small model leaves the
    // words that differ untouched. Naming the ones that actually come up in office mail
    // fixes most of the leftovers at the cost of a few dozen tokens.
    let traps = match target.to_ascii_lowercase().as_str() {
        "swedish" | "svenska" => "Norwegian words that must change in Swedish: utfordringer → \
             utmaningar, må → måste, etterpå → efteråt, begeistret → entusiastisk, enda → \
             fortfarande, noe → något, hvis → om, uke → vecka, jobbe → jobba, se på → titta på.\n\n",
        _ => "",
    };
    format!("Example, Norwegian to {target}:\nInput: {INPUT}\nOutput: {output}\n\n{traps}")
}

/// Split text into paragraphs on blank lines, dropping empty ones.
fn looks_danish_not_norwegian(text: &str) -> bool {
    const DANISH: &[&str] = &["af", "hvad", "nu", "hvordan", "været", "jer", "meget", "hvor", "kun", "ikke", "sådan"];
    const NORWEGIAN: &[&str] = &["av", "hva", "nå", "vært", "dere", "mye", "hvor", "bare", "ikke", "slik", "hei", "noe", "å"];
    let mut danish = 0;
    let mut norwegian = 0;
    for word in text.split(|c: char| !c.is_alphabetic()) {
        let word = word.to_lowercase();
        if word.is_empty() {
            continue;
        }
        // Words both languages share (ikke, hvor) count for neither.
        let d = DANISH.contains(&word.as_str());
        let n = NORWEGIAN.contains(&word.as_str());
        if d && !n {
            danish += 1;
        } else if n && !d {
            norwegian += 1;
        }
    }
    danish > norwegian
}

pub fn paragraphs(text: &str) -> Vec<&str> {
    text.split("\n\n")
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .collect()
}

/// System and user prompts for a task on a given model family.
///
/// Qwen takes a system turn and a `/no_think` switch. TranslateGemma has no system role and
/// was trained on one specific instruction that names the source language, so that is
/// detected here and the instruction reproduced exactly. A specialist asked for anything but
/// translation falls back to the general prompt, which it will follow poorly; the settings
/// page does not let that happen.
pub fn prompts(task: &Task, family: crate::assistant::Family) -> (String, String) {
    match (family, task) {
        (crate::assistant::Family::TranslateGemma, Task::Translate { text, target }) => {
            let source = detect_language(text);
            (String::new(), translategemma_prompt(source, target, text))
        }
        (crate::assistant::Family::TranslateGemma, _) => (String::new(), task.user_prompt()),
        (crate::assistant::Family::Qwen, _) => (task.system_prompt(), task.user_prompt()),
    }
}

/// The language a text is written in, as the English name TranslateGemma expects.
///
/// Falls back to "the original language" when detection is unsure, which the model copes
/// with; a confidently wrong source name hurts more than a vague one.
pub fn detect_language(text: &str) -> &'static str {
    use whatlang::Lang;
    let Some(info) = whatlang::detect(text) else { return "the original language" };
    // whatlang rarely calls a short Nordic text "reliable": Swedish, Norwegian and Danish
    // share too much. Its best guess among those three is still right far more often than
    // not, and the fallback phrase gives the model nothing, so the guess is kept for them.
    // `is_reliable` wants near-certainty, which a two-line email never reaches; an 0.8
    // guess at English is right. Half is the bar, except for the Nordic three where any
    // guess is kept: see below.
    let nordic = matches!(info.lang(), Lang::Swe | Lang::Nob | Lang::Dan);
    if info.confidence() < 0.5 && !nordic {
        return "the original language";
    }
    match info.lang() {
        Lang::Swe => "Swedish",
        // Written Bokmål and Danish differ in spelling more than in vocabulary, and whatlang
        // guesses between them almost at random. A handful of words that exist in only one
        // of the two settles it.
        Lang::Nob | Lang::Dan => {
            if looks_danish_not_norwegian(text) { "Danish" } else { "Norwegian" }
        }
        Lang::Eng => "English",
        Lang::Deu => "German",
        Lang::Fra => "French",
        Lang::Spa => "Spanish",
        Lang::Fin => "Finnish",
        Lang::Nld => "Dutch",
        Lang::Ita => "Italian",
        Lang::Por => "Portuguese",
        Lang::Pol => "Polish",
        _ => "the original language",
    }
}

/// The instruction TranslateGemma was trained on, per Google's model card. It wants the
/// source language named, which the caller has to know or detect.
pub fn translategemma_prompt(source: &str, target: &str, text: &str) -> String {
    format!(
        "You are a professional {source} to {target} translator. Your goal is to accurately \
         convey the meaning and nuances of the original {source} text while adhering to \
         {target} grammar, vocabulary, and cultural sensitivities. Produce only the {target} \
         translation, without any additional explanations or commentary. Please translate \
         the following {source} text into {target}:\n\n{text}"
    )
}

/// Strip what a small model adds despite being told not to.
pub fn clean_output(raw: &str) -> String {
    let mut text = raw.trim();

    // Qwen3 may still emit a reasoning block in no-think mode. Usually it is empty and
    // properly closed; on a long input it sometimes opens one and never closes it, and the
    // answer follows anyway, so an unclosed opener has to be dropped on its own.
    if let Some(end) = text.find("</think>") {
        text = text[end + "</think>".len()..].trim_start();
    } else if let Some(rest) = text.strip_prefix("<think>") {
        text = rest.trim_start();
    }

    // Wrapping the whole answer in quotes or a code fence is the other habit.
    let text = text.trim_matches('`').trim();
    let text = if text.len() > 2 && text.starts_with('"') && text.ends_with('"') {
        &text[1..text.len() - 1]
    } else {
        text
    };

    text.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Runs the real model. Ignored by default; needs the file the app downloaded:
    /// `LUMEN_MODEL=~/Library/Application\ Support/se.bambusa.lumen/models/qwen3-1.7b-q4_k_m.gguf \
    ///  cargo test debug_translate -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn debug_translate() {
        let Ok(path) = std::env::var("LUMEN_MODEL") else { return };
        let target = std::env::var("LUMEN_TARGET").unwrap_or_else(|_| "Swedish".into());
        let text = std::env::var("LUMEN_TEXT").unwrap_or_else(|_| {
            "Ja, jeg blir like begeistret som deg, men samtidig har vi tid til å jobbe mot at \
             lageret må se på løsninger for å øke bemanningen noe. Vi starter med at Hannes \
             setter opp oversikten over alle tre land, så kan vi se på utfordringer etterpå? 🙏"
                .into()
        });

        let mut engine = crate::assistant::engine::Engine::load(std::path::Path::new(&path)).expect("load");
        let task = Task::Translate { text: text.clone(), target: target.clone() };
        let started = std::time::Instant::now();
        // LUMEN_PROMPT=gemma prompts the TranslateGemma way (single user turn, source
        // language detected) instead of the Qwen way.
        let family = if std::env::var("LUMEN_PROMPT").as_deref() == Ok("gemma") {
            crate::assistant::Family::TranslateGemma
        } else {
            crate::assistant::Family::Qwen
        };
        let (system, user) = prompts(&task, family);
        let raw = engine
            .generate(&system, &user, task.max_tokens(), |_| {})
            .expect("generate");
        let first = clean_output(&raw);
        eprintln!("--- {:.1}s ---\n{first}", started.elapsed().as_secs_f32());
    }

    #[test]
    fn output_is_stripped_of_thinking_and_wrapping() {
        assert_eq!(clean_output("<think>\n\n</think>\n\nHej Hannes"), "Hej Hannes");
        assert_eq!(clean_output("\"Hej Hannes\""), "Hej Hannes");
        assert_eq!(clean_output("```\nHej\n```"), "Hej");
    }

    /// The full path the app takes, paragraphs and all. Needs the app's data directory:
    /// `LUMEN_DATA_DIR=~/Library/Application\ Support/se.bambusa.lumen cargo test debug_run -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn debug_run() {
        let Ok(dir) = std::env::var("LUMEN_DATA_DIR") else { return };
        let text = std::env::var("LUMEN_TEXT").unwrap_or_else(|_| "Hei Hannes.\n\nNoe nytt her?".into());
        let assistant = crate::assistant::Assistant::open(std::path::Path::new(&dir));
        let started = std::time::Instant::now();
        let out = assistant
            .run(&Task::Translate { text, target: "Swedish".into() }, |_| {})
            .expect("run");
        eprintln!("--- {:.1}s ---\n{out}\n--- end ---", started.elapsed().as_secs_f32());
    }

    /// Run one raw prompt against a model, for trying prompt variants by hand:
    /// `LUMEN_MODEL=… LUMEN_USER="…" cargo test debug_prompt -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn debug_prompt() {
        let Ok(path) = std::env::var("LUMEN_MODEL") else { return };
        let system = std::env::var("LUMEN_SYSTEM").unwrap_or_default();
        let user = std::env::var("LUMEN_USER").expect("LUMEN_USER");

        let mut engine = crate::assistant::engine::Engine::load(std::path::Path::new(&path)).expect("load");
        let started = std::time::Instant::now();
        let out = engine.generate(&system, &user, 900, |_| {}).expect("generate");
        eprintln!("--- {:.1}s ---\n{}\n--- end ---", started.elapsed().as_secs_f32(), clean_output(&out));
    }

    /// Classify a file of real messages, to see whether a small model can sort mail:
    /// `LUMEN_MODEL=… LUMEN_SAMPLE=sample.json cargo test debug_classify -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn debug_classify() {
        let Ok(path) = std::env::var("LUMEN_MODEL") else { return };
        let Ok(sample) = std::env::var("LUMEN_SAMPLE") else { return };
        let raw = std::fs::read_to_string(sample).expect("sample");
        let items: Vec<serde_json::Value> = serde_json::from_str(&raw).expect("json");

        let mut engine = crate::assistant::engine::Engine::load(std::path::Path::new(&path)).expect("load");
        let started = std::time::Instant::now();
        for item in &items {
            let subject = item["subject"].as_str().unwrap_or("");
            let from = item["from"].as_str().unwrap_or("");
            let body: String = item["body"].as_str().unwrap_or("").chars().take(600).collect();
            let task = Task::Categorize {
                subject: subject.into(),
                from: from.into(),
                text: body,
                // LUMEN_OPTIONS overrides the list, for comparing wordings:
                // LUMEN_OPTIONS='[["reply","..."],["fyi","..."]]'
                options: std::env::var("LUMEN_OPTIONS")
                    .ok()
                    .and_then(|raw| serde_json::from_str::<Vec<(String, String)>>(&raw).ok())
                    .unwrap_or_else(|| {
                        vec![
                            ("reply".into(), "a person is asking me for something, or expects an answer from me".into()),
                            ("fyi".into(), "a person wrote to me, but nothing is being asked of me".into()),
                            ("meeting".into(), "a meeting invitation, or arranging a time".into()),
                            ("invoice".into(), "an invoice, a receipt, a payment or an order confirmation".into()),
                            ("automated".into(), "an automatic notification from a system or service".into()),
                            ("newsletter".into(), "marketing, campaigns, product news sent to many people".into()),
                        ]
                    }),
            };
            let (system, user) = prompts(&task, crate::assistant::Family::Qwen);
            let one = std::time::Instant::now();
            let out = engine.generate(&system, &user, task.max_tokens(), |_| {}).expect("generate");
            eprintln!(
                "{:>5.1}s  {:<10} {}",
                one.elapsed().as_secs_f32(),
                clean_output(&out),
                &subject.chars().take(58).collect::<String>()
            );
        }
        eprintln!("--- {:.1}s for {} messages ---", started.elapsed().as_secs_f32(), items.len());
    }

    #[test]
    fn an_unclosed_reasoning_block_is_dropped() {
        assert_eq!(clean_output("<think>\n\nKonversationen handlar om…"), "Konversationen handlar om…");
        assert_eq!(clean_output("<think>\n\n</think>\nSvaret"), "Svaret");
        assert_eq!(clean_output("Ett svar om <think> mitt i"), "Ett svar om <think> mitt i");
    }

    /// Prints the first pieces that actually reach the interface, to confirm no reasoning
    /// tag is shown while an answer streams in.
    #[test]
    #[ignore]
    fn debug_stream() {
        let Ok(dir) = std::env::var("LUMEN_DATA_DIR") else { return };
        let Ok(text) = std::env::var("LUMEN_TEXT") else { return };
        let dir = std::path::PathBuf::from(dir);
        let assistant = crate::assistant::Assistant::open(&dir);

        let mut first = String::new();
        let task = Task::Summarize { text, language: "Swedish".into() };
        let out = assistant
            .run(&task, |piece| {
                if first.chars().count() < 60 {
                    first.push_str(piece);
                }
            })
            .expect("run");
        eprintln!("--- first thing shown: {first:?}");
        eprintln!("--- final: {}", out.chars().take(90).collect::<String>());
    }

    #[test]
    fn nordic_languages_are_told_apart() {
        assert_eq!(detect_language("Hej! Kan du kolla på det här innan fredag? Det vore jättebra."), "Swedish");
        assert_eq!(detect_language("Hei! Kan du se på dette før fredag? Det hadde vært veldig fint."), "Norwegian");
        assert_eq!(detect_language("Hi! Could you look at this before Friday? That would be great."), "English");
    }

    #[test]
    fn token_budget_scales_with_input_within_bounds() {
        let short = Task::Proofread { text: "Hej".into() };
        assert_eq!(short.max_tokens(), 64);
        let long = Task::Improve { text: "ord ".repeat(2000) };
        assert_eq!(long.max_tokens(), 1500);
    }
}

/// Hides a reasoning block while the answer is still arriving.
///
/// `clean_output` only ever sees the finished text, so a `<think>` tag was visible on screen
/// for as long as generation took and then vanished when the cleaned result replaced it.
/// This does the same job token by token.
///
/// The awkward case is the one Qwen3 actually produces: usually `<think></think>` with
/// nothing inside, but on a long input it sometimes opens a block, never closes it, and
/// writes the answer anyway. Suppressing until a closing tag would then hide the whole
/// answer. So content after an opening tag is held only briefly: an empty block closes
/// within a couple of characters, and anything longer than that is treated as the answer and
/// released.
pub struct StreamCleaner {
    held: String,
    state: State,
}

#[derive(PartialEq)]
enum State {
    /// Nothing emitted yet; an opening tag may still be coming.
    Start,
    /// Inside a reasoning block, waiting for it to close or to grow past the threshold.
    Inside,
    /// Everything from here flows straight through.
    Open,
}

/// How much may sit between `<think>` and `</think>` before it is taken for the answer.
/// An empty block holds only whitespace.
const THINK_BUDGET: usize = 24;

impl Default for StreamCleaner {
    fn default() -> Self {
        Self::new()
    }
}

impl StreamCleaner {
    pub fn new() -> Self {
        Self { held: String::new(), state: State::Start }
    }

    /// Feed one piece of the stream. Whatever may be shown is passed to `emit`.
    pub fn push(&mut self, piece: &str, mut emit: impl FnMut(&str)) {
        if self.state == State::Open {
            emit(piece);
            return;
        }

        self.held.push_str(piece);

        loop {
            match self.state {
                State::Start => {
                    let trimmed = self.held.trim_start();
                    if let Some(rest) = trimmed.strip_prefix("<think>") {
                        self.held = rest.to_string();
                        self.state = State::Inside;
                        continue;
                    }
                    // Still possibly the start of the tag: wait rather than guess.
                    if "<think>".starts_with(trimmed) && !trimmed.is_empty() {
                        return;
                    }
                    // Not a reasoning block at all.
                    let out = std::mem::take(&mut self.held);
                    self.state = State::Open;
                    if !out.is_empty() {
                        emit(&out);
                    }
                    return;
                }
                State::Inside => {
                    if let Some(at) = self.held.find("</think>") {
                        let rest = self.held[at + "</think>".len()..].trim_start().to_string();
                        self.held.clear();
                        self.state = State::Open;
                        if !rest.is_empty() {
                            emit(&rest);
                        }
                        return;
                    }
                    if self.held.trim().chars().count() > THINK_BUDGET {
                        let out = std::mem::take(&mut self.held).trim_start().to_string();
                        self.state = State::Open;
                        if !out.is_empty() {
                            emit(&out);
                        }
                    }
                    return;
                }
                State::Open => return,
            }
        }
    }

    /// Release anything still held, for a stream that ended mid-decision.
    pub fn finish(&mut self, mut emit: impl FnMut(&str)) {
        // Held text in `Inside` was inside a block that never closed, and an unclosed block
        // this short is an empty one: there is nothing worth showing.
        if self.state == State::Start {
            let out = std::mem::take(&mut self.held);
            if !out.is_empty() {
                emit(&out);
            }
        }
        self.held.clear();
        self.state = State::Open;
    }
}

#[cfg(test)]
mod stream_tests {
    use super::StreamCleaner;

    fn run(pieces: &[&str]) -> String {
        let mut out = String::new();
        let mut cleaner = StreamCleaner::new();
        for piece in pieces {
            cleaner.push(piece, |text| out.push_str(text));
        }
        cleaner.finish(|text| out.push_str(text));
        out
    }

    #[test]
    fn an_empty_reasoning_block_is_never_shown() {
        assert_eq!(run(&["<think>", "\n\n", "</think>", "Hej", " då"]), "Hej då");
    }

    #[test]
    fn a_tag_split_across_pieces_is_still_caught() {
        assert_eq!(run(&["<", "th", "ink>", "</think>", "Svar"]), "Svar");
    }

    #[test]
    fn an_unclosed_block_releases_the_answer() {
        let text = "Konversationen handlar om planeringen av höstens kampanj och vem som gör vad.";
        assert_eq!(run(&["<think>\n\n", text]), text);
    }

    #[test]
    fn ordinary_output_flows_straight_through() {
        assert_eq!(run(&["Hej", " Hannes", "!"]), "Hej Hannes!");
    }

    #[test]
    fn text_that_merely_starts_with_a_bracket_is_not_held() {
        assert_eq!(run(&["<", "b>fet</b>"]), "<b>fet</b>");
    }
}
