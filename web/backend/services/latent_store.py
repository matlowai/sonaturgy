"""Latent tensor store with UUID-based IDs and TTL cleanup.

Follows the same pattern as audio_store.py: in-memory dict + flat files on disk.
Tensors are serialized with safetensors, metadata in companion .json files.
"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional, Tuple

import torch
from loguru import logger
from safetensors.torch import save_file, load_file

from web.backend import config


@dataclass
class LatentRecord:
    """Metadata for a stored latent tensor."""

    id: str
    path: str  # safetensors file on disk
    shape: Tuple[int, ...]  # (batch, T, D)
    dtype: str  # "float32", "float16", etc.
    model_variant: str  # "acestep-v15-base", etc.
    stage_type: str  # "generate", "refine", "cover", etc.
    is_checkpoint: bool  # True if mid-step snapshot
    checkpoint_step: Optional[int]
    total_steps: int
    params: dict  # Full generation params snapshot
    lm_metadata: Optional[dict]  # BPM, key, structure from LLM Phase 1
    batch_size: int
    schedule: Optional[list] = None  # Timestep schedule used (for checkpoint resume)
    created_at: float = field(default_factory=time.time)
    pinned: bool = False
    pipeline_id: Optional[str] = None
    stage_index: Optional[int] = None


class LatentStore:
    """Manages persistent latent tensors with auto-cleanup."""

    def __init__(self):
        self._records: Dict[str, LatentRecord] = {}
        self._lock = threading.Lock()
        self._cleanup_thread: Optional[threading.Thread] = None
        self._running = False
        os.makedirs(config.LATENT_DIR, exist_ok=True)

    def store(self, tensor: torch.Tensor, metadata: Dict[str, Any]) -> str:
        """Serialize tensor to safetensors, store record, return UUID."""
        latent_id = uuid.uuid4().hex[:12]
        tensor_path = os.path.join(config.LATENT_DIR, f"{latent_id}.safetensors")
        meta_path = os.path.join(config.LATENT_DIR, f"{latent_id}.json")

        # Ensure tensor is on CPU and contiguous
        t = tensor.detach().cpu().contiguous()

        # Save tensor
        save_file({"latent": t}, tensor_path)

        record = LatentRecord(
            id=latent_id,
            path=tensor_path,
            shape=tuple(t.shape),
            dtype=str(t.dtype).replace("torch.", ""),
            model_variant=metadata.get("model_variant", "unknown"),
            stage_type=metadata.get("stage_type", "generate"),
            is_checkpoint=metadata.get("is_checkpoint", False),
            checkpoint_step=metadata.get("checkpoint_step"),
            total_steps=metadata.get("total_steps", 0),
            params=metadata.get("params", {}),
            lm_metadata=metadata.get("lm_metadata"),
            batch_size=metadata.get("batch_size", 1),
            schedule=metadata.get("schedule"),
            pipeline_id=metadata.get("pipeline_id"),
            stage_index=metadata.get("stage_index"),
        )

        # Save metadata to companion JSON
        meta_dict = asdict(record)
        meta_dict["shape"] = list(meta_dict["shape"])  # tuple → list for JSON
        with open(meta_path, "w") as f:
            json.dump(meta_dict, f)

        with self._lock:
            self._records[latent_id] = record

        logger.debug(
            f"Stored latent {latent_id}: shape={record.shape}, "
            f"type={record.stage_type}, model={record.model_variant}"
        )
        return latent_id

    def get(self, latent_id: str) -> Optional[torch.Tensor]:
        """Load tensor from disk by UUID. Returns None if missing."""
        record = self.get_record(latent_id)
        if record is None:
            return None
        try:
            data = load_file(record.path)
            return data["latent"]
        except Exception as e:
            logger.error(f"Failed to load latent {latent_id}: {e}")
            return None

    def get_record(self, latent_id: str) -> Optional[LatentRecord]:
        """Get metadata without loading tensor."""
        with self._lock:
            record = self._records.get(latent_id)
        if record is not None:
            return record

        # Try loading from disk (e.g., after server restart)
        meta_path = os.path.join(config.LATENT_DIR, f"{latent_id}.json")
        tensor_path = os.path.join(config.LATENT_DIR, f"{latent_id}.safetensors")
        if os.path.exists(meta_path) and os.path.exists(tensor_path):
            try:
                with open(meta_path) as f:
                    meta = json.load(f)
                record = LatentRecord(
                    id=meta["id"],
                    path=meta["path"],
                    shape=tuple(meta["shape"]),
                    dtype=meta["dtype"],
                    model_variant=meta["model_variant"],
                    stage_type=meta["stage_type"],
                    is_checkpoint=meta["is_checkpoint"],
                    checkpoint_step=meta.get("checkpoint_step"),
                    total_steps=meta["total_steps"],
                    params=meta.get("params", {}),
                    lm_metadata=meta.get("lm_metadata"),
                    batch_size=meta.get("batch_size", 1),
                    schedule=meta.get("schedule"),
                    created_at=meta.get("created_at", 0.0),
                    pinned=meta.get("pinned", False),
                    pipeline_id=meta.get("pipeline_id"),
                    stage_index=meta.get("stage_index"),
                )
                with self._lock:
                    self._records[latent_id] = record
                return record
            except Exception as e:
                logger.error(f"Failed to load latent metadata {latent_id}: {e}")
        return None

    def pin(self, latent_id: str) -> bool:
        """Mark latent as pinned (survives TTL cleanup)."""
        with self._lock:
            record = self._records.get(latent_id)
            if record is None:
                return False
            record.pinned = True
        # Update JSON on disk
        meta_path = os.path.join(config.LATENT_DIR, f"{latent_id}.json")
        if os.path.exists(meta_path):
            try:
                with open(meta_path) as f:
                    meta = json.load(f)
                meta["pinned"] = True
                with open(meta_path, "w") as f:
                    json.dump(meta, f)
            except Exception:
                pass
        return True

    def delete(self, latent_id: str) -> None:
        """Explicitly remove a latent and its files."""
        with self._lock:
            record = self._records.pop(latent_id, None)
        if record:
            for path in [record.path, record.path.replace(".safetensors", ".json")]:
                try:
                    os.remove(path)
                except OSError:
                    pass

    def list_records(self) -> List[LatentRecord]:
        """List all stored latents (metadata only, no tensors)."""
        with self._lock:
            return list(self._records.values())

    def start_cleanup(self):
        self._running = True
        self._cleanup_thread = threading.Thread(
            target=self._cleanup_loop, daemon=True
        )
        self._cleanup_thread.start()
        logger.info(
            f"Latent store started (dir={config.LATENT_DIR}, "
            f"ttl={config.LATENT_TTL_HOURS}h)"
        )

    def stop_cleanup(self):
        self._running = False

    def _cleanup_loop(self):
        while self._running:
            try:
                self._do_cleanup()
            except Exception as e:
                logger.error(f"Latent cleanup error: {e}")
            time.sleep(600)  # Check every 10 minutes

    def _do_cleanup(self):
        ttl = config.LATENT_TTL_HOURS * 3600
        now = time.time()
        expired = []
        with self._lock:
            for lid, record in list(self._records.items()):
                if record.pinned:
                    continue
                if now - record.created_at > ttl:
                    expired.append(lid)
                    for path in [
                        record.path,
                        record.path.replace(".safetensors", ".json"),
                    ]:
                        try:
                            os.remove(path)
                        except OSError:
                            pass
            for lid in expired:
                del self._records[lid]
        if expired:
            logger.info(f"Cleaned up {len(expired)} expired latents")


latent_store = LatentStore()
