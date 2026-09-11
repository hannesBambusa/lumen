//! The model runtime: llama.cpp through the `llama-cpp-2` bindings.
//!
//! One model held in memory; a fresh context per generation. A context is the KV cache and
//! costs about a hundred milliseconds to create, which is nothing next to the generation,
//! and it sidesteps the self-referential struct a long-lived context borrowing the model
//! would require.

use std::num::NonZeroU32;
use std::path::Path;

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaChatMessage, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;

/// Tokens of context. Enough for a long email plus its rewrite; more costs memory the
/// target laptop does not have.
const N_CTX: u32 = 4096;

pub struct Engine {
    backend: LlamaBackend,
    model: LlamaModel,
    threads: i32,
}

impl Engine {
    pub fn load(path: &Path) -> Result<Self, String> {
        let backend = LlamaBackend::init().map_err(|e| e.to_string())?;

        // Everything on the GPU where there is one (Apple Silicon via Metal); on other
        // platforms this build runs on the CPU and the layer count is ignored.
        let gpu_layers: u32 = if cfg!(target_os = "macos") { 99 } else { 0 };
        let params = LlamaModelParams::default().with_n_gpu_layers(gpu_layers);

        let model = LlamaModel::load_from_file(&backend, path, &params).map_err(|e| e.to_string())?;

        // Physical cores, capped: past eight, extra threads fight over memory bandwidth on
        // a laptop and generation gets slower, not faster.
        let threads = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .clamp(2, 8) as i32;

        Ok(Self { backend, model, threads })
    }

    /// Generate a reply to one system + user exchange, streaming pieces as they arrive.
    pub fn generate(
        &mut self,
        system: &str,
        user: &str,
        max_tokens: usize,
        mut on_token: impl FnMut(&str),
    ) -> Result<String, String> {
        let template = self.model.chat_template(None).map_err(|e| e.to_string())?;
        // An empty system prompt means no system turn at all: Gemma-family models have no
        // system role, and their templates reject one.
        let mut messages = Vec::with_capacity(2);
        if !system.trim().is_empty() {
            messages.push(LlamaChatMessage::new("system".into(), system.into()).map_err(|e| e.to_string())?);
        }
        messages.push(LlamaChatMessage::new("user".into(), user.into()).map_err(|e| e.to_string())?);
        let prompt = self
            .model
            .apply_chat_template(&template, &messages, true)
            .map_err(|e| e.to_string())?;

        let tokens = self
            .model
            .str_to_token(&prompt, AddBos::Always)
            .map_err(|e| e.to_string())?;

        let budget = N_CTX as usize;
        if tokens.len() + max_tokens + 8 > budget {
            return Err(format!(
                "the text is too long for the assistant ({} tokens; the limit is about {})",
                tokens.len(),
                budget - max_tokens - 8
            ));
        }

        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(NonZeroU32::new(N_CTX))
            .with_n_threads(self.threads)
            .with_n_threads_batch(self.threads);
        let mut ctx = self
            .model
            .new_context(&self.backend, ctx_params)
            .map_err(|e| e.to_string())?;

        // The whole prompt in one batch, logits only for the last position: that is the
        // only one we sample from.
        let mut batch = LlamaBatch::new(budget, 1);
        let last = tokens.len() - 1;
        for (i, token) in tokens.iter().enumerate() {
            batch
                .add(*token, i as i32, &[0], i == last)
                .map_err(|e| e.to_string())?;
        }
        ctx.decode(&mut batch).map_err(|e| e.to_string())?;

        // Low temperature: these are editing tasks, and a proofreader that gets creative is
        // a proofreader that introduces errors. Not fully greedy, which loops on small models.
        let mut sampler = LlamaSampler::chain_simple([
            LlamaSampler::temp(0.2),
            LlamaSampler::top_p(0.9, 1),
            LlamaSampler::dist(42),
        ]);

        let mut output = String::new();
        let mut position = tokens.len() as i32;

        // Tokens are bytes, not characters. An emoji or an "ä" can span two or three
        // tokens, and decoding each token on its own turns the seam into U+FFFD. So bytes
        // accumulate here and only the longest valid UTF-8 prefix is released each step.
        let mut pending: Vec<u8> = Vec::new();

        for _ in 0..max_tokens {
            let token = sampler.sample(&ctx, batch.n_tokens() - 1);
            sampler.accept(token);

            if self.model.is_eog_token(token) {
                break;
            }

            let bytes = self
                .model
                .token_to_piece_bytes(token, 64, false, None)
                .map_err(|e| e.to_string())?;
            pending.extend_from_slice(&bytes);

            let valid_up_to = match std::str::from_utf8(&pending) {
                Ok(_) => pending.len(),
                Err(e) => e.valid_up_to(),
            };
            if valid_up_to > 0 {
                let piece = String::from_utf8_lossy(&pending[..valid_up_to]).into_owned();
                pending.drain(..valid_up_to);
                on_token(&piece);
                output.push_str(&piece);
            }

            batch.clear();
            batch
                .add(token, position, &[0], true)
                .map_err(|e| e.to_string())?;
            position += 1;
            ctx.decode(&mut batch).map_err(|e| e.to_string())?;
        }

        // Whatever is left is a truncated sequence the model never finished; drop it
        // rather than emit garbage.
        Ok(output)
    }
}
