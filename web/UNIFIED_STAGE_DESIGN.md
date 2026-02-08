# Unified Stage Architecture

> **Status:** Design draft. References are to current codebase as of Feb 2026.
> **Audience:** This document is self-contained. A reader unfamiliar with the project should be able to understand the design from this document alone.

---

## Project Context

### What is ACE-Step?

[ACE-Step](https://github.com/ace-step/ACE-Step-1.5) is an open-source music generation model built on a **two-phase architecture**:

1. **Phase 1 (LLM):** A 5Hz language model takes a text caption + lyrics and produces chain-of-thought metadata (BPM, key, structure, rewritten caption) plus optional **audio code tokens** that encode musical structure at a coarse 5Hz resolution.
2. **Phase 2 (DiT):** A diffusion transformer (DiT) denoises a latent representation conditioned on the LLM outputs, text embeddings, and optional source audio. The output latent is decoded by a VAE into 48kHz stereo audio.

The model supports multiple **task types** through an instruction-routed architecture — the same weights handle text-to-music, cover (restyle), repaint (edit a time region), extract (isolate a track), lego (add a track), and complete (add accompaniment). Task type is selected by changing the instruction text, which routes conditioning through different internal pathways.

Three model variants exist: **base** (high quality, ~50 steps), **turbo** (fast, ~8 steps), and **sft** (fine-tuned, supports CFG guidance). They share the same architecture but differ in training and step count.

### What is Sonaturgy?

Sonaturgy is a custom web UI we're building on top of ACE-Step. It replaces the stock Gradio interface with a proper application:

- **Frontend:** Next.js 16 + React 19 + Zustand 5 + Tailwind + WaveSurfer.js
- **Backend:** FastAPI + Uvicorn wrapping the ACE-Step Python handlers
- **Communication:** WebSocket for real-time generation progress, REST for config/uploads

The UI currently has three generation modes — **Simple** (LLM auto-fills everything from a text description), **Custom** (full manual control over all params), and **Pipeline** (multi-stage latent chaining with per-stage params). These modes are currently implemented as independent code paths with duplicated state, which is the problem this design addresses.

### What is this document?

This document proposes a **Unified Stage Architecture** that treats every generation — whether from Simple, Custom, or Pipeline mode — as an instance of the same underlying Stage object. The goal is to:

1. Enable **latent persistence** so users can resume, branch, and iterate without VAE round-trip degradation
2. Make the three modes **feed into each other** seamlessly (Simple → Custom → Pipeline and back)
3. **DRY the codebase** by sharing param types, UI components, and execution paths
4. Support **step-level checkpointing** for fine-grained creative control

### Repository layout (key paths)

```
ACE-Step-1.5/
├── acestep/                          # Core Python model code
│   ├── diffusion_core.py             # Unified diffusion loop (our mod)
│   ├── handler.py                    # DiT handler, service_generate()
│   ├── inference.py                  # GenerationParams, generate_music()
│   └── llm_inference.py              # LLM Phase 1
├── web/
│   ├── backend/                      # FastAPI server
│   │   ├── routers/generation.py     # /generate, /pipeline endpoints
│   │   ├── schemas/
│   │   │   ├── generation.py         # GenerateRequest, AnalyzeRequest
│   │   │   └── pipeline.py           # PipelineRequest, PipelineStageConfig
│   │   └── services/
│   │       ├── audio_store.py        # UUID-keyed audio file store
│   │       ├── pipeline_executor.py  # Multi-stage pipeline runner
│   │       └── task_manager.py       # Background task queue
│   └── frontend/                     # Next.js app
│       └── src/
│           ├── app/page.tsx          # Main page, WebSocket result handler
│           ├── components/generation/
│           │   ├── GenerationPanel.tsx  # Mode tabs + shared Generate button
│           │   ├── SimpleMode.tsx       # LLM-powered auto-fill
│           │   ├── CustomMode.tsx       # Full manual control
│           │   ├── PipelineMode.tsx     # Multi-stage builder
│           │   ├── AdvancedSettings.tsx # DiT + LM param editors
│           │   └── StageBlock.tsx       # Per-stage param editor in Pipeline
│           ├── components/results/
│           │   ├── ResultsPanel.tsx   # Batch navigation + batch-level restore
│           │   └── AudioCard.tsx      # Per-audio actions (play, restore, send)
│           ├── hooks/
│           │   ├── useBatchNavigation.ts  # Batch nav + mapParamsToFields
│           │   └── useGeneration.ts       # buildRequest + generate actions
│           ├── stores/
│           │   ├── generationStore.ts     # Simple + Custom mode state
│           │   ├── pipelineStore.ts       # Pipeline mode state (separate!)
│           │   └── resultsStore.ts        # Generation results + batches
│           └── lib/
│               ├── api.ts             # REST + WebSocket client
│               └── types/index.ts     # TypeScript interfaces
```

---

## The Core Idea

**Everything is a stage.** Simple mode produces one stage. Custom mode produces one stage. Pipeline is a sequence of stages. The three modes are just different levels of UI complexity over the same underlying operation.

A **Stage** is a self-contained object:

```
Stage {
  // Identity
  id: string                    // unique within session

  // Inputs (generation params)
  params: StageParams           // caption, lyrics, steps, shift, seed, LM settings, etc.
  source: LatentRef | AudioRef | null   // what to condition on

  // Outputs (after execution)
  latent_final: Latent          // clean denoised latent [batch, T, D]
  latent_checkpoint: Latent?    // snapshot at step N (optional)
  checkpoint_step: number?      // which step the checkpoint is from
  audio: AudioFile[]            // VAE-decoded audio (only if decoded)
}
```

### Two Latent Values

Each stage can hold **two** latent snapshots:

1. **`latent_final`** — the clean latent after all N steps complete (what we store today as `stage_latents[idx]` in `pipeline_executor.py:278`)
2. **`latent_checkpoint`** — a snapshot taken at step K during the diffusion loop (does NOT exist yet)

Why two? You ran 5/8 steps in turbo and the structure is great but you want to try a different sampler for the last 3 steps. Or inject noise. Or branch into two variations from the same midpoint. The checkpoint lets you **replay from step K** without re-running steps 1 through K.

### The Workflow

```
Simple Mode ──→ [auto-fills params] ──→ Custom Mode ──→ Generate ──→ Stage Result
                                              ↑                           │
                                              │     Restore + Tweak       │
                                              ←───────────────────────────┘
                                              │
                                              │     "Add to Pipeline"
                                              ↓
                                        Pipeline Mode
                                         [stage 0] ──latent──→ [stage 1] ──latent──→ [stage 2]
                                              ↑                                          │
                                              │          Send stage to Custom             │
                                              ←──────────────────────────────────────────┘
```

1. **Simple** → LLM fills caption/lyrics/metadata → lands in Custom with params populated
2. **Custom** → full control, single stage, generates → produces a Stage Result
3. **Restore** → any result (normal or pipeline) sends params + latent ref back to Custom
4. **Tweak + Re-run** → change sampler, steps, seed, etc → re-run from latent (no VAE round-trip)
5. **Add to Pipeline** → current Custom settings become a new stage appended to Pipeline
6. **Pipeline** → sequence of stages, latents chain directly, each stage is the same object

This means Custom is the **workbench** where you iterate on a single stage, and Pipeline is the **assembly line** where you compose stages together.

---

## What Changes Architecturally

### 1. Unified Stage Params

Today, generation params live in three disconnected places:

| Where | What | File |
|-------|------|------|
| `generationStore` | Flat state for Simple + Custom | `stores/generationStore.ts` |
| `pipelineStore.stages[]` | Per-stage config for Pipeline | `stores/pipelineStore.ts` |
| `GenerationParams` | Backend dataclass | `acestep/inference.py:37` |

**Problem:** `generationStore` and `PipelineStageConfig` have overlapping but different field sets. Switching modes loses state. There's no shared "stage params" type.

**Fix:** Define a single `StageParams` type used everywhere:

```typescript
// The canonical set of params for one diffusion pass
interface StageParams {
  // Conditioning
  caption: string;
  lyrics: string;
  instrumental: boolean;
  vocalLanguage: string;
  bpm: string;
  keyscale: string;
  timesignature: string;
  duration: number;

  // Task routing
  taskType: string;           // text2music, cover, repaint, extract, lego, complete
  trackName?: string;
  completeTrackClasses?: string[];

  // Source
  srcAudioId?: string;        // uploaded audio UUID
  srcStage?: number;          // previous stage index (pipeline only)
  referenceAudioId?: string;
  audioCodes?: string;
  audioCodeHints?: string;

  // Repainting
  repaintingStart?: number;
  repaintingEnd?: number;
  audioCoverStrength: number;

  // DiT
  inferenceSteps: number;
  guidanceScale: number;
  seed: number;
  shift: number;
  inferMethod: string;        // ode, sde
  useAdg: boolean;
  cfgIntervalStart: number;
  cfgIntervalEnd: number;
  customTimesteps?: string;
  denoise: number;            // 1.0 = full, <1.0 = partial (refine)

  // LM
  thinking: boolean;
  lmTemperature: number;
  lmCfgScale: number;
  lmTopK: number;
  lmTopP: number;
  lmNegativePrompt: string;
  useCotMetas: boolean;
  useCotCaption: boolean;
  useCotLanguage: boolean;
  useConstrainedDecoding: boolean;

  // Model
  model?: string;             // base, turbo, sft — pipeline can swap per-stage
}
```

- `generationStore` becomes a single `StageParams` + mode/UI state
- `PipelineStageConfig` wraps `StageParams` + pipeline-specific fields (`inputStage`, `srcStage`, `preview`)
- `mapParamsToFields()` maps backend snake_case → `StageParams` fields (already partially done in `useBatchNavigation.ts`)

### 2. Latent Persistence (Backend)

Today latents are ephemeral — they live in `stage_latents` dict inside `run_pipeline()` and die when it returns (`pipeline_executor.py:96`). Normal generation latents are in `extra_outputs["pred_latents"]` but stripped during serialization (`generation.py:149`).

**Fix:** A server-side latent store, analogous to `audio_store`:

```python
# web/backend/services/latent_store.py
class LatentStore:
    """Stores latent tensors keyed by UUID, with TTL-based cleanup."""

    def store(self, tensor: torch.Tensor, metadata: dict) -> str:
        """Store a latent tensor, return UUID."""

    def get(self, latent_id: str) -> torch.Tensor:
        """Retrieve a latent tensor by UUID."""

    def delete(self, latent_id: str) -> None:
        """Explicitly free a latent."""
```

- **Normal generation:** After `generate_audio_core()` returns `target_latents`, store in `latent_store` and return the UUID alongside the audio result
- **Pipeline:** Replace `stage_latents` dict with `latent_store` references. Latents persist across pipeline runs so you can reference them from Custom mode
- **Checkpoint:** Add a callback hook in the diffusion loop (`diffusion_core.py:501-612`) that snapshots `xt` at a user-specified step. Store as a second latent UUID
- **Cleanup:** TTL (e.g., 30 min) or explicit delete. VRAM-aware: store on CPU by default, move to GPU on demand

### 3. Latent References in Results

Today, `AudioResult.params` has generation params but no latent reference. The frontend has no way to say "resume from this latent."

**Fix:** Add latent IDs to the result:

```typescript
interface AudioResult {
  id: string;
  params: Record<string, any>;
  // NEW:
  latentId?: string;            // UUID of the final clean latent
  latentCheckpointId?: string;  // UUID of the step-N checkpoint (if requested)
  checkpointStep?: number;      // which step the checkpoint is from
}
```

### 4. Resume-from-Latent in Custom Mode

Today, Custom mode always generates from noise (or from `srcAudioId` which goes through VAE encode). There's no way to say "start from this latent at step K."

**Fix:** Add to `generationStore` / `StageParams`:

```typescript
// Latent resume (optional — null means generate from noise)
initLatentId?: string;    // UUID of latent to start from
tStart?: number;          // starting timestep (1.0 = full schedule, 0.5 = halfway)
```

The backend `/generate` endpoint gains optional `init_latent_id` + `t_start` params. If provided:
1. Retrieve latent from `latent_store`
2. Call `model.renoise(latent, t_start)` (same as pipeline refine, `pipeline_executor.py:190`)
3. Pass `init_latents` + `t_start` to `generate_audio_core()`

This is the **exact same mechanism** pipeline refine uses today — we're just exposing it to Custom mode.

### 5. Step-Level Checkpoint in Diffusion Loop

Today the diffusion loop (`diffusion_core.py:501-612`) has no checkpoint mechanism. `xt` is overwritten in-place each step.

**Fix:** Add an optional `checkpoint_step` param to `generate_audio_core()`:

```python
# In the step loop (diffusion_core.py ~line 501)
for step_idx in range(num_steps):
    # ... existing step logic ...

    if checkpoint_step is not None and step_idx == checkpoint_step:
        checkpoint_latent = xt.detach().clone()  # snapshot before overwrite
```

Return `checkpoint_latent` alongside `target_latents` in the output dict. The caller (pipeline executor or normal generation) stores it in `latent_store`.

**Cost:** One extra `.clone()` at step K. Negligible compared to the decoder forward pass.

### 6. "Add to Pipeline" from Custom

Today there's no way to send Custom mode settings into Pipeline. The stores are independent.

**Fix:** An action in the UI:

1. User is in Custom mode with their tweaked params
2. Click "Add to Pipeline" button
3. Frontend reads `generationStore` fields, converts to a `PipelineStageConfig`
4. Calls `pipelineStore.addStage()` with those params
5. If the user has a latent ref (from a Restore), set `srcStage` or add a "virtual" stage that holds the latent
6. Switch to Pipeline mode

The reverse already works (or will, with the Restore fix): click Restore on a pipeline result → switches to Custom with all params.

### 7. Mode Unification (DRY)

The end state:

| Mode | What it is | Stages |
|------|-----------|--------|
| Simple | Auto-fill params via LLM, then run one stage | 1 |
| Custom | Manual params, one stage, full control + latent resume | 1 |
| Pipeline | Sequence of stages, latent chaining, model swapping | N |

All three produce the same `StageResult` objects. All three can feed into each other. The backend has one code path for executing a stage (today it's `service_generate()` at `handler.py:2264`).

**Frontend DRY:** `AdvancedSettings` is currently only shown for Simple + Custom (`GenerationPanel.tsx:51-84`). Pipeline stages have their own mini-param editors in `StageBlock.tsx`. These should share components — a `StageParamEditor` that renders the appropriate subset of controls based on context.

---

## Implementation Phases

### Phase 0: Fix Restore (current PR)
- [x] Expand `mapParamsToFields` to cover all params
- [x] Auto-switch to Custom mode on Restore
- [x] Pipeline results include per-stage params from backend
- [x] Per-audio Restore button in AudioCard
- [x] Send to Ref button

### Phase 1: Latent Store + Resume
**Goal:** Custom mode can resume from a previous generation's latent.

1. Create `web/backend/services/latent_store.py` — UUID-keyed tensor store with TTL
2. Normal generation stores `target_latents` in `latent_store`, returns `latent_id` in result
3. Pipeline executor uses `latent_store` instead of local `stage_latents` dict
4. Add `init_latent_id` + `t_start` to `GenerateRequest` schema
5. Backend resolves latent from store, passes to `generate_audio_core()`
6. Frontend: add `initLatentId` + `tStart` to `generationStore`
7. Restore from result populates `initLatentId`
8. UI shows "Resuming from latent" indicator + `tStart` slider (denoise)

**Key files:**
- NEW: `web/backend/services/latent_store.py`
- MODIFY: `acestep/inference.py` — store latent after generation
- MODIFY: `web/backend/routers/generation.py` — accept `init_latent_id`, resolve, pass through
- MODIFY: `web/backend/services/pipeline_executor.py` — use latent_store
- MODIFY: `web/frontend/src/stores/generationStore.ts` — add latent fields
- MODIFY: `web/frontend/src/hooks/useBatchNavigation.ts` — restore latent ID
- MODIFY: `web/frontend/src/components/results/AudioCard.tsx` — show latent info

### Phase 2: Step Checkpoint
**Goal:** Snapshot the diffusion latent at step K for replay.

1. Add `checkpoint_step` param to `generate_audio_core()` in `diffusion_core.py`
2. Clone `xt` at step K, return as `checkpoint_latent` in outputs
3. Store checkpoint in `latent_store` with metadata (step, total_steps, schedule)
4. Return `latent_checkpoint_id` + `checkpoint_step` in audio result
5. UI: show "Resume from step K" option with step slider
6. Resume from checkpoint: use checkpoint latent as `init_latents`, compute truncated schedule from step K's timestep value

**Key files:**
- MODIFY: `acestep/diffusion_core.py` — checkpoint clone in step loop
- MODIFY: `acestep/handler.py` — pass checkpoint_step, store result
- MODIFY: `acestep/inference.py` — thread checkpoint through
- MODIFY: frontend stores + UI — checkpoint step selector

### Phase 3: Add to Pipeline
**Goal:** Tack Custom mode settings onto Pipeline as a new stage.

1. "Add to Pipeline" button in Custom mode
2. Reads `generationStore`, converts to `PipelineStageConfig`
3. If Custom has a `initLatentId`, create a "virtual source" stage or reference
4. Appends to `pipelineStore.stages[]`
5. Switches to Pipeline mode
6. Stage can be reordered (drag or index change)

**Key files:**
- MODIFY: `web/frontend/src/components/generation/CustomMode.tsx` — Add to Pipeline button
- MODIFY: `web/frontend/src/stores/pipelineStore.ts` — accept stage from external source
- NEW or MODIFY: conversion helpers between `generationStore` fields and `PipelineStageConfig`

### Phase 4: Unified StageParams Type
**Goal:** DRY the param definitions across all three modes.

1. Define `StageParams` interface as the canonical type
2. `generationStore` state extends `StageParams` + UI-only fields (mode, simpleQuery, etc.)
3. `PipelineStageConfig` extends `StageParams` + pipeline-only fields (inputStage, srcStage, preview)
4. `mapParamsToFields` maps backend dict → `StageParams`
5. Shared `StageParamEditor` component used by both `AdvancedSettings` and `StageBlock`

---

## Code References

| Concept | Current Location | Notes |
|---------|-----------------|-------|
| Stage latents (pipeline) | `pipeline_executor.py:96, 278` | Local dict, dies on return |
| Latent from normal gen | `handler.py:3047, 3130-3144` | In `extra_outputs`, stripped on serialize |
| Refine re-noise | `pipeline_executor.py:181-195` | `model.renoise()` + truncated schedule |
| Diffusion step loop | `diffusion_core.py:501-612` | No checkpoint mechanism |
| Schedule truncation | `diffusion_core.py:276-296` | `TimestepScheduler.truncate()` |
| `init_latents` / `t_start` | `diffusion_core.py:334-336, 457-467` | Already supports partial denoising |
| `service_generate()` | `handler.py:2264` | Single entry point for all diffusion |
| `generate_audio_core()` | `diffusion_core.py:302` | Unified diffusion function |
| Normal gen params per-audio | `inference.py:613-694` | `base_params_dict` + per-audio seed |
| Pipeline stage config | `schemas/pipeline.py:7-50` | `PipelineStageConfig` Pydantic model |
| Generation store | `stores/generationStore.ts:11-90` | Flat state, no latent refs |
| Pipeline store | `stores/pipelineStore.ts:237-270` | Separate store, own caption/lyrics |
| Mode switch | `GenerationPanel.tsx:14-18` | Three tabs, independent renders |
| AdvancedSettings | `AdvancedSettings.tsx` | Only for Simple + Custom |
| StageBlock | `StageBlock.tsx` | Pipeline per-stage editor |
| Audio store (analog) | `web/backend/services/audio_store.py` | UUID-keyed file store, model for latent_store |
| `mapParamsToFields` | `useBatchNavigation.ts:8-42` | Backend → frontend param mapping |
| `buildRequest` | `useGeneration.ts:16-69` | Custom mode → backend request |
| Pipeline request build | `PipelineMode.tsx:127-141` | Pipeline mode → backend request |

## Storage Strategy: Tiered Latent Persistence

> **Decision made:** The storage backend is **`audio_store`-pattern safetensors flat files** —
> in-memory dict + safetensors on disk, zero external dependencies. See `UNIFIED_STAGE_EXECUTION_SPEC.md`
> Section 4.4 for the full design. The RocksDB/SQLite/LMDB discussion below is preserved as
> historical context for the decision process.

Latents are small (~96KB per batch item for 30s audio at `[batch, 375, 64]` float32) but accumulate across a session. The strategy is **hot/warm/cold tiering:**

### Hot: In-Memory (Current Generation)

Only the **most recent generation's** latents stay in GPU/CPU memory. This is what exists today — `stage_latents` in the pipeline executor, `extra_outputs["pred_latents"]` in normal generation. Fast access, zero serialization cost.

- **Scope:** Last pipeline run's stage latents, or last normal generation's output latent
- **Lifetime:** Until the next generation starts, or explicit eviction
- **Access time:** Instant (already a tensor)

### Warm: On-Disk Store (Session History)

Everything else goes to disk immediately after the generation completes. The user can reference any previous latent by UUID — the store loads it back to CPU on demand.

**Why disk, not just CPU RAM?** A long session could accumulate hundreds of latents (multiple pipeline runs, each with checkpoints). At ~96KB each that's still small, but CPU RAM is shared with model weights (which are 3-8GB+ for the LLM). Disk is abundant and latents are tiny enough that load time is negligible.

**Storage backend candidates:**

| Option | Pros | Cons |
|--------|------|------|
| **Flat files** (safetensors/pt) | Simple, no dependencies, easy to inspect | Directory scan for metadata queries, no indexing |
| **SQLite + blob** | Single file, ACID, metadata indexable, stdlib | Blob I/O overhead for tensors, 2GB blob limit (fine for latents) |
| **RocksDB** | Fast K/V, embedded, great for blob storage, no size limits | Extra dependency (`python-rocksdb`), less inspectable |
| **LMDB** | Memory-mapped, very fast reads, embedded | Write-once semantics, less flexible metadata |

**Current leaning: RocksDB.** Reasons:
- Latent store is a key-value problem (UUID → tensor bytes + metadata). RocksDB is purpose-built for this.
- Embedded (no server process), C++ core with Python bindings, battle-tested at scale.
- Supports prefix iteration (find all latents for a session/pipeline), TTL-based compaction, compression.
- The data isn't sensitive (music latents, not credentials), so encryption isn't needed.
- Column families could separate latent blobs from metadata for efficient scans.

**Alternative: safetensors flat files** if we want zero dependencies. One `.safetensors` file per latent with metadata in the header. Simple, inspectable, but no indexing.

### Cold: Exportable (Cross-Session)

For future consideration: export a latent + params as a portable `.stage` file that can be imported in a new session or shared. This is like a "save state" for a diffusion midpoint. Not in scope for Phase 1-2 but the storage design should not preclude it.

### Schema

Regardless of backend, each stored latent needs:

```python
LatentRecord = {
    "id": str,               # UUID
    "tensor": bytes,          # serialized tensor (safetensors or raw)
    "shape": tuple,           # (batch, T, D) for validation
    "dtype": str,             # "float32", "float16"

    # Provenance
    "model_variant": str,     # "acestep-v15-base", "acestep-v15-turbo"
    "stage_type": str,        # "generate", "refine", "cover", etc.
    "is_checkpoint": bool,    # True if mid-step snapshot, False if final
    "checkpoint_step": int?,  # which step (if checkpoint)
    "total_steps": int,       # how many steps the full run had
    "schedule": list[float]?, # timestep schedule used (for resume)

    # Params snapshot (for Restore)
    "params": dict,           # full StageParams used to produce this latent

    # Lifecycle
    "created_at": float,      # timestamp
    "session_id": str?,       # for cross-session grouping
    "pipeline_id": str?,      # if part of a pipeline run
    "stage_index": int?,      # position in pipeline
}
```

### Eviction Policy

- **In-memory tier:** Evict when a new generation starts (swap to disk)
- **On-disk tier:** TTL-based (default 24h), user can pin/star latents to prevent eviction
- **Manual delete:** UI can show stored latents and let user delete or export

### Size Estimates

| Scenario | Latents | Size (disk) |
|----------|---------|-------------|
| Single generation (batch=2) | 2 | ~192KB |
| 10-stage pipeline (batch=2) | 20 | ~1.9MB |
| Full session (50 generations) | 100 | ~9.6MB |
| With step checkpoints (2x) | 200 | ~19MB |
| Heavy session (200 gens + checkpoints) | 800 | ~77MB |

Even a heavy session is under 100MB on disk. This is a non-issue.

---

## Open Questions

> Several of these have been resolved in `UNIFIED_STAGE_EXECUTION_SPEC.md` (v2).
> Resolved items are marked below. Remaining open items need design decisions or GPU testing.

1. ~~**Storage backend choice:**~~ **RESOLVED** → `audio_store`-pattern safetensors flat files. Zero external dependencies, proven pattern. LanceDB deferred for future search/retrieval needs. See Exec Spec Section 4.4.

2. ~~**Latent format stability:**~~ **RESOLVED** → Reject mismatched latents. Strict model variant check, shape check, dtype check. See Exec Spec Section 8 (Replay Compatibility Rules).

3. ~~**Multi-batch latent handling:**~~ **RESOLVED** → Store full batch tensor `[batch, T, D]`. `resume_sample_index` (default 0) selects which batch item. A "branch" is picking a different batch item. See Exec Spec Section 6 (Batch semantics).

4. ~~**Virtual stages:**~~ **RESOLVED** → `src_latent_id` field on the stage config. Same source type pattern as `srcAudioId` and `srcStage`, resolved by precedence: `src_latent_id > src_stage > src_audio_id > noise`. See Exec Spec Section 4.2.

5. **Undo / branching:** OPEN. Resuming from step K with different settings creates a **tree** of latents, not a linear chain. Do we expose this as a tree visualization? Or keep it linear (each new run replaces the previous branch)? For Phase 2, linear is fine — the user manually manages variants. A tree view is a Phase 4+ polish item.

6. ~~**Checkpoint granularity:**~~ **RESOLVED** → User specifies one checkpoint step for now. Auto-checkpoint deferred. See Exec Spec Section 12.2, deferred item 3.

7. ~~**Pipeline ↔ Custom state sync:**~~ **RESOLVED** → Pipeline state is untouched when switching to Custom. Custom is a scratch pad, Pipeline is the assembled sequence. See Exec Spec Section 7, Phase 5.

8. **LM Phase 1 in pipeline stages:** OPEN. Currently pipeline defaults `thinking=false` and skips LLM entirely. With unified stages, should each pipeline stage optionally run Phase 1? This would let a stage get fresh CoT metadata before diffusion. Useful for stages with different captions/lyrics than the shared values. Cost: LLM inference per stage (~2-5s). Benefit: better conditioning for diverse multi-stage compositions.

---

## Deep Research Questions (External Agent)

> Some of these have been addressed by decisions in `UNIFIED_STAGE_EXECUTION_SPEC.md`.
> They remain here as reference for future pressure-testing and GPU validation.

Use these to pressure-test assumptions before implementation:

1. **Resume determinism:** If we resume from the same stored latent + same params + same seed, how deterministic is output across GPUs (A100 vs consumer RTX), dtypes (fp16/bf16/fp32), and torch/cuDNN versions?

2. **`t_start` correctness:** For each scheduler mode (`linear`, `discrete`, `continuous`) and both samplers (`ode`, `sde`), does `truncate(schedule, t_start)` match the intended "resume from step K" semantics, or do we need step-index based resume metadata?

3. **Checkpoint fidelity:** Is cloning `xt` at step K the right resume point, or should checkpointing store `x0`/velocity terms too to avoid drift when continuing from a midpoint?

4. **Renoise equivalence:** Is `model.renoise(clean_latent, t_start)` equivalent in quality to replaying diffusion from an actual midpoint latent, especially for turbo variants?

5. **Metadata minimum set:** What exact metadata is required for safe replay (`variant`, scheduler, shift, timesteps, infer_method, CFG window, cover switch point)? Which fields are mandatory vs optional?

6. **Cross-variant compatibility:** When reusing one latent across base/sft/turbo stages, what objective quality deltas appear, and which combinations are unsafe or unstable?

7. **Latent compression:** What quality/perf tradeoff do we get from storing latents as fp16 or bf16 versus fp32? Is there audible degradation after multiple resume cycles?

8. **Storage backend benchmark:** For expected workload (100-1000 latents/session), compare flat `safetensors` files vs SQLite blobs vs RocksDB on write latency, read latency, operational complexity, and failure recovery.

9. **Dependency risk:** How reliable is `python-rocksdb` installation across Linux/macOS/Windows in typical user environments? Is the support burden worth it versus stdlib SQLite or flat files?

10. **Process crash recovery:** What should happen to latent records if the server crashes mid-write? Do we need atomic write + checksum + startup scrub?

11. **Lifecycle coupling:** Should latent eviction be tied to task lifecycle (`task_manager.cleanup_old_tasks`) and audio TTL (`audio_store`) so references do not outlive UI-visible results?

12. **Concurrency model:** If multiple users/sessions run concurrently, how should latent IDs be namespaced and access-controlled to prevent accidental cross-session reuse?

13. **Failure UX:** What is the best product behavior when a latent is missing/expired/mismatched (hard error, silent fallback to noise, or guided repair flow)?

14. **Batch semantics:** Should a latent record always keep full batch tensors, or split into per-sample latent IDs to simplify branching and avoid accidental batch-index confusion?

15. **Audio-task bridge:** For stages that require waveform source (cover/repaint/extract/lego/complete), can we avoid repeated VAE decode/encode loops by adding latent-native source paths, and does it improve quality measurably?

16. **Scoring/LRC interoperability:** Today score/LRC depend on `task.extra_outputs`. Should persistent latent records also include or link required condition tensors to enable post-hoc scoring/LRC after task cleanup?

17. **API evolution:** What is the least disruptive versioning path to add `latent_id`, `init_latent_id`, `checkpoint_step`, etc., while keeping existing clients fully backward-compatible?

18. **Testing strategy:** What minimal automated matrix catches regressions for unified stages: generate, pipeline, resume-from-latent, checkpoint replay, model swap, and TTL eviction?

19. **Observability:** Which metrics should be tracked from day one (latent store hit rate, load latency, eviction count, resume success/failure rate, memory pressure)?

20. **Security and privacy:** If deployed beyond local single-user use, should latent IDs be treated as bearer tokens, and do we need optional encryption-at-rest for latent blobs?
