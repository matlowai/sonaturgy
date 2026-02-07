# Unified Stage Architecture — Phase 0 Commit + Phase 1 & 2 Implementation

## Context

We're building the Unified Stage Architecture from `web/UNIFIED_STAGE_EXECUTION_SPEC.md`. The branch `feature/restore-params-send-to-ref` already has Phase 0 (Restore Params + Send to Ref + Send to Src) complete in the working tree but uncommitted. This plan covers:

1. **Commit Phase 0** — the existing work
2. **Phase 1** — Latent Store + Normal Generation Integration (WP-A, WP-B, WP-C)
3. **Phase 2** — Pipeline Integration (WP-D)

Phases 3-5 (Resume API, Checkpointing, Cross-Mode Actions) are follow-up work.

---

## Step 1: Commit Phase 0

Commit the existing uncommitted changes:
- `AudioCard.tsx` — Restore Params + Send to Ref buttons
- `useBatchNavigation.ts` — Expanded `mapParamsToFields()` covering all DiT + LM params
- `pipeline_executor.py` — Per-stage params building for pipeline results
- `page.tsx` — Pipeline result normalization spreads stage params
- `en.json` — i18n keys for new buttons
- Doc updates: `plan.md`, `PLAN.md`, `PIPELINE_FRAMEWORK.md`, `UNIFIED_STAGE_DESIGN.md`

New untracked files to add: `UNIFIED_STAGE_DESIGN.md`, `UNIFIED_STAGE_EXECUTION_SPEC.md`

---

## Step 2: Phase 1 — Latent Store + Normal Generation Integration

### 2a. Config additions (`web/backend/config.py`)

Add two new env vars:
```python
LATENT_DIR = os.getenv("ACE_LATENT_DIR", os.path.join(TEMP_DIR, "latents"))
LATENT_TTL_HOURS = int(os.getenv("ACE_LATENT_TTL_HOURS", "24"))
```

### 2b. Create `web/backend/services/latent_store.py` (NEW file)

Follow `audio_store.py` pattern exactly (104 lines → ~150 lines). Key elements:

```python
@dataclass
class LatentRecord:
    id: str
    path: str                       # safetensors file path
    shape: tuple                    # (batch, T, D)
    dtype: str                      # "float32"
    model_variant: str              # "acestep-v15-base", etc.
    stage_type: str                 # "generate", "refine", "cover", etc.
    is_checkpoint: bool             # False for final, True for step-K snapshot
    checkpoint_step: Optional[int]
    total_steps: int
    params: dict                    # Full generation params snapshot
    lm_metadata: Optional[dict]     # BPM, key, etc. from LLM Phase 1
    batch_size: int
    created_at: float
    pinned: bool = False

class LatentStore:
    def __init__(self): ...          # in-memory dict + makedirs
    def store(self, tensor, metadata) -> str:  # save safetensors, return UUID
    def get(self, latent_id) -> Optional[Tensor]:  # load from disk
    def get_record(self, latent_id) -> Optional[LatentRecord]:  # metadata only
    def pin(self, latent_id) -> bool:
    def delete(self, latent_id) -> None:
    def list_records(self) -> List[LatentRecord]:
    def start_cleanup(self): ...     # TTL thread
    def stop_cleanup(self): ...
    def _cleanup_loop(self): ...     # same pattern as AudioStore
    def _do_cleanup(self): ...       # skip pinned records

latent_store = LatentStore()        # module-level singleton
```

Serialization: `safetensors.torch.save_file()` / `safetensors.torch.load_file()`. safetensors is already installed (v0.7.0). Store metadata in a companion `.json` file (simpler than trying to fit complex metadata in safetensors headers).

### 2c. Wire into app lifespan (`web/backend/app.py`)

```python
from web.backend.services.latent_store import latent_store
# In lifespan:
latent_store.start_cleanup()
# In shutdown:
latent_store.stop_cleanup()
```

### 2d. Schema additions

**`web/backend/schemas/generation.py`** — Add to `GenerateRequest`:
```python
# Latent resume (Phase 3 will use these, add now for forward-compat)
init_latent_id: Optional[str] = None
t_start: float = 1.0
checkpoint_step: Optional[int] = None
resume_sample_index: Optional[int] = None
```

**`web/backend/schemas/pipeline.py`** — Add to `PipelineStageConfig`:
```python
src_latent_id: Optional[str] = None
checkpoint_step: Optional[int] = None
```

### 2e. Normal generation integration (`web/backend/routers/generation.py`)

In the `_run()` function, after `generate_music()` returns and before building `audio_data`:

1. Get `pred_latents` from `result.extra_outputs` (it's a CPU tensor `[batch, T, D]`)
2. Get `lm_metadata` from `result.extra_outputs`
3. For each batch item, store the individual latent slice in `latent_store`
4. Add `latent_id` to each audio result dict

```python
# After result = generate_music(...)
pred_latents = result.extra_outputs.get("pred_latents")  # [batch, T, D] CPU tensor
lm_metadata = result.extra_outputs.get("lm_metadata")

latent_ids = []
if pred_latents is not None:
    for i in range(pred_latents.shape[0]):
        latent_id = latent_store.store(
            tensor=pred_latents[i:i+1],  # Keep batch dim [1, T, D]
            metadata={
                "model_variant": getattr(dit, 'model_variant', 'unknown'),
                "stage_type": req.task_type,
                "is_checkpoint": False,
                "checkpoint_step": None,
                "total_steps": req.inference_steps,
                "params": req.model_dump(),
                "lm_metadata": lm_metadata,
                "batch_size": 1,  # Stored per-sample
            }
        )
        latent_ids.append(latent_id)

# Then in the audio_data loop, add latent_id:
audio_data.append({
    "id": entry.id,
    "key": audio.get("key", ""),
    "sample_rate": audio.get("sample_rate", 48000),
    "params": audio.get("params", {}),
    "codes": audio.get("params", {}).get("audio_codes", ""),
    "latent_id": latent_ids[i] if i < len(latent_ids) else None,
})
```

### 2f. Fix `or`-fallback in pipeline_executor.py

Replace lines ~165-166:
```python
# BEFORE:
stage_caption = stage.caption or req.caption
stage_lyrics = stage.lyrics or req.lyrics

# AFTER:
stage_caption = stage.caption if stage.caption is not None else req.caption
stage_lyrics = stage.lyrics if stage.lyrics is not None else req.lyrics
```

### 2g. Frontend type additions (`web/frontend/src/lib/types/index.ts`)

Add to `AudioResult`:
```typescript
latentId?: string;
latentCheckpointId?: string;
checkpointStep?: number;
```

Add to `PipelineStageConfig`:
```typescript
src_latent_id?: string;
checkpoint_step?: number;
```

### 2h. Frontend latent indicator (`AudioCard.tsx`)

Small visual indicator when `audio.latentId` is present — a subtle badge/chip showing the latent is persisted. This signals to the user that "Resume from latent" will be possible in Phase 3.

---

## Step 3: Phase 2 — Pipeline Integration

### 3a. Pipeline executor stores latents (`pipeline_executor.py`)

After each stage's `service_generate()` call, store the stage latent in `latent_store`:

```python
from web.backend.services.latent_store import latent_store

# After: stage_latents[idx] = outputs["target_latents"].detach().cpu()
latent_id = latent_store.store(
    tensor=stage_latents[idx],
    metadata={
        "model_variant": dit_handler.model_variant,
        "stage_type": stage.type,
        "is_checkpoint": False,
        "total_steps": stage.steps,
        "params": stage_params.get(idx, {}),  # Reuse per-stage params from restore block
        "lm_metadata": None,  # Pipeline stages don't run LLM individually
        "batch_size": req.batch_size,
    }
)
# Store latent_id for attachment to audio results
stage_latent_ids[idx] = latent_id
```

### 3b. Attach latent_id to pipeline audio results

In the audio results building section, add `latent_id` from `stage_latent_ids[stage_idx]`.

### 3c. Add `src_latent_id` resolution

In the stage setup logic (before `resolve_src_audio` and before refine setup), check for `stage.src_latent_id`:

- If present and stage is `refine`: load from `latent_store.get()`, skip VAE entirely, use as `init_latents` directly (fast path)
- If present and stage is audio-requiring: load from `latent_store.get()`, VAE decode to waveform, then existing pathway
- If missing/expired: hard error with clear message

This is the highest-priority source per the precedence rules: `src_latent_id > src_stage > src_audio_id > noise`.

---

## Files Modified (Summary)

| File | Change | Size |
|------|--------|------|
| `web/backend/config.py` | +2 lines (LATENT_DIR, LATENT_TTL_HOURS) | Tiny |
| `web/backend/services/latent_store.py` | **NEW** (~150 lines) | M |
| `web/backend/app.py` | +3 lines (import, start_cleanup, stop_cleanup) | Tiny |
| `web/backend/schemas/generation.py` | +4 optional fields on GenerateRequest | S |
| `web/backend/schemas/pipeline.py` | +2 optional fields on PipelineStageConfig | Tiny |
| `web/backend/routers/generation.py` | +20 lines (store latents, attach IDs) | S |
| `web/backend/services/pipeline_executor.py` | +30 lines (store, attach, src_latent_id resolution, or-fix) | M |
| `web/frontend/src/lib/types/index.ts` | +5 optional fields | Tiny |
| `web/frontend/src/components/results/AudioCard.tsx` | +5 lines (latent badge) | Tiny |

---

## Verification

1. **Backend startup:** `latent_store` initializes, creates `web_tmp/latents/` dir, cleanup thread starts
2. **Normal generation:** After generating, check that `latent_id` appears in the audio result JSON. Verify `.safetensors` + `.json` files appear in `web_tmp/latents/`
3. **Pipeline generation:** Each stage's result includes `latent_id`. Files persist on disk
4. **TTL cleanup:** Set `ACE_LATENT_TTL_HOURS=0` temporarily to verify cleanup removes files
5. **Frontend:** AudioCard shows latent indicator badge when `latentId` is present
6. **TypeScript:** `npx tsc --noEmit` passes (minus the pre-existing TrainingProgress.tsx error)
7. **Backward compat:** Existing API clients work unchanged (all new fields are optional with defaults)
8. **or-fallback fix:** Pipeline stage with `caption: ""` (explicitly empty) doesn't fall back to shared caption
