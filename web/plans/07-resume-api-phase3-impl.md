# Phase 3: Resume API — Implementation

## Context

Implementing Phase 3 of the Unified Stage Execution spec. Phase 1+2 (commit `29666d9`) added `LatentStore` and latent persistence. Phase 3 closes the loop: users click Restore on a result, get a latent loaded with a denoise slider, and generate with a truncated diffusion schedule.

The full detailed plan is already approved at `~/.claude/plans/snappy-imagining-newt.md`. All line numbers verified against current code — no drift.

## Changes (8 files)

### 1. `web/backend/routers/generation.py`
- Add `import torch` at top
- Insert latent resolution block after line 50 (`src_audio = ...`), before line 52 (LM codes comment)
  - Resolve `req.init_latent_id` → tensor via `latent_store.get_record()` + `latent_store.get()`
  - Validate model variant match, sample index bounds
  - Select batch item if multi-sample latent, expand to `req.batch_size`
  - Renoise if `t_start < 1.0 - 1e-6` (same pattern as `pipeline_executor.py:196-204`)
  - If `t_start >= 1.0`, set tensor to None (generate from noise)
- Add `init_latents=init_latents_tensor, t_start=effective_t_start` to `GenerationParams()` call (after line 95)

### 2. `web/frontend/src/stores/generationStore.ts`
- Add 4 fields to `GenerationState` interface after `autoGen` (line 83): `initLatentId`, `tStart`, `checkpointStep`, `resumeSampleIndex`
- Add `clearLatentResume` action to interface
- Add 4 defaults after `autoGen: false` (line 146)
- Add `clearLatentResume` action after `resetToDefaults` (line 176)
- NOT added to `GENERATION_SETTINGS_KEYS` — ephemeral per-session

### 3. `web/frontend/src/lib/types/index.ts`
- Add 4 fields to `GenerateRequest` after `lm_codes_strength` (line 85): `init_latent_id`, `t_start`, `checkpoint_step`, `resume_sample_index`

### 4. `web/frontend/src/hooks/useGeneration.ts`
- Add 4 fields to `buildRequest()` after `lm_codes_strength` (line 68)

### 5. `web/frontend/src/hooks/useBatchNavigation.ts`
- Add 4 reset fields to `mapParamsToFields()` after line 42 (resets latent state to null/defaults on batch-level restore)

### 6. `web/frontend/src/components/results/AudioCard.tsx`
- Replace `handleRestoreParams` (lines 121-128): spread `mapParamsToFields(audio.params)` then override `initLatentId: audio.latentId || null`

### 7. `web/frontend/src/components/generation/AdvancedSettings.tsx`
- Insert resume panel as first child of `{open && (` block (after line 29)
- Blue-bordered panel: latent ID display, denoise slider (0-1), Clear button, hint at 1.0

### 8. `web/frontend/src/components/generation/GenerationPanel.tsx`
- Insert resume indicator after `<AdvancedSettings />` (line 58), before generate button (line 60)
- Only visible when `tStart < 1.0`

## Verification
1. `.venv/bin/python -c "from web.backend.app import create_app"`
2. `cd web/frontend && npx tsc --noEmit` (only pre-existing TrainingProgress.tsx:12 error)
3. Commit on branch `feature/restore-params-send-to-ref`
