# ACE-Step 1.5 Web UI - Project Index

> **Start here.** This file is the top-level map of the web UI project.
> Detailed docs are split into topic files under `web/`.

---

## Quick Start

```bash
# Backend (from project root)
.venv/bin/python web/backend/run.py    # port 8000

# Frontend (from web/frontend/)
npm run dev                            # port 3000

# Clean frontend cache if stale chunks
rm -rf web/frontend/.next && cd web/frontend && npm run dev
```

---

## Documentation Map

| File | What's in it |
|------|-------------|
| **`web/PLAN.md`** | Master reference: architecture, full file map, gotchas, API reference, pipeline design spec, Python API quick reference, GPU tiers |
| **`web/HANDOFF.md`** | Original architecture decisions, file inventory with line counts, design decisions (task queue, tensor storage, audio lifecycle) |
| **This file** | Feature summary, what's done/in-progress/todo, implementation notes |

---

## Features Implemented

### Pipeline Builder (Multi-Stage Generation) ✅
Build custom diffusion pipelines with 7 stage types, each with independent model/params. Latent chaining, preview at any stage, built-in + user presets.
- **Stage types:** Generate, Refine, Cover, Repaint, Extract, Lego, Complete
- **Audio-requiring stages** (cover/repaint/extract/lego/complete) accept source from file upload or previous stage output (on-demand VAE decode)
- Frontend: `PipelineMode.tsx`, `StageBlock.tsx`, `pipelineStore.ts`
- Backend: `pipeline_executor.py` (with `resolve_src_audio` + `build_stage_instruction` helpers), `schemas/pipeline.py`
- Core: `acestep/diffusion_core.py` (unified diffusion loop), `handler.py` (model swapping, `service_generate` with full task-type kwargs)

### Audio Metadata Embedding ✅
All generated FLAC/WAV/MP3 files embed full generation parameters for reproducibility.
- Backend: `services/audio_metadata.py`, `acestep/audio_utils.py`
- API: `GET /api/audio/metadata/{id}`, `POST /api/audio/upload-and-extract`

### Prompt Library ✅
Save/browse/reuse prompts with genre/mood/tag taxonomy. Persistent in `~/.acestep/prompts.json`.
- Frontend: `PromptLibrary.tsx`, `promptLibraryStore.ts`
- Backend: `services/prompt_library.py`, `routers/prompts.py`

### Import Song ✅
Upload previously generated FLAC/WAV, auto-populate all generation fields from embedded metadata.

### Audio Export ✅
Format selector (FLAC/WAV/MP3), MP3 quality settings, size estimates, metadata in all formats.

### Advanced Diffusion Controls ✅
Scheduler dropdown per stage, unclamped turbo steps, ODE/SDE sampler selection.

### Editable Slider Values ✅
Click any slider value to type custom numbers directly. `EditableNumber.tsx` component.

### Global Audio Player ✅ (Fixed)
Single player bar at bottom of screen with WaveSurfer.js waveform, transport controls, playlist panel.
- Frontend: `PlayerBar.tsx`, `playerStore.ts`, `AudioCard.tsx` (play + add-to-playlist buttons)
- User adds tracks to playlist explicitly via "Add to Playlist" button per card, or "Add All" per batch.

**What was broken & how it was fixed:**
- **Root cause:** PlayerBar returned `null` when no tracks existed. When user clicked play, the component mounted fresh and WaveSurfer async init raced with the track URL arriving. The container div didn't exist yet during init.
- **Fix 1: Always render PlayerBar.** Use CSS (`translateY(100%)` / always visible) instead of conditional `return null`. WaveSurfer pre-initializes on page load, ready before any play click.
- **Fix 2: Pending URL queue.** Added `pendingUrlRef` — if a track is requested before WaveSurfer finishes async init, the URL is queued and loaded as soon as init completes.
- **Fix 3: Removed `backend: 'WebAudio'`.** Default MediaElement backend is more reliable for streaming URLs.
- **Fix 4: Let WaveSurfer handle click-to-seek** via `interact: true` instead of a separate `onClick` handler that conflicted.

### AutoTextarea Fix ✅
ResizeObserver was saving bogus heights from layout reflows. Fixed to only track during `mousedown` (actual user drag). Clear corrupted values: `Object.keys(localStorage).filter(k => k.startsWith('textarea-height:')).forEach(k => localStorage.removeItem(k))`

---

## Core Python Files Modified

| File | Change |
|------|--------|
| `acestep/diffusion_core.py` | **NEW.** Unified diffusion loop replacing 6 model files' `generate_audio()` |
| `acestep/handler.py` | Imports `generate_audio_core`, model swapping, `init_latents`/`t_start` passthrough |
| `acestep/inference.py` | Added `init_latents`/`t_start` to `GenerationParams` |
| `acestep/audio_utils.py` | Metadata embedding in `AudioSaver.save_audio()` |

---

## TODO

### Next Up — Guidance & Control Features to Expose

These features exist in the Python backend but aren't fully exposed in the web UI:

**1. Show CoT Reasoning Output** ✅ DONE
- Backend returns `lm_metadata` in `extra_outputs` (inference.py line 698), router extracts it (generation.py line 137-139)
- Added `extra` field to `BatchEntry` type, captured in `page.tsx`, displayed in `ResultsPanel.tsx`
- Shows: AI-decided caption, BPM, key, duration, time sig, language, lyrics + time costs

**2. Scheduler Override in Pipeline Stages** ✅ VERIFIED
- Fully wired: StageBlock.tsx → PipelineStageConfig.scheduler → pipeline.py schema → pipeline_executor.py (line 161) → handler.py service_generate (line 2242, 2410-2411) → diffusion_core.py generate_audio_core (line 333, 357-366)
- Each pipeline stage CAN use a different timestep scheduler

**3. LM Codes Strength** ✅ WIRED
- Was dead code: frontend sent `lm_codes_strength` but backend never used it
- In Gradio, `audio_cover_strength` controls this: `cover_steps = int(num_steps * strength)` switches from LM-code conditioning to text-only after that many steps
- Fix: Added mapping in `generation.py` router — for text2music+thinking, `lm_codes_strength` overrides `audio_cover_strength`

**4. Contextual Tooltips** ✅ DONE
- New `components/common/Tooltip.tsx` — hover/click (?) icon with auto-repositioning popover
- New `lib/help-text.ts` — all help content strings organized by section (DiT, LM, Pipeline, LLM Assist)
- Tooltips added to: `AdvancedSettings.tsx` (all sliders + checkboxes), `StageBlock.tsx` (all params), `LLMAssist.tsx` (advanced panel)

**5. GPU-aware Limits & Warnings** (see `web/PLAN.md` item 4)

### Research Notes — What Lives Where

**Negative prompts:** Already fully wired for LLM (not diffusion). The `lmNegativePrompt` field in AdvancedSettings controls LLM code generation guidance. DiT CFG uses a learned `null_condition_emb` parameter, not text-based negatives — this is architecturally different from Stable Diffusion. No action needed.

**APG vs ADG:** Two guidance algorithms for base/SFT CFG models:
- APG (Adaptive Preference Guidance) — default, uses momentum buffer for smoother guidance
- ADG (Adaptive Dual Guidance) — alternative, uses latent-aware scaling with sigma
- Already exposed via `use_adg` checkbox in AdvancedSettings
- Code: `diffusion_core.py:563-578`

**Repetition Penalty:** Now exposed in LLMAssist's advanced panel. Python `create_sample()` accepts it at `inference.py:927`. Range 1.0-2.0.

**Cover Task — Style Transfer with Structure Preservation:**
- Source audio is VAE-encoded to 25Hz latents. Diffusion starts from pure noise (NOT img2img).
- Two condition sets: "cover" (cross-attention sees source structure) and "non-cover" (caption-only, source=silence).
- `audio_cover_strength` controls a temporal switch: `cover_steps = int(num_steps * strength)`.
  - Steps 0→cover_steps: source conditioning (locks in melody/harmony/rhythm).
  - Steps cover_steps→end: caption-only conditioning (applies new style/timbre).
  - 1.0 = max preservation, 0.2 = loose style transfer, 0.0 = ignore source entirely.
- Early diffusion steps build large-scale structure; late steps refine fine detail. So strength controls "same bones, new skin" vs "loose inspiration."
- Skip LM: source latents ARE the semantic anchor, codes not needed.
- Code path: `handler.py` `_prepare_batch` sets `is_covers=True` → `prepare_condition()` attends to src_latents → `diffusion_core.py:505` switches conditions at cover_steps.

**Repaint Task — Surgical Segment Replacement:**
- Source audio encoded, then a **chunk_mask** created: `False` = keep, `True` = regenerate.
- Source latents have the target region zeroed out (replaced with learned silence latent). Model sees context from both sides and fills the gap.
- Time range: `repainting_start`/`repainting_end` in seconds → converted to latent frame indices (48kHz / 1920 = 25Hz).
- Supports outpainting: if `repainting_end` > audio length, silence is padded and the model continues naturally.
- `chunk_mask` is spatial (which frames), vs cover's `cover_steps` which is temporal (which denoising steps).
- Skip LM: same reason as cover.
- Code path: `handler.py` `_prepare_batch` builds chunk mask → `preprocess_batch` applies it → model uses mask to freeze non-target frames.
- **No feathering/crossfade!** Mask is binary (hard cut at 40ms frame boundaries). Boundary coherence comes entirely from bidirectional attention — the DiT sees context on both sides and generates a fill that flows naturally. This is unlike image inpainting which uses alpha blending; here attention IS the blur. Code: `handler.py:1831-1833` (binary mask), `modeling_*.py:1648` (mask→feature channel concat).

**src_audio vs reference_audio:**
- `src_audio`: Audio to transform (cover) or edit (repaint). Gets VAE-encoded to latents, used as structural anchor.
- `reference_audio`: Style reference for cross-attention (timbre/texture). Can cover song A in style of song B.

**6. Pipeline Expansion — Cover/Repaint/Extract/Lego/Complete Stage Types** ✅ DONE
- Expanded pipeline builder from 2 stage types (generate, refine) to 7
- Backend: Added `resolve_src_audio()` (upload or VAE-decode previous stage), `build_stage_instruction()` (template substitution from `TASK_INSTRUCTIONS`), full stage-type routing in `pipeline_executor.py`
- Backend: Validation in `generation.py` — audio source required for 5 new types, base-only model enforcement, track_name required for extract/lego
- Frontend: `StageBlock.tsx` with conditional UI per type (audio source toggle, cover strength slider, repaint time range, track selector, complete track multi-select, model filtering for base-only)
- Frontend: `pipelineStore.ts` with `STAGE_DEFAULTS` map, 2 new presets ("Cover + Polish", "Gen + Extract Vocals"), `removeStage` fixes `src_stage` references
- Frontend: Pre-flight validation in `PipelineMode.tsx`
- Schema: `pipeline.py` + `types/index.ts` with `src_audio_id`, `src_stage`, `audio_cover_strength`, `repainting_start/end`, `track_name`, `complete_track_classes`
- Help text: All new tooltips in `help-text.ts`

**7. Per-Stage Caption/Lyrics Override (Gap 1)** ✅ DONE
- Optional `caption` and `lyrics` on `PipelineStageConfig` — per-stage override, falls back to shared
- Executor: `stage.caption or req.caption` per stage
- Frontend: collapsible per-stage caption/lyrics in `StageBlock.tsx`
- Unlocks Pattern H (iterative prompt refinement) and targeted instrument descriptions

**8. Performance & Safety Improvements** ✅ DONE
- `torch.inference_mode()` in `diffusion_core.py` and `pipeline_executor.py` (faster than `no_grad`)
- Cover safety fallback: audio stages with missing source → text2music + warning
- Device-agnostic `empty_cache()` guards in pipeline executor
- New Part VIII in `PIPELINE_FRAMEWORK.md` documenting applied + future optimizations

### Recent Session — GitHub & Infrastructure (Feb 2026)
- **GitHub setup:** Fork at `matlowai/sonaturgy`, private backup at `matlowai/web-audio`
- **Rebased** onto 35 new upstream commits (clean, zero conflicts)
- **README:** Added Sonaturgy header with beginner-friendly Quick Start
- **Critical fix:** `web/frontend/src/lib/` was gitignored by Python's `lib/` pattern — app was unrunnable for new clones
- **Model checker fix:** `check_model_exists()` now verifies weight files exist, not just directory presence (partial downloads were falsely passing)
- **Download progress bar:** Backend reports dir size vs HF repo total, frontend shows percentage bar
- **Dep upgrade:** Next.js 16, React 19, WaveSurfer 7.12, Zustand 5 — 0 npm vulnerabilities
- **Flash attention logging:** Now warns when flash_attn requested but package not installed (was silently falling back to SDPA)
- **`prefer_source`:** Wired through `swap_dit_model` to match upstream's download source routing

### Community Tips — CFG Guidance Settings
From user testing: SFT model (32-50 steps) benefits from **guidance_scale 3-5** (down from default 7) with **CFG interval 0.15–0.85**. This means ~30% of steps run unguided (first 15% + last 15%), adding diversity and less "dry" output. The LM already provides strong structural guidance, so lower CFG lets the diffusion add more texture and improvisation.

### Flash Attention Status
The UI toggle works correctly end-to-end, but `flash_attn` package must be installed separately (`pip install flash-attn`). Without it, the handler silently falls back to SDPA. Now logs a warning when this happens. The `swap_dit_model` path correctly preserves the attention implementation from initial config.

### Project Presets — Persist & Recall Full Configurations

**Problem:** Every time the user opens the app, they re-select DiT model, LLM model, flash
attention, offload settings, and advanced params (guidance scale, shift, CFG, etc.). Power
users switching between workflows (fast drafting vs quality production vs cover sessions)
have to manually reconfigure everything.

**Scope:** A "Project Preset" captures the full configuration state:

**Layer 1 — Service Config (left pane, `ServiceConfig.tsx`)**
Currently `useState` (ephemeral). Should persist + recall:
```
configPath         "acestep-v15-turbo"       DiT model
lmModelPath        "acestep-5Hz-lm-1.7B"     LLM model
device             "auto"                     Device
flashAttn          false                      Flash attention
offloadCpu         false                      CPU offload
offloadDit         false                      DiT-only offload
compileModel       false                      torch.compile
quantization       false                      int8 quantization
backend            "vllm"                     LLM backend
```

**Layer 2 — Generation Defaults (`generationStore.ts`)**
Already in Zustand but not persisted. Key fields to capture:
```
inferenceSteps     8            shift              1.0
guidanceScale      7.0          inferMethod        "ode"
thinking           true         lmTemperature      0.85
lmCfgScale         2.0          useCotMetas        true
audioCoverStrength 1.0          batchSize          2
cfgIntervalStart   0.0          cfgIntervalEnd     1.0
```

**Layer 3 — Pipeline Defaults (`pipelineStore.ts`)**
Already has user presets. Could optionally be bundled into project presets.

**Implementation approach:**

1. **Auto-save "last used"** — `localStorage` key `project-last-config`. On app load,
   `ServiceConfig.tsx` reads this and initializes `useState` from it. Generation store
   gets a `loadFromStorage()` action. This alone solves 80% of the annoyance.

2. **Named presets** — `localStorage` key `project-presets`. Same pattern as pipeline presets:
   `savePreset(name)` captures Layer 1 + Layer 2, `loadPreset(name)` restores both.

3. **Built-in presets (ship 3-4):**
   - **Fast Draft** — Turbo, no LLM, 8 steps, batch 4, shift 3
   - **Quality** — Base, 1.7B LLM, 50 steps, batch 1, thinking on, shift 2
   - **SFT + CFG** — SFT, 1.7B LLM, 50 steps, guidance 3-5, CFG interval 0.15-0.85
   - **Cover Session** — Turbo, no LLM, cover_strength 0.5, 8 steps

4. **UI:** Preset selector dropdown at top of sidebar (above DiT card), with save/delete.
   Loading a preset both restores settings AND optionally auto-initializes the selected
   models (with confirmation toast: "Load Base + 1.7B LLM?").

**Key files:** `ServiceConfig.tsx` (migrate `useState` → persist), `generationStore.ts`
(add `persist` middleware or manual load/save), new `projectPresetStore.ts` or extend
existing stores.

**Effort:** Medium. The "auto-save last used" is small (~30 lines). Named presets with
UI is a proper feature.

### Future Ideas
- [x] **DAW-style audio source viewer** ✅ — `AudioSourceViewer.tsx`: WaveSurfer.js waveform with scroll-wheel zoom, transport controls (⏮⏪◀▶⏸), progress bar, time display. Repaint: draggable red region overlay for visual mask selection. Phase C (minimap, beat grid, snap) still TODO
- [ ] Batch generation queue with progress
- [ ] A/B comparison tool
- [ ] Export presets to shareable JSON
- [ ] Genre-based prompt suggestions (LLM-powered)
- [ ] Training data curation from library
- [ ] Multi-language UI (infra exists, only English populated)
- [ ] Block-based workflow system with wrapper for custom nodes and smart/easy bindings
- [ ] Additional model backend integrations
