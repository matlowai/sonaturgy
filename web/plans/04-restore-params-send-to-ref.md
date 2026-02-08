# Plan: Enhance Restore Params + Send to Src

## Context

Both features partially exist but are incomplete:
- **Restore Params** — exists at batch level in ResultsPanel (`useBatchNavigation.ts:35-49`) but only restores 14 of ~30 stored params. Missing: thinking, all LM settings, infer_method, CFG interval, use_adg, audio_cover_strength. The backend stores ALL params via `GenerationParams.to_dict()` → `asdict(self)`.
- **Send to Src** — exists in AudioCard (`line 110-113`) but only sets `srcAudioId`. Doesn't switch task type or offer referenceAudioId.

## Changes

### 1. Expand `restoreParams` in `useBatchNavigation.ts`

Add the missing fields to the `setFields` call. The backend stores all of these in `audio.params` (snake_case). Map to frontend store field names (camelCase):

```
// Currently restored (keep):
caption, lyrics, instrumental, taskType, vocalLanguage, bpm, keyscale,
timesignature, duration, inferenceSteps, guidanceScale, seed, shift

// Add these:
thinking           ← p.thinking
inferMethod        ← p.infer_method
useAdg             ← p.use_adg
cfgIntervalStart   ← p.cfg_interval_start
cfgIntervalEnd     ← p.cfg_interval_end
audioCoverStrength ← p.audio_cover_strength
lmTemperature      ← p.lm_temperature
lmCfgScale         ← p.lm_cfg_scale
lmTopK             ← p.lm_top_k
lmTopP             ← p.lm_top_p
lmNegativePrompt   ← p.lm_negative_prompt
useCotMetas        ← p.use_cot_metas
useCotCaption      ← p.use_cot_caption
useCotLanguage     ← p.use_cot_language
useConstrainedDecoding ← p.use_constrained_decoding
```

Use defaults from `generationStore.ts` as fallbacks (e.g. `p.thinking ?? true`).

### 2. Add per-audio Restore Params to `AudioCard.tsx`

The batch-level restore uses `batch.params` (= first audio's params). But each audio in a batch has a different `seed`. Add a per-audio "Restore" button in AudioCard that restores that specific audio's params (including its seed), using the same comprehensive field mapping.

Add a `handleRestoreParams` function that calls `gen.setFields(...)` with `audio.params`, same mapping as batch-level but using per-audio data.

### 3. Enhance Send to Src in `AudioCard.tsx`

Currently sets `srcAudioId` only. Enhance to also set `referenceAudioId` (for text2music + reference audio mode). Show a dropdown or two buttons:
- **"Send to Src"** — sets `srcAudioId` (for cover/repaint/etc). Already exists.
- **"Send to Ref"** — sets `referenceAudioId` (for text2music similarity/denoise). New button.

This is simple and avoids the complexity of auto-switching task types.

### 4. Add i18n key for "Send to Ref"

Add `results.send_to_ref_btn` key to `en.json`.

## Files to modify

| File | Change |
|------|--------|
| `web/frontend/src/hooks/useBatchNavigation.ts` | Expand `restoreParams` with ~15 more fields |
| `web/frontend/src/components/results/AudioCard.tsx` | Add `handleRestoreParams`, add "Restore" button, add `handleSendToRef` + "Send to Ref" button |
| `web/frontend/src/lib/i18n/en.json` | Add `send_to_ref_btn` key |

## Verification

1. Generate music with non-default settings (e.g. thinking=off, shift=3, SDE, CFG interval)
2. Navigate to results, click per-audio "Restore" → verify ALL params restored including seed
3. Click batch-level "Restore Params" → verify comprehensive param restoration
4. Click "Send to Ref" → verify referenceAudioId is set, strength slider appears in text2music mode
5. TypeScript check: `cd web/frontend && npx tsc --noEmit`
