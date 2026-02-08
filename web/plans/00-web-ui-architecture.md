# ACE-Step 1.5: Custom Web UI Plan

Replace the buggy Gradio UI with a **Next.js + React** frontend and a clean **FastAPI** backend that wraps the existing Python handlers.

---

## Architecture

```
Browser (Next.js on :3000)
    ↕ REST + WebSocket
FastAPI Backend (:8000)
    ↕ Direct Python imports
Existing handlers (handler.py, llm_inference.py, inference.py)
    ↕
GPU (DiT + LM + VAE)
```

---

## Project Structure

All new code in `web/` at project root. Existing `acestep/` **untouched**.

```
web/
  backend/
    app.py                    # FastAPI app factory + lifespan
    config.py                 # Env var config
    dependencies.py           # Dependency injection (handlers)
    run.py                    # uvicorn entrypoint
    routers/
      service.py              # Init, status, GPU info
      generation.py           # Generate, create-sample, format
      audio.py                # Upload, serve, convert-to-codes, score, LRC
      lora.py                 # Load/unload/enable/scale
      training.py             # Dataset, preprocess, train, export
      models.py               # List DiT/LM models
      examples.py             # Random examples
      ws.py                   # WebSocket for real-time progress
    schemas/
      service.py              # Pydantic models
      generation.py
      audio.py
      lora.py
      training.py
      common.py               # Response wrapper, errors
    services/
      task_manager.py          # ThreadPoolExecutor(1) + WS broadcast
      audio_store.py           # File management + TTL cleanup

  frontend/
    package.json
    next.config.js            # API proxy rewrites for dev
    tailwind.config.ts
    src/
      app/
        layout.tsx            # Root layout with providers
        page.tsx              # Main generation page
        training/page.tsx     # LoRA training page
      components/
        layout/               # Header, Sidebar
        service/              # ServiceConfig, GPUInfo, ModelSelector
        generation/           # GenerationPanel, SimpleMode, CustomMode,
                              # CaptionInput, LyricsInput, MetadataInputs,
                              # TaskTypeSelector, AudioUploads, AdvancedSettings
        results/              # ResultsPanel, AudioCard, AudioPlayer (wavesurfer),
                              # BatchNavigation, ScoreDisplay, LRCDisplay
        training/             # DatasetBuilder, TrainingForm, TrainingProgress
        common/               # AudioUpload, StatusBadge, Toast, Spinner
      hooks/
        useWebSocket.ts       # WS connection + auto-reconnect
        useGeneration.ts      # Generation state + API calls
        useService.ts         # Service init + status
        useBatchNavigation.ts # Batch prev/next
      stores/                 # Zustand stores
        serviceStore.ts       # Model init state
        generationStore.ts    # All generation params + mode
        resultsStore.ts       # Batch queue, audio results
        uiStore.ts            # Language, sidebar, theme
      lib/
        api.ts                # API client (fetch/axios)
        ws.ts                 # WebSocket client class
        constants.ts          # Mirrors Python constants
        i18n/                 # en.json, zh.json, ja.json (copied from existing)
        types/                # TypeScript interfaces
```

---

## Backend API Endpoints

### Service
| Method | Path | Wraps |
|--------|------|-------|
| `GET` | `/api/service/status` | Handler state + GPU config |
| `POST` | `/api/service/initialize` | `dit_handler.initialize_service()` + `llm_handler.initialize()` |
| `GET` | `/api/service/gpu-config` | `get_gpu_config()` |

### Models
| Method | Path | Wraps |
|--------|------|-------|
| `GET` | `/api/models/dit` | `dit_handler.get_available_acestep_v15_models()` |
| `GET` | `/api/models/lm` | `llm_handler.get_available_5hz_lm_models()` |
| `GET` | `/api/models/checkpoints` | `dit_handler.get_available_checkpoints()` |

### Generation
| Method | Path | Wraps |
|--------|------|-------|
| `POST` | `/api/generation/generate` | `inference.generate_music()` via task manager |
| `GET` | `/api/generation/task/{id}` | Poll task status |
| `POST` | `/api/generation/create-sample` | `inference.create_sample()` |
| `POST` | `/api/generation/format` | `inference.format_sample()` |
| `POST` | `/api/generation/understand` | `inference.understand_music()` |

### Audio
| Method | Path | Wraps |
|--------|------|-------|
| `POST` | `/api/audio/upload` | Store temp file, return ID |
| `GET` | `/api/audio/files/{id}` | Serve audio via FileResponse |
| `POST` | `/api/audio/convert-to-codes` | `dit_handler.convert_src_audio_to_codes()` |
| `POST` | `/api/audio/{id}/score` | `dit_handler.get_lyric_score()` |
| `POST` | `/api/audio/{id}/lrc` | `dit_handler.get_lyric_timestamp()` |
| `GET` | `/api/audio/download-all/{task_id}` | ZIP bundle |

### LoRA
| Method | Path | Wraps |
|--------|------|-------|
| `GET` | `/api/lora/status` | `dit_handler.get_lora_status()` |
| `POST` | `/api/lora/load` | `dit_handler.load_lora(path)` |
| `POST` | `/api/lora/unload` | `dit_handler.unload_lora()` |
| `POST` | `/api/lora/enable` | `dit_handler.set_use_lora(bool)` |
| `POST` | `/api/lora/scale` | `dit_handler.set_lora_scale(float)` |

### Training
| Method | Path | Wraps |
|--------|------|-------|
| `POST` | `/api/training/dataset/scan` | Scan audio directory |
| `POST` | `/api/training/dataset/auto-label` | LLM auto-labeling |
| `GET` | `/api/training/dataset/samples` | Get sample table |
| `PUT` | `/api/training/dataset/sample/{idx}` | Edit sample |
| `POST` | `/api/training/dataset/save` | Save JSON |
| `POST` | `/api/training/dataset/load` | Load JSON |
| `POST` | `/api/training/preprocess` | Audio -> tensors |
| `POST` | `/api/training/start` | Start LoRA training |
| `GET` | `/api/training/status` | Training progress |
| `POST` | `/api/training/stop` | Stop training |
| `POST` | `/api/training/export` | Export LoRA |

### WebSocket
| Path | Purpose |
|------|---------|
| `/api/ws` | Real-time progress: subscribe to task, receive progress/completed/error events |

### Examples
| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/examples/random?mode=simple` | Random simple description |
| `GET` | `/api/examples/random?mode=custom&task=text2music` | Random custom example |

---

## Key Design Decisions

### Long-Running Tasks
- `POST /generate` returns `task_id` immediately
- Generation runs in `ThreadPoolExecutor(max_workers=1)` (GPU is single-resource)
- Client subscribes via WebSocket for real-time progress
- Fallback: poll `GET /task/{id}`
- Progress callback passed to `generate_music()` broadcasts via WS

### Extra Outputs for Score/LRC
- `get_lyric_score()` and `get_lyric_timestamp()` need tensors from generation
- Store `extra_outputs` in memory keyed by task_id with TTL cleanup
- Score/LRC endpoints reference task_id to access stored tensors

### Audio File Lifecycle
- Generated files stored in managed temp dir via `AudioStore`
- UUID-based IDs, served at `/api/audio/files/{id}`
- Auto-cleanup after 24 hours
- Upload files get temp IDs, resolved to paths before handler calls

### Frontend State
- **Zustand** stores (4 stores: service, generation, results, ui)
- Lightweight, no Redux boilerplate
- Each store manages one domain

---

## Frontend Tech Stack
- **Next.js 14** (App Router)
- **TypeScript**
- **Tailwind CSS** + **shadcn/ui** components
- **Zustand** for state
- **wavesurfer.js** for audio waveform visualization
- **Native WebSocket** with auto-reconnect

---

## Feature Parity Checklist

### Service Configuration
- [ ] DiT model selection (6 models: turbo, shift1, shift3, continuous, sft, base)
- [ ] LM model selection (3 models: 0.6B, 1.7B, 4B)
- [ ] Device selection (auto/cuda/cpu)
- [ ] Performance options (flash attention, CPU offload, DiT offload, compile, quantization)
- [ ] Initialize button with progress
- [ ] LoRA management (load/unload/enable/scale slider)
- [ ] Checkpoint browser

### Generation - Simple Mode
- [ ] Natural language query input
- [ ] Instrumental checkbox
- [ ] Vocal language selector
- [ ] Create Sample button (LLM generates caption/lyrics/metadata)
- [ ] Random description dice button

### Generation - Custom Mode
- [ ] Task type selector (text2music, cover, repaint, lego, extract, complete)
- [ ] Dynamic instruction display per task type
- [ ] Caption textarea + random example button + Format button
- [ ] Lyrics textarea + structure tag support
- [ ] Instrumental checkbox
- [ ] Vocal language dropdown (50+ languages)
- [ ] BPM input (30-300)
- [ ] Key/scale input (70 valid combinations)
- [ ] Time signature dropdown (2/4, 3/4, 4/4, 6/8)
- [ ] Duration input (10-600s)
- [ ] Batch size (1-8, GPU-aware max)
- [ ] Reference audio upload (style transfer)
- [ ] Source audio upload (for cover/repaint/lego/extract/complete)
- [ ] Convert to codes button
- [ ] Audio codes textarea + transcribe button
- [ ] Track name selector (for lego/extract)
- [ ] Complete track classes selector (for complete task)
- [ ] Repainting start/end inputs (for repaint/lego)
- [ ] Audio cover strength slider (for cover)
- [ ] Load saved params from JSON

### Advanced Settings
- [ ] Inference steps slider (1-200)
- [ ] Guidance scale slider (1-15, base model only)
- [ ] Seed input + random seed checkbox
- [ ] Shift slider (1-5)
- [ ] Inference method dropdown (ode/sde)
- [ ] Custom timesteps input
- [ ] Audio format dropdown (mp3/flac)
- [ ] Use ADG checkbox (base only)
- [ ] CFG interval start/end sliders (base only)
- [ ] LM temperature (0-2)
- [ ] LM CFG scale (1-3)
- [ ] LM top-k (0-100)
- [ ] LM top-p (0-1)
- [ ] LM negative prompt
- [ ] CoT metas / CoT language checkboxes
- [ ] Constrained decoding debug
- [ ] Think mode checkbox
- [ ] Parallel thinking checkbox
- [ ] Caption rewrite checkbox
- [ ] AutoGen toggle
- [ ] Auto score checkbox
- [ ] Auto LRC checkbox
- [ ] LM codes strength (0-1)
- [ ] LM batch chunk size

### Results
- [ ] Audio playback with waveform (1-8 cards)
- [ ] Send to source audio button
- [ ] Save audio + metadata button
- [ ] Quality score button + display
- [ ] LRC generation button + display
- [ ] Audio codes display
- [ ] Batch navigation (prev/next)
- [ ] Batch indicator (Batch X / Y)
- [ ] Restore parameters from batch
- [ ] Download all files
- [ ] Generation details (time costs, metadata)

### LoRA Training
- [ ] Dataset builder: scan directory
- [ ] Dataset builder: load existing JSON
- [ ] Auto-label with LLM (caption, BPM, key, time sig)
- [ ] Preview/edit samples (audio, caption, lyrics, metadata)
- [ ] Custom activation tags
- [ ] Save dataset JSON
- [ ] Preprocess to tensors
- [ ] Training config (rank, alpha, dropout, LR, epochs, batch, grad accum, save interval, shift, seed)
- [ ] Start/stop training
- [ ] Training progress (epoch, loss)
- [ ] Loss plot visualization
- [ ] Export LoRA

### i18n
- [ ] English
- [ ] Chinese
- [ ] Japanese

---

## Implementation Phases

### Phase 1: Foundation
1. Backend app factory, config, dependencies, run.py
2. Pydantic schemas for all endpoints
3. Service router (status + initialize)
4. Models router (list DiT + LM)
5. Next.js project setup (create-next-app, Tailwind, shadcn/ui)
6. Root layout + Header
7. Service config sidebar with model selectors + init button
8. Zustand stores (serviceStore, uiStore)

### Phase 2: Core Generation
9. Task manager (ThreadPoolExecutor + WS broadcast)
10. Generation router (generate endpoint)
11. WebSocket endpoint
12. Audio router (upload, serve files)
13. Generation store + useWebSocket hook
14. Custom mode form (all input fields)
15. Results panel with AudioCard (HTML5 audio first)
16. Full generate -> subscribe -> display flow

### Phase 3: Full Features
17. Simple mode (create-sample, format)
18. Examples router + random loading
19. wavesurfer.js audio player integration
20. Batch management (prev/next/restore)
21. Score + LRC endpoints + UI
22. Audio codes (convert, transcribe, understand)
23. Advanced settings panel (DiT + LM params)
24. Send to source audio chaining
25. Save + download all
26. AutoGen continuous generation

### Phase 4: Training + Polish
27. LoRA router (load/unload/enable/scale)
28. Training router (dataset, preprocess, train, export)
29. Dataset builder UI
30. Training form + progress UI
31. i18n wiring (en/zh/ja)
32. Error handling + toast notifications
33. GPU-aware limits (clamp duration/batch per tier)
34. Responsive layout polish

---

## Critical Existing Files (wrap, don't rewrite)

| File | What to wrap |
|------|-------------|
| `acestep/inference.py` | `generate_music()`, `create_sample()`, `format_sample()`, `understand_music()` + dataclasses |
| `acestep/handler.py` | `AceStepHandler` - init, generate, LoRA, score, LRC, VAE encode/decode |
| `acestep/llm_inference.py` | `LLMHandler` - init, generate_with_stop_condition, understand_audio_from_codes |
| `acestep/gpu_config.py` | `get_gpu_config()`, tier detection, limit checking |
| `acestep/constants.py` | Task types, languages, track names, valid keys, BPM/duration ranges |
| `acestep/audio_utils.py` | `AudioSaver`, UUID generation |
| `acestep/training/` | `DatasetBuilder`, `Trainer`, `LoRAConfig`, `TrainingConfig` |
| `acestep/gradio_ui/events/generation_handlers.py` | Reference for UI behavior logic |
| `acestep/gradio_ui/events/results_handlers.py` | Reference for batch management + score/LRC flow |
| `acestep/gradio_ui/i18n/*.json` | Translation files to copy |

---

## Dev Workflow

```bash
# Terminal 1: Backend
cd web/backend && python run.py    # port 8000

# Terminal 2: Frontend
cd web/frontend && npm run dev     # port 3000, proxies /api -> 8000
```

## Verification

1. Start backend, verify `GET /api/service/status` returns uninitialized
2. `POST /api/service/initialize` with turbo + 1.7B LM, verify models load
3. `POST /api/generation/generate` with simple caption, verify task_id returned
4. WebSocket subscription receives progress + completed events
5. Audio plays in browser from `/api/audio/files/{id}`
6. Batch generation (size=4) produces 4 AudioCards
7. Score + LRC buttons work on generated audio
8. Simple mode create-sample generates caption/lyrics/metadata
9. Cover task with source audio upload works
10. LoRA load/unload/scale works
11. Training dataset scan + auto-label works
12. i18n switches between en/zh/ja
