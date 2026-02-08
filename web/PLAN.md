# ACE-Step 1.5 Web UI — Master Reference & Plan

> **Purpose:** This is the single source of truth for the web UI project.
> Read this file at the start of every session after context clears.
> It contains: architecture, file map, what works, what's broken, what to build,
> gotchas, and all the domain knowledge needed to work on this project.

---

## Last Session Summary (2026-02-07)

**Completed this session (Phase 7a + bugfix):**
1. **Modal LLM Assist** — Refactored inline `LLMAssist` into a global modal overlay (`LLMAssistModal.tsx`) + Zustand store (`llmAssistStore.ts`). Singleton renders in `layout.tsx`. Any binding point calls `openAssist(label, callback)` to open, "Use" routes result to the caller's target. Old `LLMAssist.tsx` deleted.
2. **Universal Binding Points** — AI Assist trigger buttons on: CustomMode caption toolbar, PipelineMode Conditioning header, each StageBlock header. StageBlock binding splits: caption/lyrics → stage overrides, metadata → shared `setFieldsIfEmpty()`.
3. **Resume Latent Duration Fix** — Resume from latent crashed with `RuntimeError: Sizes of tensors must match` when request duration differed from stored latent. Fix: derive duration from `tensor.shape[1] / 25.0` and force-override `req.duration` in `routers/generation.py`.
4. **Files**: NEW `llmAssistStore.ts`, `LLMAssistModal.tsx`. DELETED `LLMAssist.tsx`. MODIFIED `layout.tsx`, `CustomMode.tsx`, `PipelineMode.tsx`, `StageBlock.tsx`, `routers/generation.py`.

**Next up (P0):** Restart backend to test resume fix. Then: DRY `<LMSettingsPanel>` + `<LLMPreviewPanel>` extraction (Phase 7 remaining), missing pipeline LM fields, per-stage checkpoint_step UI. Surface `result.success === false` errors to frontend toast.

**Previous (same branch, Phase 6):**
1. **Pipeline LM Settings** — Added thinking, lm_temperature, lm_cfg_scale, lm_top_k/p, negative prompt, CoT toggles, constrained decoding to Pipeline mode. Backend schema already had these fields; added frontend types, store state, UI section in PipelineMode.tsx, wired into request builder.
2. **Collapsible StageBlock** — Diffusion params grid collapsed by default with summary line ("8 steps, shift 3.0, ode"). Preview checkbox pulled out to always-visible.
3. **Backend Latent Endpoints** — `GET /latent/{id}/metadata` (shape, model, caption, timestamps) + `POST /latent/{id}/decode` (VAE decode → playable audio). Fixed shape transpose `[B,T,D]→[B,D,T]` and proper `_load_model_context("vae")`.
4. **Enhanced Resume Panel** — AdvancedSettings auto-opens when latent set, fetches+displays metadata grid, "Preview" button decodes and plays via global player.
5. **Play Latent on AudioCard** — Decode+play button next to latent badge on results.

**Previous (same branch, Phase 5):**
1. **Frontend Unification + Cross-Mode Actions** — Bidirectional Custom ↔ Pipeline flow.
   - `StageParams` shared type in `types/index.ts`, `PipelineStageConfig extends StageParams`
   - New `stageConversion.ts`: `customToStage()`, `stageToCustom()`, `paramsToStage()`, `mapParamsToFields()` (moved from useBatchNavigation)
   - GenerationPanel: "+ Pipeline" button (Custom → Pipeline stage)
   - StageBlock: "→ Custom" button (Pipeline stage → Custom mode)
   - AudioCard: "+ Pipeline" button (result → Pipeline stage, carries latent)
   - `pipelineStore`: `addStageFromConfig()`, `setFieldsIfEmpty()` actions
   - Files: `types/index.ts`, `stageConversion.ts` (NEW), `useBatchNavigation.ts`, `pipelineStore.ts`, `GenerationPanel.tsx`, `StageBlock.tsx`, `AudioCard.tsx`
2. **Resume API (Phase 3) + Step Checkpointing (Phase 4)** — implemented earlier on this branch

**Previous session:**
1. LLM Preview (Analysis-Only), Dynamic Slider Labels
2. Project Presets (auto-save + named presets), inference_mode benchmark, hydration fix, GPU testing
3. Per-Stage Caption/Lyrics Override, Cover Safety Fallback, Device-Agnostic Cache Cleanup
4. PIPELINE_FRAMEWORK.md (8 parts), Community Fork Analysis

**Earlier sessions:**
- Pipeline Expansion (7 Stage Types), AudioSourceViewer, Pipeline Builder Phases 0-4, LLM Assist,
  Layout fix, CoT Reasoning Display, Scheduler Override, LM Codes Strength wiring, Contextual
  Tooltips, Global Audio Player fix, LLM Sampler Settings, Audio Metadata Embedding, Prompt Library,
  Import Song, Export, Advanced Controls, Editable Sliders, AutoTextarea fix

**Dev servers:**
- Backend: `.venv/bin/python web/backend/run.py` (port 8000)
- Frontend: `cd web/frontend && npm run dev` (port 3000)
- If frontend shows stale chunks: `rm -rf web/frontend/.next && npm run dev`

**Next up (P0):** Custom↔Pipeline component DRY (see audit below), then GPU-aware limits
**GPU test needed:** LLM Preview, per-stage caption/lyrics, extract/lego/complete, Resume API, Step Checkpointing, Latent decode

---

## Feature Parity Audit: Custom vs Pipeline

### The Problem

Custom mode (CustomMode + AdvancedSettings) and Pipeline mode (PipelineMode + StageBlock) are two views over mostly the same backend capabilities, but they were built independently. They should expose the **same features** — just with different things pre-expanded (Custom = single-stage detail view; Pipeline = multi-stage overview with collapsed details). Currently they have significant feature gaps.

### What Custom has that Pipeline is missing

| Feature | Custom Location | Pipeline Status | Fix |
|---------|----------------|-----------------|-----|
| **LLM Preview** button | CustomMode.tsx (line 92-130, 248-374) | **MISSING** — no "Preview LLM" button in pipeline conditioning | Extract `<LLMPreviewPanel>` component |
| **LM Batch Chunk Size** slider | AdvancedSettings line 316 | **MISSING** — not in pipelineStore or PipelineMode LM section | Add to pipelineStore + PipelineMode LM section + request |
| **LM Codes Strength** slider | AdvancedSettings line 323 | **MISSING** — not in backend PipelineRequest schema either | Add to backend schema + pipelineStore + UI |
| **Constrained Decoding Debug** checkbox | AdvancedSettings line 341 | **MISSING** — not in pipeline | Add to pipelineStore + PipelineMode |
| **Allow LM Batch** checkbox | AdvancedSettings line 342 | **MISSING** — not in pipeline | Add to pipelineStore + PipelineMode |
| **Auto Score / Auto LRC** checkboxes | AdvancedSettings lines 343-344 | **MISSING** — pipeline results don't auto-score | Decide if pipeline needs these (probably yes) |
| **Score Sensitivity** slider | AdvancedSettings line 358 | **MISSING** | Add if auto-score added |
| **Random Seed** checkbox | AdvancedSettings line 179 | **MISSING** — pipeline stages only have seed field | Add as pipeline-level option |
| **Audio Format / Custom Timesteps** | AdvancedSettings lines 202-221 | **Partial** — audio format is in PipelineMode, custom timesteps is per-stage `timesteps` field but no UI |  |
| **Checkpoint Step** | AdvancedSettings line 224 | **MISSING** — per-stage on schema but no UI in StageBlock | Add to StageBlock diffusion params |
| **Resume from Latent** panel | AdvancedSettings lines 72-131 | **N/A** — Pipeline doesn't have resume concept (stages chain latents internally) | Skip |
| **Reference Audio** upload | CustomMode line 481-486 | **N/A** — Pipeline stages have per-stage src_audio | Different pattern, OK |
| **Format Caption** button | CustomMode line 260 | **MISSING** — no format button in pipeline | Extract shared or add |
| **Random Example** button | CustomMode line 259 | **MISSING** | Add or share |

### What Pipeline has that Custom is missing

| Feature | Pipeline Location | Custom Status | Notes |
|---------|------------------|---------------|-------|
| **Multi-stage orchestration** | StageBlock pipeline | N/A | Core pipeline-only feature |
| **Per-stage model selection** | StageBlock line 176 | N/A | Custom uses service-level model |
| **Per-stage caption/lyrics** | StageBlock line 188-237 | N/A | Custom has single set |
| **Presets** (built-in + user) | PipelineMode lines 513-618 | Done in ServiceConfig | Different preset systems, OK |

### Bugs & Issues Found in Review

1. **Latent decode 500** — Fixed: stored latents are `[B,T,D]`, need `.transpose(1,2)` for VAE which expects `[B,D,T]`. Also needed `_load_model_context("vae")` and `vae.dtype` instead of `dit.dtype`.
2. **Pipeline LM fields partial** — We added the core 10 fields but missed: `lm_batch_chunk_size`, `lm_codes_strength`, `constrained_decoding_debug`, `allow_lm_batch`. Backend schema also doesn't have all of these.
3. **`unit` variable unused** — PipelineMode line 334: `let unit = 'MB'` declared but never used (size calculation inlines the unit). Harmless but messy.

### DRY Strategy: Shared Components

The right approach is **shared atomic components** that both modes compose, NOT wrapping everything in one mega-component with mode flags. Each shared component takes a `value`/`onChange` interface and is store-agnostic.

**Phase 7 plan — Extract shared components:**

1. **`<LMSettingsPanel>`** — Extracted from AdvancedSettings LM section
   - Props: `{ values: LMSettings, onChange: (field, value) => void, expanded?: boolean }`
   - `LMSettings` type: `{ thinking, lmTemperature, lmCfgScale, lmTopK, lmTopP, lmNegativePrompt, useCotMetas, useCotCaption, useCotLanguage, useConstrainedDecoding, constrainedDecodingDebug?, allowLmBatch?, lmBatchChunkSize?, lmCodesStrength? }`
   - Used by: AdvancedSettings (reads from generationStore), PipelineMode (reads from pipelineStore)
   - Both modes get identical UI, different data sources

2. **`<LLMPreviewPanel>`** — Extracted from CustomMode lines 92-374
   - Props: `{ caption, lyrics, instrumental, vocalLanguage, bpm, keyscale, timesignature, duration, lmSettings: LMSettings, onApplyMetadata: (meta) => void }`
   - Self-contained: manages its own loading/result/expand state
   - Used by: CustomMode (passes generationStore values), PipelineMode (passes pipelineStore values)
   - Both modes get "Preview LLM" button + result panel

3. **`<ConditioningGrid>`** — Extracted from both modes' metadata grid
   - Props: `{ language, duration, bpm, keyscale, timesignature, batchSize, instrumental, onChange }`
   - Currently duplicated between CustomMode and PipelineMode with slightly different layouts
   - Low priority — layouts differ enough that extraction may not save much

4. **Per-stage `checkpoint_step` UI** — Add to StageBlock collapsible diffusion params
   - Simple number input, same as AdvancedSettings but per-stage
   - Backend schema already has the field, just no frontend UI

**Implementation order:**
1. `<LMSettingsPanel>` — Biggest DRY win, most duplicated code
2. `<LLMPreviewPanel>` — Important feature gap (pipeline has no LLM preview)
3. Add missing pipelineStore fields (`lmBatchChunkSize`, `lmCodesStrength`, `constrainedDecodingDebug`, `allowLmBatch`)
4. Add missing backend PipelineRequest fields to match
5. StageBlock checkpoint_step UI

**Files modified in `acestep/` (core Python — NOT just web/):**
- `acestep/diffusion_core.py` — NEW (579 lines), uses `torch.no_grad()` (benchmarked `inference_mode` — no speed gain, kept `no_grad` for training compatibility)
- `acestep/handler.py` — MODIFIED (+26 lines: import, model_variant, generate_audio_core call, init_latents/t_start)
- `acestep/inference.py` — MODIFIED (+6 lines: init_latents/t_start in GenerationParams)
- `acestep/llm_inference.py` — MODIFIED (+5 lines: initialized `cot_output_text`, exposed `thinking_text` in `extra_outputs` for `dit` mode return)

---

## Architecture Overview

```
Browser (port 3000)          Backend (port 8000)           ACE-Step Core
┌─────────────────┐   HTTP   ┌──────────────────┐         ┌──────────────┐
│  Next.js 16     │ ──────→  │  FastAPI          │ ──────→ │ handler.py   │
│  React + Zustand│   /api/* │  Routers + Schemas│         │ inference.py │
│  Tailwind CSS   │          │  TaskManager      │         │ llm_inference│
└────────┬────────┘          └────────┬─────────┘         │ gpu_config   │
         │                            │                    │ model_dl     │
         │  WebSocket                 │  ThreadPool        └──────────────┘
         └──── ws://host:8000/api/ws ─┘  (1 GPU worker)
```

- **Next.js rewrites** `/api/*` → `http://localhost:8000/api/*` (HTTP only, NOT WebSocket)
- **WebSocket** connects directly to port 8000 (bypasses Next.js proxy)
- **Polling fallback** at 1.5s for progress when WS unavailable
- **Python package manager:** `uv` (NOT pip) — see `pyproject.toml` + `uv.lock`
- **Project root:** `/BigU/AI/music/ACE-Step-1.5`

---

## How to Start

```bash
# Backend (from project root)
cd /BigU/AI/music/ACE-Step-1.5
.venv/bin/python web/backend/run.py

# Frontend (from frontend dir)
cd /BigU/AI/music/ACE-Step-1.5/web/frontend
npm run dev

# If frontend shows 404s on chunks, clean cache:
rm -rf .next && npm run dev
```

---

## File Map

### ACE-Step Core Modifications (2 modified, 1 new)

| File | Lines | Purpose |
|------|-------|---------|
| `acestep/diffusion_core.py` | ~576 | **NEW.** Unified diffusion loop replacing per-model `generate_audio()`. `VariantConfig`, `MODEL_VARIANT_CONFIGS` (6 variants), `TimestepScheduler` (4 strategies + `truncate()`), `generate_audio_core()` with CFG/APG/ADG |
| `acestep/handler.py` | +26 | Imports `generate_audio_core`, stores `self.model_variant`, replaces `model.generate_audio()` call, threads `init_latents`/`t_start` through `generate_music()` and `service_generate()` |
| `acestep/inference.py` | +6 | Added `init_latents` + `t_start` to `GenerationParams`, threaded to `dit_handler.generate_music()` |

### Backend (26 files, ~2,300 lines)

| File | Lines | Purpose |
|------|-------|---------|
| `backend/app.py` | 57 | FastAPI app, lifespan, router mounts, CORS |
| `backend/run.py` | 26 | Uvicorn entry point (port 8000) |
| `backend/config.py` | 13 | PROJECT_ROOT resolution |
| `backend/dependencies.py` | 31 | Singleton DI for dit_handler, llm_handler |
| **Routers** | | |
| `routers/service.py` | 116 | `/initialize`, `/initialize-llm`, `/status`, `/gpu-config` |
| `routers/models.py` | ~240 | `/dit`, `/lm`, `/info`, `/download-status`, `/download/{name}`, `/download-main`, `/checkpoints` |
| `routers/generation.py` | ~450 | `/generate`, `/task/{id}`, `/create-sample`, `/format`, `/understand`, **`/analyze`** (LLM Phase 1 preview), **`/pipeline`** (validates 7 stage types, audio source, model constraints) |
| `routers/audio.py` | 156 | `/upload`, `/files/{id}`, `/convert-to-codes`, `/score`, `/lrc`, `/download-all` |
| `routers/training.py` | 207 | `/dataset/*`, `/start`, `/stop`, `/status`, `/preprocess`, `/export` |
| `routers/lora.py` | 44 | `/load`, `/unload`, `/enable`, `/scale`, `/status` |
| `routers/ws.py` | 39 | WebSocket endpoint, subscribe to task updates |
| `routers/examples.py` | 57 | `/random` — random example for simple/custom mode |
| **Schemas** | | |
| `schemas/common.py` | 15 | `ApiResponse` wrapper |
| `schemas/service.py` | 39 | `InitializeRequest`, `ServiceStatus`, `GPUConfigResponse` |
| `schemas/generation.py` | ~185 | `GenerateRequest`, `TaskStatusResponse`, `CreateSampleRequest/Response`, `AnalyzeRequest/Response`, etc. |
| `schemas/audio.py` | 47 | `ScoreRequest/Response`, `LRCRequest/Response` |
| `schemas/training.py` | 73 | `ScanDatasetRequest`, `TrainingRequest`, `ExportLoRARequest`, etc. |
| `schemas/pipeline.py` | 83 | **NEW.** `PipelineStageConfig` (7 stage types, audio source fields, cover/repaint/track params), `PipelineRequest` |
| `schemas/lora.py` | 24 | `LoRAStatus`, load/enable requests |
| **Services** | | |
| `services/task_manager.py` | 142 | GPU task queue, WebSocket broadcast, progress tracking |
| `services/audio_store.py` | 104 | Temp file storage for uploads + generated audio |
| `services/pipeline_executor.py` | ~356 | **NEW.** `run_pipeline()` — multi-stage latent chaining with 7 stage types. `resolve_src_audio()` (upload or VAE-decode previous stage), `build_stage_instruction()` (template substitution). Routes cover/repaint/extract/lego/complete with per-type kwargs |

### Frontend (34 files, ~4,800 lines)

| File | Lines | Purpose |
|------|-------|---------|
| **App** | | |
| `app/layout.tsx` | 25 | Root layout (`h-screen flex flex-col overflow-hidden`), sidebar, header, toast |
| `app/page.tsx` | ~140 | Home page — WebSocket + polling + result handling (incl. pipeline results) |
| `app/training/page.tsx` | 22 | Training page |
| **Components — Common** | | |
| `components/common/AutoTextarea.tsx` | 104 | Auto-expanding textarea with localStorage persistence |
| `components/common/AudioUpload.tsx` | 69 | File upload with preview |
| `components/common/AudioSourceViewer.tsx` | ~245 | **NEW.** WaveSurfer.js waveform viewer for source audio. Scroll-wheel zoom, transport controls (⏮⏪◀▶⏸), progress bar, time display. Repaint mode: draggable region overlay via Regions plugin, bidirectional sync with start/end fields |
| `components/common/Spinner.tsx` | 9 | Loading spinner |
| `components/common/Toast.tsx` | 21 | Toast notifications |
| `components/common/LLMAssist.tsx` | ~155 | **NEW.** Reusable AI Assist panel: query → LLM creates caption/lyrics/metadata → "Use This" applies to parent mode |
| **Components — Generation** | | |
| `components/generation/GenerationPanel.tsx` | ~87 | Mode tabs (Simple/Custom/Pipeline) + generate button + AutoGen |
| `components/generation/SimpleMode.tsx` | 173 | LLM-assisted: query → editable caption/lyrics |
| `components/generation/CustomMode.tsx` | ~560 | Full manual control: all params, task types, LLMAssist, **LLM Preview** (analyze-only button + result panel with Apply), **dynamic slider labels** (cover strength vs similarity/denoise) |
| `components/generation/PipelineMode.tsx` | ~210 | **NEW.** Pipeline builder: LLMAssist, conditioning, stage list, presets (built-in + user save/load/delete), Run Pipeline |
| `components/generation/StageBlock.tsx` | ~469 | **NEW.** Per-stage card: 7-option type selector, conditional UI per type (audio source toggle, cover strength, repaint range, track selector, complete multi-select), model filtering for base-only types |
| `components/generation/AdvancedSettings.tsx` | 249 | DiT + LM hyperparameters |
| **Components — Results** | | |
| `components/results/ResultsPanel.tsx` | 115 | Batch navigation, progress, download all |
| `components/results/AudioCard.tsx` | 148 | Per-audio: player, score, LRC, codes |
| `components/results/AudioPlayer.tsx` | 92 | HTML5 audio player |
| **Components — Service** | | |
| `components/service/ServiceConfig.tsx` | ~530 | DiT + LLM cards, model selection, launch buttons, download buttons |
| `components/service/LoRAPanel.tsx` | 108 | LoRA load/unload/enable/scale |
| **Components — Training** | | |
| `components/training/DatasetBuilder.tsx` | 218 | Scan, label, edit, save, preprocess |
| `components/training/TrainingForm.tsx` | 155 | LoRA training config + start/stop |
| `components/training/TrainingProgress.tsx` | 92 | Live loss plot + progress |
| **Hooks** | | |
| `hooks/useGeneration.ts` | 168 | generate(), createSample(), formatCaption() |
| `hooks/useService.ts` | 75 | initialize(), fetchModels(), fetchStatus() |
| `hooks/useWebSocket.ts` | 37 | WS connection + subscribe |
| `hooks/useBatchNavigation.ts` | 61 | prev/next batch |
| **Lib** | | |
| `lib/api.ts` | ~300 | All API calls incl. downloadModel/downloadMainModel, `runPipeline()`, `analyzeLLM()` |
| `lib/ws.ts` | 74 | WSClient class (connects to port 8000 directly) |
| `lib/types/index.ts` | ~350 | All TypeScript interfaces + `AnalyzeRequest/Response`, `PipelineStageType` union (7 types), `PipelineStageConfig` (with audio source, cover/repaint/track fields), `PipelineRequest`, `PipelineStageResult`, `PipelineResult` |
| `lib/constants.ts` | 47 | Languages, task types, instructions, etc. |
| `lib/i18n/index.ts` | 28 | i18n helper (en only currently) |
| **Stores (Zustand)** | | |
| `stores/generationStore.ts` | 150 | All generation params + simple/custom/pipeline mode state |
| `stores/pipelineStore.ts` | ~290 | **NEW.** Pipeline stages, shared conditioning, 5 built-in presets (incl. Cover+Polish, Gen+Extract Vocals), `STAGE_DEFAULTS` map for all 7 types, user preset save/load/delete via localStorage, stage CRUD with src_stage reference fixing |
| `stores/resultsStore.ts` | 66 | Batches, progress, scores, LRCs |
| `stores/serviceStore.ts` | ~67 | Status, models, GPU config, model info, download status, downloadingModels |
| `stores/uiStore.ts` | 38 | Theme, language, toasts, sidebar |

### Config Files
| File | Purpose |
|------|---------|
| `frontend/next.config.js` | Rewrites + webpack cache=false in dev |
| `frontend/package.json` | Deps: next, react, zustand, tailwindcss |
| `frontend/tailwind.config.ts` | Tailwind theme config |
| `frontend/tsconfig.json` | TypeScript config with `@/` path alias |

---

## Key Gotchas

### 1. WebSocket MUST bypass Next.js
Next.js `rewrites` only handles HTTP, NOT WebSocket upgrades.
`ws.ts` connects to `ws://hostname:8000/api/ws` directly.
If WS fails silently, the polling fallback in `page.tsx` catches it.

### 2. Model directory ≠ usable model
The 4B LM has a directory with config.json but NO weight files (.safetensors).
`_has_weights()` in `models.py` checks for actual `.safetensors/.bin/.pt` files.
Never trust directory existence alone.

### 3. handler.py attribute gotchas
- `dit.model is not None` (not `dit.service_initialized` — doesn't exist)
- `dit.config` is an `AceStepConfig` object, not a dict — use `getattr()`
- `getattr(llm, "llm_initialized", False)` for LLM status
- Quantization value: frontend sends `'int8_weight_only'` (not `'int8'`)

### 4. LLM checkpoint path
`llm.initialize(checkpoint_dir=...)` needs the `checkpoints/` directory,
NOT the project root. Fixed in `service.py`:
```python
checkpoints_dir = os.path.join(project_root, "checkpoints")
```

### 5. vllm process group conflict
When DiT initializes `torch.distributed`, vllm can't reinitialize.
Falls back to PyTorch backend automatically in `llm_inference.py`.

### 6. Progress callback signature
`generate_music` calls `progress(progress_val, desc="", **kwargs)`.
NOT `progress(progress_val, msg="")`. Fixed in `generation.py`.

### 7. Dev server chunk 404s
Next.js dev server can serve stale chunks after code changes.
Fix: `rm -rf .next && npm run dev`. The `config.cache = false` in
`next.config.js` helps but doesn't fully prevent it after config changes.

### 8. Training router was completely wrong
Nearly every method call in the original `training.py` had wrong class names,
method names, or parameters. All were fixed to match actual `acestep/training/` API.
Key fixes: `scan_directory(dir)` not `(dir, extensions)`, `label_all_samples()` not
`auto_label()`, `LoRAConfig(r=...)` not `(rank=...)`, etc.

### 9. Audio score/LRC endpoint signatures
`pred_latents` → `pred_latent`, `lyric_token_idss` → `lyric_token_ids`.
Score endpoint needs batch indexing: `pred_latents[idx:idx+1]`.

### 10. Task manager thread safety
`_broadcast_sync` stores a reference to the main event loop via `set_event_loop()`.
Cannot use `asyncio.get_event_loop()` from a thread — it returns a new loop.
Fixed in `app.py` lifespan: `task_manager.set_event_loop(asyncio.get_running_loop())`.

### 11. Model download routing: main vs sub-models
Models in `SUBMODEL_REGISTRY` (LM 0.6B/4B, DiT shift1/shift3/continuous/sft/base)
use `POST /models/download/{name}` → `download_submodel()`.
Models from the main repo (turbo, 1.7B LM, VAE, text_encoder) use
`POST /models/download-main` → `download_main_model()`.
Frontend `MAIN_MODEL_COMPONENTS` set determines routing. The `__main__` key tracks
main model download state in `_download_state` dict.

### 12. Latent pipeline — NOW FULLY EXPOSED ✅
`extra_outputs["pred_latents"]` gives access to final denoised latents (CPU tensor).
`extra_outputs["src_latents"]` and `extra_outputs["chunk_masks"]` also available.
**NOW IMPLEMENTED:** `init_latents` and `t_start` are threaded through the full stack:
`inference.py` `GenerationParams` → `handler.py` `generate_music()` / `service_generate()` →
`diffusion_core.py` `generate_audio_core()`. `TimestepScheduler.truncate()` handles schedule
slicing for partial denoising. Pipeline executor in `pipeline_executor.py` uses
`model.renoise(clean_latents, t_start)` to add noise before refine stages.

---

## Current State (What Works)

- [x] Separate DiT / LLM launch buttons with independent init
- [x] Model selection with descriptions, download badges, comparison modals
- [x] **Model download from UI** — download buttons in sidebar, background threads, polling completion
- [x] GPU info display from `/gpu-config`
- [x] Simple Mode: query → LLM generates editable caption/lyrics/metadata
- [x] Custom Mode: all params, all task types, audio uploads
- [x] Auto-expanding persistent textareas (`AutoTextarea` component)
- [x] Advanced settings: DiT params, LM params, CoT toggles
- [x] WebSocket + polling progress tracking
- [x] Audio playback, batch navigation, score/LRC buttons, download all
- [x] Training: dataset builder, LoRA training, export
- [x] LoRA: load/unload/enable/scale
- [x] Console.error logging for API errors
- [x] Dynamic model scanning (backend reads actual weight files on disk)
- [x] **Pipeline Builder (backend)** — `diffusion_core.py` unified diffusion loop, `init_latents`/`t_start` passthrough, `POST /api/generation/pipeline` endpoint, `pipeline_executor.py` multi-stage orchestrator, frontend types + API call
- [x] **Pipeline Builder (frontend)** — `PipelineMode.tsx`, `StageBlock.tsx`, `pipelineStore.ts`, Pipeline tab in GenerationPanel, 5 built-in presets, user preset save/load/delete (localStorage), pipeline result handling in `page.tsx`
- [x] **Pipeline Expansion: 7 Stage Types** — cover (restyle audio), repaint (edit time region), extract (isolate track), lego (add track), complete (add accompaniment). Audio source from upload or previous stage output. `resolve_src_audio()` with on-demand VAE decode, `build_stage_instruction()` with template substitution, frontend conditional UI per type, pre-flight + backend validation
- [x] **AI Assist in Custom + Pipeline modes** — `LLMAssist.tsx` reusable component: query → LLM generates caption/lyrics/metadata → "Use This" populates fields
- [x] **Layout fix** — `h-screen flex flex-col overflow-hidden` + `min-h-0` on flex children prevents height oscillation

---

## TODO Checklist (Priority Order)

### P0 — Critical

#### [x] 1. Model Download from UI ✅ DONE
**Implemented.** Backend: `POST /download/{model_name}` + `POST /download-main` endpoints
with `_download_state` tracking dict, background threads. Frontend: `DownloadButton` component
in `ServiceConfig.tsx`, polls `/download-status` every 5s, toast notifications, auto-refresh.
Files changed: `routers/models.py`, `api.ts`, `serviceStore.ts`, `ServiceConfig.tsx`.

**Feb 2026 updates:**
- **Progress bar:** `/download-status` now returns `current_bytes`/`total_bytes`/`progress` for active downloads via `_get_dir_size()` + HF `repo_info(files_metadata=True)`. Frontend shows percentage bar.
- **Model existence check fix:** `check_model_exists()` in `model_downloader.py` now uses `_has_weight_files()` to verify `.safetensors`/`.bin`/`.pt` files exist, not just directory presence. Partial downloads (metadata without weights) no longer falsely pass.

---

#### [ ] Flash Attention / Attention Implementation Visibility — TODO
**Status:** The flash attention toggle works correctly end-to-end (UI → schema → handler → `AutoModel.from_pretrained`). Fallback chain: `flash_attention_2 → sdpa → eager`. Warning logged when `flash_attn` package not installed.

**What needs doing:**
- [ ] Expose `attn_implementation` in `/api/service/status` response so UI can display what's actually in use (currently only visible in server logs)
- [ ] Show active attention impl in ServiceConfig panel (e.g. badge: "FA2" / "SDPA" / "Eager")
- [ ] Consider adding flash_attn install status to a system info / diagnostics endpoint

**Code path:** `ServiceConfig.tsx` (flashAttn toggle) → `schemas/service.py` (use_flash_attention bool) → `routers/service.py` (passthrough) → `handler.py:393-401` (availability check + fallback) → `handler.py:403-422` (load with fallback chain) → `handler.py:585` (swap_dit_model preserves impl from config)

**Community note:** Users without `flash_attn` installed see SDPA silently used. The warning log (`pip install flash-attn`) now makes this visible in terminal but not in the UI yet.

---

#### [ ] CFG Guidance Tuning Notes — TODO
**Community finding:** SFT model (32-50 steps) benefits from **guidance_scale 3-5** (down from default 7) with **CFG interval start=0.15, end=0.85**. This means ~30% of steps run unguided, adding diversity/texture. The LM already provides strong structural backbone, so lower CFG lets diffusion add more improvisation.

**What needs doing:**
- [ ] Consider updating default guidance_scale for SFT/base models (currently 7 for all)
- [ ] Expose CFG interval (start/end) in AdvancedSettings if not already there
- [ ] Add presets or per-model-type default recommendations in the UI

---

#### [x] 2. Pipeline Builder (Multi-Stage Latent Refinement) ✅ DONE (Phases 0-4)
**Problem:** Users want ComfyUI-style multi-model workflows (e.g. Base 50-step → Turbo 8-step
refine at denoise=0.6) but with a streamlined linear interface. Inspired by a ComfyUI workflow
using `ace_1_5_base` (50 steps, denoise=1.0) → `acestep_v1.5_turbo` (8 steps, denoise=0.6,
sampler=jkass_quality) with shared conditioning and shift=3 on both.

**See full design spec:** [Pipeline Builder Design Spec](#pipeline-builder-design-spec) below.

**Phase 0: diffusion_core.py** ✅ DONE
New file `acestep/diffusion_core.py` (~576 lines):
- `VariantConfig` dataclass + `MODEL_VARIANT_CONFIGS` for all 6 variants
- `TimestepScheduler` with 4 strategies (linear, discrete, continuous, custom) + `truncate()` for pipeline
- `generate_audio_core()` — unified diffusion loop with CFG/APG/ADG guidance
- Lazy-loads `apg_guidance.py` from checkpoint dir (no checkpoint file modifications)

Modified `acestep/handler.py` (3 edits):
- Import `generate_audio_core`
- Store `self.model_variant = config_path` during `initialize_service()`
- Replace `self.model.generate_audio(**kwargs)` → `generate_audio_core(self.model, variant=self.model_variant, **kwargs)`

**Phase 1: Latent passthrough** ✅ DONE
Modified `acestep/handler.py`:
- Added `init_latents` + `t_start` params to `service_generate()` and `generate_music()`
- Threaded through to `generate_audio_core()` call

Modified `acestep/inference.py`:
- Added `init_latents` (Any) + `t_start` (float, default 1.0) to `GenerationParams` dataclass
- Threaded through `generate_music()` → `dit_handler.generate_music()`

**Phase 2: Backend pipeline endpoint** ✅ DONE
New file `web/backend/schemas/pipeline.py`:
- `PipelineStageConfig` — per-stage diffusion params (type, steps, shift, denoise, seed, preview)
- `PipelineRequest` — shared conditioning + list of stages

New file `web/backend/services/pipeline_executor.py`:
- `run_pipeline()` — orchestrates multi-stage diffusion with latent chaining
- Re-noises clean latents via `model.renoise()` for refine stages
- VAE-decodes final + preview stages, saves audio via `audio_store`
- Per-stage progress broadcasting via `task_manager`

Modified `web/backend/routers/generation.py`:
- Added `POST /api/generation/pipeline` endpoint with stage graph validation

Modified `web/frontend/src/lib/api.ts`:
- Added `runPipeline()` API call

Modified `web/frontend/src/lib/types/index.ts`:
- Added `PipelineStageConfig`, `PipelineRequest`, `PipelineStageResult`, `PipelineResult` types

**Phase 3: Frontend pipeline builder** ✅ DONE
New files: `stores/pipelineStore.ts`, `components/generation/StageBlock.tsx`, `components/generation/PipelineMode.tsx`.
Modified: `stores/generationStore.ts` (added `'pipeline'` mode), `components/generation/GenerationPanel.tsx`
(Pipeline tab), `app/page.tsx` (pipeline result handling).
3 built-in presets shipped: Generate→Refine, High-Step→Polish, 3-Stage Quality.

**Phase 4: User presets + polish** ✅ DONE
Updated `stores/pipelineStore.ts`:
- `userPresets` state loaded from localStorage on init
- `savePreset(name)` — saves current stages to localStorage (replaces if name exists)
- `deletePreset(name)` — removes from localStorage
- `loadUserPresets()` / `persistUserPresets()` helpers with SSR safety

Updated `components/generation/PipelineMode.tsx`:
- Separate "Saved" section showing user presets with delete (×) buttons
- "Save Current as Preset" button with inline name input (Enter to save, Esc to cancel)
- Toast notification on save

**Future:** Per-stage model selection (requires backend model swapping in pipeline_executor.py)

**Checkpoint files: UNTOUCHED** (gitignored, downloaded from HuggingFace)

---

#### [x] 3. Contextual Help / Tooltips ✅ DONE
**Problem:** Users don't know what parameters do or how to write good captions/lyrics.

**Implementation approach:**
- Create `components/common/Tooltip.tsx` — hover/click `(?)` icon shows popover
- Create `lib/help-text.ts` — all help content strings, organized by section
- Add tooltips next to every label in: SimpleMode, CustomMode, AdvancedSettings, ServiceConfig

**Content to include (from `docs/en/Tutorial.md`):**

**Caption writing:**
- Be specific > vague: "sad piano ballad with female breathy vocal" > "sad song"
- Dimensions: style/genre, emotion, instruments, timbre texture, era, production style, vocal characteristics, speed/rhythm
- Don't put BPM/key in caption — use the dedicated metadata fields
- Avoid conflicting styles

**Lyrics structure tags:**
- Structure: `[Intro]`, `[Verse]`, `[Pre-Chorus]`, `[Chorus]`, `[Bridge]`, `[Outro]`
- Dynamic: `[Build]`, `[Drop]`, `[Breakdown]`
- Vocal: `[raspy vocal]`, `[whispered]`, `[falsetto]`, `[powerful belting]`, `[spoken word]`, `[harmonies]`, `[ad-lib]`
- Energy: `[high energy]`, `[low energy]`, `[building energy]`, `[explosive]`, `[melancholic]`, `[euphoric]`, `[dreamy]`
- Instrumental: `[Instrumental]`, `[Guitar Solo]`, `[Piano Interlude]`, `[Fade Out]`, `[Silence]`
- Combine with dash: `[Chorus - anthemic]`

**Lyrics tips:**
- 6-10 syllables per line ideal
- UPPERCASE = stronger vocal intensity
- (parentheses) = background vocals
- Blank lines between sections
- Keep caption and lyrics consistent

**Parameter explanations:**
- `inference_steps`: Turbo rec. 8, Base rec. 32-64. More = finer but slower
- `guidance_scale`: CFG strength 1-15 (base model only). Higher = more adherence, risk of artifacts
- `shift`: Timestep offset 1-5. Higher = stronger semantics/clearer framework, lower = more details
- `seed`: -1 = random. Fix seed when tuning params, vary for exploration
- `use_adg`: Adaptive Dual Guidance (base only) — dynamically adjust CFG
- `infer_method`: "ode" = Euler (faster, deterministic), "sde" = stochastic (adds randomness)
- `audio_cover_strength`: 0.0 = ignore source, 1.0 = strict adherence, 0.2 = style transfer
- `thinking`: Enable LM Chain-of-Thought reasoning for codes
- `lm_temperature`: 0 = deterministic, 0.85 = default, >1 = more creative
- `lm_cfg_scale`: LM guidance 1-3. Higher = more prompt adherence
- `lm_codes_strength`: 0-1, how much LM codes influence DiT
- `score_scale`: Affects scoring sensitivity

**Task type guide:**
- `text2music`: Main mode — generate from text description
- `cover`: Keep structure, change style/details (needs source audio, adjust cover_strength)
- `repaint`: Regenerate a time segment (needs source audio + start/end seconds)
- `lego`: Add specific instrument track (base model only, needs source audio)
- `extract`: Isolate specific instrument (base model only, needs source audio)
- `complete`: Add accompaniment to single track (base model only, needs source audio)

**Model guide:**
- Turbo (default): 8 steps, fast, good quality. Best for most users
- Turbo-shift1: More creative/diverse, weaker semantics
- Turbo-shift3: Stronger conditioning, good for LoRA training
- Turbo-continuous: Experimental, continuous shift support
- SFT: 50 steps, better detail, supports CFG
- Base: 50 steps, highest quality, slowest, exclusive tasks (lego/extract/complete)
- LM 0.6B: Fast, ~3GB VRAM, basic quality
- LM 1.7B: Balanced (recommended), ~8GB VRAM
- LM 4B: Best quality, ~12GB VRAM

**Key files:** New `Tooltip.tsx`, new `help-text.ts`, edits to SimpleMode/CustomMode/AdvancedSettings

---

#### [ ] 4. GPU-Aware Limits & Warnings
**Problem:** Users can set durations/batch sizes exceeding GPU capability.

**Backend:** Already has `/gpu-config` endpoint returning full tier info.
**Frontend changes:**
- In `generationStore.ts` or `useGeneration.ts`: validate against `gpuConfig` before generating
- Show warning toast when duration > max or batch > max
- In CustomMode duration input: show `(max: Xs)` hint from gpuConfig
- In CustomMode batch size input: show `(max: X)` hint
- In ServiceConfig: show "LM not recommended" for <8GB VRAM tiers

**Python API:** `get_gpu_config() -> GPUConfig` at line 176 of `gpu_config.py`
Fields: `tier`, `gpu_memory_gb`, `max_duration_with_lm`, `max_duration_without_lm`,
`max_batch_size_with_lm`, `max_batch_size_without_lm`, `init_lm_default`,
`available_lm_models`, `lm_memory_gb`

Also: `check_duration_limit(duration, gpu_config, lm_initialized) -> (bool, str)` at line 259
And: `check_batch_size_limit(batch_size, gpu_config, lm_initialized) -> (bool, str)` at line 289

**Key files:** `useGeneration.ts`, `CustomMode.tsx`, `AdvancedSettings.tsx`, `serviceStore.ts`

---

### P1 — Important

#### [x] 5. Restore Parameters + Cross-Mode Actions ✅ DONE (Phases 1-5, `feature/restore-params-send-to-ref`)
**Full unified stage architecture implemented:**
- **Phase 1-2:** Latent store with persistent storage and pipeline integration
- **Phase 3:** Resume API — latent ID resolution, renoise, truncated schedule
- **Phase 4:** Step Checkpointing — capture at step K, resume from checkpoint
- **Phase 5:** Frontend Unification — `StageParams` shared type, `stageConversion.ts` utilities,
  bidirectional Custom ↔ Pipeline flow, AudioCard → Pipeline with latent carry
- **AudioCard buttons:** Restore Params, Resume Ckpt, + Pipeline, Send to Src, Send to Ref
- **Key files:** `stageConversion.ts`, `AudioCard.tsx`, `GenerationPanel.tsx`, `StageBlock.tsx`,
  `pipelineStore.ts`, `useBatchNavigation.ts`, `types/index.ts`

#### [x] 6. Send Result to Source Audio / Reference ✅ DONE (`feature/restore-params-send-to-ref`)
- "Send to Src" button sets `gen.srcAudioId` to audio file ID
- "Send to Ref" button sets `gen.referenceAudioId`
- "+ Pipeline" button converts result to pipeline stage (with latent if available)
- **Key files:** `AudioCard.tsx`, `generationStore.ts`

#### [ ] 7. LM Codes Display & Copy
Show LM-generated audio codes in results (stored in `AudioResult.codes`).
- Add collapsible section in `AudioCard.tsx`
- Copy-to-clipboard button
- "Transcribe" button → calls `/understand` endpoint
- **Key files:** `AudioCard.tsx`, `api.ts` (already has `understandMusic()`)

#### [ ] 8. Understand Music UI
Backend endpoint exists (`POST /generation/understand`), no UI.
- Add "Analyze Codes" button when audioCodes is populated
- Display returned caption/lyrics/metadata
- **Key files:** `CustomMode.tsx`, `useGeneration.ts`

#### [ ] 9. Auto Score + Auto LRC Toggles
`GenerateRequest` has `auto_score` and `auto_lrc` fields but no UI controls.
- Add checkboxes in `AdvancedSettings.tsx`
- Add to `generationStore.ts`
- **Key files:** `AdvancedSettings.tsx`, `generationStore.ts`

#### [ ] 10. Score Scale + LM Codes Strength Controls
`GenerateRequest` has `score_scale` and `lm_codes_strength` but no UI.
- Add sliders in `AdvancedSettings.tsx`
- `score_scale`: affects scoring sensitivity
- `lm_codes_strength`: 0-1, how much LM codes influence DiT
- **Key files:** `AdvancedSettings.tsx`, `generationStore.ts`

#### [x] 11. DAW-Style Audio Source Viewer & Repaint Mask Editor ✅ DONE (Phase A+B)
**Problem:** The current repaint start/end controls are plain number inputs. Users need to *see* the
audio, zoom into it, and visually select the region to repaint — like a DAW does.

**Scope:** This applies to ALL audio-requiring pipeline stages (cover, repaint, extract, lego, complete)
that use uploaded source audio. Repaint gets the richest treatment (visual mask), but all types benefit
from a waveform preview of the source.

**Implementation approach:**

**Phase A: Waveform preview for uploaded source audio**
- Use WaveSurfer.js (already a dependency) inside StageBlock's audio source section
- When `src_audio_id` is set and mode is "upload", render a mini waveform of the source
- Scroll-wheel zoom on the waveform (WaveSurfer `zoom()` API: pixels-per-second)
- Click-to-seek for preview playback
- Component: `AudioSourceViewer.tsx` wrapping WaveSurfer, used inside StageBlock
- **Key files:** `components/common/AudioSourceViewer.tsx`, `StageBlock.tsx`, `globals.css` (region handle styles)

**Phase B: Visual repaint region selection** ✅ DONE
- WaveSurfer Regions plugin (`wavesurfer.js/dist/plugins/regions`) draws a selection
- Single draggable/resizable red region overlay on the waveform (default: full audio masked)
- Region start/end sync bidirectionally with `repainting_start` / `repainting_end` number inputs
- Red resize handles extend above/below waveform, widen on hover (`globals.css`)
- Clicking waveform disabled in repaint mode (no accidental seek/play)
- Transport bar: ⏮ (start of track), ⏪ (start of mask, repaint only), ◀ (back 5s), ▶/⏸ (play/pause)
- Progress bar slides under waveform during playback, time display (M:SS.s / M:SS.s)
- First play starts at mask start; keyboard: Space=play, Home=start, Left=back 5s
- Scroll-wheel zoom (min = fit-to-container, no scrollbar; max = 500px/sec)
- **Key files:** `AudioSourceViewer.tsx`, `globals.css`

**Phase C: Enhanced UX**
- Minimap plugin for overview when zoomed in
- Keyboard shortcuts: Space=play/pause, Escape=deselect
- Time ruler with beat grid if BPM is set (beat = 60/BPM seconds)
- Region snapping to beat grid (optional)
- Visual indicators: different region colors for repaint (red tint) vs source context (green tint)
- For cover stages: show full waveform with strength gradient overlay visualization

**WaveSurfer.js API notes:**
```typescript
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions';

const ws = WaveSurfer.create({
  container: '#waveform',
  waveColor: 'var(--text-secondary)',
  progressColor: 'var(--accent)',
  minPxPerSec: 50,    // default zoom
  interact: true,
});

const regions = ws.registerPlugin(RegionsPlugin.create());
const region = regions.addRegion({
  start: repaintStart,
  end: repaintEnd,
  color: 'rgba(255, 0, 0, 0.15)',
  drag: true,
  resize: true,
});

// Zoom with scroll wheel
container.addEventListener('wheel', (e) => {
  e.preventDefault();
  const newZoom = ws.options.minPxPerSec * (e.deltaY > 0 ? 0.9 : 1.1);
  ws.zoom(Math.max(10, Math.min(500, newZoom)));
});

// Sync region ↔ number inputs
region.on('update-end', () => {
  updateStage(index, {
    repainting_start: region.start,
    repainting_end: region.end,
  });
});
```

**Technical note — How repaint masking actually works internally:**
The mask is **binary** (not feathered). No crossfade or blending is applied.
- Source audio VAE-encoded to 25Hz latent frames (1 frame = 40ms of audio)
- Binary `chunk_mask`: `False` = keep, `True` = regenerate
- Repaint region in source latents zeroed out (replaced with learned silence latent)
- Mask concatenated as extra feature channel to source latents → model conditioning
- Coherence at boundaries comes from **bidirectional attention** — the DiT transformer
  sees context on both sides and generates a fill that flows naturally into the surroundings
- No post-processing blend, no gradient mask, no time-domain windowing
- This is different from image inpainting (which uses alpha feathering). Here the attention
  mechanism IS the "blur" — like how GPT fills a `[MASK]` token using surrounding context
- Frame resolution: boundaries snap to 40ms (25Hz latent). Users won't notice at this granularity
- Code refs: `handler.py:1831-1833` (mask creation), `handler.py:1884-1891` (silence replacement),
  `modeling_*.py` (mask→feature channel concat), `diffusion_core.py` (generation loop — no mask blending step)

---

### P2 — Nice to Have

#### [ ] 11. OpenRouter API compatibility
Separate server at port 8002. Could expose toggle in UI or just document.
See `docs/en/Openrouter_API_DOC.md`.

#### [ ] 12. Generation History
Persist history with params + results. Quick re-run, side-by-side compare.

#### [ ] 13. Caption Writing Assistant
Dedicated panel: dimension selectors, tag palette, conflict checker, genre examples.

#### [ ] 14. Batch Comparison View
Side-by-side players with score overlay. Select best → promote.

#### [ ] 15. VAE Calibration UI
`prepare_vae_calibration` for custom datasets. Add in training section.

#### [ ] 16. Custom Timesteps Visual Editor
Replace text input with visual timeline or presets.

#### [ ] 17. Multi-Language UI
i18n infrastructure exists but only English. Gradio supports en/zh/ja.

---

## Pipeline Builder Design Spec

> This is the full technical design for the multi-stage latent refinement pipeline.
> Inspired by ComfyUI workflows but with a clean block-based UX instead of a visual node graph.

### Motivation

A ComfyUI workflow chains Base model (50 steps) → Turbo model (8 steps, denoise=0.6)
in latent space. The base provides structural quality, turbo adds speed refinement.
Both use shift=3, different seeds, shared text conditioning. Result is better than
either model alone.

Our UI should support this and beyond (3+ stages, any model combo) without requiring
the user to wire nodes manually.

### Design Philosophy vs ComfyUI

| Aspect | ComfyUI | Our Pipeline Builder |
|--------|---------|---------------------|
| Connection UX | Drag wires between nodes | Dropdown: "connect to Stage N" |
| Layout | Freeform 2D canvas | Ordered vertical list of stage cards |
| Complexity | Exposes everything | Exposes what matters |
| Flexibility | Arbitrary graph | Linear/DAG chain (covers 95% of use cases) |
| VRAM control | None (manual) | Per-block dropdown (keep / offload RAM / offload disk) |
| Presets | Share JSON files | Built-in + user-saved in localStorage |
| Latents | Requires explicit VAE decode/encode wiring | Automatic between stages, no round-trip |
| Model management | Load all upfront | Load/offload per stage, choreographed |

### Block Types (7 implemented)

```
GENERATE     Creates latent from noise (text2music)
  Input:     conditioning (auto from shared caption/lyrics)
  Output:    latent tensor [batch, T, D]
  Settings:  model, steps, shift, seed, sampler, cfg

REFINE       Partially denoises an existing latent with a (possibly different) model
  Input:     latent from any previous stage (dropdown)
  Output:    latent tensor [batch, T, D]
  Settings:  model, steps, denoise (0.0-1.0), shift, seed, sampler, cfg

COVER        Restyle source audio while preserving melody & structure
  Input:     source audio (upload or previous stage output)
  Output:    latent tensor [batch, T, D]
  Settings:  model (any), steps, cover_strength (0-1), shift, seed, sampler, cfg
  Note:      Uses source as style reference (refer_audios). Instruction from TASK_INSTRUCTIONS["cover"]

REPAINT      Regenerate a specific time region of source audio
  Input:     source audio (upload or previous stage output) + start/end seconds
  Output:    latent tensor [batch, T, D]
  Settings:  model (any), steps, start_time, end_time (-1=end), shift, seed, sampler, cfg
  Note:      Supports outpainting (extending beyond audio length)

EXTRACT      Isolate a specific instrument track from source audio
  Input:     source audio (upload or previous stage output) + track_name
  Output:    latent tensor [batch, T, D]
  Settings:  model (base only), steps, track_name (from TRACK_NAMES), shift, seed
  Note:      Instruction from TASK_INSTRUCTIONS["extract"] with {TRACK_NAME} substitution

LEGO         Add a new instrument track to source audio context
  Input:     source audio (upload or previous stage output) + track_name
  Output:    latent tensor [batch, T, D]
  Settings:  model (base only), steps, track_name (from TRACK_NAMES), shift, seed
  Note:      Instruction from TASK_INSTRUCTIONS["lego"] with {TRACK_NAME} substitution

COMPLETE     Add accompaniment tracks to a solo or partial mix
  Input:     source audio (upload or previous stage output) + track_classes list
  Output:    latent tensor [batch, T, D]
  Settings:  model (base only), steps, complete_track_classes (multi-select), shift, seed
  Note:      Instruction from TASK_INSTRUCTIONS["complete"] with {TRACK_CLASSES} substitution
```

All audio-requiring stages (cover/repaint/extract/lego/complete) resolve source via
`resolve_src_audio()` — either from `src_audio_id` (uploaded file via `audio_store.get_path()` →
`dit_handler.process_src_audio()`) or `src_stage` (VAE-decode previous stage latent via
`dit_handler.tiled_decode()`). Final stage always auto-decoded; intermediate stages use
`preview: true` checkbox for optional decode.

### UI Mockup

Third mode tab alongside Simple and Custom: **Simple | Custom | Pipeline**

```
┌─ Pipeline ───────────────────────────────────────────────────┐
│                                                              │
│  Caption: [acoustic soul, female tenor vocal, guitar solo..] │
│  Lyrics:  [[Verse 1] / They say she makes a good lover...]  │
│  Duration: [150s]  BPM: [100]  Key: [C major]  Lang: [en]   │
│                                                              │
│  ════════════════════════════════════════════════════         │
│                                                              │
│  ┌─ Stage 1 ──────────────────────────────────────────────┐  │
│  │  ● Generate from noise                                 │  │
│  │                                                        │  │
│  │  Model   [acestep-v15-base        ▼]                   │  │
│  │  Steps   [50    ]  Shift [3  ]  Seed [random        ]  │  │
│  │  Sampler [dpmpp_2m ▼]  CFG [1.0]                       │  │
│  │  VRAM    [⚡ Offload after ▼]                           │  │
│  │  Preview [☐]                           [× Remove]      │  │
│  └────────────────────────────────────────────────────────┘  │
│                      │                                        │
│                      ▼ latent                                 │
│                                                              │
│  ┌─ Stage 2 ──────────────────────────────────────────────┐  │
│  │  ● Refine latent from [Stage 1 ▼]                      │  │
│  │                                                        │  │
│  │  Model    [acestep-v15-turbo      ▼]                   │  │
│  │  Steps    [8     ]  Shift [3  ]  Seed [random       ]  │  │
│  │  Denoise  [━━━━━━━━━━━━○──── 0.60]                     │  │
│  │  Sampler  [euler ▼]  CFG [1.0]                          │  │
│  │  VRAM     [⚡ Offload after ▼]                           │  │
│  │  Preview  [☑]                           [× Remove]      │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  [+ Add Stage]                                               │
│                                                              │
│  ┌─ Presets ──────────────────────────────────────────────┐  │
│  │ [Base→Turbo] [SFT→Turbo] [3-Stage Quality] [💾 Save]  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  [▶ Run Pipeline]                                            │
└──────────────────────────────────────────────────────────────┘
```

### The "Connect To" Dropdown (Input Selection)

When adding a Refine stage, the input dropdown shows only compatible previous outputs:

```
  Input: [Select source...        ▼]
         ├─ Stage 1 → latent
         ├─ Stage 2 → latent         (if 3+ stages)
         ├─ Upload audio → encode    (adds an Encode block automatically)
         └─ + New Encode block...
```

No wires, no spaghetti. Cycles are impossible by construction (can only connect
to previous stages). The pipeline is always a valid DAG.

### VRAM Management Per Block

Each stage specifies its model lifecycle:

```
  VRAM: [⚡ Keep loaded    ▼]     ← stays in GPU between stages (fastest)
        [⚡ Offload to RAM ▼]     ← moved to system RAM after stage runs
        [💾 Load on demand ▼]     ← loaded from disk each time (slowest, minimal VRAM)
```

**Execution choreography:**
```
Stage 1 (Base, VRAM=offload):
  1. Load base model to GPU
  2. Run 50-step diffusion → latent_1
  3. Move base model to RAM (or disk)

Stage 2 (Turbo, VRAM=offload):
  1. Load turbo model to GPU
  2. Add noise to latent_1 up to t_start=0.6
  3. Run 8-step diffusion from t=0.6 → latent_2
  4. Move turbo model to RAM

Final: VAE decode latent_2 (+ latent_1 if Stage 1 preview=true)
```

With 24GB+ VRAM: keep both loaded, no swap overhead.
With 12-16GB: offload between stages, ~30-60s swap cost.
With 8-12GB: offload + maybe quantize, still works.

### Example Pipelines (Ship as Built-in Presets)

**Base → Turbo Refine** (the ComfyUI workflow):
```json
{
  "name": "Base → Turbo Refine",
  "description": "50-step base for structure, 8-step turbo for detail polish",
  "stages": [
    { "type": "generate", "model": "acestep-v15-base", "steps": 50,
      "shift": 3, "cfg": 1.0, "sampler": "dpmpp_2m", "vram": "offload",
      "preview": false },
    { "type": "refine", "input": 0, "model": "acestep-v15-turbo", "steps": 8,
      "denoise": 0.6, "shift": 3, "cfg": 1.0, "sampler": "euler",
      "vram": "offload", "preview": true }
  ]
}
```

**SFT → Turbo**:
```json
{
  "name": "SFT → Turbo Polish",
  "description": "SFT quality with turbo refinement pass",
  "stages": [
    { "type": "generate", "model": "acestep-v15-sft", "steps": 50,
      "shift": 2, "cfg": 3.0, "sampler": "dpmpp_2m", "vram": "offload" },
    { "type": "refine", "input": 0, "model": "acestep-v15-turbo", "steps": 8,
      "denoise": 0.4, "shift": 3, "sampler": "euler", "vram": "offload",
      "preview": true }
  ]
}
```

**3-Stage Quality** (experimental):
```json
{
  "name": "3-Stage Quality",
  "description": "Base structure → SFT detail → Turbo polish",
  "stages": [
    { "type": "generate", "model": "acestep-v15-base", "steps": 50,
      "shift": 3, "cfg": 1.0, "sampler": "dpmpp_2m", "vram": "offload" },
    { "type": "refine", "input": 0, "model": "acestep-v15-sft", "steps": 32,
      "denoise": 0.5, "shift": 2, "cfg": 2.0, "sampler": "dpmpp_2m",
      "vram": "offload" },
    { "type": "refine", "input": 1, "model": "acestep-v15-turbo", "steps": 8,
      "denoise": 0.3, "shift": 3, "sampler": "euler", "vram": "offload",
      "preview": true }
  ]
}
```

### Backend API

```
POST /api/generation/pipeline
Body: {
  // Shared conditioning (same as single-stage generate)
  caption: "acoustic soul, female tenor vocal...",
  lyrics: "[Verse 1]\nThey say she makes...",
  instrumental: false,
  vocal_language: "en",
  bpm: 100,
  keyscale: "C major",
  timesignature: "4",
  duration: 150,
  batch_size: 1,

  // LM settings (used for conditioning, shared across stages)
  thinking: true,
  lm_temperature: 0.85,
  lm_cfg_scale: 1.0,
  // ... other LM params ...

  // Pipeline stages
  stages: [
    {
      type: "generate",
      model: "acestep-v15-base",
      steps: 50,
      shift: 3.0,
      cfg: 1.0,
      sampler: "dpmpp_2m",
      seed: -1,
      vram: "offload",
      preview: false
    },
    {
      type: "refine",
      input_stage: 0,
      model: "acestep-v15-turbo",
      steps: 8,
      denoise: 0.6,
      shift: 3.0,
      cfg: 1.0,
      sampler: "euler",
      seed: -1,
      vram: "offload",
      preview: true
    }
  ]
}

Response: { task_id: "abc123" }
```

Progress broadcasts per-stage:
```json
{ "type": "progress", "task_id": "abc123",
  "stage": 0, "stage_name": "Base (50 steps)",
  "progress": 0.72, "message": "Step 36/50" }

{ "type": "progress", "task_id": "abc123",
  "stage": 1, "stage_name": "Turbo Refine (8 steps)",
  "progress": 0.25, "message": "Step 2/8" }
```

Result includes per-stage outputs:
```json
{
  "result": {
    "stages": [
      { "stage": 0, "audio_id": "...", "preview": false },
      { "stage": 1, "audio_id": "...", "preview": true }
    ],
    "final_audio_id": "...",
    "time_costs": { "stage_0": 45.2, "stage_1": 3.8, "vae_decode": 2.1 }
  }
}
```

### Implementation Order

**Phase 0: Create diffusion_core.py** ✅ DONE
Created `acestep/diffusion_core.py` (~576 lines) with `VariantConfig`, `MODEL_VARIANT_CONFIGS`
(6 variants), `TimestepScheduler` (4 strategies + `truncate()`), `generate_audio_core()`.
Modified `handler.py`: import, store `model_variant`, replace `model.generate_audio()` call.

**Phase 1: Core Python latent passthrough** ✅ DONE
Added `init_latents`/`t_start` to `generate_audio_core()`, threaded through `handler.py`
`generate_music()`/`service_generate()`, threaded through `inference.py` `GenerationParams`.

**Phase 2: Backend pipeline endpoint** ✅ DONE
Created `schemas/pipeline.py` (`PipelineStageConfig`, `PipelineRequest`).
Created `services/pipeline_executor.py` (`run_pipeline()` with latent chaining + VAE decode).
Added `POST /generation/pipeline` to `routers/generation.py`.
Added `runPipeline()` to `api.ts`, pipeline types to `types/index.ts`.

**Phase 3: Frontend pipeline builder** ✅ DONE
New files: `pipelineStore.ts`, `StageBlock.tsx`, `PipelineMode.tsx`.
Modified: `generationStore.ts`, `GenerationPanel.tsx`, `page.tsx`.
3 built-in presets, pipeline result handling.

**Phase 4: User presets + polish** ✅ DONE
User preset save/load/delete via localStorage. Inline save UI in PipelineMode.

### DRY Refactor of Model Files

**IMPORTANT:** The `checkpoints/` directory is **gitignored** — those files are downloaded
from HuggingFace by `model_downloader.py`. We CANNOT modify them. Instead, our unified
diffusion loop lives in `acestep/diffusion_core.py` (git-tracked) and **replaces** the
model's own `generate_audio()` at the call site in `handler.py`.

The 6 model files total ~12,650 lines but **85-90% is identical copy-paste**. Only the
`generate_audio()` method (~150-200 lines per file) differs, in 3 dimensions:

**Dimension 1: CFG Guidance (base/sft=YES, all turbo=NO)**
- Base/SFT: 60+ lines of CFG logic — batch doubling, momentum buffer, APG/ADG
- Turbo variants: Zero guidance, simplified loop
- Extractable to: `CFGuidance` class (~70 lines)

**Dimension 2: Timestep Scheduling (4 strategies)**
| Strategy | Used by | Description |
|----------|---------|-------------|
| `linear` | base, sft, shift1, shift3 | `linspace(1,0,steps+1)` + shift formula |
| `discrete` | turbo (default) | Pre-defined SHIFT_TIMESTEPS dict for shifts 1/2/3 only |
| `continuous` | turbo-continuous | Dynamic from continuous shift [1-5] |
| `custom` | sft + all turbo variants | Accept user-provided timestep tensor |
- Extractable to: `TimestepScheduler` class (~80 lines)

**Dimension 3: Defaults / Constraints**
| Model | Default shift | Forced shift | Step param |
|-------|--------------|-------------|------------|
| base | 1.0 | — | `infer_steps` |
| sft | 1.0 | — | `infer_steps` |
| turbo | 3.0 | — | `fix_nfe` |
| turbo-shift1 | 1.0 | — | `fix_nfe` |
| turbo-shift3 | — | 3.0 (hardcoded) | `fix_nfe` |
| turbo-continuous | 3.0 | — | `fix_nfe` |
- Expressible as: config dict per model variant

**Everything else (imports, class defs, all other methods) is identical.**

**Key insight:** The model's public methods are callable from external code:
- `model.prepare_condition(...)` — condition setup (encoder hidden states, context latents)
- `model.prepare_noise(context_latents, seed)` — initial noise tensor
- `model.decoder(...)` — the actual transformer forward pass (neural net)
- `model.get_x0_from_noise(xt, vt, t)` — predict clean sample (for SDE)
- `model.renoise(x0, t)` — re-add noise (for SDE)

Our code replaces the model's diffusion LOOP, not the model itself.

**Target architecture:**
```
acestep/diffusion_core.py (NEW, ~300 lines, git-tracked)
├── TimestepScheduler     — 4 strategies + truncate() for pipeline
├── CFGuidance            — CFG + ADG (base/sft only)
├── MODEL_VARIANT_CONFIGS — dict mapping model name → {use_cfg, timestep_mode, defaults}
└── generate_audio_core(model, ...) — unified diffusion loop, calls model's public methods

acestep/handler.py (MODIFIED — 1 line change at line 2333)
  BEFORE: outputs = self.model.generate_audio(**generate_kwargs)
  AFTER:  outputs = generate_audio_core(self.model, **generate_kwargs,
                        variant=self.model_variant, init_latents=..., t_start=...)

checkpoints/*/modeling_*.py — UNTOUCHED (gitignored, downloaded artifacts)
```

**How handler.py knows which variant:** When `initialize_service()` loads a model at
line 398, it knows the `config_path` (e.g., "acestep-v15-turbo"). Store this as
`self.model_variant = config_path` and pass it to `generate_audio_core()` which looks
up the variant config (CFG yes/no, timestep strategy, defaults).

**Result: checkpoint files untouched, init_latents/t_start in ONE place, single source of truth.**

---

## Latent Pipeline Technical Reference

> Detailed findings from code exploration of the ACE-Step core.
> Essential reading for implementing the Pipeline Builder.

### Latent Flow Through the Pipeline

```
prepare_noise()                    → initial noise tensor [batch, T, D//2]
     ↓
generate_audio() diffusion loop    → denoised latent (xt)
     ↓
extra_outputs["pred_latents"]      → saved to CPU [batch, T, D//2]
     ↓
tiled_decode() (VAE)               → audio [batch, 2, samples] @ 48kHz
```

### Where Noise/Latent Is Created

**File:** `checkpoints/*/modeling_acestep_v15_base.py` — `prepare_noise()` method (~line 1733)
- Shape: `(batch_size, latent_length, latent_dim // 2)`
- `latent_length` matches `context_latents.shape[1]` (25Hz sampled frames)
- Supports per-batch-item seeding via `torch.Generator`
- Returns pure noise tensor — this is always `t=1.0`

### Where DiT Sampling Happens

**File:** `checkpoints/*/modeling_acestep_v15_base.py` — `generate_audio()` method (~line 1783)

```python
# Timestep schedule: 1.0 → 0.0 in infer_steps
t = torch.linspace(1.0, 0.0, infer_steps + 1)

# Shift applied to all timesteps
if shift != 1.0:
    t = shift * t / (1 + (shift - 1) * t)

# Main loop
for step_idx, (t_curr, t_prev) in enumerate(zip(t[:-1], t[1:])):
    vt = decoder(xt, t_curr, conditions)   # velocity prediction
    # Optional CFG / ADG guidance
    if infer_method == "ode":
        dt = t_curr - t_prev
        xt = xt - vt * dt                  # Euler step
    elif infer_method == "sde":
        pred_clean = get_x0_from_noise(xt, vt, t_curr)
        xt = renoise(pred_clean, next_t)   # stochastic re-noise
```

**Key:** `xt` is a mutable tensor, fully accessible at every step.
The loop iterates over pairs from the timestep schedule.
**To support partial denoising:** truncate the timestep schedule to start from `t_start < 1.0`.

### Model File Matrix (CRITICAL for Pipeline Builder)

There are **two different model codebases** and **6 separate file copies**:

| Model | File | Default Shift | Timesteps | CFG | Key Difference |
|-------|------|--------------|-----------|-----|----------------|
| base | `modeling_acestep_v15_base.py` | 1.0 | linspace + custom | Yes | Full featured, ADG |
| sft | `modeling_acestep_v15_base.py` | 1.0 | linspace only | Yes | Nearly identical to base |
| turbo | `modeling_acestep_v15_turbo.py` | 3.0 | **Pre-defined schedules**, maps to nearest valid | No | Most restricted, `fix_nfe` not `infer_steps` |
| turbo-shift1 | `modeling_acestep_v15_turbo.py` | 1.0 | Simple linspace | No | Simplest turbo variant |
| turbo-shift3 | `modeling_acestep_v15_turbo.py` | 3.0 (forced) | Same as shift1 | No | Hardcodes shift=3 |
| turbo-continuous | `modeling_acestep_v15_turbo.py` | 3.0 | Continuous shift [1-5], direct custom timesteps | No | Most flexible turbo |

**Files to modify (6 copies):**
```
checkpoints/acestep-v15-base/modeling_acestep_v15_base.py          (base model code)
checkpoints/acestep-v15-sft/modeling_acestep_v15_base.py           (near-identical)
checkpoints/acestep-v15-turbo/modeling_acestep_v15_turbo.py        (pre-defined timestep schedules, VALID_SHIFTS, fix_nfe)
checkpoints/acestep-v15-turbo-shift1/modeling_acestep_v15_turbo.py (simple linspace)
checkpoints/acestep-v15-turbo-shift3/modeling_acestep_v15_turbo.py (forces shift=3)
checkpoints/acestep-v15-turbo-continuous/modeling_acestep_v15_turbo.py (continuous shift, flexible timesteps)
```

**The turbo (default) variant is the trickiest** — it uses `fix_nfe=8` instead of `infer_steps`,
pre-computes VALID_TIMESTEPS and SHIFT_TIMESTEPS dicts, and maps custom timesteps to nearest
valid values. For partial denoising, we'll need to truncate the pre-defined schedule.

**Recommended approach:** Rather than modifying 6 files with slightly different logic,
add the `t_start` truncation in `handler.py` AFTER the timestep schedule is computed
but BEFORE the diffusion loop. This way each model computes its schedule normally,
and we just slice it.

### What Needs to Change for `init_latents` + `t_start`

Since `diffusion_core.py` owns the loop, this is trivial — add to ONE function:

```python
# In acestep/diffusion_core.py — generate_audio_core()
def generate_audio_core(model, ..., init_latents=None, t_start=1.0, variant="turbo"):
    # 1. Compute timestep schedule (strategy determined by variant config)
    config = MODEL_VARIANT_CONFIGS[variant]
    schedule = TimestepScheduler.compute(config.timestep_mode, ...)

    # 2. If init_latents provided, truncate schedule
    if init_latents is not None:
        schedule = TimestepScheduler.truncate(schedule, t_start)
        xt = init_latents.to(device).to(dtype)
    else:
        xt = model.prepare_noise(context_latents, seed)

    # 3. Run diffusion loop calling model.decoder() at each step
    for step_idx, (t_curr, t_prev) in enumerate(schedule.pairs()):
        vt = model.decoder(xt, t_curr, conditions)    # model's neural net
        if config.use_cfg:
            vt = CFGuidance.apply(vt, ...)             # base/sft only
        xt = ode_step(xt, vt, t_curr, t_prev)          # or sde_step

    return {"pred_latents": xt, ...}
```

`TimestepScheduler.truncate()` — find first timestep <= t_start, slice:
```python
@staticmethod
def truncate(schedule, t_start):
    mask = schedule <= t_start + 1e-6
    start_idx = mask.nonzero()[0].item() if mask.any() else 0
    return schedule[start_idx:]
```

Works identically regardless of how the schedule was computed.

**Threading through call chain:** handler.py → inference.py → generate_audio_core()
needs `init_latents` and `t_start` parameters threaded at each level.

**Checkpoint files: UNTOUCHED.** The model's own `generate_audio()` still exists in the
downloaded checkpoint, but our handler never calls it — we call `generate_audio_core()` instead.

### Cover Task — Mechanism Summary

> **Full deep dive:** See `web/PIPELINE_FRAMEWORK.md` Part I for the complete mechanism
> analysis with code walkthroughs. This section is the quick reference.

**Key insight:** Cover does NOT do latent-space img2img. It uses a **two-condition
temporal switch** during denoising. Diffusion always starts from pure noise.

**Instruction-based routing:** All 7 task types use the same model. The instruction string
in the text prompt selects behavior. Cover is detected by substring match on
`"generate audio semantic tokens"` + `"based on the given conditions"` in `handler.py:1884-1901`.
This is fragile — custom instructions containing those substrings accidentally trigger cover mode.

**VQ bottleneck (cover only):** `prepare_condition()` in `modeling_*.py:1607-1652` runs source
latents through tokenize (25Hz→5Hz, VQ quantize) → detokenize (5Hz→25Hz). This strips timbre/texture
but preserves melodic/rhythmic skeleton. The `torch.where(is_covers > 0, lm_hints, src_latents)`
swap means **only cover uses the bottleneck** — extract/lego/complete get unquantized source latents.

**Temporal switch:** `cover_steps = int(num_steps * strength)` in `diffusion_core.py:461`.
Steps 0→cover_steps use source-conditioned context. Steps cover_steps→end switch to
caption-only (silence context, DEFAULT_DIT_INSTRUCTION, KV cache reset). Early steps lock
structure, late steps apply style — controlled by `audio_cover_strength`.

**Code paths:**
- Detection: `handler.py:1884-1901` (is_covers), `constants.py:79-89` (TASK_INSTRUCTIONS)
- VQ bottleneck: `modeling_*.py:1638-1649` (tokenize/detokenize/swap)
- Context injection: `modeling_*.py:1347` (channel-wise concat into decoder)
- Temporal switch: `diffusion_core.py:416-528` (two conditions + loop switch)
- Non-cover text: `handler.py:2050-2079` (same caption, DEFAULT instruction)

### Model Loading / Offloading

**File:** `handler.py` — `_load_model_context()` (~line 637)

Already supports CPU offloading via context manager:
```python
@contextmanager
def _load_model_context(self, model_name):
    if not self.offload_to_cpu:
        yield  # no-op
        return
    self._recursive_to_device(model, self.device, self.dtype)  # → GPU
    yield
    self._recursive_to_device(model, "cpu")                     # → CPU
```

Three components can be independently offloaded: `model` (DiT), `vae`, `text_encoder`.
`offload_dit_to_cpu=False` keeps DiT on GPU even when other components offload.

**For Pipeline Builder:** We need a way to swap the DiT model weights without full
re-initialization. Options:
1. **Quick swap:** Load different `.safetensors` into the same model architecture (same arch, different weights)
2. **Full re-init:** Call `initialize_service()` with new config_path (~30-60s, reloads everything)
3. **Multi-handler:** Hold multiple handler instances, swap which one is active (highest VRAM)

Option 1 is ideal if all DiT models share the same architecture (they do — all are
`AceStepConditionGenerationModel`). Just load different state_dict.

### Available Latent Tensors in extra_outputs

After generation, `extra_outputs` dict contains:
- `pred_latents` — final denoised latent [batch, T, D], on CPU
- `src_latents` — input source latent (for cover/repaint tasks)
- `chunk_masks` — boolean masks [batch, T]
- `lyric_token_ids` — for score/LRC computation
- `pred_latent` (singular) — sometimes used for single-batch

### ComfyUI Dual CLIP vs Our Text Encoder

The ComfyUI workflow uses `DualCLIPLoaderMultiGPU` loading BOTH `qwen_0.6b_ace15.safetensors`
AND `qwen_4b_ace15.safetensors` simultaneously as a dual text encoder. Our ACE-Step handler
uses only `Qwen3-Embedding-0.6B`. This may account for some quality difference. Investigate
whether the handler supports dual text encoders or if this is ComfyUI-specific packaging.

### Sampler/Scheduler Notes from ComfyUI Workflow

The ComfyUI workflow uses samplers not in ACE-Step's native code:
- Stage 1: `dpmpp_2m` with `sgm_uniform` scheduler
- Stage 2: `jkass_quality` with `sgm_uniform` scheduler

ACE-Step natively supports `"ode"` (Euler) and `"sde"` (stochastic). For the Pipeline
Builder, we may want to add support for additional samplers or map ComfyUI sampler names
to the closest native equivalent. For now:
- `dpmpp_2m` ≈ `"ode"` (both deterministic, forward integration)
- `jkass_quality` ≈ custom (no direct equivalent — may need implementation)
- `sgm_uniform` = uniform timestep spacing (already the default)

---

## ACE-Step Core Python API Quick Reference

### Model Downloads (`acestep/model_downloader.py`)
```python
download_submodel(model_name, checkpoints_dir=None, force=False, token=None) -> (bool, str)  # line 161
download_main_model(checkpoints_dir=None, force=False, token=None) -> (bool, str)  # line 110
download_all_models(checkpoints_dir=None, force=False, token=None) -> (bool, [str])  # line 214
ensure_main_model(checkpoints_dir=None, token=None) -> (bool, str)  # line 252
ensure_dit_model(model_name, checkpoints_dir=None, token=None) -> (bool, str)  # line 324
ensure_lm_model(model_name=None, checkpoints_dir=None, token=None) -> (bool, str)  # line 282
check_model_exists(model_name, checkpoints_dir=None) -> bool  # line 78
list_available_models() -> Dict[str, str]  # line 96
get_checkpoints_dir(custom_dir=None) -> Path  # line 54
```

Sub-model registry (`SUBMODEL_REGISTRY`): LM 0.6B, LM 4B, DiT shift1/shift3/continuous/sft/base.
Main model components (`MAIN_MODEL_COMPONENTS`): turbo, vae, Qwen3-Embedding-0.6B, LM 1.7B.

### GPU Config (`acestep/gpu_config.py`)
```python
get_gpu_config(gpu_memory_gb=None) -> GPUConfig  # line 176
check_duration_limit(duration, gpu_config, lm_initialized) -> (bool, str)  # line 259
check_batch_size_limit(batch_size, gpu_config, lm_initialized) -> (bool, str)  # line 289
get_recommended_lm_model(gpu_config) -> Optional[str]  # line 349
is_lm_model_supported(model_path, gpu_config) -> (bool, str)  # line 319
```

### Music Generation (`acestep/inference.py`)
```python
generate_music(dit_handler, llm_handler, params, config, save_dir=None, progress=None) -> GenerationResult  # line 293
create_sample(llm_handler, query, instrumental=False, vocal_language=None, ...) -> CreateSampleResult  # line 891
format_sample(llm_handler, caption, lyrics, user_metadata=None, ...) -> FormatSampleResult  # line 1065
understand_music(llm_handler, audio_codes, ...) -> UnderstandResult  # line 719
```

### Handler Init (`acestep/handler.py`)
```python
AceStepHandler.initialize_service(  # line 308
    project_root, config_path, device="auto", use_flash_attention=False,
    compile_model=False, offload_to_cpu=False, offload_dit_to_cpu=False,
    quantization=None
) -> (str, bool)
# Auto-downloads missing models at lines 365-383
```

### LLM Init (`acestep/llm_inference.py`)
```python
LLMHandler.initialize(  # line 311
    checkpoint_dir, lm_model_path, backend="vllm", device="auto",
    offload_to_cpu=False, dtype=None
) -> (str, bool)
```

### DiT Diffusion Loop (`checkpoints/*/modeling_acestep_v15_base.py`)
```python
AceStepConditionGenerationModel.generate_audio(  # line 1783
    # ... many params ...
    infer_steps, shift, infer_method,
    audio_cover_strength,
    # NEEDED FOR PIPELINE (not yet implemented):
    # init_latents=None, t_start=1.0,
) -> dict  # returns {"target_latents": ..., "pred_latents": ..., ...}

AceStepConditionGenerationModel.prepare_noise(  # line 1733
    context_latents, seed
) -> torch.Tensor  # noise [batch, T, D//2]
```

### Model Offloading (`acestep/handler.py`)
```python
AceStepHandler._load_model_context(model_name)  # line 637 — context manager
# model_name: "model" (DiT), "vae", or "text_encoder"
# Moves to GPU on enter, back to CPU on exit (if offload_to_cpu=True)
```

---

## GPU Tier Reference

| VRAM | Tier | LM Default | Max Duration (LM/no-LM) | Max Batch (LM/no-LM) |
|------|------|-----------|--------------------------|----------------------|
| ≤4GB | 1 | None | -/3min | -/1 |
| 4-6GB | 2 | None | -/6min | -/1 |
| 6-8GB | 3 | 0.6B opt | 4min/6min | 1/2 |
| 8-12GB | 4 | 0.6B opt | 4min/6min | 2/4 |
| 12-16GB | 5 | 0.6B/1.7B | 4min/6min | 2/4 |
| 16-24GB | 6 | All | 8min/8min | 4/8 |
| ≥24GB | ∞ | All | 10min/10min | 8/8 |

---

## Educational Content Reference (from Tutorial.md)

### Caption Dimensions
Style/Genre | Emotion | Instruments | Timbre Texture | Era | Production | Vocal | Speed/Rhythm | Structure

### Common Caption Examples
- `"A driving, hypnotic tech-house track with punchy four-on-the-floor kick drum and deep pulsing sub-bass"`
- `"sad piano ballad with female breathy vocal, lo-fi bedroom pop production"`
- `"80s synthwave with arpeggiated synths, gated reverb drums, and warm analog pads"`
- `"aggressive trap beat with 808 bass, hi-hat rolls, and dark atmospheric synths"`

### Lyrics Template
```
[Intro]
[Driving synth arpeggio and four-on-the-floor beat begins]

[Verse 1]
First verse lyrics here
Keep lines 6-10 syllables

[Pre-Chorus]
Building energy transition

[Chorus]
Emotional climax lyrics
UPPERCASE FOR EMPHASIS
(background vocals in parentheses)

[Verse 2]
Second verse development

[Bridge]
[Build]
Tension and elevation

[Chorus]
Repeat or vary chorus

[Outro]
[Fade Out]
```

### Key Teaching: "Elephant Rider" Metaphor
The model has its own will/temperament. You guide it like riding an elephant —
you suggest direction, but the elephant decides some things on its own.
More specific captions = more control. Less specific = more surprises.
This is a feature, not a bug.

### Key Teaching: Fix Seed When Tuning
Random factors and tuning factors have comparable influence.
Without fixed seed, parameter changes are masked by randomness.
Fix seed → tune one parameter → observe effect → then randomize for exploration.

### Key Teaching: Caption-Lyrics Consistency
Caption and lyrics MUST be consistent or the model gets confused:
- Instruments in caption ↔ instrumental tags in lyrics
- Emotion in caption ↔ energy tags in lyrics
- Vocal description in caption ↔ vocal control tags in lyrics
