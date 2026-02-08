# Analysis-Only Preview + Dynamic Slider Labels

## Context

Upstream added an `analysis_only` flag that runs the LLM without diffusion — returns
metadata (BPM, key, duration, rewritten caption) in ~1-2 seconds. This is a high-value
feature for our web UI: iterate on prompts fast without waiting for full generation.

Also, the `audio_cover_strength` slider label is static — always says "Cover Strength"
regardless of whether it's being used for cover, LM codes, or reference audio similarity.
Upstream made it dynamic based on context.

---

## Feature 1: LLM Preview (Analysis-Only)

### How it works

`generate_with_stop_condition(infer_type="dit")` runs Phase 1 only: CoT generation
that produces metadata (BPM, key, duration, language, rewritten caption). No audio codes,
no diffusion. Returns in 1-2 seconds.

### Where it fits in each mode

**Custom mode** — most value here. Add a "Preview LLM" button next to the Generate button.
Shows what the LLM would produce for the current caption + lyrics before committing to
full generation. User can then tweak and preview again.

**Pipeline mode** — less urgent. Per-stage preview could be useful but adds complexity.
Skip for now — users can use Custom mode to iterate on their prompt, then switch to Pipeline.

**Simple mode** — already has `createSample()` which does LLM generation. The analysis
preview would be redundant here. Skip.

### Implementation

**New backend endpoint: `POST /generation/analyze`**

Separate from `/generate` — simpler, no task queue needed (fast enough to be synchronous).
Calls `llm_handler.generate_with_stop_condition(infer_type="dit")` directly.

Files:
- `web/backend/schemas/generation.py` — add `AnalyzeRequest` and `AnalyzeResponse`
- `web/backend/routers/generation.py` — add `/analyze` endpoint
- `web/frontend/src/lib/api.ts` — add `analyzeLLM()` function
- `web/frontend/src/lib/types/index.ts` — add `AnalyzeResponse` type
- `web/frontend/src/components/generation/CustomMode.tsx` — add Preview LLM button + result display

**Backend endpoint:**
```python
@router.post("/analyze")
def analyze_endpoint(req: AnalyzeRequest, llm=Depends(get_llm_handler)):
    result = llm.generate_with_stop_condition(
        caption=req.caption, lyrics=req.lyrics, infer_type="dit",
        temperature=req.lm_temperature, top_p=req.lm_top_p,
        use_cot_metas=req.use_cot_metas,
        use_cot_caption=req.use_cot_caption,
        use_cot_language=req.use_cot_language,
        use_constrained_decoding=req.use_constrained_decoding,
    )
    # Return metadata from result
```

**Frontend button in CustomMode:**
- "Preview LLM" button, visible when LLM is initialized
- On click: calls `/generation/analyze` with current caption + lyrics + LM settings
- Shows result in a collapsible panel: BPM, key, duration, language, rewritten caption
- "Apply" button to populate metadata fields from preview
- Loading spinner while waiting

### Request schema (AnalyzeRequest)
```
caption, lyrics, instrumental,
lm_temperature, lm_top_p, lm_top_k, lm_cfg_scale, lm_negative_prompt,
use_cot_metas, use_cot_caption, use_cot_language, use_constrained_decoding,
vocal_language, bpm, keyscale, timesignature, duration
```
(Subset of GenerateRequest — only fields the LLM needs)

### Response schema (AnalyzeResponse)
```
caption (rewritten), bpm, keyscale, duration, language, timesignature,
thinking_text (raw CoT output for display)
```

---

## Feature 2: Dynamic Slider Labels

### Current state

- **CustomMode.tsx:362** — `audioCoverStrength` slider, label: i18n `cover_strength_label`,
  visible only when `taskType === 'cover'`
- **AdvancedSettings.tsx:204** — `lmCodesStrength` slider, label: i18n `codes_strength_label`,
  always visible in LM settings
- **StageBlock.tsx:298** — `audio_cover_strength` per-stage, label: hardcoded `"Cover Strength:"`,
  visible only for cover stages

### What to change

**CustomMode.tsx:** Show the strength slider for more contexts, with dynamic label:
- `taskType === 'cover'` → "Cover Strength" (source preservation)
- `taskType === 'text2music'` + has reference audio → "Similarity / Denoise" (upstream pattern)
- Keep `lmCodesStrength` separate in AdvancedSettings (different mechanism)

**StageBlock.tsx:** Already scoped to cover stages — label is fine. No change needed.

### Files to modify
- `web/frontend/src/components/generation/CustomMode.tsx` — widen visibility condition,
  dynamic label based on taskType + reference audio presence
- `web/frontend/src/lib/help-text.ts` — add help text for similarity/denoise context
- `web/frontend/src/lib/i18n/en.json` — add `similarity_denoise_label` + `_info` keys

---

## Files Summary

| File | Change |
|------|--------|
| `web/backend/schemas/generation.py` | Add `AnalyzeRequest`, `AnalyzeResponse` |
| `web/backend/routers/generation.py` | Add `POST /analyze` endpoint |
| `web/frontend/src/lib/api.ts` | Add `analyzeLLM()` |
| `web/frontend/src/lib/types/index.ts` | Add `AnalyzeResponse` type |
| `web/frontend/src/components/generation/CustomMode.tsx` | Preview button + dynamic slider label |
| `web/frontend/src/lib/help-text.ts` | Add similarity/denoise help text |
| `web/frontend/src/lib/i18n/en.json` | Add i18n keys |

## Verification

1. Start backend + frontend
2. Initialize LLM (Simple mode or Launch LLM button)
3. Go to Custom mode, enter caption + lyrics
4. Click "Preview LLM" → should return metadata in 1-2 seconds
5. Click "Apply" → metadata fields populate
6. Set task to cover → slider shows "Cover Strength"
7. Set task to text2music + upload reference audio → slider shows "Similarity / Denoise"
8. Generate normally — should still work as before
