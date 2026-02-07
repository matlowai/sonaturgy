/**
 * Contextual help text for all parameters.
 * Organized by section. Content sourced from docs/en/Tutorial.md and web/PLAN.md.
 */

// ── DiT Parameters ──────────────────────────────────────────────────

export const HELP_INFERENCE_STEPS =
  'Number of denoising steps. Turbo: 8 recommended. Base/SFT: 32-64 recommended. More steps = finer detail but slower.';

export const HELP_GUIDANCE_SCALE =
  'CFG strength (base/SFT models only, 1-15). Higher = more adherence to caption/lyrics, but risk of artifacts above ~10.';

export const HELP_SHIFT =
  'Timestep offset (1-5). Higher = stronger semantics & clearer structure. Lower = more fine detail. Default: 3 for turbo, 1 for base/SFT.';

export const HELP_SEED =
  'Random seed. -1 = random each time. Fix the seed when tuning parameters to isolate the effect of each change.';

export const HELP_RANDOM_SEED =
  'When checked, a new random seed is used for every generation. Uncheck to use the seed value above.';

export const HELP_INFER_METHOD =
  'ODE (Euler): deterministic, faster. SDE (stochastic): adds controlled randomness, can improve diversity.';

export const HELP_AUDIO_FORMAT =
  'Output format. FLAC: lossless, fast. WAV: lossless, larger. MP3: lossy, smallest.';

export const HELP_CUSTOM_TIMESTEPS =
  'Override the auto-generated timestep schedule with custom comma-separated values (e.g. 0.97,0.76,0.615...). Leave empty for auto.';

export const HELP_USE_ADG =
  'Adaptive Dual Guidance (base model only). Dynamically adjusts CFG using latent-aware scaling with sigma.';

export const HELP_CFG_INTERVAL_START =
  'Start of the CFG active range (0.0-1.0). CFG guidance is only applied between start and end timesteps.';

export const HELP_CFG_INTERVAL_END =
  'End of the CFG active range (0.0-1.0). Setting end < 1.0 disables guidance in early (noisy) steps.';

// ── LM Parameters ───────────────────────────────────────────────────

export const HELP_THINKING =
  'Enable LM Chain-of-Thought reasoning for audio code generation. The LLM analyzes your caption/lyrics and generates structured audio codes that guide the DiT.';

export const HELP_LM_TEMPERATURE =
  'LLM sampling temperature. 0 = deterministic, 0.85 = default, >1 = more creative/random output.';

export const HELP_LM_CFG_SCALE =
  'LLM guidance scale (1-3). Higher = more adherence to your prompt. Default: 2.0.';

export const HELP_LM_TOP_K =
  'Top-K sampling. 0 = disabled (use all tokens). Higher values limit to the K most likely tokens.';

export const HELP_LM_TOP_P =
  'Nucleus sampling threshold. 0.9 = consider tokens covering 90% probability mass. Lower = more focused.';

export const HELP_LM_NEGATIVE_PROMPT =
  'Negative prompt for LLM code generation guidance. Tells the LLM what to avoid. Default: "NO USER INPUT".';

export const HELP_LM_BATCH_CHUNK =
  'Max batch size per LLM inference call. Smaller chunks use less VRAM but take more total time.';

export const HELP_LM_CODES_STRENGTH =
  'Controls what fraction of denoising steps use LM-generated codes (0-1). 1.0 = all steps use LM codes. 0.5 = first half uses LM codes, second half uses text-only conditioning.';

export const HELP_COT_METAS =
  'Let the LLM fill in missing metadata (BPM, key, time signature, duration) via chain-of-thought reasoning.';

export const HELP_COT_CAPTION =
  'Let the LLM enhance or rewrite the caption for better generation quality.';

export const HELP_COT_LANGUAGE =
  'Let the LLM detect the vocal language from lyrics content.';

export const HELP_CONSTRAINED_DECODING =
  'Enforce structured output format from the LLM. Recommended to keep enabled for reliable metadata parsing.';

export const HELP_CONSTRAINED_DEBUG =
  'Log constrained decoding state transitions for debugging. Produces verbose console output.';

export const HELP_PARALLEL_THINKING =
  'Process multiple batch items through the LLM simultaneously. Faster but uses more VRAM.';

export const HELP_AUTO_SCORE =
  'Automatically compute alignment scores after generation.';

export const HELP_AUTO_LRC =
  'Automatically generate LRC (timestamped lyrics) after generation.';

export const HELP_SCORE_SCALE =
  'Scoring sensitivity. Higher values increase score discrimination between good and bad alignment.';

// ── Pipeline / Stage Parameters ─────────────────────────────────────

export const HELP_STAGE_TYPE =
  'Generate: from noise. Refine: polish previous latent. Cover: restyle audio. Repaint: regenerate a section. Extract/Lego/Complete: instrument-level editing (base model only).';

export const HELP_STAGE_MODEL =
  'DiT model for this stage. Turbo: fast (8 steps). Base: highest quality (50+ steps). SFT: good detail with CFG support. Extract/Lego/Complete require base model.';

export const HELP_STAGE_COVER =
  'Restyle source audio while preserving melody & structure. Cover strength controls how much of the original structure to retain vs. apply your new caption.';

export const HELP_COVER_STRENGTH =
  'How much of the source audio structure to preserve (0-1). 1.0 = strict preservation. 0.5 = balanced. 0.2 = loose style transfer. Controls when conditioning switches from source-aware to caption-only during denoising.';

export const HELP_STAGE_REPAINT =
  'Regenerate a specific time region of source audio while keeping the rest untouched. Supports outpainting (extending beyond audio length).';

export const HELP_REPAINT_START =
  'Start time in seconds of the region to regenerate. Context before this point is preserved.';

export const HELP_REPAINT_END =
  'End time in seconds. -1 = end of audio. Values beyond audio length will extend (outpaint) with new content.';

export const HELP_STAGE_EXTRACT =
  'Isolate a specific instrument track from the source audio. Base model only.';

export const HELP_STAGE_LEGO =
  'Add a new instrument track to the source audio context. Base model only.';

export const HELP_STAGE_COMPLETE =
  'Add accompaniment tracks to a solo or partial mix. Select which instruments to add. Base model only.';

export const HELP_SRC_AUDIO =
  'Source audio for this stage. Upload a file, or use a previous pipeline stage\'s output.';

export const HELP_TRACK_NAME =
  'Which instrument track to extract, add, or target.';

export const HELP_STAGE_DENOISE =
  'Denoise strength for refine stages (0.05-1.0). Lower = less change from input latent. 0.6 is a good starting point for refinement.';

export const HELP_STAGE_SCHEDULER =
  'Timestep schedule strategy. Auto = model default. Linear: evenly spaced. Discrete: pre-defined turbo schedule. Continuous: dynamic shift support.';

export const HELP_STAGE_PREVIEW =
  'VAE-decode this stage\'s output as a preview audio. Adds decoding time but lets you hear intermediate results.';

export const HELP_STAGE_INPUT =
  'Which previous stage\'s latent to use as input for refinement.';

export const HELP_STAGE_CAPTION =
  'Override the shared caption for this stage. Useful for applying different creative directions at each stage (e.g., "add lush strings" for a cover stage, "clean guitar" for a lego stage). Leave empty to use the shared caption.';

// ── LLM Assist Parameters ───────────────────────────────────────────

export const HELP_ASSIST_TEMPERATURE =
  'Sampling temperature for the AI Assist LLM. Higher = more creative suggestions.';

export const HELP_ASSIST_TOP_K =
  'Top-K sampling for AI Assist. 0 = disabled.';

export const HELP_ASSIST_TOP_P =
  'Nucleus sampling for AI Assist. Lower = more focused output.';

export const HELP_ASSIST_REP_PENALTY =
  'Repetition penalty (1.0-2.0). Higher values discourage the LLM from repeating phrases. 1.0 = no penalty.';

export const HELP_ASSIST_CONSTRAINED =
  'Enforce structured output from the AI Assist LLM for reliable parsing.';

// ── Dynamic Slider Labels ──────────────────────────────────────────

export const HELP_SIMILARITY_DENOISE =
  'Controls similarity to reference audio during denoising. 1.0 = maximum similarity (all steps use reference conditioning). Lower values let the model diverge from the reference in later steps, giving more creative freedom.';
