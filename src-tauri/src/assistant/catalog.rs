//! The models the app knows how to download and run.
//!
//! Every entry is a public download with no account: gated repositories are useless to a
//! distributed app, since every user would need their own login. Google's own TranslateGemma
//! repo is gated, so the entry points at an ungated community conversion. Not the Ollama
//! registry blob: that one comes from Ollama's own converter, bundles the vision tower, and
//! lacks `gemma3.attention.layer_norm_rms_epsilon`, which upstream llama.cpp refuses to load.

use serde::Serialize;

/// How a model is prompted. The families differ in more than wording: Qwen takes a system
/// turn and a `/no_think` switch, Gemma has no system role at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Family {
    Qwen,
    TranslateGemma,
}

/// What a model is for. A translation specialist cannot proofread or summarise.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    General,
    Translation,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub blurb: &'static str,
    #[serde(skip)]
    pub file: &'static str,
    #[serde(skip)]
    pub url: &'static str,
    pub size_bytes: u64,
    pub family: Family,
    pub role: Role,
    pub licence: &'static str,
}

pub const MODELS: &[ModelSpec] = &[
    ModelSpec {
        id: "qwen3-1.7b",
        name: "Qwen3 1.7B",
        blurb: "Small. Runs on any laptop, about 1.5 GB of memory. Fine for fixing and \
                improving text; translation between close languages is rough.",
        file: "qwen3-1.7b-q4_k_m.gguf",
        url: "https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf",
        size_bytes: 1_107_409_472,
        family: Family::Qwen,
        role: Role::General,
        licence: "Apache 2.0",
    },
    ModelSpec {
        id: "qwen3-4b",
        name: "Qwen3 4B",
        blurb: "Better. Noticeably more accurate at everything, about 3 GB of memory. Slow \
                on a laptop without a GPU.",
        file: "qwen3-4b-q4_k_m.gguf",
        url: "https://huggingface.co/unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf",
        size_bytes: 2_497_281_312,
        family: Family::Qwen,
        role: Role::General,
        licence: "Apache 2.0",
    },
    ModelSpec {
        id: "translategemma-4b",
        name: "TranslateGemma 4B",
        blurb: "Translation only. Google's translation-trained Gemma, 55 languages. Used for \
                Translate when downloaded; the writing model does the rest.",
        file: "translategemma-4b.gguf",
        url: "https://huggingface.co/mradermacher/translategemma-4b-it-GGUF/resolve/main/translategemma-4b-it.Q4_K_M.gguf",
        size_bytes: 2_489_909_760,
        family: Family::TranslateGemma,
        role: Role::Translation,
        licence: "Gemma Terms of Use",
    },
];

pub fn find(id: &str) -> Option<&'static ModelSpec> {
    MODELS.iter().find(|m| m.id == id)
}

pub const DEFAULT_MODEL: &str = "qwen3-1.7b";
