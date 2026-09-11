//! The on-device writing assistant.
//!
//! Small language models running inside the app, doing several jobs: translation, spelling
//! and grammar, restructuring a draft, summarising a thread. Opt-in: nothing is downloaded
//! and nothing runs until the user says so, and turning it off unloads the model and frees
//! the memory.
//!
//! More than one model can be on disk. The user picks which does the writing tools, and
//! optionally a translation specialist for Translate. Each has its own download state.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

pub mod apple;
pub mod catalog;
pub mod engine;
pub mod tasks;

pub use catalog::{Family, ModelSpec, Role, MODELS};
pub use tasks::Task;

/// Which jobs the assistant is allowed to do. Each is a switch on the settings page, so a
/// user who wants translation but distrusts a model rewriting their prose can have exactly
/// that.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Features {
    pub translate: bool,
    pub proofread: bool,
    pub improve: bool,
    pub summarize: bool,
}

impl Default for Features {
    fn default() -> Self {
        Self { translate: true, proofread: true, improve: true, summarize: true }
    }
}

/// What actually performs a translation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Backend {
    /// A downloaded model: the translation specialist if one is chosen, else the general one.
    Model,
    /// The Mac's own translator. Nothing to download and better output than a model this
    /// size, so it is the default where it exists.
    Apple,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// Master switch. Off means no feature appears anywhere and the model is unloaded.
    pub enabled: bool,
    pub features: Features,
    /// The general model: writing tools, summaries, and translation unless a specialist is
    /// chosen below.
    pub model: String,
    /// A translation-only model to use for Translate, if any.
    pub translation_model: Option<String>,
    /// Which translator Translate uses.
    pub translation_backend: Backend,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled: false,
            features: Features::default(),
            model: catalog::DEFAULT_MODEL.to_string(),
            translation_model: None,
            translation_backend: if apple::available() { Backend::Apple } else { Backend::Model },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelState {
    /// Nothing on disk.
    Missing,
    Downloading,
    /// A partial file is on disk and the download can be resumed from it.
    Paused,
    /// Complete on disk; loaded into memory on first use.
    Ready,
    Error,
}

/// One catalogue entry plus where its file is.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    #[serde(flatten)]
    pub spec: &'static ModelSpec,
    pub state: ModelState,
    pub downloaded_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// What the interface needs to render Settings and every assistant control.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub enabled: bool,
    pub features: Features,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub translation_model: Option<String>,
    pub translation_backend: Backend,
    /// Whether the Mac's own translator can be offered at all. False everywhere but macOS,
    /// so the interface can hide the choice rather than show one that cannot be taken.
    pub apple_translation: bool,
    pub models: Vec<ModelStatus>,
    /// Which model is currently held in memory, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loaded: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum AssistantError {
    #[error("the assistant is turned off")]
    Disabled,
    #[error("{0} is not downloaded yet. Download it in Settings.")]
    NotDownloaded(&'static str),
    #[error("a download is already running for {0}")]
    AlreadyDownloading(&'static str),
    #[error("unknown model")]
    UnknownModel,
    #[error("this computer has no built-in translator")]
    NoAppleTranslation,
    #[error("{0}")]
    Translator(String),
    #[error("download failed: {0}")]
    Download(String),
    #[error("download paused")]
    Paused,
    #[error("download cancelled")]
    Cancelled,
    #[error("could not write the model file: {0}")]
    Io(#[from] std::io::Error),
    #[error("model: {0}")]
    Engine(String),
}

pub type Result<T> = std::result::Result<T, AssistantError>;

/// Live state of one model's download. Flags are read by the loop between chunks.
struct Download {
    running: AtomicBool,
    downloaded: AtomicU64,
    pause: AtomicBool,
    cancel: AtomicBool,
    error: Mutex<Option<String>>,
}

/// Everything the assistant owns, shared with the command layer.
pub struct Assistant {
    data_dir: PathBuf,
    settings: Mutex<Settings>,
    downloads: HashMap<&'static str, Download>,
    /// The loaded engine and which model it holds.
    engine: Mutex<Option<(&'static str, engine::Engine)>>,
}

impl Assistant {
    pub fn open(data_dir: &Path) -> Arc<Self> {
        let settings: Settings = std::fs::read_to_string(data_dir.join("assistant.json"))
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();

        let downloads = MODELS
            .iter()
            .map(|m| {
                (
                    m.id,
                    Download {
                        running: AtomicBool::new(false),
                        downloaded: AtomicU64::new(0),
                        pause: AtomicBool::new(false),
                        cancel: AtomicBool::new(false),
                        error: Mutex::new(None),
                    },
                )
            })
            .collect();

        let assistant = Arc::new(Self {
            data_dir: data_dir.to_path_buf(),
            settings: Mutex::new(settings),
            downloads,
            engine: Mutex::new(None),
        });

        // The chosen writing model may be gone: deleted from Settings by an older build, or
        // the file removed by hand. Another downloaded one is a better answer than an
        // assistant that is switched on and silently does nothing. Safe to do here and only
        // here, because no download can be in flight at startup, so this cannot trample a
        // choice the user is in the middle of acting on.
        let needs_replacing = assistant
            .settings
            .lock()
            .ok()
            .map(|settings| {
                catalog::find(&settings.model).is_none_or(|spec| !assistant.is_ready(spec))
            })
            .unwrap_or(false);

        if needs_replacing {
            if let Some(other) = MODELS
                .iter()
                .find(|m| m.role == Role::General && assistant.is_ready(m))
            {
                let _ = assistant.set_model(other.id);
            }
        }

        assistant
    }

    fn model_path(&self, spec: &ModelSpec) -> PathBuf {
        self.data_dir.join("models").join(spec.file)
    }

    fn part_path(&self, spec: &ModelSpec) -> PathBuf {
        self.data_dir.join("models").join(format!("{}.part", spec.file))
    }

    fn is_ready(&self, spec: &ModelSpec) -> bool {
        std::fs::metadata(self.model_path(spec))
            .map(|m| m.len() == spec.size_bytes)
            .unwrap_or(false)
    }

    fn model_status(&self, spec: &'static ModelSpec) -> ModelStatus {
        let download = &self.downloads[spec.id];
        let running = download.running.load(Ordering::Relaxed);
        let error = download.error.lock().ok().and_then(|e| e.clone());
        let partial = std::fs::metadata(self.part_path(spec)).map(|m| m.len()).unwrap_or(0);

        let state = if error.is_some() {
            ModelState::Error
        } else if running {
            ModelState::Downloading
        } else if self.is_ready(spec) {
            ModelState::Ready
        } else if partial > 0 {
            ModelState::Paused
        } else {
            ModelState::Missing
        };

        let downloaded_bytes = if running {
            download.downloaded.load(Ordering::Relaxed)
        } else if self.is_ready(spec) {
            spec.size_bytes
        } else {
            partial
        };

        ModelStatus { spec, state, downloaded_bytes, error }
    }

    pub fn status(&self) -> Status {
        let settings = self.settings.lock().map(|s| s.clone()).unwrap_or_default();
        Status {
            enabled: settings.enabled,
            features: settings.features,
            model: settings.model,
            translation_model: settings.translation_model,
            translation_backend: settings.translation_backend,
            apple_translation: apple::available(),
            models: MODELS.iter().map(|m| self.model_status(m)).collect(),
            loaded: self.engine.lock().ok().and_then(|e| e.as_ref().map(|(id, _)| id.to_string())),
        }
    }

    fn persist(&self, settings: &Settings) -> Result<()> {
        let raw = serde_json::to_string_pretty(settings).unwrap_or_default();
        std::fs::create_dir_all(&self.data_dir)?;
        std::fs::write(self.data_dir.join("assistant.json"), raw)?;
        Ok(())
    }

    fn edit(&self, change: impl FnOnce(&mut Settings)) -> Result<()> {
        let mut settings = self.settings.lock().map_err(|_| AssistantError::Engine("lock".into()))?;
        change(&mut settings);
        self.persist(&settings)
    }

    /// Turn the assistant on or off. Off unloads the model immediately; files stay on disk.
    pub fn set_enabled(&self, enabled: bool) -> Result<()> {
        self.edit(|s| s.enabled = enabled)?;
        if !enabled {
            self.unload();
        }
        Ok(())
    }

    pub fn set_features(&self, features: Features) -> Result<()> {
        self.edit(|s| s.features = features)
    }

    pub fn set_model(&self, id: &str) -> Result<()> {
        let spec = catalog::find(id).ok_or(AssistantError::UnknownModel)?;
        if spec.role != Role::General {
            return Err(AssistantError::UnknownModel);
        }
        self.edit(|s| s.model = spec.id.to_string())
    }

    /// Choose the translator. Asking for the Mac's when there is none is a no-op rather
    /// than an error: the setting would be unusable and silently ignoring it is worse.
    pub fn set_translation_backend(&self, backend: Backend) -> Result<()> {
        if backend == Backend::Apple && !apple::available() {
            return Err(AssistantError::NoAppleTranslation);
        }
        self.edit(|s| s.translation_backend = backend)
    }

    pub fn set_translation_model(&self, id: Option<&str>) -> Result<()> {
        let id = match id {
            None => None,
            Some(id) => Some(catalog::find(id).ok_or(AssistantError::UnknownModel)?.id.to_string()),
        };
        self.edit(|s| s.translation_model = id)
    }

    fn unload(&self) {
        if let Ok(mut engine) = self.engine.lock() {
            *engine = None;
        }
    }

    pub fn pause_download(&self, id: &str) -> Result<()> {
        let spec = catalog::find(id).ok_or(AssistantError::UnknownModel)?;
        self.downloads[spec.id].pause.store(true, Ordering::Relaxed);
        Ok(())
    }

    /// Stop a running download and delete what was fetched; or, when nothing is running,
    /// delete a paused partial file.
    pub fn cancel_download(&self, id: &str) -> Result<()> {
        let spec = catalog::find(id).ok_or(AssistantError::UnknownModel)?;
        let download = &self.downloads[spec.id];
        if download.running.load(Ordering::Relaxed) {
            download.cancel.store(true, Ordering::Relaxed);
        } else {
            let _ = std::fs::remove_file(self.part_path(spec));
            download.downloaded.store(0, Ordering::Relaxed);
        }
        if let Ok(mut error) = download.error.lock() {
            *error = None;
        }
        Ok(())
    }

    /// Delete a model from disk, unloading it first if it is the one in memory.
    ///
    /// Deleting the model currently in use hands the job to another downloaded one rather
    /// than leaving the assistant switched on with nothing behind it. Removing the 1.7B to
    /// save space, with the 4B sitting right there, should not silently kill every feature.
    pub fn remove_model(&self, id: &str) -> Result<()> {
        let spec = catalog::find(id).ok_or(AssistantError::UnknownModel)?;
        if let Ok(mut engine) = self.engine.lock() {
            if engine.as_ref().map(|(loaded, _)| *loaded == spec.id).unwrap_or(false) {
                *engine = None;
            }
        }
        let _ = std::fs::remove_file(self.model_path(spec));
        let _ = std::fs::remove_file(self.part_path(spec));
        let download = &self.downloads[spec.id];
        download.downloaded.store(0, Ordering::Relaxed);
        if let Ok(mut error) = download.error.lock() {
            *error = None;
        }

        let replacement = MODELS
            .iter()
            .find(|m| m.role == Role::General && m.id != spec.id && self.is_ready(m));
        self.edit(|s| {
            if s.model == spec.id {
                if let Some(other) = replacement {
                    s.model = other.id.to_string();
                }
            }
            if s.translation_model.as_deref() == Some(spec.id) {
                s.translation_model = None;
            }
        })
    }

    /// Download a model if it is not already complete. A second caller while one is running
    /// for the same model returns at once; different models may download concurrently.
    ///
    /// Resumable: a gigabyte over hotel wifi will be interrupted, and restarting from zero
    /// each time would mean it never finishes. The partial file is kept and the request asks
    /// for the remainder with a `Range` header.
    pub fn ensure_downloaded(&self, id: &str, on_progress: impl Fn(u64, u64)) -> Result<()> {
        let spec = catalog::find(id).ok_or(AssistantError::UnknownModel)?;
        if self.is_ready(spec) {
            return Ok(());
        }
        let download = &self.downloads[spec.id];
        if download.running.swap(true, Ordering::Relaxed) {
            return Err(AssistantError::AlreadyDownloading(spec.name));
        }
        download.pause.store(false, Ordering::Relaxed);
        download.cancel.store(false, Ordering::Relaxed);
        if let Ok(mut error) = download.error.lock() {
            *error = None;
        }

        let result = self.download(spec, download, &on_progress);

        download.running.store(false, Ordering::Relaxed);
        match &result {
            // Pause and cancel are the user's doing, not failures, so they leave no error.
            Err(AssistantError::Paused) | Err(AssistantError::Cancelled) | Ok(()) => {}
            Err(e) => {
                if let Ok(mut error) = download.error.lock() {
                    *error = Some(e.to_string());
                }
            }
        }
        result
    }

    fn download(&self, spec: &ModelSpec, state: &Download, on_progress: &impl Fn(u64, u64)) -> Result<()> {
        std::fs::create_dir_all(self.data_dir.join("models"))?;
        let part = self.part_path(spec);
        let have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);

        // A partial file larger than the target is corrupt; start over.
        let have = if have > spec.size_bytes {
            std::fs::remove_file(&part)?;
            0
        } else {
            have
        };

        let client = reqwest::blocking::Client::builder()
            .timeout(None)
            .build()
            .map_err(|e| AssistantError::Download(e.to_string()))?;

        let mut request = client.get(spec.url);
        if have > 0 {
            request = request.header("Range", format!("bytes={have}-"));
        }
        let mut response = request
            .send()
            .map_err(|e| AssistantError::Download(e.to_string()))?;

        let status = response.status();
        // 206 means the server honoured the range; 200 means it did not and is sending the
        // whole file, in which case the partial copy must be discarded.
        let resume = status.as_u16() == 206;
        if !status.is_success() {
            return Err(AssistantError::Download(format!("server answered {status}")));
        }

        let mut file = if resume && have > 0 {
            std::fs::OpenOptions::new().append(true).open(&part)?
        } else {
            std::fs::File::create(&part)?
        };
        let mut written = if resume { have } else { 0 };
        state.downloaded.store(written, Ordering::Relaxed);

        let mut buffer = vec![0u8; 1 << 20];
        let mut since_report = 0u64;
        loop {
            if state.cancel.load(Ordering::Relaxed) {
                drop(file);
                let _ = std::fs::remove_file(&part);
                state.downloaded.store(0, Ordering::Relaxed);
                return Err(AssistantError::Cancelled);
            }
            if state.pause.load(Ordering::Relaxed) {
                file.flush()?;
                return Err(AssistantError::Paused);
            }

            let n = response
                .read(&mut buffer)
                .map_err(|e| AssistantError::Download(e.to_string()))?;
            if n == 0 {
                break;
            }
            file.write_all(&buffer[..n])?;
            written += n as u64;
            since_report += n as u64;
            state.downloaded.store(written, Ordering::Relaxed);
            // Roughly every 4MB: often enough for a live progress bar, rare enough that the
            // event stream is not itself a cost.
            if since_report >= 4 << 20 {
                on_progress(written, spec.size_bytes);
                since_report = 0;
            }
        }
        file.flush()?;
        drop(file);

        if written != spec.size_bytes {
            return Err(AssistantError::Download(format!(
                "got {written} bytes, expected {}",
                spec.size_bytes
            )));
        }

        std::fs::rename(&part, self.model_path(spec))?;
        on_progress(written, spec.size_bytes);
        Ok(())
    }

    /// Which model a task should run on, given the settings.
    fn model_for(&self, task: &Task) -> Result<&'static ModelSpec> {
        let settings = self.settings.lock().map_err(|_| AssistantError::Engine("lock".into()))?;
        if !settings.enabled {
            return Err(AssistantError::Disabled);
        }

        if matches!(task, Task::Translate { .. }) {
            if let Some(id) = &settings.translation_model {
                if let Some(spec) = catalog::find(id) {
                    if self.is_ready(spec) {
                        return Ok(spec);
                    }
                }
            }
        }

        let spec = catalog::find(&settings.model).ok_or(AssistantError::UnknownModel)?;
        if !self.is_ready(spec) {
            return Err(AssistantError::NotDownloaded(spec.name));
        }
        Ok(spec)
    }

    /// Whether Translate can run at all right now: the Mac's translator counts, so a user
    /// with no model downloaded still gets translation.
    pub fn translation_ready(&self) -> bool {
        let Ok(settings) = self.settings.lock() else { return false };
        match settings.translation_backend {
            Backend::Apple => apple::available(),
            Backend::Model => {
                let specialist = settings
                    .translation_model
                    .as_deref()
                    .and_then(catalog::find)
                    .is_some_and(|spec| self.is_ready(spec));
                specialist
                    || catalog::find(&settings.model).is_some_and(|spec| self.is_ready(spec))
            }
        }
    }

    /// Translate with the Mac, if that is the chosen backend. `None` means carry on with a
    /// model.
    ///
    /// The whole text goes over at once: the helper splits paragraphs itself, and Apple's
    /// API takes them as one batch, so this is a single round trip rather than one per
    /// paragraph.
    fn apple_translation(&self, task: &Task) -> Option<Result<String>> {
        let Task::Translate { text, target } = task else { return None };

        let settings = self.settings.lock().ok()?;
        if !settings.enabled {
            return Some(Err(AssistantError::Disabled));
        }
        if settings.translation_backend != Backend::Apple || !apple::available() {
            return None;
        }
        drop(settings);

        let target_code = apple::language_code(target)?;
        let source = tasks::detect_language(text);
        let source_code = apple::language_code(source);

        Some(
            apple::translate(text, source_code, target_code)
                .map_err(AssistantError::Translator),
        )
    }

    /// Run a task. Loads the right model on first use and keeps it loaded; asking for a
    /// different model swaps it. One generation at a time.
    pub fn run(&self, task: &Task, on_token: impl FnMut(&str)) -> Result<String> {
        if let Some(result) = self.apple_translation(task) {
            let text = result?;
            // Apple answers all at once rather than token by token. Handing the whole
            // thing over keeps every caller on one path.
            let mut on_token = on_token;
            on_token(&text);
            return Ok(text);
        }

        let spec = self.model_for(task)?;

        let mut slot = self.engine.lock().map_err(|_| AssistantError::Engine("lock".into()))?;
        let needs_load = slot.as_ref().map(|(id, _)| *id != spec.id).unwrap_or(true);
        if needs_load {
            // Drop the old one before loading the new: two 4B models do not fit a laptop.
            *slot = None;
            let engine = engine::Engine::load(&self.model_path(spec)).map_err(AssistantError::Engine)?;
            *slot = Some((spec.id, engine));
        }
        let (_, engine) = slot.as_mut().expect("just loaded");

        // Translation goes paragraph by paragraph. Two reasons: the model merged a writer's
        // paragraphs into one block when handed the whole message, and a small model is
        // markedly more accurate on a short input than on a long one. Each paragraph is its
        // own generation; the joins are reproduced exactly.
        if let Task::Translate { text, target } = task {
            let mut on_token = on_token;
            let mut out = String::new();
            for (index, paragraph) in tasks::paragraphs(text).into_iter().enumerate() {
                if index > 0 {
                    on_token("\n\n");
                    out.push_str("\n\n");
                }
                let part = Task::Translate { text: paragraph.to_string(), target: target.clone() };
                let (system, user) = tasks::prompts(&part, spec.family);
                // Per generation: the cleaner's state is about one answer, and a paragraph
                // that begins with a reasoning block must not be judged by the last one.
                let mut cleaner = tasks::StreamCleaner::new();
                let raw = engine
                    .generate(&system, &user, part.max_tokens(), |piece| {
                        cleaner.push(piece, &mut on_token)
                    })
                    .map_err(AssistantError::Engine)?;
                cleaner.finish(&mut on_token);
                out.push_str(&tasks::clean_output(&raw));
            }
            return Ok(out);
        }

        let (system, user) = tasks::prompts(task, spec.family);
        // The reasoning block is stripped from the finished text below, but it also has to
        // be kept off the screen while the answer is still arriving.
        let mut on_token = on_token;
        let mut cleaner = tasks::StreamCleaner::new();
        let output = engine
            .generate(&system, &user, task.max_tokens(), |piece| {
                cleaner.push(piece, &mut on_token)
            })
            .map_err(AssistantError::Engine)?;
        cleaner.finish(&mut on_token);

        Ok(tasks::clean_output(&output))
    }
}
