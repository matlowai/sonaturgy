# Pipeline Framework — Mechanisms, Patterns, Quality Control & RLVR

> **Purpose:** Single source of truth for how ACE-Step's instruction-routed architecture
> works mechanically, what pipeline combinations are possible today vs need building, and
> the long-term vision for automated quality control and dataset building.
>
> **Status:** Design phase. Expanding iteratively as we build and test.
>
> **Companion docs:** `web/PLAN.md` (architecture, file map, API ref, TODO),
> `plan.md` (project index + research notes)

---

## Table of Contents

**Part I — Mechanism Reference** (how the model actually works)
1. [Instruction Routing System](#1-instruction-routing-system)
2. [Conditioning Pathway Matrix](#2-conditioning-pathway-matrix)
3. [The VQ Bottleneck (Cover Only)](#3-the-vq-bottleneck-cover-only)
4. [Two-Condition Temporal Switch](#4-two-condition-temporal-switch)
5. [The Cover Strength Spectrum](#5-the-cover-strength-spectrum)

**Part II — Pipeline Patterns: Works Today** (current pipeline executor)
6. [Patterns Using Current Features](#6-patterns-using-current-features)

**Part III — Feature Gaps** (what needs building for advanced patterns)
7. [Pipeline Executor Limitations](#7-pipeline-executor-limitations)

**Part IV — Pipeline Patterns: Needs Feature Gaps Closed**
8. [Patterns Requiring New Features](#8-patterns-requiring-new-features)

**Part V — Quality Detection** (medium-term)
9. [Quality Detection & Distortion Scoring](#9-quality-detection--distortion-scoring)

**Part VI — Dataset Building & RLVR** (long-term)
10. [Dataset Building for RLVR](#10-dataset-building-for-rlvr)

**Part VII — Agent Orchestration** (long-term)
11. [Agent Orchestration Vision](#11-agent-orchestration-vision)

**Part VIII — Performance & Robustness Patterns**
12. [Performance & Robustness Optimizations](#12-performance--robustness-optimizations)

**Appendix**
13. [Open Questions](#13-open-questions)
14. [File Reference](#14-file-reference)

---

## Critical Reminders for Future Sessions

> Read these bullets before diving into any implementation work.

- **`prepare_condition()` lives in the MODEL CHECKPOINT files** (downloaded from HF, gitignored).
  NOT in `handler.py` or `diffusion_core.py`. Path: `checkpoints/acestep-v15-*/modeling_*.py`.
  We cannot modify these files — they'd be overwritten on next download.
- **`_prepare_batch()` in `handler.py:1696` is the most important function to understand.**
  It builds ALL conditioning tensors: VAE encoding, is_covers detection, src_latents, chunk masks,
  non-cover text prep. 400+ lines, does everything.
- **`service_generate()` at `handler.py:2257` is the pipeline's entry point** into the handler.
  The pipeline executor calls this per stage.
- **`generate_audio_core()` at `diffusion_core.py:302` is OUR diffusion loop** (replaces the
  model's own `generate_audio()`). This is where the temporal switch, KV cache reset, and
  init_latents/t_start logic lives. We own this file.
- **Pipeline shared conditioning is at `pipeline_executor.py:111-112`** — `captions_batch` and
  `lyrics_batch` use `req.caption` for ALL stages. Per-stage caption override (Gap 1) changes here.
- **The `is_covers` flag is set by INSTRUCTION SUBSTRING MATCHING** (`handler.py:1887-1900`),
  not by a task_type parameter. Cover instruction: "generate audio semantic tokens" + "based on
  the given conditions". The `has_code_hint` flag also triggers it.
- **Only cover goes through the VQ bottleneck** (`modeling_*.py:1649` `torch.where` swap).
  Extract/lego/complete pass source latents through uncompressed.
- **Model files:** Base at `modeling_acestep_v15_base.py` (~1800 lines), Turbo at
  `modeling_acestep_v15_turbo.py` (~similar). SFT uses the base file. All share the same
  `AceStepConditionGenerationModel` class with identical `prepare_condition()`.
- **The frontend constants in `web/frontend/src/lib/constants.ts`** must stay in sync with
  `acestep/constants.py`. If you add a new task type or change an instruction, update both.

---

# Part I — Mechanism Reference

> How the model's conditioning system actually works under the hood.
> Read this to understand WHY different stage types produce different results.

## 1. Instruction Routing System

ACE-Step uses a single model (`AceStepConditionGenerationModel`) for all 7 task types.
The instruction string embedded in the text prompt selects behavior. This is an
**instruction-following architecture** — same weights, different conditioning pathways.

### The Instructions

```python
# acestep/constants.py:79-89 — TASK_INSTRUCTIONS
"text2music": "Fill the audio semantic mask based on the given conditions:"
"repaint":    "Repaint the mask area based on the given conditions:"
"cover":      "Generate audio semantic tokens based on the given conditions:"
"extract":    "Extract the {TRACK_NAME} track from the audio:"
"lego":       "Generate the {TRACK_NAME} track based on the audio context:"
"complete":   "Complete the input track with {TRACK_CLASSES}:"
```

### How Instructions Are Embedded

Every generation uses the same prompt template (`SFT_GEN_PROMPT` in `constants.py:101`):
```
# Instruction
{instruction}

# Caption
{caption}

# Metas
{metadata}<|endoftext|>
```

The instruction slot is filled by `build_stage_instruction()` (`pipeline_executor.py:23`)
or by `generate_instruction()` (`handler.py:1318`). The text encoder (`Qwen3-Embedding`,
loaded at `handler.py:522-523`)
processes the full prompt — the instruction shifts the embedding into a different region,
changing what the DiT's cross-attention attends to.

### is_covers Detection (Substring Matching)

`_prepare_batch()` in `handler.py:1884-1901` detects cover mode:

```python
instruction_lower = instruction_i.lower()
is_cover = ("generate audio semantic tokens" in instruction_lower and
           "based on the given conditions" in instruction_lower) or has_code_hint
```

Key implications:
- **Only the cover instruction** activates the VQ bottleneck pathway
- **Extract/lego/complete** have different instruction text → `is_covers=False` → source
  latents pass through unquantized (full fidelity)
- **Audio code hints** (`has_code_hint=True`) also trigger cover mode — LM codes serve as
  a semantic anchor similar to VQ-processed source
- **Custom instructions risk:** Any instruction containing those two substrings will
  accidentally activate cover conditioning. The detection is substring-based, not exact match.

### Instruction Flow Through the Pipeline

```
pipeline_executor.py:build_stage_instruction(stage)
  → looks up TASK_INSTRUCTIONS[stage.type], substitutes {TRACK_NAME}/{TRACK_CLASSES}
  → passes as instructions=[instruction] * batch_size to service_generate()
    → handler.py:_prepare_batch() embeds into SFT_GEN_PROMPT for text encoder
    → handler.py:_prepare_batch() also uses raw instruction for is_cover detection
```

---

## 2. Conditioning Pathway Matrix

| Stage Type | `is_covers` | Source Latents | VQ Bottleneck | Context Channel | Cross-Attention | Chunk Mask |
|------------|-------------|---------------|---------------|-----------------|-----------------|------------|
| generate | False | silence | No | silence + all-True mask | text only | all True (generate everything) |
| refine | False | silence* | No | silence + all-True mask | text only | all True |
| cover | **True** | VQ-processed source | **Yes** (5Hz quantize) | VQ skeleton + all-True mask | text + cover instruction | all True |
| repaint | False | source with gap | No | source (zeroed region) + binary mask | text + repaint instruction | True in target region |
| extract | False | full source | No | full source + all-True mask | text + "Extract {TRACK}" | all True |
| lego | False | full source | No | full source + all-True mask | text + "Generate {TRACK}" | all True |
| complete | False | full source | No | full source + all-True mask | text + "Complete with {CLASSES}" | all True |

*Refine starts from a re-noised previous latent (`init_latents`), not pure noise.
The conditioning is standard text2music — structural information comes from the latent itself.

### Key Observations

1. **Cover is the ONLY type that uses the VQ bottleneck.** All other audio types pass
   source latents through uncompressed → full acoustic detail preserved.

2. **Repaint is the ONLY type that uses a spatial mask.** `chunk_mask`: `False` = keep,
   `True` = regenerate. All other types mask everything True (generate full output).

3. **Cover has a TEMPORAL switch** (conditioning changes at denoising step N). All other
   types use constant conditioning throughout.

4. **Extract/lego/complete are base-model-only** — only the base model was trained with
   track-level instructions and multi-track audio data.

---

## 3. The VQ Bottleneck (Cover Only)

Defined in the model checkpoint files (identical logic in base & turbo):
- **Base:** `checkpoints/acestep-v15-base/modeling_acestep_v15_base.py:1607-1652`
- **Turbo:** `checkpoints/acestep-v15-turbo/modeling_acestep_v15_turbo.py:1604-1649`
- **SFT:** uses the base file: `checkpoints/acestep-v15-sft/modeling_acestep_v15_base.py`

### The Code Path (`prepare_condition`)

```python
def prepare_condition(self, ..., is_covers, src_latents, ...):
    # 1. Encode text/lyric/reference into cross-attention states
    encoder_hidden_states, encoder_attention_mask = self.encoder(
        text_hidden_states, lyric_hidden_states,
        refer_audio_acoustic_hidden_states_packed, ...)

    # 2. VQ bottleneck — compress source to semantic skeleton
    if precomputed_lm_hints_25Hz is not None:
        lm_hints_25Hz = precomputed_lm_hints_25Hz       # from audio codes
    else:
        # tokenize: 25Hz → pool to 5Hz → VQ quantize (codebook lookup)
        lm_hints_5Hz, indices, llm_mask = self.tokenize(hidden_states, silence_latent, ...)
        # detokenize: 5Hz quantized → upsample back to 25Hz
        lm_hints_25Hz = self.detokenize(lm_hints_5Hz)

    # 3. CONDITIONAL SWAP — VQ version for cover, original for everything else
    src_latents = torch.where(is_covers > 0, lm_hints_25Hz, src_latents)

    # 4. Concat with chunk_mask → context_latents fed to decoder
    context_latents = torch.cat([src_latents, chunk_masks], dim=-1)
    return encoder_hidden_states, encoder_attention_mask, context_latents
```

### What the VQ Bottleneck Preserves vs Strips

The tokenizer pools 25Hz latents to **5Hz** (`pool_window_size=5`), vector-quantizes through
a learned codebook, then detokenizes back to 25Hz. This is a **lossy information bottleneck**:

| Survives VQ | Stripped by VQ |
|-------------|----------------|
| Melodic contour | Timbre / tone color |
| Harmonic progression | Reverb characteristics |
| Rhythmic pattern | Noise texture |
| Arrangement structure | Stereo imaging |
| Tempo / key center | Attack transients |
| Phrase boundaries | Fine spectral detail |

Think of it like heavy JPEG compression: the composition survives, pixel detail is lost.

**Testing needed:** The exact bottleneck "personality" with different source types (dense
orchestral, sparse acoustic, vocal-only, drums-only) is uncharacterized. See Open Questions.

### Context Injection into the Decoder

The context_latents are concatenated **channel-wise** with the noisy latent `xt` at every
decoder step (inside `AceStepDiTModel.forward()` at `modeling_*_base.py:1347`,
`modeling_*_turbo.py:1344`):

```python
hidden_states = torch.cat([context_latents, hidden_states], dim=-1)
hidden_states = self.proj_in(hidden_states)  # project [D + D//2] → model dim
```

This is channel conditioning (always present), distinct from cross-attention (text/lyric/reference).
The DiT "sees" the source structure alongside the noise at every step.

---

## 4. Two-Condition Temporal Switch

When `audio_cover_strength < 1.0`, two separate condition sets are prepared BEFORE the
diffusion loop starts (in `generate_audio_core()` at `diffusion_core.py:392-440`):

**Cover condition set:**
- `prepare_condition()` with `is_covers=True`, real source latents, cover instruction
- VQ skeleton in context channel, source-aware text in cross-attention

**Non-cover condition set:**
- `prepare_condition()` with `is_covers=False`, **silence** latents, **DEFAULT_DIT_INSTRUCTION**
- Silence in context channel, same caption but default instruction in cross-attention

```python
# diffusion_core.py:461 — the switch point
cover_steps = int(num_steps * audio_cover_strength)

# diffusion_core.py:498-528 — the switch during denoising
for step_idx in range(num_steps):
    if step_idx >= cover_steps and encoder_hidden_states_non_cover is not None:
        # Swap ALL conditioning to non-cover versions
        encoder_hidden_states = encoder_hidden_states_non_cover
        encoder_attention_mask = encoder_attention_mask_non_cover
        context_latents = context_latents_non_cover
        # CRITICAL: Reset KV cache — old cache encoded source-aware context
        past_key_values = EncoderDecoderCache(DynamicCache(), DynamicCache())
```

### Why Early Steps = Structure, Late Steps = Style

Flow-matching diffusion goes from noise (t=1) to clean (t=0):
- **t near 1.0 (early):** Signal is mostly noise. Model makes coarse structural decisions —
  key center, tempo, arrangement, melodic contour. These persist through all later steps.
- **t near 0.0 (late):** Signal is mostly clean. Model refines surface texture — overtone
  spectrum, reverb, transients, stereo width.

By conditioning on source skeleton in early steps (locking structure), then switching to
caption-only in late steps (applying new style), you get "same bones, new skin."

### KV Cache Reset Is Critical

When switching conditions, the accumulated key/value cache from prior steps (which encoded
source-aware context) must be discarded. Without reset, the decoder would still "remember"
source structure through cached attention states, defeating the switch.

### Non-Cover Text: Same Caption, Different Instruction

The non-cover condition set (built in `_prepare_batch()` at `handler.py:2050-2079`) uses `DEFAULT_DIT_INSTRUCTION`
("Fill the audio semantic mask based on the given conditions:") but the **same caption
and metadata**. The late-phase "style application" still has your genre/mood caption —
just without the source anchor and without the cover instruction trigger.

---

## 5. The Cover Strength Spectrum

```
cover_steps = int(num_steps * strength)

Steps 0 → cover_steps:  Source-conditioned (VQ skeleton + cover instruction)
Steps cover_steps → end: Caption-only (silence context + default instruction)
```

| Strength | Cover Steps (of 50) | Result Character |
|----------|---------------------|------------------|
| 1.0 | 50/50 | Maximum preservation — same song, slight variation |
| 0.9 | 45/50 | Same bones, slightly new skin |
| 0.7 | 35/50 | Recognizable melody + new arrangement/timbre |
| 0.5 | 25/50 | Loose structural echo, significant style change |
| 0.3 | 15/50 | Vague inspiration, mostly new composition |
| 0.1 | 5/50 | Barely influenced, essentially text2music |
| 0.0 | 0/50 | Pure text2music (source ignored entirely) |

### Pipeline Strength Guidelines

- **0.95-1.0** = structural clone. Preserve a generated song's structure while applying
  a different model's texture (e.g., base→turbo cover at 0.95).
- **0.5-0.7** = creative restyle. Good for genre transformation.
- **Chained covers with decreasing strength** = progressive transformation. Each stage
  pushes further from the original.
- **Cover + Refine** = cover provides structural anchor, refine (low denoise) polishes.

---

# Part II — Pipeline Patterns: Works Today

> These patterns use ONLY features that exist in the current `pipeline_executor.py`.
> They can be configured as pipeline presets and run today.

## 6. Patterns Using Current Features

### Pattern A: Cover + Refine (Style Transfer)

**Scenario:** Transform uploaded audio into a new style.

```
Stage 1: COVER (sft, 50 steps, src=uploaded.wav, strength=0.7)
  → Caption: "electronic ambient, synthesizer pads, ethereal"
  ↓ latent
Stage 2: REFINE (turbo, 8 steps, denoise=0.4, input=Stage 1)
  → Same caption — polishes the style transfer
```

**Works because:** Cover and refine are fully implemented. Single source audio, single
shared caption, linear chain.

### Pattern B: Generate + Refine (Quality Ladder)

**Scenario:** Base model for structure, turbo for speed polish.

```
Stage 1: GENERATE (base, 50 steps, shift=3)
  → Full song from noise, high structural quality
  ↓ latent
Stage 2: REFINE (turbo, 8 steps, denoise=0.5, input=Stage 1)
  → Quick refinement pass with turbo's texture
```

**Already shipped as built-in preset** ("Base → Turbo Refine").

### Pattern C: Progressive Cover Drift

**Scenario:** Gradually transform a song by chaining covers with decreasing strength.

```
Stage 1: COVER (strength=0.9, src=uploaded.wav)  → barely changed
  ↓ latent (decoded to wav, re-encoded as source for Stage 2)
Stage 2: COVER (strength=0.6, src=Stage 1)  → moderate shift
  ↓ latent
Stage 3: COVER (strength=0.3, src=Stage 2)  → loose inspiration
```

**Works because:** Each cover stage can reference a previous stage's output via `src_stage`.
The VAE decode→re-encode round-trip happens automatically in `resolve_src_audio()`.

**Caveat:** Each VAE round-trip introduces small quality loss. 3 stages = 3 round-trips.
The VQ bottleneck at each stage also progressively strips detail.

### Pattern D: Repaint Targeted Region

**Scenario:** Fix a bad section in a generated or uploaded song.

```
Stage 1: REPAINT (src=uploaded.wav, start=45.0, end=52.0)
  → Same caption + lyrics
  → Model regenerates that 7-second window
  → Bidirectional attention sees context on both sides → seamless fill
```

**Works because:** Repaint is fully implemented with time range controls.

### Pattern E: Extract + Lego (Single Stem Replacement)

**Scenario:** Replace one instrument in a full mix.

```
Stage 1: EXTRACT vocals (base, src=uploaded mix.wav)
  → Isolate just the vocals from the full mix
  ↓ output is vocals-only audio
Stage 2: LEGO guitar (base, src=Stage 1)
  → Caption: "clean warm acoustic guitar, fingerpicking"
  → Model generates guitar track to accompany the extracted vocals
```

**Works because:** Extract and lego are implemented. The model generates the new
instrument in the *context* of whatever source audio it receives.

**Limitation:** The result is vocals + new guitar only. The original drums/bass/etc
are gone. To get a full mix back, you'd need a COMPLETE stage — but that adds
instruments based on what's already there, which may duplicate what was extracted.
See Feature Gaps below.

### Pattern F: Cover High-Preservation for Artifact Removal

**Scenario:** A generated song has subtle distortion/artifacts throughout.

```
Stage 1: COVER (src=distorted song, strength=0.95)
  → Caption: "clean production, professional mix, no distortion"
  → VQ bottleneck strips the fine-detail artifacts
  → 95% source conditioning preserves structure
  → Final 5% caption-only applies "clean" style
```

**Why this might work:** Distortion is typically fine-detail noise that the VQ bottleneck
strips. The semantic skeleton survives.

**Why this might not:** If the distortion is structural (wrong notes, timing issues),
VQ preserves it. Only works for texture-level artifacts.

---

# Part III — Feature Gaps

> What the pipeline executor CAN'T do today, and what each gap blocks.

## 7. Pipeline Executor Limitations

### Gap 1: Per-Stage Caption/Lyrics Override ✅ IMPLEMENTED

**Previous behavior:** All stages shared caption/lyrics from `PipelineRequest`.

**Now:** Optional `caption` and `lyrics` fields on `PipelineStageConfig`. Executor uses
`stage.caption or req.caption` per stage. Frontend: collapsible per-stage caption/lyrics
override in `StageBlock.tsx` with AutoTextarea fields.

**Unlocked patterns:** Pattern H (Iterative Prompt Refinement), targeted instrument
descriptions per stage, creative direction changes between stages.

### Gap 2: Multi-Source Merge / Audio Mix Stage

**Current behavior:** Each stage gets exactly ONE source: either `src_audio_id` (upload)
or `src_stage` (previous stage output). No way to combine two sources.

**What it blocks:**
- True stem surgery: extract two stems separately, modify one, recombine
- Layering: lego a track against a mix of previous outputs
- Any pattern requiring inputs from multiple prior stages

**Possible approaches:**
- **A) Waveform mix stage:** A new stage type that takes 2+ `src_stage` references,
  VAE-decodes each, sums the waveforms (with optional gain), re-encodes as one source.
  Simple, no model changes needed, but lossy (two VAE round-trips).
- **B) Latent-space mixing:** Average or weighted-sum latents from different stages.
  Theoretically cleaner (no VAE round-trip) but untested — latent space linearity is
  not guaranteed. Needs experimentation.
- **C) External stem separator:** Use a dedicated tool (Demucs, etc.) for separation
  instead of ACE-Step's extract. Feed separated stems back as sources. Sidesteps the
  pipeline entirely for the separation step.

**Effort:** Medium (approach A) to Research-grade (approach B).

### Gap 3: Mid-Pipeline Scoring / Branching

**Current behavior:** Pipeline runs all stages sequentially. No decision points.

**What it blocks:**
- Quality ladder: generate N candidates, score, pick best, refine the winner
- Conditional repair: only run fix pipeline if quality score is below threshold
- Any adaptive workflow where later stages depend on earlier stage quality

**Possible approaches:**
- **A) Post-pipeline scoring:** Run pipeline, score result, decide if re-run needed.
  Agent loop outside the pipeline handles branching. Simpler, no executor changes.
- **B) Branch stage type:** A new stage type that scores previous output and selects
  a branch (e.g., "if score < 7, run repair substages; else skip to end").
  Complex, turns linear pipeline into a DAG with conditionals.

**Recommended:** Start with (A). The agent orchestration layer (Part VII) handles
branching decisions. Keep the pipeline executor simple and linear.

**Effort:** Approach A = zero (agent logic only). Approach B = large.

### Gap 4: Per-Stage Model for Extract/Lego/Complete

**Current behavior:** Model swapping works — `swap_dit_model()` loads new weights.
But extract/lego/complete require the base model specifically. If a pipeline uses
turbo for generate→refine, then needs base for extract, the swap works but hasn't
been tested end-to-end with real inference.

**Risk:** The conditioning state (text embeddings, etc.) is computed per-stage, so
model swaps should be safe. But the embedding spaces of different model variants may
not align perfectly. `prepare_condition()` lives in the model weights, so each model
processes conditions with its own trained weights.

**Effort:** Testing only — the code path exists, just needs GPU validation.

### Gap 5: Batch-Level Branching

**Current behavior:** All batch items go through the same stages.

**What it blocks:**
- Generating 4 candidates, scoring each, only refining the top 2
- Per-item repair decisions based on individual quality scores

**Likely approach:** Keep pipelines batch-uniform. Do selection between pipeline runs
via the agent layer. Simpler and sufficient for most workflows.

---

# Part IV — Pipeline Patterns: Needs Feature Gaps Closed

> These patterns are architecturally sound but require features from Part III.

## 8. Patterns Requiring New Features

### Pattern G: Full Stem Surgery (Needs Gap 2: Multi-Source Merge)

**Scenario:** Replace guitar in a full mix while keeping everything else.

```
Stage 1: EXTRACT vocals (base, src=uploaded mix.wav)    → vocals only
Stage 2: EXTRACT drums (base, src=uploaded mix.wav)     → drums only
Stage 3: EXTRACT bass (base, src=uploaded mix.wav)      → bass only
Stage 4: MIX (src=[Stage 1, Stage 2, Stage 3])          → NEW STAGE TYPE
  → Combines the 3 stems into one mix (without guitar)
Stage 5: LEGO guitar (base, src=Stage 4)
  → Caption: "clean warm acoustic guitar"
  → Generates new guitar against the combined stems
```

**Why linear extract→lego doesn't work today:** If you extract vocals (Stage 1) then
lego guitar against it (Stage 2), you get vocals + guitar only. The drums/bass from
the original mix are gone. You can't merge Stage 1 + a separate drums extraction
because each stage only accepts ONE source.

**Workaround without Gap 2:** Use COMPLETE instead of the extract→merge→lego chain:
```
Stage 1: EXTRACT guitar (base, src=mix.wav)  → isolate the bad guitar
  [diagnostic only — discard this output]
Stage 2: COVER (src=mix.wav, strength=0.95)
  → Caption: "clean warm acoustic guitar, professional mix"
  → VQ strips guitar artifacts, high preservation keeps everything else
```
Less precise but works today.

### Pattern H: Iterative Prompt Refinement (Needs Gap 1: Per-Stage Caption)

**Scenario:** Apply different creative directions at each stage.

```
Stage 1: GENERATE
  → Caption: "jazz piano trio, brushed drums, upright bass, intimate"
Stage 2: COVER (src=Stage 1, strength=0.7)
  → Caption: "add lush string section, orchestral depth"    ← DIFFERENT
Stage 3: COVER (src=Stage 2, strength=0.8)
  → Caption: "warmer analog saturation, vintage tape feel"  ← DIFFERENT
```

Each cover stage applies a different "edit instruction" while preserving structure.
**Requires per-stage caption fields (Gap 1).**

### Pattern I: Quality Ladder with Branching (Needs Gap 3: Scoring)

**Scenario:** Generate candidates, score, refine only the best.

```
Pipeline 1 (batch=4): GENERATE (turbo, 8 steps, different seeds)
  → 4 candidates
  [SCORE EACH — agent picks best]              ← GAP 3
Pipeline 2: REFINE (base, 32 steps, denoise=0.5, src=best from Pipeline 1)
  → Deep refinement of the winner
Pipeline 3: REFINE (turbo, 8 steps, denoise=0.3, src=Pipeline 2)
  → Final polish
```

**Workaround without Gap 3:** Run as separate pipeline invocations. The agent
(or user) scores after Pipeline 1, picks the best audio, uploads it as source
for Pipeline 2. Manual but functional.

### Pattern J: Targeted Instrument Repair (Needs Gaps 1+2)

**Scenario:** Generated song has good vocals but distorted guitar.

**Ideal approach (needs multi-source merge + per-stage caption):**
```
Stage 1: EXTRACT vocals (base, src=song)   → good vocals
Stage 2: EXTRACT drums (base, src=song)    → good drums
Stage 3: MIX (src=[Stage 1, Stage 2])      → vocals + drums
Stage 4: LEGO guitar (base, src=Stage 3)
  → Caption: "clean warm acoustic guitar, no distortion"
Stage 5: COMPLETE (base, src=Stage 4)
  → complete_track_classes: ["bass", "keyboard"]
```

**What works today instead:**
- **Repaint** if distortion is time-localized (fixes a region, keeps everything else)
- **Cover at 0.95** if distortion is texture-level (VQ strips fine artifacts)
- **Extract + Lego** if you're OK losing some instruments (vocals + new guitar, no drums/bass)

---

# Part V — Quality Detection (Medium-Term)

## 9. Quality Detection & Distortion Scoring

### Vision

An automated quality assessment system that can:
1. **Score overall quality** of generated audio (partially exists: `/api/audio/score`)
2. **Detect specific defects** per instrument/stem
3. **Classify defect types:** clipping, aliasing, phase cancellation, wrong pitch,
   timing drift, spectral artifacts, muddy mix
4. **Provide actionable feedback** the pipeline (or agent) can act on

### Current State

ACE-Step's built-in `handler.score()` evaluates latent-space quality → single number.
This is a starting point but insufficient for targeted repair decisions.

### Proposed Architecture

```
Generated Audio
      ↓
┌─────────────────────────────┐
│  Quality Analysis Pipeline  │
├─────────────────────────────┤
│  1. Stem Separation         │  ← ACE-Step extract or external (Demucs)
│  2. Per-Stem Analysis       │  ← Spectral analysis, SNR, THD
│  3. Mix Analysis            │  ← Stereo width, frequency balance
│  4. Perceptual Model        │  ← Omni audio quality model
│  5. Reference Comparison    │  ← If reference clips provided
└──────────────┬──────────────┘
               ↓
┌──────────────────────────────┐
│  Quality Report              │
│  Overall: 7.2/10             │
│  Vocals: 8.5 (clean)        │
│  Guitar: 3.1 (DISTORTION)   │
│  Drums: 7.8 (slightly thin) │
│  Bass: 6.5 (muddy low end)  │
│                              │
│  Suggested repairs:          │
│  → Re-lego guitar (clean)   │
│  → Repaint bass 0:30-0:45   │
│  → Cover w/ "wider mix"     │
└──────────────────────────────┘
```

### Implementation Stages

**Stage A: Spectral heuristics** (no ML needed, buildable now)
- Detect clipping (samples at ±1.0), measure THD (total harmonic distortion)
- Frequency band energy ratios (bass/mid/treble balance)
- Stereo correlation (mono compatibility, width)
- CPU-only, fast, deterministic

**Stage B: Perceptual model** (requires external model)
- Audio quality assessment: PESQ, ViSQOL, or fine-tuned omni audio model
- Score perceptual quality, not just spectral properties
- Compare against reference clips if provided

**Stage C: Per-stem quality** (requires stem separation)
- Use ACE-Step's extract or external Demucs for separation
- Run Stage A+B analysis on each stem independently
- Cross-reference: if guitar stem has high THD, recommend re-lego

**Stage D: LLM interpretation** (local omni model)
- Feed spectral features + quality scores to local LLM
- Natural language: "The guitar has clipping artifacts starting at 0:30"
- Output repair recommendations in pipeline-executable format

---

# Part VI — Dataset Building & RLVR (Long-Term)

## 10. Dataset Building for RLVR

### The Core Idea

Every generation is a potential training example. By scoring outputs and building
**preference pairs** (good vs bad), we create a dataset for reinforcement learning —
fine-tuning the model to prefer high-quality outputs.

### Important: Diffusion ≠ LLM Training

ACE-Step is a flow-matching diffusion model, not an autoregressive LLM. Standard
RLHF/DPO (designed for next-token prediction) doesn't directly apply. Relevant approaches:

- **DiffusionDPO** (Wallace et al. 2023) — adapts DPO loss to the diffusion denoising objective
- **DDPO** (Black et al. 2023) — policy gradient RL for diffusion models
- **ReFL** (Xu et al. 2023) — reward feedback learning for diffusion

The existing ACE-Step training infrastructure (`acestep/training/`) uses flow matching loss.
Integrating preference learning would require extending this with one of the above methods.
The **dataset format** (preference pairs + prompts) is still valuable regardless of which
RL method is used.

### Preference Pair Structure

```json
{
  "prompt": {
    "caption": "acoustic soul, female tenor vocal...",
    "lyrics": "[Verse 1] They say she makes...",
    "metadata": {"bpm": 100, "keyscale": "C major", "duration": 150}
  },
  "chosen": {
    "audio_path": "generations/good_001.flac",
    "quality_score": 8.7,
    "quality_report": { "vocals": 9.0, "guitar": 8.5, "drums": 8.0 },
    "generation_params": { "model": "turbo", "steps": 8, "seed": 42, "shift": 3 }
  },
  "rejected": {
    "audio_path": "generations/bad_001.flac",
    "quality_score": 4.2,
    "quality_report": { "vocals": 7.0, "guitar": 2.1, "drums": 5.0 },
    "defects": ["guitar_distortion", "muddy_bass"],
    "generation_params": { "model": "turbo", "steps": 8, "seed": 17, "shift": 3 }
  }
}
```

### Collection Strategies

**Strategy 1: Same prompt, different seeds**
Generate N candidates with same prompt, different seeds. Top-K = "chosen",
bottom-K = "rejected". Model learns: for this prompt, these latent paths are better.

**Strategy 2: Same prompt, different params**
Vary steps, shift, CFG, model variant. Model learns which strategies work per prompt type.

**Strategy 3: Before/after repair pipeline**
Generate → detect distortion → repair via pipeline → score both.
"Rejected" = original distorted, "Chosen" = repaired. Model learns to avoid defects.

**Strategy 4: Human-in-the-loop curation**
Present pairs to user: "Which sounds better?" Most reliable signal, most expensive.
Reserve for ambiguous cases or calibrating the automated scoring.

**Strategy 5: Reference-anchored scoring**
User provides reference clips. Score each generation by similarity. Builds dataset
aligned to specific aesthetic preferences.

### What to Save Per Generation

1. **Prompt** — caption, lyrics, metadata
2. **Generation params** — model, steps, shift, seed, CFG, scheduler, instruction
3. **Audio file** — output (FLAC for quality, or latents for re-decode)
4. **Quality assessment** — overall score, per-stem scores, defect list
5. **Pipeline config** — if multi-stage, the full stage graph + params
6. **Source audio** — if cover/repaint/etc., the input audio
7. **LM metadata** — if LLM assisted, CoT reasoning and generated caption

### Storage Considerations

At 48kHz stereo FLAC, ~30s ≈ 5MB. Latent tensors ≈ 200KB. For scale:
- Store latents + params for reproduction, FLAC only for quality assessment
- Batch generations overnight with GPU, score in morning
- Target: 10K preference pairs for meaningful RL signal
- At 10K × 5MB = ~50GB for audio + latents + annotations

---

# Part VII — Agent Orchestration (Long-Term)

## 11. Agent Orchestration Vision

### The End State

A local LLM agent receives high-level directions and reference material, then autonomously:

1. **Interprets the brief** — "Jazz album, 8 tracks, warm analog, female vocals on 3"
2. **Plans pipelines** — Selects stage types, models, parameters per track
3. **Generates candidates** — Runs batches, varying seeds and params
4. **Scores and filters** — Automated quality detection, reference comparison
5. **Repairs defects** — Routes problems through targeted fix pipelines
6. **Iterates** — Adjusts parameters based on what worked/failed
7. **Curates dataset** — Saves good/bad pairs, builds RLVR training set
8. **Presents results** — Shortlist of best candidates with quality reports

### Agent Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    User Interface                         │
│  Brief: "Jazz album, 8 tracks, warm analog, female vox" │
│  References: [clip1.wav, clip2.wav]                      │
│  Quality bar: "Professional release quality"             │
└──────────────────────┬───────────────────────────────────┘
                       ↓
┌──────────────────────────────────────────────────────────┐
│                    Agent Core (Local LLM)                 │
│                                                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────┐ │
│  │ Planner    │  │ Critic     │  │ Dataset Builder     │ │
│  │ Brief →    │  │ Audio →    │  │ Results →           │ │
│  │ Pipeline   │  │ Score +    │  │ Preference pairs    │ │
│  │ configs    │  │ Repair     │  │ Coverage analysis   │ │
│  └─────┬──────┘  └─────┬──────┘  └──────────┬─────────┘ │
│        ↓               ↓                     ↓           │
│  ┌──────────────────────────────────────────────────┐    │
│  │              ACE-Step Pipeline API                │    │
│  │  POST /api/generation/pipeline                   │    │
│  │  POST /api/audio/score                           │    │
│  │  POST /api/generation/understand                 │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

### Agent Decision Loop (Pseudocode)

```python
def produce_track(brief, reference_clips):
    # Phase 1: Generate candidates
    caption = llm_expand_brief(brief)
    lyrics = llm_write_lyrics(brief) if brief.has_vocals else "[Instrumental]"

    candidates = []
    for seed in random_seeds(N=8):
        result = run_pipeline([
            generate(model="turbo", steps=8, seed=seed),
            refine(model="base", steps=32, denoise=0.5),
        ], caption=caption, lyrics=lyrics)
        candidates.append(result)

    # Phase 2: Score and rank
    scored = [(quality_score(c, reference_clips), c) for c in candidates]
    scored.sort(reverse=True)

    # Phase 3: Repair top candidates if needed
    for score, candidate in scored[:3]:
        report = quality_report(candidate)
        if report.has_defects():
            repaired = run_repair_pipeline(report, candidate)
            save_preference_pair(rejected=candidate, chosen=repaired, prompt=brief)

    # Phase 4: Return best, save all for dataset
    for s, c in scored:
        save_to_catalog(c, score=s, brief=brief, caption=caption)
    return scored[0]
```

### Planner Heuristics (Learned Over Time)

```yaml
genre_presets:
  jazz:
    preferred_model: "base"
    steps: 50
    shift: 2.0
    cfg: 3.0
    cover_strength_for_reference: 0.6
    common_defects: ["muddy_piano", "timing_drift"]
    repair_strategy: "extract_and_relego"

  electronic:
    preferred_model: "turbo"
    steps: 8
    shift: 3.0
    cover_strength_for_reference: 0.4
    common_defects: ["aliasing", "thin_bass"]
    repair_strategy: "cover_high_preservation"

  vocal_heavy:
    preferred_model: "sft"
    steps: 50
    cfg: 5.0
    lm_model: "1.7B"
    thinking: true
    common_defects: ["pitch_artifacts", "sibilance"]
    repair_strategy: "extract_vocals_and_relego"
```

These start as manual observations, evolve as the agent gathers data.

### Reference Clip Workflow

```
User provides: reference_clip.wav
    ↓
Agent analyzes: BPM, key, genre, instrumentation, vocal character
    ↓
Agent extracts: metadata fields + caption seeds + timbre reference
    ↓
Agent generates: candidates with extracted params
                 scores by perceptual similarity to reference
                 iterates on caption until quality bar met
```

### Autonomy Levels

| Level | Description | User Involvement |
|-------|-------------|-----------------|
| **Fully autonomous** | "Here are your 8 jazz tracks, I made 47 attempts" | Brief only |
| **Supervised** | "4 candidates for Track 1, which do you prefer?" | Periodic selection |
| **Collaborative** | "Guitar is distorted, I suggest re-lego. Approve?" | Per-decision |

---

# Part VIII — Performance & Robustness Patterns

> Optimizations and safety patterns worth adopting. Some are already applied,
> others are noted for future work.

## 12. Performance & Robustness Optimizations

### Applied: `torch.inference_mode()` Over `torch.no_grad()`

`torch.inference_mode()` is strictly better than `torch.no_grad()` for inference paths.
It disables both autograd AND version tracking, giving a measurable speed + memory improvement.

**Already swapped in:**
- `diffusion_core.py:498` — main diffusion loop
- `pipeline_executor.py` — `resolve_src_audio()` VAE decode, refine re-noise, final VAE decode

**Not touched (upstream files):**
- `handler.py` — 15+ occurrences. Would need upstream acceptance or maintaining a patch.
- `llm_inference.py` — constrained/CFG decoding loops.

### Applied: Cover Safety Fallback

In `pipeline_executor.py`, if an audio-requiring stage (cover/repaint/extract/lego/complete)
fails to resolve source audio, it now gracefully degrades to text2music generation with a
warning log, instead of crashing. The router validation should catch this first, but this
is a safety net for edge cases (e.g., deleted upload, race condition).

### Applied: Device-Agnostic Cache Cleanup

`torch.cuda.empty_cache()` calls in `pipeline_executor.py` now guard on
`torch.cuda.is_available()` to avoid errors on non-CUDA devices.

### Future: Auto-Tuned VAE Decode Chunk Size

Instead of a fixed `tiled_decode()` chunk size, auto-tune based on available VRAM:
```python
def _get_auto_decode_chunk_size():
    mem = get_gpu_memory_gb()
    if mem >= 48: return 1536
    if mem >= 24: return 1024
    return 512
```
Relevant for pipeline stages that VAE-decode previous stage output (`resolve_src_audio()`).
Worth implementing when we test long-duration pipeline runs.

### Future: LLM Unload During Audio Stages

When running cover/extract/lego/complete stages, the LLM is not needed (these don't use
CoT or code generation). Unloading LLM weights before audio stages and lazy-reloading
when needed again could free significant VRAM (0.6B = ~3GB, 1.7B = ~8GB).

Pattern from community fork:
```python
class LLMHandler:
    def unload(self):
        del self.model, self.tokenizer
        self.model = self.tokenizer = None
        gc.collect()
        torch.cuda.empty_cache()
```

This is relevant to Gap 4 (per-stage model management) and multi-model pipelines where
VRAM is tight.

### Future: Training Performance Patterns (for RLVR)

When we build the RLVR training loop (Part VI), these patterns are worth adopting:

1. **`non_blocking=True`** on all `.to(device)` calls in training loops — enables
   async CPU→GPU transfers, overlapping with compute
2. **Fused AdamW** — `torch.optim.AdamW(..., fused=True)` on CUDA, ~10-15% faster
3. **DataLoader tuning** — `prefetch_factor=2`, `persistent_workers=True`,
   `pin_memory_device="cuda"` for faster data loading
4. **Resume from checkpoint** — essential for long RLVR runs. Save optimizer state,
   scheduler state, and dataset position alongside model weights
5. **Pre-computed timestep tensors** — allocate once in `__init__`, not per training step

### Future: Progress Estimation with Historical Data

Persist per-step timing data to a cache file (`.cache/acestep/progress_estimates.json`).
After a few runs, use historical data to predict ETA for future generations, bucketed
by device/steps/duration. Better than our current step-count-based progress for
multi-stage pipelines where each stage has different step counts and models.

---

## 13. Open Questions

### Needs Testing (do with GPU)

1. **VQ bottleneck characteristics:** What survives quantization for different source
   types? Dense orchestral vs sparse acoustic vs vocal-only vs drums-only.
   Understanding the bottleneck's "personality" informs strength recommendations.

2. **Cover + CFG interaction:** Community says CFG 3-5 with SFT improves cover.
   Does this interact with cover_strength? Lower CFG in caption-only phase = more freedom?

3. **Model swap + conditioning state:** When `swap_dit_model()` changes weights mid-pipeline,
   do embeddings from the new model's `prepare_condition()` produce compatible representations?
   Same architecture = same shapes, but trained weights differ.

4. **Latent-space mixing:** Can we average or weighted-sum latents from different stages?
   VAE latent space is continuous, so linear interpolation might produce valid audio.

5. **End-to-end pipeline with audio stages:** Cover, repaint, extract stages haven't been
   tested with actual GPU inference in the pipeline executor.

6. **Custom instructions:** Do non-standard instruction strings generalize? E.g., "Enhance
   the clarity of the mix while preserving all instruments:" — does the model respond
   meaningfully, or does it need exact training instructions?

### Needs Design Decisions

7. **Agent autonomy level:** How much should the agent decide vs ask the user?

8. **Quality bar calibration:** "Professional release quality" means different things.
   Need calibration step where user rates examples and agent learns their threshold.

9. **Prompt diversity for RLVR:** Balanced coverage across genres, tempos, keys,
   instrumentation. A prompt generator that fills coverage gaps improves dataset quality.

10. **Fine-tuning scope:** DiffusionDPO on full DiT? Just decoder? Condition encoder?
    VQ bottleneck? Different components benefit from different training signals.

11. **Per-stage caption UX:** Collapsible override in StageBlock, or separate "stage
    conditioning" panel? Should lyrics also be per-stage?

### Needs Infrastructure

12. **Storage at scale:** 10K pairs × ~5MB = ~50GB. Need structured catalog with
    search/filter, not flat files. SQLite + filesystem? DVC?

13. **GPU scheduling:** Overnight batch generation. Queue system with VRAM limits,
    failure recovery, batch resume.

14. **Dataset versioning:** As model improves via RL, quality bar shifts. Old "chosen"
    may become "rejected". Need versioning tied to model checkpoints.

---

## 14. File & Function Reference

> All paths relative to project root `/media/dylan-matlow/BigU/AI/music/ACE-Step-1.5`.
> Line numbers are approximate — may shift slightly after edits.

### Constants & Templates

| Location | What | Notes |
|----------|------|-------|
| `acestep/constants.py:62` | `TASK_TYPES_BASE` | `["text2music", "repaint", "cover", "extract", "lego", "complete"]` |
| `acestep/constants.py:70` | `DEFAULT_DIT_INSTRUCTION` | `"Fill the audio semantic mask based on the given conditions:"` — used by text2music, also the non-cover fallback during temporal switch |
| `acestep/constants.py:71` | `DEFAULT_LM_INSTRUCTION` | `"Generate audio semantic tokens based on the given conditions:"` — same text as TASK_INSTRUCTIONS["cover"], but for LM use |
| `acestep/constants.py:79-89` | `TASK_INSTRUCTIONS` dict | Maps task type → instruction string. Includes `_default` variants for extract/lego/complete without params. `{TRACK_NAME}` and `{TRACK_CLASSES}` are format placeholders |
| `acestep/constants.py:96-99` | `TRACK_NAMES` list | `["woodwinds", "brass", "fx", "synth", "strings", "percussion", "keyboard", "guitar", "bass", "drums", "backing_vocals", "vocals"]` |
| `acestep/constants.py:101-109` | `SFT_GEN_PROMPT` | Template: `"# Instruction\n{}\n\n# Caption\n{}\n\n# Metas\n{}<\|endoftext\|>"` — ALL generation goes through this |
| `web/frontend/src/lib/constants.ts:24-34` | Frontend mirrors | `TASK_TYPES`, `TASK_TYPES_TURBO`, `TASK_INSTRUCTIONS`, `TRACK_NAMES` — must stay in sync with Python constants |

### Handler — Core Generation Path (acestep/handler.py)

| Line | Function | What It Does | Key Details |
|------|----------|-------------|-------------|
| 53 | `class AceStepHandler` | Main handler class | Holds model, vae, text_encoder, silence_latent. Singleton via `dependencies.py` |
| 309 | `initialize_service()` | Load DiT model | Stores `self.model_variant` (e.g. "acestep-v15-turbo"). Auto-downloads missing models. Returns `(msg, success)` |
| 552 | `swap_dit_model(new_variant)` | Hot-swap DiT weights | Loads new checkpoint into existing model architecture. Used by pipeline executor for multi-model pipelines |
| 857 | `_decode_audio_codes_to_latents(code_str)` | LM codes → latents | Parses code string, runs through VQ codebook → detokenize → 25Hz latents. Used for `has_code_hint` path |
| 1194 | `_normalize_instructions(instructions, batch_size, default)` | Normalize to list | Ensures `instructions` is a `List[str]` of length `batch_size`, filling with `default` as needed |
| 1249 | `_encode_audio_to_latents(audio)` | Wav → VAE latents | `audio` is `[2, frames]` tensor at 48kHz. Returns `[T, D]` latent at 25Hz (48kHz / 1920 hop) |
| 1318 | `generate_instruction(task_type, track_name, complete_track_classes)` | Task type → instruction string | Handles `{TRACK_NAME}` substitution (uppercased) and `{TRACK_CLASSES}` join. Returns string from TASK_INSTRUCTIONS |
| 1410 | `process_src_audio(audio_file)` | Load + normalize source audio | Returns `[2, frames]` tensor. Resamples to 48kHz stereo. Called by `resolve_src_audio()` for uploads |
| **1696** | **`_prepare_batch()`** | **THE batch assembly function** | Builds all conditioning tensors. Contains: VAE encode of source (line 1769-1793), chunk_mask + is_covers construction (line 1837-1904), src_latents per task type (line 1906-1939), LM hints decode (line 1942-1978), text tokenization (line 1984-2039), non-cover text prep when strength < 1.0 (line 2050-2079). **This is the function to read to understand conditioning** |
| 1837-1904 | (inside `_prepare_batch`) | `is_covers` detection | Per-batch-item loop. Repainting→False (line 1877). Else: substring match on instruction (line 1887-1900) OR `has_code_hint` (line 1888) |
| 1906-1939 | (inside `_prepare_batch`) | `src_latents` construction | Cover/extract/lego/complete: `target_latents[i].clone()`. Repaint: clone + zero the masked region with silence. Text2music: silence_latent |
| 2050-2079 | (inside `_prepare_batch`) | Non-cover text embedding | Only when `audio_cover_strength < 1.0`. Uses `DEFAULT_DIT_INSTRUCTION` + same caption → separate text encoder pass → stored as `non_cover_text_*` |
| 2181 | `preprocess_batch(batch)` | Text encoder + embeddings | Runs `infer_text_embeddings()` and `infer_lyric_embeddings()` on tokenized inputs from `_prepare_batch` |
| **2257** | **`service_generate()`** | **Main generation entry point** | Called by pipeline executor + generation router. Accepts: `captions, lyrics, target_wavs, instructions, audio_cover_strength, audio_code_hints, repainting_start/end, init_latents, t_start, scheduler, timesteps` + all diffusion params. Calls `_prepare_batch()` → `preprocess_batch()` → `model.prepare_condition()` → `generate_audio_core()` |
| 2497 | `tiled_decode(latents)` | VAE decode with tiling | Handles large latent tensors by chunking. Returns `[batch, 2, samples]` audio. Used by pipeline executor's `resolve_src_audio()` |
| 2837 | `generate_music()` | High-level wrapper | Used by `inference.py:generate_music()`. Calls `_prepare_batch` → `preprocess_batch` → `generate_audio_core`. Higher-level than `service_generate` |

### Diffusion Core (acestep/diffusion_core.py)

| Line | Function/Region | What It Does | Key Details |
|------|----------------|-------------|-------------|
| 302 | `generate_audio_core()` | **Unified diffusion loop** | Replaces per-model `generate_audio()`. Accepts `model, variant, init_latents, t_start, audio_cover_strength, non_cover_text_*`. Routes to correct config via `MODEL_VARIANT_CONFIGS` |
| 392-408 | (inside `generate_audio_core`) | Cover condition preparation | Calls `model.prepare_condition()` with `is_covers=True`, real src_latents |
| 416-440 | (inside `generate_audio_core`) | Non-cover condition preparation | Only when `audio_cover_strength < 1.0`. Calls `model.prepare_condition()` with `is_covers=False`, silence latents, `non_cover_text_hidden_states` |
| 457-458 | (inside `generate_audio_core`) | Pipeline partial denoise | `if init_latents is not None and t_start < 1.0: schedule = TimestepScheduler.truncate(schedule, t_start)` |
| 461 | (inside `generate_audio_core`) | Cover steps calculation | `cover_steps = int(num_steps * audio_cover_strength)` |
| 464-467 | (inside `generate_audio_core`) | Initial latent | `if init_latents: xt = init_latents` else `xt = model.prepare_noise(context_latents, seed)` |
| 493-528 | (inside `generate_audio_core`) | **Temporal switch + KV cache reset** | At `step_idx >= cover_steps`: swaps encoder_hidden_states, context_latents to non-cover versions. **Resets `past_key_values`** to fresh `EncoderDecoderCache` (line 526-528). CFG doubling of non-cover states done once (line 506-521, `cover_cfg_doubled` flag) |
| 542-549 | (inside `generate_audio_core`) | Decoder forward pass | `model.decoder(hidden_states=x_in, timestep=t_in, ..., encoder_hidden_states, context_latents, past_key_values)` |

### Model Files (checkpoints — downloaded artifacts, NOT in git)

> These files are in `checkpoints/acestep-v15-*/`. Base and turbo have slightly different
> line numbers but identical `prepare_condition()`. Both inherit `AceStepPreTrainedModel`.
>
> **Base model file:** `checkpoints/acestep-v15-base/modeling_acestep_v15_base.py`
> **Turbo model file:** `checkpoints/acestep-v15-turbo/modeling_acestep_v15_turbo.py`
> **SFT uses base file:** `checkpoints/acestep-v15-sft/modeling_acestep_v15_base.py`

| Line (base) | Class/Method | What It Does | Key Details |
|-------------|-------------|-------------|-------------|
| 862 | `AudioTokenDetokenizer` | 5Hz quantized → 25Hz continuous | The "detokenize" half of VQ. Upsamples from pool_window_size=5 |
| 1181 | `AceStepAudioTokenizer` | Continuous → VQ quantized | The "tokenize" half. Pool→quantize through learned codebook |
| 1240 | `AceStepDiTModel` | The diffusion transformer (decoder) | ~300 lines. Takes `hidden_states, timestep, encoder_hidden_states, context_latents, past_key_values`. Contains transformer layers, time embeddings, `proj_in` |
| 1347 | (inside `AceStepDiTModel.forward`) | Context latent injection | `hidden_states = torch.cat([context_latents, hidden_states], dim=-1)` then `self.proj_in()`. This is channel-wise conditioning |
| 1509 | `AceStepConditionEncoder` | Text + lyric + reference → encoder states | Cross-attention conditioning. Combines text embeddings, lyric embeddings, and reference audio acoustic features |
| 1557 | `AceStepConditionGenerationModel` | **Top-level model class** | Composed of: `self.decoder` (DiT), `self.encoder` (condition), `self.tokenizer` (VQ), `self.detokenizer` (VQ inverse), `self.null_condition_emb` (CFG) |
| 1566-1578 | `__init__()` | Model composition | `self.decoder = AceStepDiTModel(config)`, `self.encoder = AceStepConditionEncoder(config)`, `self.tokenizer = AceStepAudioTokenizer(config)`, `self.detokenizer = AudioTokenDetokenizer(config)`, `self.null_condition_emb = nn.Parameter(...)` |
| 1580-1591 | `tokenize(x, silence_latent, attention_mask)` | 25Hz → 5Hz VQ | Pads to `pool_window_size`, rearranges to patches, calls `self.tokenizer(x)` → `(quantized, indices)` |
| 1593-1604 | `detokenize(quantized)` | 5Hz → 25Hz continuous | Calls `self.detokenizer(quantized)` → upsampled hidden_states |
| **1607-1652** | **`prepare_condition()`** | **THE conditioning function** | (1) Encoder pass → `encoder_hidden_states`. (2) VQ path: tokenize→quantize→detokenize or use precomputed hints. (3) `torch.where(is_covers > 0, lm_hints_25Hz, src_latents)` — **the cover swap**. (4) Concat src_latents + chunk_masks → `context_latents` |
| 1649 | (inside `prepare_condition`) | **The cover swap** | `src_latents = torch.where(is_covers.unsqueeze(-1).unsqueeze(-1) > 0, lm_hints_25Hz, src_latents)` — VQ-processed for cover, original for everything else |
| 1733-1750 | `prepare_noise()` | Create initial noise tensor | Shape: `(batch, latent_length, latent_dim // 2)`. Per-item seeding via `torch.Generator` |
| 1772 | `get_x0_from_noise(zt, vt, t)` | Predict clean from noisy + velocity | `x0 = zt - t * vt` (flow matching) |
| 1775 | `renoise(x, t, noise=None)` | Re-add noise to clean latent | `xt = (1-t)*x + t*noise`. Used by pipeline executor for refine stages |

### Pipeline Executor (web/backend/services/pipeline_executor.py)

| Line | Function | What It Does | Key Details |
|------|----------|-------------|-------------|
| 20 | `AUDIO_STAGE_TYPES` | Set of types needing source audio | `{"cover", "repaint", "extract", "lego", "complete"}` |
| 23-31 | `build_stage_instruction(stage)` | Stage config → instruction string | Looks up `TASK_INSTRUCTIONS[stage.type]`, substitutes `{TRACK_NAME}` and `{TRACK_CLASSES}`. Falls back to text2music |
| 34-76 | `resolve_src_audio(stage, dit_handler, stage_latents, sample_rate)` | Get source audio tensor | Two paths: `stage.src_audio_id` → `audio_store.get_path()` → `dit_handler.process_src_audio()`. Or `stage.src_stage` → `stage_latents[src_stage]` → `dit_handler.tiled_decode()` → CPU `[2, frames]` tensor |
| 79-230+ | `run_pipeline(task_id, dit_handler, req)` | **Main pipeline orchestrator** | Validates stages. For each stage: optional model swap (line 143-156), resolve source audio (line 190-219), prepare seeds/params, call `dit_handler.service_generate()` (line 227+), save latents to `stage_latents` dict |
| 111-112 | (inside `run_pipeline`) | **Shared conditioning** | `captions_batch = [req.caption] * batch_size`, `lyrics_batch = [req.lyrics] * batch_size` — **THIS is where per-stage caption would need to change (Gap 1)** |
| 174-188 | (inside `run_pipeline`) | Refine stage setup | `clean_latents = stage_latents[input_stage]`, `init_latents = model.renoise(clean_latents, t_start)` |
| 190-219 | (inside `run_pipeline`) | Audio stage routing | Calls `resolve_src_audio()`, builds instruction via `build_stage_instruction()`, sets per-type kwargs (cover_strength, repainting_start/end, audio_code_hints) |
| 208-212 | (inside `run_pipeline`) | Cover-specific setup | `audio_cover_strength = stage.audio_cover_strength`, `refer_audios = [[src_audio]]` (source also used as timbre reference) |

### Schemas (web/backend/schemas/)

| File:Line | Class | Key Fields | Notes |
|-----------|-------|------------|-------|
| `pipeline.py:7` | `PipelineStageConfig` | `type, input_stage, src_audio_id, src_stage, audio_cover_strength, audio_code_hints, repainting_start, repainting_end, track_name, complete_track_classes, model, steps, shift, denoise, seed, ...` | **No `caption` or `lyrics` field — that's Gap 1** |
| `pipeline.py:49` | `PipelineRequest` | `caption, lyrics, instrumental, vocal_language, bpm, keyscale, timesignature, duration, batch_size, thinking, lm_*, stages` | Shared conditioning for all stages |
| `generation.py:7` | `GenerateRequest` | `task_type, instruction, caption, lyrics, ...` | Single-stage generation (Custom Mode). Has `instruction` field that pipeline doesn't use (builds its own) |

### Frontend (web/frontend/src/)

| File | What | Key Details |
|------|------|-------------|
| `lib/constants.ts:24` | `TASK_TYPES` | All 6 types. `TASK_TYPES_TURBO` = first 3 only (text2music, repaint, cover) |
| `lib/constants.ts:27-34` | `TASK_INSTRUCTIONS` | Frontend mirror of Python constants. Uses `{TRACK_NAME}`, `{TRACK_CLASSES}` placeholders |
| `lib/constants.ts:36-39` | `TRACK_NAMES` | 12 instrument names for extract/lego UI dropdowns |
| `lib/types/index.ts` | `PipelineStageType`, `PipelineStageConfig`, `PipelineRequest` | TypeScript types mirroring backend schemas. ~line 307 area |
| `stores/pipelineStore.ts` | `usePipelineStore` | Zustand store. `stages`, `STAGE_DEFAULTS` map (7 types), `addStage`, `updateStage`, `removeStage` (fixes src_stage refs), presets, user preset save/load/delete (localStorage) |
| `components/generation/StageBlock.tsx` | Stage card UI | ~469 lines. Type selector, conditional UI per type (audio source toggle, cover strength slider, repaint range, track selector, complete multi-select), model filtering for base-only types |
| `components/generation/PipelineMode.tsx` | Pipeline builder | ~210 lines. LLMAssist, shared conditioning, stage list, presets (built-in + user), Run Pipeline button |
| `components/common/AudioSourceViewer.tsx` | WaveSurfer waveform | ~245 lines. Source audio preview for pipeline stages. Scroll-wheel zoom, transport controls. Repaint mode: draggable region overlay (Regions plugin), bidirectional sync with start/end fields |

### Key Data Flows to Remember

**Cover generation path:**
```
user sets task_type="cover" + uploads source audio
→ generation.py router or pipeline_executor.py
  → build_stage_instruction() → TASK_INSTRUCTIONS["cover"]
  → resolve_src_audio() → dit_handler.process_src_audio() → [2, frames] tensor
  → dit_handler.service_generate(target_wavs=src, instructions=["Generate audio semantic..."], audio_cover_strength=X)
    → _prepare_batch(): VAE-encode src → target_latents, detect is_cover=True via instruction substring
    → _prepare_batch(): src_latents = target_latents.clone(), build non-cover text if strength < 1.0
    → preprocess_batch(): text_encoder(SFT_GEN_PROMPT with cover instruction) → text_hidden_states
    → model.prepare_condition(): tokenize→VQ→detokenize→torch.where swap → context_latents
    → generate_audio_core(): cover condition for steps 0→cover_steps, then switch to non-cover + KV reset
    → VAE decode → audio
```

**Pipeline refine path:**
```
pipeline_executor.py:run_pipeline() stage type="refine"
→ clean_latents = stage_latents[input_stage]  (CPU tensor from previous stage)
→ init_latents = model.renoise(clean_latents.to(device), t_start=stage.denoise)
→ dit_handler.service_generate(init_latents=init_latents, t_start=stage.denoise)
  → generate_audio_core(): TimestepScheduler.truncate(schedule, t_start), start from init_latents not noise
```

**Pipeline audio-stage path (extract/lego/complete):**
```
pipeline_executor.py:run_pipeline() stage type in AUDIO_STAGE_TYPES
→ resolve_src_audio(stage, dit_handler, stage_latents)
  → if src_audio_id: audio_store.get_path() → process_src_audio() → [2, frames]
  → if src_stage: stage_latents[src_stage] → tiled_decode() → [2, frames]
→ target_wavs = src_audio.unsqueeze(0).expand(batch_size, ...)
→ instruction = build_stage_instruction(stage)  # e.g. "Extract the VOCALS track from the audio:"
→ dit_handler.service_generate(target_wavs=..., instructions=[instruction])
  → _prepare_batch(): is_cover=False (instruction doesn't match cover substring)
  → src_latents = target_latents.clone() (full fidelity, no VQ)
  → model.prepare_condition(): torch.where skips VQ → src_latents unchanged in context_latents
```
