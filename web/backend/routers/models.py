"""Models router: list available DiT and LM models, check download status.

Scans the checkpoints directory to determine what's actually usable
(has weight files) vs just metadata stubs.
"""

import os
import threading
from pathlib import Path
from typing import Dict, Any

from fastapi import APIRouter, Depends
from loguru import logger

from web.backend.dependencies import get_dit_handler, get_llm_handler
from web.backend.schemas.common import ApiResponse
from web.backend import config as app_config

router = APIRouter()

# Download state tracking: model_name -> {status, message}
# status: "downloading" | "completed" | "error"
_download_state: Dict[str, Dict[str, str]] = {}


# Descriptions keyed by model name — enriches whatever we find on disk.
# If a model exists on disk but isn't listed here, it still shows up
# with a generic description.
DIT_DESCRIPTIONS: Dict[str, Dict[str, Any]] = {
    "acestep-v15-turbo": {
        "name": "Turbo",
        "description": "Fast 8-step generation with distilled model. Best balance of speed and quality for most use cases.",
        "steps": 8, "cfg": False, "speed": "Fast", "quality": "High", "recommended": True,
    },
    "acestep-v15-turbo-shift1": {
        "name": "Turbo Shift-1",
        "description": "Turbo variant with shift=1. More creative/diverse outputs with slightly less consistency.",
        "steps": 8, "cfg": False, "speed": "Fast", "quality": "High",
    },
    "acestep-v15-turbo-shift3": {
        "name": "Turbo Shift-3",
        "description": "Turbo variant with shift=3. Stronger conditioning adherence, good for LoRA training.",
        "steps": 8, "cfg": False, "speed": "Fast", "quality": "High",
    },
    "acestep-v15-turbo-continuous": {
        "name": "Turbo Continuous",
        "description": "Turbo variant optimized for continuous/long-form generation and music extension.",
        "steps": 8, "cfg": False, "speed": "Fast", "quality": "High",
    },
    "acestep-v15-sft": {
        "name": "SFT (Supervised Fine-Tuned)",
        "description": "Supervised fine-tuned model. Higher quality outputs but requires more steps (32-50).",
        "steps": 50, "cfg": True, "speed": "Slow", "quality": "Very High",
    },
    "acestep-v15-base": {
        "name": "Base",
        "description": "Original base model. Highest quality, most flexible, but slowest. Supports CFG guidance.",
        "steps": 50, "cfg": True, "speed": "Slow", "quality": "Highest",
    },
}

LM_DESCRIPTIONS: Dict[str, Dict[str, Any]] = {
    "acestep-5Hz-lm-0.6B": {
        "name": "0.6B (Small)",
        "description": "Lightweight language model. Fast inference, lower VRAM. Good for quick iterations.",
        "params": "0.6B", "vram": "~3 GB", "speed": "Fastest", "quality": "Good",
    },
    "acestep-5Hz-lm-1.7B": {
        "name": "1.7B (Medium)",
        "description": "Default language model. Best balance of quality and speed for most setups.",
        "params": "1.7B", "vram": "~8 GB", "speed": "Fast", "quality": "High", "recommended": True,
    },
    "acestep-5Hz-lm-4B": {
        "name": "4B (Large)",
        "description": "Largest language model. Best caption/lyrics understanding but requires more VRAM.",
        "params": "4B", "vram": "~12 GB", "speed": "Slower", "quality": "Highest",
    },
}


def _get_checkpoints_dir() -> str:
    return os.path.join(app_config.PROJECT_ROOT, "checkpoints")


def _has_weights(model_dir: str) -> bool:
    """Check if a model directory actually contains weight files."""
    if not os.path.isdir(model_dir):
        return False
    for f in os.listdir(model_dir):
        if f.endswith((".safetensors", ".bin", ".pt")):
            return True
    return False


def _scan_models(prefix: str, descriptions: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Scan checkpoints dir for models matching prefix, merge with descriptions.

    Returns dict keyed by model name with:
      - ready: bool (weight files present)
      - any matching description fields
      - auto-generated name if not in descriptions
    """
    ckpt = _get_checkpoints_dir()
    result = {}

    # 1) Scan disk for all matching directories
    if os.path.isdir(ckpt):
        for entry in sorted(os.listdir(ckpt)):
            if entry.startswith(prefix) and os.path.isdir(os.path.join(ckpt, entry)):
                ready = _has_weights(os.path.join(ckpt, entry))
                info = {"ready": ready}
                if entry in descriptions:
                    info.update(descriptions[entry])
                else:
                    # Auto-generate a name from the directory name
                    info["name"] = entry.replace(prefix, "").strip("-") or entry
                    info["description"] = f"Model found at checkpoints/{entry}"
                    info["speed"] = "Unknown"
                    info["quality"] = "Unknown"
                result[entry] = info

    # 2) Also include known models that aren't on disk yet (downloadable)
    for name, desc in descriptions.items():
        if name not in result:
            result[name] = {"ready": False, **desc}

    return result


@router.get("/dit")
def list_dit_models():
    """Return DiT models found on disk (with weight files)."""
    models = _scan_models("acestep-v15-", DIT_DESCRIPTIONS)
    # Return only names of models that have weights (usable)
    return ApiResponse(data=[name for name, info in models.items() if info["ready"]])


@router.get("/lm")
def list_lm_models():
    """Return LM models found on disk (with weight files)."""
    models = _scan_models("acestep-5Hz-lm-", LM_DESCRIPTIONS)
    return ApiResponse(data=[name for name, info in models.items() if info["ready"]])


@router.get("/checkpoints")
def list_checkpoints(dit=Depends(get_dit_handler)):
    checkpoints = dit.get_available_checkpoints()
    return ApiResponse(data=checkpoints)


@router.get("/info")
def model_info():
    """Return full model info: descriptions + ready status, scanned from disk."""
    return ApiResponse(data={
        "dit": _scan_models("acestep-v15-", DIT_DESCRIPTIONS),
        "lm": _scan_models("acestep-5Hz-lm-", LM_DESCRIPTIONS),
    })


@router.get("/download-status")
def download_status():
    """Check which models are downloaded and usable."""
    dit = _scan_models("acestep-v15-", DIT_DESCRIPTIONS)
    lm = _scan_models("acestep-5Hz-lm-", LM_DESCRIPTIONS)
    ckpt = _get_checkpoints_dir()

    return ApiResponse(data={
        "main_ready": all([
            _has_weights(os.path.join(ckpt, "vae")),
            _has_weights(os.path.join(ckpt, "Qwen3-Embedding-0.6B")),
        ]),
        "dit": {name: info["ready"] for name, info in dit.items()},
        "lm": {name: info["ready"] for name, info in lm.items()},
        "core": {
            "vae": _has_weights(os.path.join(ckpt, "vae")),
            "text_encoder": _has_weights(os.path.join(ckpt, "Qwen3-Embedding-0.6B")),
        },
        "downloading": dict(_download_state),
    })


@router.post("/download/{model_name}")
def download_model(model_name: str):
    """Start downloading a sub-model in the background.

    Works for models in SUBMODEL_REGISTRY (LM 0.6B/4B, DiT shift1/shift3/continuous/sft/base).
    For turbo/1.7B/vae/text_encoder use /download-main instead.
    """
    from acestep.model_downloader import SUBMODEL_REGISTRY

    if model_name not in SUBMODEL_REGISTRY:
        return ApiResponse(success=False, error=f"Unknown sub-model '{model_name}'. Use /download-main for core components.")

    if model_name in _download_state and _download_state[model_name]["status"] == "downloading":
        return ApiResponse(data={"status": "downloading", "message": "Already downloading"})

    _download_state[model_name] = {"status": "downloading", "message": "Starting download..."}

    def _do_download():
        try:
            from acestep.model_downloader import download_submodel
            ckpt = Path(_get_checkpoints_dir())
            success, msg = download_submodel(model_name, checkpoints_dir=ckpt)
            _download_state[model_name] = {
                "status": "completed" if success else "error",
                "message": msg,
            }
            logger.info(f"Download {model_name}: {msg}")
        except Exception as e:
            _download_state[model_name] = {"status": "error", "message": str(e)}
            logger.error(f"Download {model_name} failed: {e}")

    threading.Thread(target=_do_download, daemon=True).start()
    return ApiResponse(data={"status": "downloading", "message": f"Started downloading {model_name}"})


@router.post("/download-main")
def download_main():
    """Start downloading core components (vae, text_encoder, turbo DiT, 1.7B LM)."""
    key = "__main__"
    if key in _download_state and _download_state[key]["status"] == "downloading":
        return ApiResponse(data={"status": "downloading", "message": "Already downloading"})

    _download_state[key] = {"status": "downloading", "message": "Starting main model download..."}

    def _do_download():
        try:
            from acestep.model_downloader import download_main_model
            ckpt = Path(_get_checkpoints_dir())
            success, msg = download_main_model(checkpoints_dir=ckpt)
            _download_state[key] = {
                "status": "completed" if success else "error",
                "message": msg,
            }
            logger.info(f"Main model download: {msg}")
        except Exception as e:
            _download_state[key] = {"status": "error", "message": str(e)}
            logger.error(f"Main model download failed: {e}")

    threading.Thread(target=_do_download, daemon=True).start()
    return ApiResponse(data={"status": "downloading", "message": "Started downloading main model"})
