# Unified Stage Execution Spec

> **Status:** Revised draft (v2). Incorporates codebase review feedback.
> **Scope:** Unified stage architecture with persistent latents, resume/checkpoint, and cross-mode workflows.
> **Storage:** `audio_store`-pattern flat files (in-memory dict + safetensors on disk). LanceDB deferred until retrieval needs emerge.

---

## 1) Objectives

1. Unify `Simple`, `Custom`, and `Pipeline` around one stage model.
2. Persist latents beyond single request lifetime.
3. Support restore/resume without VAE round-trips.
4. Add checkpoint-at-step for branch/replay workflows.
5. Enable bidirectional flow between Custom and Pipeline modes.

## 2) Non-Goals (Initial Delivery)

1. Full DAG pipeline executor with conditional branching.
2. Tree visualization UI for latent lineage.
3. Cross-model latent conversion.
4. Search/retrieval index (deferred — migrate to LanceDB when prompt library + latent catalog UX demands it).
5. Observability/metrics infrastructure (use `loguru` logging at call sites).

---

## 3) Current Baseline (Code Anchors)

### 3.1 Backend

| What | File:Line | Notes |
|------|-----------|-------|
| `GenerateRequest` | `web/backend/schemas/generation.py:7` | Flat request for Simple + Custom |
| `PipelineStageConfig` | `web/backend/schemas/pipeline.py:7` | Per-stage config |
| `PipelineRequest` | `web/backend/schemas/pipeline.py:53` | Shared + stages array |
| `run_pipeline()` | `web/backend/services/pipeline_executor.py:80` | Multi-stage executor |
| `resolve_src_audio()` | `web/backend/services/pipeline_executor.py:34` | Source resolution: upload or prev stage |
| `stage_latents` dict | `web/backend/services/pipeline_executor.py:96` | Ephemeral, dies on return |
| Latent stored per stage | `web/backend/services/pipeline_executor.py:278` | `outputs["target_latents"].detach().cpu()` |
| Per-stage params build | `web/backend/services/pipeline_executor.py:359-404` | Shared + per-stage merge for Restore |
| Normal gen route | `web/backend/routers/generation.py:38` | `@router.post("/generate")` |
| Result serialization | `web/backend/routers/generation.py:143-149` | Keeps `time_costs` + `lm_metadata`, tensors stay in-memory on task object |
| `audio_store` pattern | `web/backend/services/audio_store.py` | 104 lines, in-memory dict + flat files + TTL thread |
| Config env vars | `web/backend/config.py` | `TEMP_DIR`, `AUDIO_TTL_HOURS` |

### 3.2 Core Diffusion

| What | File:Line | Notes |
|------|-----------|-------|
| `generate_audio_core()` | `acestep/diffusion_core.py:302` | Unified diffusion function for all variants |
| `TimestepScheduler.truncate()` | `acestep/diffusion_core.py:276` | Finds first timestep <= t_start |
| Schedule truncation used | `acestep/diffusion_core.py:457-458` | `if init_latents ... truncate(schedule, t_start)` |
| `init_latents` / `t_start` | `acestep/diffusion_core.py:334-336, 464-467` | Already supports partial denoising |
| Diffusion step loop | `acestep/diffusion_core.py:501` | `with torch.no_grad():` wraps loop at 502 |
| Cover temporal switch | `acestep/diffusion_core.py:461` | `cover_steps = int(num_steps * strength)` |
| KV cache reset at switch | `acestep/diffusion_core.py:529-531` | Clears cache when switching from source to text-only |
| `service_generate()` | `acestep/handler.py:2264` | Single entry point for all diffusion |
| `generate_music()` (handler) | `acestep/handler.py:2860` | Called by `inference.generate_music()` |
| `pred_latents` extraction | `acestep/handler.py:3047` | `outputs["target_latents"]` |
| `extra_outputs` construction | `acestep/handler.py:3130` | Includes `pred_latents` (kept in-memory, not serialized) |
| `is_covers` detection | `acestep/handler.py:1884-1901` | Substring match on instruction text |
| VQ bottleneck (cover) | Model code `modeling_*.py:1638-1649` | 25Hz→5Hz quantize→25Hz detokenize |
| `inference.generate_music()` | `acestep/inference.py:~line 400` | Wrapper that router calls |
| `base_params_dict` per-audio | `acestep/inference.py:613-694` | `params.to_dict()` + per-audio seed override |

### 3.3 Frontend

| What | File:Line | Notes |
|------|-----------|-------|
| `GenerateRequest` type | `web/frontend/src/lib/types/index.ts:38` | |
| `AudioResult` type | `web/frontend/src/lib/types/index.ts:97` | |
| `PipelineStageConfig` type | `web/frontend/src/lib/types/index.ts:270` | |
| `BatchEntry` type | `web/frontend/src/lib/types/index.ts:342` | |
| `mapParamsToFields()` | `web/frontend/src/hooks/useBatchNavigation.ts:8` | Backend snake_case → frontend camelCase |
| `handleRestoreParams` | `web/frontend/src/components/results/AudioCard.tsx:121` | Per-audio restore |
| `handleSendToSrc` | `web/frontend/src/components/results/AudioCard.tsx:111` | Sets `srcAudioId` |
| `handleSendToRef` | `web/frontend/src/components/results/AudioCard.tsx:116` | Sets `referenceAudioId` |
| `GenerationState` | `web/frontend/src/stores/generationStore.ts:11` | Simple + Custom mode state |
| `PipelineState` | `web/frontend/src/stores/pipelineStore.ts:237` | Pipeline mode state (separate store) |
| Pipeline result ingestion | `web/frontend/src/app/page.tsx:21` | Normalizes pipeline → BatchEntry |
| Mode tabs | `web/frontend/src/components/generation/GenerationPanel.tsx:14` | Simple / Custom / Pipeline |
| `AdvancedSettings` | `web/frontend/src/components/generation/AdvancedSettings.tsx` | Only for Simple + Custom |
| `StageBlock` | `web/frontend/src/components/generation/StageBlock.tsx` | Per-stage editor in Pipeline |
| `buildRequest()` | `web/frontend/src/hooks/useGeneration.ts:16-69` | Custom mode → backend request |
| Pipeline request build | `web/frontend/src/components/generation/PipelineMode.tsx:127-141` | |

---

## 4) Target Architecture

### 4.1 Canonical Concepts

1. **`StageParams`** — canonical parameter set for one diffusion pass (shared TS + Python type).
2. **`StageSource`** — one of: `noise | src_audio_id | src_stage | src_latent_id`.
3. **`StageResult`** — per-audio output including `latent_id` and optional checkpoint references.
4. **`LatentRecord`** — persistent latent artifact with provenance, params snapshot, and lifecycle metadata.

### 4.2 Source Precedence

When multiple source fields are set on a stage, resolve in this order:

```
src_latent_id  >  src_stage  >  src_audio_id  >  noise
```

- **`src_latent_id`:** Load tensor from `latent_store`. For refine stages, use directly as `init_latents`. For audio-requiring stages (cover/repaint/extract/lego/complete), **always VAE-decode to waveform first** — the VQ bottleneck pathway must be preserved for covers.
- **`src_stage`:** Existing behavior — look up in ephemeral `stage_latents` dict (or `latent_store` after migration).
- **`src_audio_id`:** Existing behavior — load file from `audio_store`, process via `handler.process_src_audio()`.
- **noise:** Default — random Gaussian noise via `model.prepare_noise()`.

If a specified source is missing/expired, **hard error** — no silent fallback to noise. The error message includes the missing latent ID so the user can re-generate.

### 4.3 Cover Mechanism Compatibility

Audio-requiring stages route through a waveform path regardless of source type:

```
src_latent_id → latent_store.get() → VAE decode → waveform → [existing cover/repaint/etc pathway]
src_stage     → stage_latents[idx]  → VAE decode → waveform → [existing cover/repaint/etc pathway]
src_audio_id  → audio_store.get()   → load file  → waveform → [existing cover/repaint/etc pathway]
```

For cover specifically, the waveform enters the VQ bottleneck (25Hz→5Hz quantize→25Hz detokenize) and the temporal switch (`cover_steps = int(num_steps * strength)`) applies exactly as today. The `is_covers` detection via instruction substring match (`handler.py:1884-1901`) is unchanged.

For `refine` stages only, `src_latent_id` provides a **fast path** that skips VAE decode entirely:

```
src_latent_id → latent_store.get() → model.renoise(latent, t_start) → init_latents
```

This is the same mechanism as `pipeline_executor.py:181-195` today.

### 4.4 Storage: `audio_store`-Pattern Flat Files

Follow the proven `audio_store.py` pattern (104 lines, zero external deps):

```python
# web/backend/services/latent_store.py
@dataclass
class LatentRecord:
    id: str
    path: str                      # safetensors file on disk
    shape: tuple                   # (batch, T, D) for validation
    dtype: str                     # "float32"
    model_variant: str             # "acestep-v15-base", etc.
    stage_type: str                # "generate", "refine", "cover", etc.
    is_checkpoint: bool            # True if mid-step snapshot
    checkpoint_step: Optional[int] # which step (if checkpoint)
    total_steps: int               # how many steps the full run had
    schedule: Optional[List[float]] # timestep schedule used (for resume)
    params: dict                   # full StageParams snapshot
    lm_metadata: Optional[dict]    # BPM, key, structure from LLM Phase 1
    batch_size: int                # number of samples in batch dim
    created_at: float
    pinned: bool = False           # user-pinned, survives TTL cleanup
    pipeline_id: Optional[str] = None
    stage_index: Optional[int] = None

class LatentStore:
    """In-memory dict + safetensors on disk. Same pattern as AudioStore."""

    def __init__(self):
        self._records: Dict[str, LatentRecord] = {}
        self._lock = threading.Lock()
        os.makedirs(config.LATENT_DIR, exist_ok=True)

    def store(self, tensor: Tensor, metadata: dict) -> str:
        """Serialize tensor to safetensors, store record, return UUID."""

    def get(self, latent_id: str) -> Optional[Tensor]:
        """Load tensor from disk by UUID. Returns None if expired/missing."""

    def get_record(self, latent_id: str) -> Optional[LatentRecord]:
        """Get metadata without loading tensor."""

    def pin(self, latent_id: str) -> bool:
        """Mark latent as pinned (survives TTL cleanup)."""

    def delete(self, latent_id: str) -> None:
        """Explicitly remove a latent and its file."""

    def list_records(self) -> List[LatentRecord]:
        """List all stored latents (metadata only, no tensors)."""

    # TTL cleanup thread — same pattern as AudioStore._cleanup_loop
```

**Hot tier:** Most recent generation's latents stay in the in-memory dict (fast access). Safetensors file is written immediately (crash-safe).

**Warm tier:** Older latents are in the dict + on disk. `get()` reads from disk via `safetensors.torch.load_file()`. Load time for ~96KB is <1ms.

**Eviction:** TTL thread (same as `audio_store._cleanup_loop`). Default 24h. Pinned latents survive cleanup.

**Config additions to `web/backend/config.py`:**
```python
LATENT_DIR = os.getenv("ACE_LATENT_DIR", os.path.join(TEMP_DIR, "latents"))
LATENT_TTL_HOURS = int(os.getenv("ACE_LATENT_TTL_HOURS", "24"))
```

**Future migration path:** If the project grows to need search/retrieval over thousands of latents across sessions, swap the in-memory dict for LanceDB (HNSW + metadata filtering). The `LatentStore` interface stays the same — only the backing implementation changes.

### 4.5 Two Latent Values Per Stage

Each completed stage can produce up to two stored latents:

1. **`latent_final`** — the clean denoised latent after all N steps. Always stored. This is what `stage_latents[idx]` holds today (`pipeline_executor.py:278`).

2. **`latent_checkpoint`** — a snapshot of `xt` at user-specified step K during the diffusion loop. Optionally stored. This is a **new capability** added by the checkpoint feature.

Both get their own `LatentRecord` with `is_checkpoint=False` / `is_checkpoint=True` respectively. They share the same `params` snapshot but differ in `checkpoint_step`, `total_steps`, and the actual tensor content.

**Why two?** The final latent is the "finished" result. The checkpoint is a "save point" — resume from step K with different sampler, seed, guidance, or other params without re-running steps 1 through K.

---

## 5) Data Contracts (Backward-Compatible Additions)

All additions are optional fields with defaults. Existing clients work unchanged.

### 5.1 `GenerateRequest` additions

```python
# web/backend/schemas/generation.py
init_latent_id: Optional[str] = None       # Resume from stored latent
t_start: float = 1.0                       # Starting timestep (1.0 = full, <1.0 = partial)
checkpoint_step: Optional[int] = None      # Snapshot xt at this step
resume_sample_index: Optional[int] = None  # Which batch item to use from stored latent
```

### 5.2 `PipelineStageConfig` additions

```python
# web/backend/schemas/pipeline.py
src_latent_id: Optional[str] = None        # Use stored latent as source
checkpoint_step: Optional[int] = None      # Snapshot xt at this step
```

### 5.3 `AudioResult` additions (response)

```python
# In result audio dicts (generation.py route + pipeline_executor.py)
latent_id: str                              # UUID of final clean latent
latent_checkpoint_id: Optional[str] = None  # UUID of step-K checkpoint
checkpoint_step: Optional[int] = None       # Which step
lm_metadata: Optional[dict] = None          # BPM, key, etc. from LLM Phase 1
```

### 5.4 Frontend type additions

```typescript
// web/frontend/src/lib/types/index.ts — AudioResult
latentId?: string;
latentCheckpointId?: string;
checkpointStep?: number;
lmMetadata?: Record<string, any>;

// web/frontend/src/stores/generationStore.ts — new fields
initLatentId: string | null;      // null = generate from noise
tStart: number;                   // 1.0 = full schedule
checkpointStep: number | null;    // null = no checkpoint
```

---

## 6) Per-Stage Field Conventions

### The `or`-fallback problem

Today, per-stage fields fall back to shared values using Python's `or` operator:

```python
# pipeline_executor.py:165-166
stage_caption = stage.caption or req.caption
stage_lyrics = stage.lyrics or req.lyrics
```

**Problem:** Empty string `""` is falsy in Python. If a user explicitly sets caption to `""` (meaning "no caption"), the `or` treats it as "use shared caption." This coupling also applies to `keyscale`, `timesignature`, and any new per-stage fields.

**Convention (must be enforced in all new code):**

| Value | Meaning |
|-------|---------|
| `None` | "Use shared value from parent request" |
| `""` (empty string) | "Explicitly empty — no value" |
| `"some text"` | "Use this value" |

**Fix:** Replace `or` with explicit `None` check:

```python
stage_caption = stage.caption if stage.caption is not None else req.caption
```

This change should be applied to existing `caption`/`lyrics` fallbacks in `pipeline_executor.py:165-166` and to all new per-stage fields.

**Frontend:** Pydantic's `Optional[str] = None` + JSON `null` → `None` means the frontend must send `undefined` (omit the field) or `null` to mean "use shared." Sending `""` means "explicitly empty." This is already correct for the existing fields (per MEMORY.md gotcha) but must be documented for new fields.

### Mode-specific field mapping

Simple, Custom, and Pipeline use different field names for overlapping concepts:

| Concept | Simple Mode | Custom Mode | Pipeline Stage | Backend Param |
|---------|------------|-------------|----------------|---------------|
| Text description | `simpleQuery` | `caption` | `stage.caption` / `req.caption` | `caption` |
| Instrumental flag | `simpleInstrumental` | `instrumental` | `req.instrumental` | `instrumental` |
| Vocal language | `simpleVocalLanguage` | `vocalLanguage` | `req.vocal_language` | `vocal_language` |
| Format flag | — | `isFormatCaption` | — | `is_format_caption` |
| Instruction | — | `instruction` | Built by `build_stage_instruction()` | `instruction` |
| Batch size | — | `batchSize` | `req.batch_size` | `batch_size` |
| Denoise | — | — | `stage.denoise` | `t_start` (computed from denoise) |

**Simple → Custom conversion:** `simpleQuery` maps to `caption` (it's a natural language description). `simpleInstrumental` → `instrumental`. `simpleVocalLanguage` → `vocalLanguage`. When restoring to Custom mode, these fields are already mapped correctly by `mapParamsToFields` because the backend stores `caption`/`instrumental`/`vocal_language` regardless of which mode initiated the request.

**Custom → Pipeline conversion:** Most fields map 1:1. Exceptions: `instruction` is auto-built by `build_stage_instruction()` on the backend (not user-editable in pipeline), `isFormatCaption` is Custom-only, `denoise` is Pipeline-only (Custom uses `tStart` via latent resume).

### Batch semantics

`LatentRecord` stores the **full batched tensor** `[batch, T, D]`. The `batch_size` field records how many samples are in the batch dimension.

When restoring/resuming, `resume_sample_index` (default: `0`) selects which batch item to use. A "branch" is just selecting a different batch item from the same stored latent.

For pipeline stages, the current behavior of using batch item 0 as shared source (`pipeline_executor.py:70`) is preserved. The user can override with `resume_sample_index` on per-stage basis in future iterations.

---

## 7) Execution Phases

### Phase 1: Latent Store + Normal Generation Integration

**Goal:** Every generation persists its latents. Results include latent IDs.

Backend:
- [ ] Add `LATENT_DIR` and `LATENT_TTL_HOURS` to `config.py`
- [ ] Create `web/backend/services/latent_store.py` — `LatentStore` class following `audio_store` pattern
- [ ] Wire into `app.py` lifespan (start/stop cleanup thread)
- [ ] In `generation.py` route: after generation completes, store per-sample `target_latents` in `latent_store`, attach `latent_id` to each audio result
- [ ] Preserve existing `extra_outputs` behavior for score/LRC compatibility
- [ ] Include `lm_metadata` from `extra_outputs` in both the `LatentRecord` and the audio result

Frontend:
- [ ] Add `latentId`, `latentCheckpointId`, `checkpointStep`, `lmMetadata` to `AudioResult` type
- [ ] Display latent indicator on AudioCard when `latentId` is present (small badge/icon)

Exit criteria: Every generated sample has a `latent_id` in its result. Latents survive on disk across server restarts.

### Phase 2: Pipeline Integration

**Goal:** Pipeline stages persist latents. Cross-run resume is possible.

- [ ] In `pipeline_executor.py`: after each stage's `service_generate()`, store latent in `latent_store` alongside the existing `stage_latents[idx]` (keep ephemeral dict for fast intra-pipeline access)
- [ ] Attach `latent_id` to per-stage audio results (extend the params-building block at `pipeline_executor.py:359-404`)
- [ ] Add `src_latent_id` to `PipelineStageConfig` schema
- [ ] In `resolve_src_audio()` and stage setup logic: add `src_latent_id` resolution at highest priority
  - For refine: load latent, `model.renoise()`, pass as `init_latents` (fast path, no VAE)
  - For audio-requiring stages: load latent, VAE decode to waveform, then existing pathway (preserves VQ bottleneck for covers)
- [ ] Hard error if `src_latent_id` points to missing/expired latent (no silent fallback)

Exit criteria: Pipeline outputs include `latent_id` per stage. A new pipeline run can reference latents from a previous run via `src_latent_id`.

### Phase 3: Resume API

**Goal:** Custom mode can resume from any stored latent.

Backend:
- [ ] Add `init_latent_id`, `t_start`, `resume_sample_index` to `GenerateRequest` schema
- [ ] In `generation.py` route: if `init_latent_id` is set, resolve latent from store, select batch item, validate compatibility (model variant, shape, dtype), call `model.renoise(latent, t_start)`, pass as `init_latents`
- [ ] Fix `or`-fallback in `pipeline_executor.py:165-166` — replace with `if is not None` check
- [ ] Apply same convention to all new per-stage fields
- [ ] Compatibility validation: reject if stored latent's `model_variant` doesn't match current loaded model. Return clear error with expected vs actual variant

Frontend:
- [ ] Add `initLatentId`, `tStart` to `generationStore`
- [ ] Update `mapParamsToFields` to restore `initLatentId` from result's `latentId`
- [ ] Add "Resuming from latent" indicator in Custom mode UI when `initLatentId` is set
- [ ] Add `tStart` / denoise slider (reuse existing `audioCoverStrength` slider pattern with different label)
- [ ] "Clear latent" button to reset `initLatentId` to null (generate from noise)

Exit criteria: User can Restore a result → get latent ref populated → tweak params → Generate resumes from that latent with truncated schedule.

### Phase 4: Step Checkpointing

**Goal:** Snapshot the diffusion latent at step K for replay.

Backend:
- [ ] Add `checkpoint_step` param to `generate_audio_core()` in `diffusion_core.py`
- [ ] In the step loop (inside `with torch.no_grad():` at line 501): clone `xt` at target step

```python
# diffusion_core.py step loop (~line 502)
checkpoint_latent = None
for step_idx in range(num_steps):
    # ... existing step logic ...
    if checkpoint_step is not None and step_idx == checkpoint_step:
        checkpoint_latent = xt.detach().clone()
```

- [ ] Return `checkpoint_latent` alongside `target_latents` in output dict
- [ ] Thread `checkpoint_step` through `handler.py` → `inference.py` → `diffusion_core.py`
- [ ] Store checkpoint latent in `latent_store` with `is_checkpoint=True`, `checkpoint_step=K`, `schedule=full_schedule`
- [ ] Attach `latent_checkpoint_id` and `checkpoint_step` to audio result

Frontend:
- [ ] Add `checkpointStep` to `generationStore` and `PipelineStageConfig`
- [ ] Show checkpoint step selector (number input, 0 to inferenceSteps-1)
- [ ] When restoring from a checkpoint: set `initLatentId` to the checkpoint's latent ID, compute `tStart` from checkpoint's schedule position

**Resume from checkpoint:** The checkpoint stores `xt` at the noise level of step K. To resume:
1. Load checkpoint tensor as `init_latents`
2. Use the stored `schedule` to find the timestep value at step K
3. Set `t_start` to that value
4. `TimestepScheduler.truncate()` clips the schedule to start from step K's position
5. Diffusion continues from step K+1 through step N with the new params

Cost: One `.clone()` at step K — negligible vs decoder forward pass.

Exit criteria: Checkpoint + replay works end-to-end for both normal generation and pipeline stages.

### Phase 5: Frontend Unification + Cross-Mode Actions

**Goal:** DRY the param types. Bidirectional Custom ↔ Pipeline flow.

Type unification:
- [ ] Define `StageParams` interface as the canonical type in `types/index.ts`
- [ ] `generationStore` state: `StageParams` + UI-only fields (`mode`, `simpleQuery`, `simpleInstrumental`, `simpleVocalLanguage`, `isFormatCaption`, `useRandomSeed`, `autoScore`, `autoLrc`, `autoGen`, etc.)
- [ ] `PipelineStageConfig`: `StageParams` + pipeline-only fields (`inputStage`, `srcStage`, `preview`, `model`)
- [ ] Centralize `mapParamsToFields()` as the single backend→frontend mapping utility
- [ ] Extract shared `StageParamEditor` component from `AdvancedSettings` + `StageBlock` (both render DiT params, LM params — share the controls)

Cross-mode actions:
- [ ] **"Add to Pipeline" button** in Custom mode:
  1. Read `generationStore` fields, convert to `PipelineStageConfig`
  2. If `initLatentId` is set, carry it as `src_latent_id` on the new stage
  3. Call `pipelineStore.addStage()` with those params
  4. Switch to Pipeline mode
- [ ] **"Send stage to Custom" button** in Pipeline's `StageBlock`:
  1. Read stage params, convert to `generationStore` fields via `mapParamsToFields`
  2. If stage has `src_latent_id` or a result with `latent_id`, set `initLatentId`
  3. Switch to Custom mode
- [ ] Pipeline state is untouched when switching modes — Custom is a scratch pad, Pipeline is the assembled sequence

Exit criteria: No field loss when moving Simple → Custom → Pipeline → Custom. Roundtrip preserves all params + latent references.

---

## 8) Replay Compatibility Rules

When resuming from a stored latent, validate before calling diffusion:

| Check | Rule | Error |
|-------|------|-------|
| Model variant | `record.model_variant == current_model_variant` | "Latent was generated with {X}, current model is {Y}" |
| Tensor shape | `record.shape[1:] == expected_shape[1:]` (T, D dims match) | "Latent shape mismatch" |
| Dtype | `record.dtype` is loadable by current setup | Warn, cast if possible |
| Batch size | `resume_sample_index < record.batch_size` | "Sample index {N} out of range (batch has {M} items)" |

**NOT checked** (intentionally flexible):
- `infer_method` — you can resume an ODE-started latent with SDE and vice versa
- `shift` — different shift values change the schedule but the latent is still valid
- `guidance_scale` — safe to change between resume runs
- `seed` — different seed is the whole point of branching

**Cross-variant note:** base/sft/turbo share the same latent space dimensions (`D=64`), so a latent from one *could* work with another. But training differences mean quality is unpredictable. The model variant check prevents this by default. A future `--force-cross-variant` flag could override for experimentation.

---

## 9) Test Matrix

### 9.1 Contract/API
- [ ] Existing clients work with new optional fields omitted
- [ ] Result payload backward compatibility (no new required fields)

### 9.2 Functional
- [ ] Generate → Restore → Resume path (Custom mode)
- [ ] Pipeline stage outputs restore in Custom mode with latent ref
- [ ] `src_audio_id`, `src_stage`, `src_latent_id` source routing coverage
- [ ] Checkpoint creation + replay (same params = same output in same env)
- [ ] Cover stage with `src_latent_id` preserves VQ bottleneck pathway
- [ ] Refine stage with `src_latent_id` uses fast path (no VAE decode)

### 9.3 Lifecycle
- [ ] Latent survives server restart (safetensors on disk + re-scan on startup)
- [ ] TTL eviction removes expired latents and their files
- [ ] Pinned latent survives TTL cleanup
- [ ] Missing latent returns clear error, no silent fallback

### 9.4 Cross-Mode
- [ ] Custom → "Add to Pipeline" carries params + latent ref
- [ ] Pipeline → "Send to Custom" carries params + latent ref
- [ ] Pipeline state untouched when switching to Custom and back

---

## 10) Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Replay mismatch across model variants | Corrupted output | Strict variant check, reject by default |
| Silent fallback to noise | User confusion | Hard error on missing latent, no fallback |
| `or`-fallback coupling on new per-stage fields | Wrong conditioning | Standardize `None` = shared, `""` = empty; replace all `or` with `is not None` |
| Frontend field drift between stores | Lost state on mode switch | Canonical `StageParams` type, shared mapping utility |
| Safetensors disk growth over long sessions | Disk full | TTL cleanup (default 24h), pinning for important latents, size monitoring in logs |
| Checkpoint `xt` vs `x0` fidelity | Drift on resume | Start with `xt` clone (simplest). If drift is audible, add `x0`/velocity storage in future |

---

## 11) Work Packages

| WP | Scope | Phase | Estimated Size |
|----|-------|-------|----------------|
| WP-A | Schema additions (both languages) + `or`-fallback fix | Phase 1 | S |
| WP-B | `latent_store` service + config + lifecycle | Phase 1 | M |
| WP-C | Normal generation integration (store + return latent IDs) | Phase 1 | S |
| WP-D | Pipeline integration (store + `src_latent_id` resolution) | Phase 2 | M |
| WP-E | Resume API (thread `init_latent_id`/`t_start` through stack) | Phase 3 | M |
| WP-F | Checkpoint capture + replay path in diffusion core | Phase 4 | S |
| WP-G | Frontend `StageParams` type + `mapParamsToFields` expansion | Phase 5 | M |
| WP-H | Cross-mode actions (Add to Pipeline / Send to Custom) | Phase 5 | M |
| WP-I | Shared `StageParamEditor` component (DRY AdvancedSettings + StageBlock) | Phase 5 | L |

Each work package ships with: code diff, contract diff (if applicable), test updates.

---

## 12) Decision Log

### 12.1 Accepted

1. **`audio_store`-pattern flat storage** for latent persistence. In-memory dict + safetensors on disk. Zero new dependencies. Proven pattern.
2. **Backward-compatible API evolution** — optional fields only, no breaking changes.
3. **Hard error on missing latent** — no silent fallback to noise.
4. **`None` = shared, `""` = empty** convention for per-stage field fallbacks.
5. **Full batch tensor storage** — `LatentRecord` keeps `[batch, T, D]`, `resume_sample_index` selects item.
6. **Cover stages always VAE-decode** — `src_latent_id` goes through waveform path for cover/repaint/etc, preserving VQ bottleneck.
7. **`lm_metadata` stored in `LatentRecord`** — needed for UI display when resuming (LLM phase skipped).

### 12.2 Deferred

1. **LanceDB search/retrieval index** — migrate when prompt library + latent catalog UX demands it. Interface stays the same, only backing store changes.
2. **Branching DAG executor** — keep linear pipeline for now.
3. **Automatic multi-checkpoint** — user specifies one step for now.
4. **Cross-variant latent reuse** — blocked by default, future `--force` flag.
5. **Observability/metrics infrastructure** — use `loguru` logging at call sites. Revisit when multi-user.
6. **`StageParamEditor` shared component** (WP-I) — can be done incrementally after core features work.

---

## 13) Related Docs

- `web/UNIFIED_STAGE_DESIGN.md` — original design vision + motivation + workflow diagrams
- `web/PLAN.md` — master project reference (architecture, file map, TODO)
- `web/PIPELINE_FRAMEWORK.md` — pipeline mechanism deep dive, cover/repaint internals
- `plan.md` — project index + feature summary
