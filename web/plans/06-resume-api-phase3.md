# Phase 3: Resume API — Implementation Plan

## Context

Phase 1+2 (committed as `29666d9`) established the `LatentStore` and wired latent persistence into both normal generation and pipeline execution. Every generated sample now has a `latent_id` in its result. Phase 3 closes the loop: users can **resume from any stored latent** by clicking Restore on a result, tweaking params, and generating with a truncated diffusion schedule.

The entire backend call chain (`GenerationParams` → `inference.generate_music()` → `handler.generate_music()` → `service_generate()` → `generate_audio_core()`) already supports `init_latents` and `t_start` — only the **route-level glue** (resolve latent ID → tensor, validate, renoise, pass to params) is missing. The backend schema fields (`init_latent_id`, `t_start`, `checkpoint_step`, `resume_sample_index`) were already added in Phase 1+2.

---

## Step 1: Backend — Route-Level Latent Resolution

**File:** `web/backend/routers/generation.py`

Insert after line 51 (`src_audio = ...`) and before line 53 (`effective_cover_strength = ...`):

```python
# Resolve stored latent for resume
init_latents_tensor = None
effective_t_start = req.t_start

if req.init_latent_id:
    record = latent_store.get_record(req.init_latent_id)
    if record is None:
        raise HTTPException(404, f"Latent '{req.init_latent_id}' not found or expired")

    # Validate model variant
    current_variant = getattr(dit, "model_variant", "unknown")
    if record.model_variant != "unknown" and record.model_variant != current_variant:
        raise HTTPException(
            422,
            f"Latent model mismatch: generated with '{record.model_variant}', "
            f"current model is '{current_variant}'"
        )

    # Validate resume_sample_index
    sample_idx = req.resume_sample_index or 0
    if sample_idx >= record.batch_size:
        raise HTTPException(
            422,
            f"Sample index {sample_idx} out of range (latent has {record.batch_size} items)"
        )

    # Load tensor
    tensor = latent_store.get(req.init_latent_id)
    if tensor is None:
        raise HTTPException(404, f"Failed to load latent tensor '{req.init_latent_id}'")

    # Select batch item if stored latent has multiple
    if record.batch_size > 1:
        tensor = tensor[sample_idx : sample_idx + 1]

    # Expand to request batch_size
    if req.batch_size > 1:
        tensor = tensor.expand(req.batch_size, -1, -1).contiguous()

    # Renoise for partial denoising (same pattern as pipeline_executor.py:196-204)
    if effective_t_start < 1.0 - 1e-6:
        with torch.inference_mode():
            init_latents_tensor = dit.model.renoise(
                tensor.to(dit.device).to(dit.dtype), effective_t_start,
            )
    else:
        # t_start >= 1.0 → generate from noise, ignore latent
        init_latents_tensor = None
        effective_t_start = 1.0
```

Then add 2 fields to the `GenerationParams()` call (after line 96's `use_constrained_decoding`):
```python
    init_latents=init_latents_tensor,
    t_start=effective_t_start,
```

Also add `import torch` at the top of `generation.py` (alongside existing imports) since it's now used for the renoise path.

No other backend changes needed — the chain already threads these through.

---

## Step 2: Frontend — GenerationState Store

**File:** `web/frontend/src/stores/generationStore.ts`

**2a.** Add to `GenerationState` interface, after `autoGen: boolean;` (line 83):
```typescript
  // Latent resume (ephemeral, not persisted in presets)
  initLatentId: string | null;
  tStart: number;
  checkpointStep: number | null;
  resumeSampleIndex: number | null;
  clearLatentResume: () => void;
```

**2b.** Add to `defaults` object, after `autoGen: false,` (line 146):
```typescript
  initLatentId: null,
  tStart: 1.0,
  checkpointStep: null,
  resumeSampleIndex: null,
```

**2c.** Add action in the store create block, after `resetToDefaults` (line 176):
```typescript
  clearLatentResume: () => set({ initLatentId: null, tStart: 1.0, checkpointStep: null, resumeSampleIndex: null }),
```

**NOT added to `GENERATION_SETTINGS_KEYS`** in `presets.ts` — these are ephemeral per-session.

---

## Step 3: Frontend — GenerateRequest Type

**File:** `web/frontend/src/lib/types/index.ts`

Add after `lm_codes_strength: number;` (line 85), before the closing `}`:
```typescript
  // Latent resume
  init_latent_id: string | null;
  t_start: number;
  checkpoint_step: number | null;
  resume_sample_index: number | null;
```

---

## Step 4: Frontend — buildRequest()

**File:** `web/frontend/src/hooks/useGeneration.ts`

Add after `lm_codes_strength: gen.lmCodesStrength,` (line 68), before closing `};`:
```typescript
      init_latent_id: gen.initLatentId,
      t_start: gen.tStart,
      checkpoint_step: gen.checkpointStep,
      resume_sample_index: gen.resumeSampleIndex,
```

---

## Step 5: Frontend — mapParamsToFields()

**File:** `web/frontend/src/hooks/useBatchNavigation.ts`

Add after `useConstrainedDecoding: p.use_constrained_decoding ?? true,` (line 42):
```typescript
    // Reset latent resume (these are set explicitly by AudioCard, not from params)
    initLatentId: null,
    tStart: 1.0,
    checkpointStep: null,
    resumeSampleIndex: null,
```

This ensures the batch-level `restoreParams` clears stale resume state. The per-audio `handleRestoreParams` in AudioCard overrides `initLatentId` after the spread.

---

## Step 6: Frontend — AudioCard handleRestoreParams

**File:** `web/frontend/src/components/results/AudioCard.tsx`

Replace lines 121-128:
```typescript
  const handleRestoreParams = () => {
    if (!audio.params) {
      addToast('No params to restore', 'info');
      return;
    }
    gen.setFields({
      ...mapParamsToFields(audio.params),
      initLatentId: audio.latentId || null,
    });
    addToast(
      audio.latentId
        ? `Params restored from Sample ${index + 1} (with latent)`
        : `Params restored from Sample ${index + 1}`,
      'success',
    );
  };
```

Key: `mapParamsToFields` resets `initLatentId` to null (Step 5), then the spread override sets it to the **output** latent of this result. `tStart` stays at 1.0 — user must lower it in the slider to actually resume.

---

## Step 7: Frontend — Resume Panel in AdvancedSettings

**File:** `web/frontend/src/components/generation/AdvancedSettings.tsx`

Insert as first child of `<div className="mt-3 space-y-4">` (after line 29), before the DiT Parameters section:
```tsx
          {/* Resume from Latent */}
          {gen.initLatentId && (
            <div className="border rounded-lg p-3 space-y-2" style={{ borderColor: 'var(--accent)', backgroundColor: 'rgba(59, 130, 246, 0.05)' }}>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
                  Resuming from latent
                </h4>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => gen.setFields({ initLatentId: null, tStart: 1.0 })}
                >
                  Clear
                </button>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                ID: <code className="text-xs">{gen.initLatentId}</code>
              </p>
              <div>
                <label className="label">
                  Denoise: {gen.tStart.toFixed(2)}
                  <Tooltip text="How much of the schedule to run. 1.0 = full denoise (ignores latent). Lower values preserve more of the original." />
                </label>
                <input
                  type="range" min={0} max={1} step={0.05}
                  value={gen.tStart}
                  onChange={(e) => gen.setField('tStart', parseFloat(e.target.value))}
                />
              </div>
              {gen.tStart >= 1.0 && (
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  At 1.0, generation starts from noise. Lower the slider to resume from the stored latent.
                </p>
              )}
            </div>
          )}
```

Uses existing `Tooltip` component (already imported line 9) and `gen` store (line 13). Blue accent border matches LLM preview panel pattern.

---

## Step 8: Frontend — Resume Indicator in GenerationPanel

**File:** `web/frontend/src/components/generation/GenerationPanel.tsx`

Insert after `<AdvancedSettings />` (line 58) and before the generate button div (line 60):
```tsx
          {/* Resume indicator */}
          {gen.initLatentId && gen.tStart < 1.0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded text-xs" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: 'var(--accent)' }}>
              <span>Resuming from latent {gen.initLatentId.slice(0, 8)}... (denoise: {gen.tStart.toFixed(2)})</span>
              <button className="underline hover:no-underline" onClick={() => gen.setFields({ initLatentId: null, tStart: 1.0 })}>Clear</button>
            </div>
          )}
```

Only shows when `tStart < 1.0` (an actual resume is happening). `gen` is already available (line 25).

---

## Files Modified (8 total)

| File | Change | Size |
|------|--------|------|
| `web/backend/routers/generation.py` | Latent resolution block + 2 params | ~45 lines |
| `web/frontend/src/stores/generationStore.ts` | 4 fields + defaults + action | ~10 lines |
| `web/frontend/src/lib/types/index.ts` | 4 fields on GenerateRequest | 4 lines |
| `web/frontend/src/hooks/useGeneration.ts` | 4 fields in buildRequest | 4 lines |
| `web/frontend/src/hooks/useBatchNavigation.ts` | 4 reset fields in mapParamsToFields | 4 lines |
| `web/frontend/src/components/results/AudioCard.tsx` | handleRestoreParams sets initLatentId | ~12 lines |
| `web/frontend/src/components/generation/AdvancedSettings.tsx` | Resume panel with slider + clear | ~25 lines |
| `web/frontend/src/components/generation/GenerationPanel.tsx` | Resume indicator banner | ~5 lines |

---

## Verification

1. **Python imports:** `.venv/bin/python -c "from web.backend.app import create_app"`
2. **TypeScript:** `cd web/frontend && npx tsc --noEmit` (only pre-existing TrainingProgress error)
3. **Frontend smoke:** `npm run dev`, Restore a result → resume panel appears, slider works, Clear removes it
4. **Backend contract:** POST `/generation/generate` with `init_latent_id` + `t_start` returns 404 for bad ID, 422 for variant mismatch, 200 for valid request
5. **GPU test (deferred):** Full end-to-end: generate → restore → lower tStart → generate again → verify truncated schedule produces variation of original
