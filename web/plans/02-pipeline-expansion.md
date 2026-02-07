# Pipeline Expansion: Cover, Repaint, Extract, Lego, Complete Stage Types

## Goal
Expand the pipeline builder from 2 stage types (generate, refine) to 7, giving users ComfyUI-style building blocks for audio transformation workflows.

## New Stage Types

| Type | What it does | Requires | Model |
|------|-------------|----------|-------|
| **cover** | Restyle audio preserving structure | Source audio + caption | Any |
| **repaint** | Regenerate a time segment | Source audio + start/end | Any |
| **extract** | Isolate a specific instrument | Source audio + track name | Base only |
| **lego** | Add an instrument track | Source audio + track name | Base only |
| **complete** | Add accompaniment | Source audio + track classes | Base only |

All audio-requiring stages can get source from either **uploaded file** (src_audio_id) or **previous stage output** (src_stage). The latter triggers on-demand VAE decode of that stage's latent.

---

## Files to Modify (in order)

### Phase 1: Schema + Types

**1. `web/backend/schemas/pipeline.py`** — Add to `PipelineStageConfig`:
- `src_audio_id: Optional[str]` — uploaded audio UUID
- `src_stage: Optional[int]` — previous stage index as audio source
- `audio_cover_strength: float = 1.0` — cover blending
- `audio_code_hints: Optional[str]` — pre-extracted codes for cover
- `repainting_start: Optional[float]` — seconds
- `repainting_end: Optional[float]` — seconds
- `track_name: Optional[str]` — for extract/lego
- `complete_track_classes: Optional[List[str]]` — for complete

**2. `web/frontend/src/lib/types/index.ts`** — Mirror schema: add `PipelineStageType` union, add new optional fields to `PipelineStageConfig`.

**3. `web/frontend/src/lib/help-text.ts`** — Add tooltips for cover strength, repaint range, track selector, src audio, and each new stage type.

### Phase 2: Backend Execution

**4. `web/backend/routers/generation.py`** — Expand `start_pipeline` validation:
- Accept 7 stage types
- Audio-requiring types must have `src_audio_id` or `src_stage`
- `src_stage` must reference a valid previous stage
- extract/lego/complete must use base model
- extract/lego require `track_name`

**5. `web/backend/services/pipeline_executor.py`** — Core changes:
- Add `resolve_src_audio(stage, dit_handler, stage_latents, sample_rate)` helper:
  - If `src_audio_id`: `audio_store.get_path()` → `dit_handler.process_src_audio()` → tensor
  - If `src_stage`: VAE-decode that stage's latent (using existing `dit_handler.tiled_decode()`) → tensor
- In main loop, branch per stage type to set `target_wavs`, `instructions`, `repainting_start/end`, `audio_cover_strength`, `audio_code_hints` before calling `service_generate()`
- For cover: set `refer_audios` from source audio (existing pattern)
- Instruction text generated from `TASK_INSTRUCTIONS` constants with `{TRACK_NAME}` / `{TRACK_CLASSES}` substitution

### Phase 3: Frontend UI

**6. `web/frontend/src/stores/pipelineStore.ts`** —
- Default stage configs per type (cover defaults to strength=0.5, extract/lego default to base model + 50 steps)
- Widen `addStage` to accept any `PipelineStageType`
- Add 2 built-in presets: "Cover + Polish", "Generate + Extract Vocals"

**7. `web/frontend/src/components/generation/StageBlock.tsx`** — Conditional UI sections:
- **Type selector**: expand dropdown to 7 options. On type change, auto-set model defaults (base for extract/lego/complete).
- **Audio source** (cover/repaint/extract/lego/complete): toggle between "Upload" (reuse existing `AudioUpload.tsx`) and "From stage N" (select previous stage). `src_audio_id` and `src_stage` are mutually exclusive.
- **Cover controls**: cover strength slider (0-1)
- **Repaint controls**: start/end time inputs (seconds), -1 for end-of-audio
- **Track selector** (extract/lego): dropdown from `TRACK_NAMES` constant (already in constants.ts)
- **Track class selector** (complete): multi-checkbox from `TRACK_NAMES`
- **Model filter**: for extract/lego/complete, filter DIT_MODELS to base only

---

## Key Implementation Details

### resolve_src_audio helper (pipeline_executor.py)
```python
def resolve_src_audio(stage, dit_handler, stage_latents, sample_rate):
    if stage.src_audio_id:
        path = audio_store.get_path(stage.src_audio_id)
        return dit_handler.process_src_audio(path)  # → [2, frames]
    elif stage.src_stage is not None:
        latents = stage_latents[stage.src_stage]  # [batch, T, D] CPU
        with torch.no_grad(), dit_handler._load_model_context("vae"):
            latents_gpu = latents.to(dit_handler.device).transpose(1, 2).contiguous().to(dit_handler.vae.dtype)
            pred_wavs = dit_handler.tiled_decode(latents_gpu).float().cpu()
            return pred_wavs[0]  # batch item 0 as shared source
    return None
```

### Instruction generation (pipeline_executor.py)
```python
from acestep.constants import TASK_INSTRUCTIONS
def build_stage_instruction(stage):
    template = TASK_INSTRUCTIONS.get(stage.type, TASK_INSTRUCTIONS.get("text2music"))
    if "{TRACK_NAME}" in template:
        template = template.replace("{TRACK_NAME}", stage.track_name or "track")
    if "{TRACK_CLASSES}" in template:
        classes = ", ".join(stage.complete_track_classes or ["accompaniment"])
        template = template.replace("{TRACK_CLASSES}", classes)
    return template
```

### Stage loop routing (pipeline_executor.py)
Each stage type sets specific kwargs before calling `service_generate()`:
- **generate**: no target_wavs, no instructions override (existing behavior)
- **refine**: init_latents from renoise (existing behavior)
- **cover**: target_wavs=src_audio, refer_audios=[[src_audio]], audio_cover_strength, instruction="Generate audio semantic tokens..."
- **repaint**: target_wavs=src_audio, repainting_start/end as lists, instruction="Repaint the mask area..."
- **extract/lego/complete**: target_wavs=src_audio, track-specific instruction

### Existing infrastructure reused
- `AudioUpload.tsx` — file upload component (no changes needed)
- `audio_store.get_path()` — resolve upload IDs to paths
- `dit_handler.process_src_audio()` — normalize audio to stereo 48kHz tensor
- `dit_handler.tiled_decode()` — VAE decode for src_stage resolution
- `TRACK_NAMES`, `TASK_INSTRUCTIONS` — already in frontend constants.ts and backend constants.py

---

## Verification

1. **TypeScript**: `npx tsc --noEmit` after all frontend changes
2. **Backend start**: Restart backend, verify no import errors
3. **Stage type UI**: Switch stage type dropdown, verify conditional UI shows/hides correctly
4. **Upload flow**: Upload audio in a cover stage, verify ID is stored and preview plays
5. **Cover pipeline**: Upload audio → cover stage → run → verify output is restyled
6. **Repaint pipeline**: Generate → repaint (src_stage=0, start=10, end=20) → verify only section changed
7. **Chain pipeline**: Generate → cover (src_stage=0) → refine → verify latent chaining works
8. **Model constraint**: Try setting turbo on extract stage → verify UI prevents or backend rejects
