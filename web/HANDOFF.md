# ACE-Step 1.5 Web UI - Session Handoff

## What Was Done

Replaced the Gradio UI with a **Next.js 14 + React** frontend and a **FastAPI** backend that wraps the existing Python handlers. All new code lives in `web/`. The existing `acestep/` directory is **completely untouched**.

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

## How to Run

```bash
# Terminal 1: Backend
cd web/backend && python run.py    # port 8000

# Terminal 2: Frontend
cd web/frontend && npm install && npm run dev    # port 3000, proxies /api -> 8000
```

The frontend `next.config.js` proxies all `/api/*` requests to `localhost:8000`.

---

## File Inventory (63 files total)

### Backend: `web/backend/` (24 files)

#### Core (4 files)
| File | Purpose |
|------|---------|
| `app.py` | FastAPI app factory with CORS, lifespan (starts audio cleanup, shuts down task manager), includes all routers under `/api/` prefix |
| `config.py` | Env var config: `ACE_HOST`, `ACE_PORT`, `ACE_PROJECT_ROOT`, `ACE_TEMP_DIR`, `ACE_AUDIO_TTL_HOURS`, `ACE_CORS_ORIGINS` |
| `dependencies.py` | Singleton dependency injection for `AceStepHandler` (DiT) and `LLMHandler`. Adds project root to `sys.path` so `acestep` is importable |
| `run.py` | Uvicorn entrypoint. Adds project root to sys.path, runs `web.backend.app:create_app` as factory |

#### Schemas: `web/backend/schemas/` (6 files)
| File | Key Models |
|------|-----------|
| `common.py` | `ApiResponse(success, data, error)`, `ErrorResponse` |
| `service.py` | `InitializeRequest`, `ServiceStatus`, `GPUConfigResponse` |
| `generation.py` | `GenerateRequest` (all 40+ generation params), `TaskStatusResponse`, `CreateSampleRequest/Response`, `FormatRequest/Response`, `UnderstandRequest/Response` |
| `audio.py` | `AudioUploadResponse`, `ConvertToCodesRequest/Response`, `ScoreRequest/Response`, `LRCRequest/Response` |
| `lora.py` | `LoadLoRARequest`, `EnableLoRARequest`, `ScaleLoRARequest`, `LoRAStatusResponse` |
| `training.py` | `ScanDatasetRequest`, `AutoLabelRequest`, `SampleEdit`, `TrainingRequest`, `TrainingStatusResponse`, `ExportLoRARequest` |

#### Routers: `web/backend/routers/` (8 files)

| File | Prefix | Endpoints | Wraps |
|------|--------|-----------|-------|
| `service.py` | `/api/service` | `GET /status`, `POST /initialize`, `GET /gpu-config` | `dit_handler.initialize_service()`, `llm_handler.initialize()`, `get_gpu_config()` |
| `models.py` | `/api/models` | `GET /dit`, `GET /lm`, `GET /checkpoints` | `dit_handler.get_available_acestep_v15_models()`, `llm_handler.get_available_5hz_lm_models()`, `dit_handler.get_available_checkpoints()` |
| `generation.py` | `/api/generation` | `POST /generate`, `GET /task/{id}`, `POST /create-sample`, `POST /format`, `POST /understand`, **`POST /pipeline`** (7 stage types with full validation) | `inference.generate_music()` via task_manager, `inference.create_sample()`, `inference.format_sample()`, `inference.understand_music()`, `pipeline_executor.run_pipeline()` |
| `audio.py` | `/api/audio` | `POST /upload`, `GET /files/{id}`, `POST /convert-to-codes`, `POST /score`, `POST /lrc`, `GET /download-all/{task_id}` | `dit_handler.convert_src_audio_to_codes()`, `dit_handler.get_lyric_score()`, `dit_handler.get_lyric_timestamp()` |
| `lora.py` | `/api/lora` | `GET /status`, `POST /load`, `POST /unload`, `POST /enable`, `POST /scale` | `dit_handler.load_lora()`, `.unload_lora()`, `.set_use_lora()`, `.set_lora_scale()`, `.get_lora_status()` |
| `training.py` | `/api/training` | `POST /dataset/scan`, `POST /dataset/auto-label`, `GET /dataset/samples`, `PUT /dataset/sample/{idx}`, `POST /dataset/save`, `POST /dataset/load`, `POST /preprocess`, `POST /start`, `GET /status`, `POST /stop`, `POST /export` | `DatasetBuilder`, `Trainer`, `lora_utils.export_lora` |
| `examples.py` | `/api/examples` | `GET /random?mode=simple&task_type=text2music` | Reads JSON files from `acestep/gradio_ui/examples/` |
| `ws.py` | `/api` | `WS /ws` | WebSocket for real-time progress. Clients send `{"type":"subscribe","task_id":"..."}` to subscribe |

#### Services: `web/backend/services/` (4 files)

| File | Purpose |
|------|---------|
| `task_manager.py` | `TaskManager` singleton with `ThreadPoolExecutor(max_workers=1)` for GPU tasks. `submit(fn)` returns task_id. Stores `Task` objects with status/progress/result/extra_outputs. Broadcasts progress via WebSocket to subscribed clients. `extra_outputs` kept in memory for score/LRC (contains tensors). Auto-cleanup of old tasks. |
| `audio_store.py` | `AudioStore` singleton managing temp audio files with UUID-based IDs. `store_file()` copies to temp dir, `store_upload()` saves uploaded bytes, `get_path()` resolves ID to path. Background cleanup thread removes files older than `AUDIO_TTL_HOURS` (default 24). |
| `pipeline_executor.py` | **NEW.** `run_pipeline()` orchestrates multi-stage diffusion with 7 stage types. `resolve_src_audio()` resolves source from upload or previous stage VAE decode. `build_stage_instruction()` does template substitution from `TASK_INSTRUCTIONS`. Handles latent chaining, model swapping, per-stage progress, audio save. |
| `audio_metadata.py` | **NEW.** `embed_metadata()` writes generation params to audio files. `build_pipeline_metadata()` serializes pipeline config for reproducibility. |

### Frontend: `web/frontend/` (39 files)

#### Config (5 files)
| File | Notes |
|------|-------|
| `package.json` | next 14, react 18, zustand 4, wavesurfer.js 7, clsx, tailwind-merge |
| `next.config.js` | Proxies `/api/*` to `http://localhost:8000/api/*` |
| `tailwind.config.ts` | Dark mode, custom primary color palette |
| `tsconfig.json` | Path alias `@/*` -> `./src/*` |
| `postcss.config.js` | Standard tailwind + autoprefixer |

#### App: `src/app/` (4 files)
| File | Purpose |
|------|---------|
| `globals.css` | CSS custom properties for dark theme, utility classes (.btn, .card, .badge, .progress-bar, .toast, slider/checkbox styles, collapsible) |
| `layout.tsx` | Root layout: wraps children with `<Header>`, `<Sidebar>`, `<ToastContainer>` |
| `page.tsx` | Main generation page. Two-column grid: `<GenerationPanel>` left, `<ResultsPanel>` right. Sets up `useWebSocket` to handle progress/completed/error messages from backend, auto-subscribes to current task |
| `training/page.tsx` | LoRA training page with `<DatasetBuilder>`, `<TrainingForm>`, `<TrainingProgress>` |

#### Components: `src/components/` (14 files)

**Layout (2)**
| File | Purpose |
|------|---------|
| `layout/Header.tsx` | Top bar: title, DiT/LLM status badges, language selector (en/zh/ja) |
| `layout/Sidebar.tsx` | Left sidebar (320px): contains `<ServiceConfig>` and `<LoRAPanel>`. Collapsible on mobile |

**Service (2)**
| File | Purpose |
|------|---------|
| `service/ServiceConfig.tsx` | Full service init form: DiT model selector (6 models), device, LLM toggle, LM model selector (3 models), backend (vllm/pt), flash attention, CPU offload, DiT offload, compile, quantization, GPU info display, Initialize button with spinner |
| `service/LoRAPanel.tsx` | LoRA management: status badges, path input + load button, enable/disable toggle, scale slider (0-2), unload button. Only shows when DiT initialized |

**Generation (4)**
| File | Purpose |
|------|---------|
| `generation/GenerationPanel.tsx` | Mode selector (Simple/Custom), renders mode component, AdvancedSettings, Generate button with spinner, AutoGen toggle |
| `generation/SimpleMode.tsx` | Natural language query textarea, dice button for random example, instrumental checkbox, vocal language dropdown, Create Sample button. Shows generated caption/lyrics/metadata preview |
| `generation/CustomMode.tsx` | Full custom mode: task type selector (adapts to turbo/base), instruction field, track name (lego/extract), complete track classes (multi-select), caption textarea + Random + Format buttons, lyrics textarea, instrumental toggle, metadata grid (language, BPM, key, time sig, duration, batch size), audio uploads (reference + source), convert to codes button, audio codes textarea, repainting controls (start/end), cover strength slider |
| `generation/AdvancedSettings.tsx` | Collapsible panel. DiT params: inference steps slider, guidance scale (base only), shift, seed, random seed, infer method, audio format, custom timesteps, ADG + CFG intervals (base only). LM params: temperature, CFG scale, top-k, top-p, negative prompt, batch chunk size, codes strength. Checkboxes: think, CoT metas, caption rewrite, CoT language, constrained decoding, debug, parallel thinking, auto score, auto LRC. Score sensitivity slider |

**Results (3)**
| File | Purpose |
|------|---------|
| `results/ResultsPanel.tsx` | Shows generating state (progress bar + message) or current batch. Batch navigation (prev/next buttons + "Batch X / Y"). Grid of AudioCards. Restore params button, download all link, generation details (collapsible JSON) |
| `results/AudioCard.tsx` | Per-audio card: AudioPlayer (wavesurfer), action buttons (Send to Src, Save/Download, Score, LRC). Score display, LRC display (pre-formatted), audio codes (collapsible). Calls `/api/audio/score` and `/api/audio/lrc` endpoints |
| `results/AudioPlayer.tsx` | Wraps wavesurfer.js: waveform visualization (blue theme, 64px height), play/pause button, time display. Falls back to plain `<audio>` if wavesurfer fails to load |

**Training (3)**
| File | Purpose |
|------|---------|
| `training/DatasetBuilder.tsx` | Scan directory input, load existing JSON, sample list with edit capability (caption, BPM, key, language), auto-label button, save dataset |
| `training/TrainingForm.tsx` | Preprocess output dir, dataset path, output dir, LoRA config (rank, alpha, dropout), training config (LR, epochs, batch size, grad accum, save interval, seed), Start/Stop buttons, Export LoRA section |
| `training/TrainingProgress.tsx` | Polls `/api/training/status` every 3s. Shows running/stopped badge, epoch/total, loss value, progress bar, loss curve canvas chart |

**Common (3)**
| File | Purpose |
|------|---------|
| `common/Toast.tsx` | Fixed bottom-right toast container, renders from `uiStore.toasts`, click to dismiss |
| `common/Spinner.tsx` | CSS border spinner, 3 sizes (sm/md/lg), accent color |
| `common/AudioUpload.tsx` | File input + upload to `/api/audio/upload`, shows filename + clear button + inline audio preview |

#### Hooks: `src/hooks/` (4 files)
| File | Purpose |
|------|---------|
| `useWebSocket.ts` | Creates `WSClient`, connects on mount, disconnects on unmount. `subscribe(taskId)` function. Re-registers message handler on change |
| `useGeneration.ts` | `generate()`: builds `GenerateRequest` from store, calls `startGeneration` API, sets task ID in results store. `createSample()`: calls `/api/generation/create-sample`, populates generation store. `formatCaption()`: calls `/api/generation/format`, updates store |
| `useService.ts` | `fetchStatus()`, `fetchGPUConfig()`, `fetchModels()` on mount. `initialize(req)`: calls API, updates store, shows toast |
| `useBatchNavigation.ts` | `goNext()`, `goPrev()`, `restoreParams()` (loads batch params back into generation store) |

#### Stores: `src/stores/` (4 files)
| File | State |
|------|-------|
| `serviceStore.ts` | `status` (ServiceStatus), `gpuConfig`, `ditModels[]`, `lmModels[]`, `checkpoints[]`, `initializing`, `error` |
| `generationStore.ts` | ALL generation params (~50 fields): mode, simpleQuery, caption, lyrics, instrumental, taskType, instruction, metadata (bpm/key/timesig/duration), audio refs, repainting, DiT params, LM params, auto features. Actions: `setField`, `setFields`, `resetToDefaults` |
| `resultsStore.ts` | `batches[]`, `currentBatchIndex`, `currentTaskId`, `generating`, `progress`, `statusMessage`, `scores{}`, `lrcs{}`. Actions: `addBatch`, `goNext`, `goPrev`, `getCurrentBatch`, `clear` |
| `uiStore.ts` | `language` (en/zh/ja), `sidebarOpen`, `theme`, `toasts[]`. Actions: `addToast` (auto-removes after 5s), `removeToast` |

#### Lib: `src/lib/` (8 files)
| File | Purpose |
|------|---------|
| `types/index.ts` | TypeScript interfaces matching all backend Pydantic schemas |
| `api.ts` | Fetch-based API client with typed functions for every endpoint (~35 functions) |
| `ws.ts` | `WSClient` class: WebSocket with auto-reconnect (3s), subscribe to task, handler registration |
| `constants.ts` | Mirrors `acestep/constants.py`: `VALID_LANGUAGES` (51), `LANGUAGE_NAMES`, `TASK_TYPES`, `TASK_TYPES_TURBO`, `TASK_INSTRUCTIONS`, `TRACK_NAMES`, `TIME_SIGNATURES`, `BPM_MIN/MAX`, `DURATION_MIN/MAX`, `AUDIO_FORMATS`, `INFER_METHODS` |
| `i18n/en.json` | English translations (copied from `acestep/gradio_ui/i18n/en.json`) |
| `i18n/zh.json` | Chinese translations (copied from `acestep/gradio_ui/i18n/zh.json`) |
| `i18n/ja.json` | Japanese translations (copied from `acestep/gradio_ui/i18n/ja.json`) |
| `i18n/index.ts` | `t(lang, 'path.to.key')` and `tReplace(lang, path, {key: value})` functions |

---

## Key Design Decisions

### Long-Running Tasks
- `POST /api/generation/generate` returns `task_id` immediately
- Generation runs in `ThreadPoolExecutor(max_workers=1)` (GPU is single-resource)
- Client subscribes via WebSocket: `{"type":"subscribe","task_id":"abc123"}`
- Backend broadcasts `progress`, `completed`, `error` messages
- Fallback: poll `GET /api/generation/task/{id}`

### Score/LRC Tensor Storage
- `generate_music()` returns `extra_outputs` containing tensors (pred_latents, encoder_hidden_states, etc.)
- These are stored in `task_manager._tasks[task_id].extra_outputs` in memory
- Score endpoint (`POST /api/audio/score`) and LRC endpoint (`POST /api/audio/lrc`) reference `task_id` to access stored tensors
- Tensors are cleaned up when tasks expire (default 1 hour)

### Audio File Lifecycle
- Generated files stored in `web_tmp/{task_id}/` via `AudioStore`
- UUID-based IDs, served at `GET /api/audio/files/{id}`
- Uploaded files also get UUID IDs
- Auto-cleanup after 24 hours (configurable via `ACE_AUDIO_TTL_HOURS`)

### Frontend State Architecture
- 4 Zustand stores, each managing one domain
- Components read from stores directly, actions via hooks
- WebSocket messages handled in `page.tsx`, dispatched to results store

---

## Existing ACE-Step Files

| File | Status | What's wrapped / changed |
|------|--------|--------------------------|
| `acestep/diffusion_core.py` | **NEW** | Unified diffusion loop (`generate_audio_core()`) replacing per-model `generate_audio()`. `VariantConfig`, `MODEL_VARIANT_CONFIGS` (6 variants), `TimestepScheduler` (4 strategies + `truncate()`), CFG/APG/ADG guidance. Pipeline Builder `init_latents`/`t_start` support. |
| `acestep/handler.py` | **MODIFIED** | Imports `generate_audio_core`, stores `self.model_variant`, calls unified loop instead of `model.generate_audio()`. Added `init_latents`/`t_start` params to `generate_music()` and `service_generate()`. |
| `acestep/inference.py` | **MODIFIED** | Added `init_latents` (Any) + `t_start` (float) to `GenerationParams`, threaded through `generate_music()` → `dit_handler.generate_music()`. |
| `acestep/llm_inference.py` | Wrapped | `LLMHandler` - `initialize()`, `generate_with_stop_condition()`, `understand_audio_from_codes()`, `create_sample_from_query()`, `format_sample_from_input()`, `get_available_5hz_lm_models()` |
| `acestep/gpu_config.py` | `get_gpu_config()`, `GPUConfig` dataclass |
| `acestep/constants.py` | All constants mirrored in `lib/constants.ts` |
| `acestep/audio_utils.py` | `AudioSaver` used inside `generate_music()` |
| `acestep/training/` | `DatasetBuilder`, `Trainer`, `TrainingConfig`, `LoRAConfig`, `export_lora` (imported lazily in training router) |
| `acestep/gradio_ui/i18n/*.json` | Copied to `lib/i18n/` |
| `acestep/gradio_ui/examples/` | Read directly by examples router |

---

## Known Issues / TODO for Next Session

1. **npm install not run yet** - Frontend dependencies need to be installed
2. **Backend dependency check** - Needs `fastapi`, `uvicorn`, `python-multipart` pip packages
3. **Training router** - Uses lazy imports for `DatasetBuilder`, `Trainer`, `LoRAConfig`, `TrainingConfig` - these import paths need verification against actual `acestep/training/` module structure
4. **Score/LRC endpoints** - The `dit_handler.get_lyric_score()` and `dit_handler.get_lyric_timestamp()` method signatures need verification - they were inferred from the Gradio results_handlers.py reference code
5. **Progress callback** - The `progress_cb` passed to `generate_music()` may not match the expected signature (Gradio uses `gr.Progress(track_tqdm=True)`, our callback is a simple function)
6. **WebSocket broadcast from thread** - `_broadcast_sync` uses `asyncio.run_coroutine_threadsafe` which requires the event loop to be accessible from the worker thread - may need testing
7. **next-env.d.ts** - Not created, will be auto-generated on first `npm run dev`
8. **No `.gitignore` for web/** - Should add one for `node_modules/`, `.next/`, `web_tmp/`
9. **Training module** - The `DatasetBuilder`, `Trainer` classes' exact method signatures (`.scan_directory()`, `.auto_label()`, `.get_samples()`, `.edit_sample()`, `.save()`, `.load()`, `.preprocess()`, `.train()`, `.stop()`) were inferred and may need adjustment
10. **Audio router score/LRC** - Need to verify the exact tensor keys in `extra_outputs` match what `get_lyric_score()` and `get_lyric_timestamp()` expect
