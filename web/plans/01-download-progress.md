# Download Progress Bar

## Approach: Directory size polling + HF repo size lookup

Simplest path — no HuggingFace progress callbacks, no WebSocket streaming. Just:
1. When download starts, fetch expected total size from HuggingFace API (one call)
2. Store it in `_download_state` alongside current dir size
3. Frontend polls `/download-status` (already happening every 5s), shows a progress bar

## Backend Changes

### `web/backend/routers/models.py`

**In `_do_download` (both submodel and main):**
- Before calling `download_submodel()`, fetch repo size via `huggingface_hub.repo_info()`
- Store `total_bytes` in `_download_state[model_name]`
- Also add a helper `_get_dir_size(path)` that sums file sizes in the model dir

**In `/download-status` endpoint:**
- For any model with `status == "downloading"`, also return:
  - `current_bytes`: result of `_get_dir_size()` on the model dir
  - `total_bytes`: from the stored repo info
  - `progress`: percentage (current/total * 100)

### No changes to `acestep/model_downloader.py` (beyond the check fix already done)

## Frontend Changes

### `web/frontend/src/stores/serviceStore.ts`
- Extend `ModelDownloadStatus.downloading` type to include `progress`, `current_bytes`, `total_bytes`

### `web/frontend/src/components/service/ServiceConfig.tsx`
- In `DownloadButton`, read progress from `downloadStatus.downloading[key]`
- Show a simple CSS progress bar + percentage text when downloading
- Replace "Downloading..." spinner text with "Downloading... 42% (3.4 / 8.1 GB)"

## Files to modify
1. `web/backend/routers/models.py` — `_do_download`, `/download-status`, add `_get_dir_size`
2. `web/frontend/src/stores/serviceStore.ts` — extend type
3. `web/frontend/src/components/service/ServiceConfig.tsx` — progress bar UI

## Verification
- Start backend, click download for a model that needs downloading
- Watch progress bar fill up over time
- Confirm it reaches 100% and flips to "Ready"
