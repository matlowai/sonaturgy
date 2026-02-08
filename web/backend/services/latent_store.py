"""Latent tensor store with UUID-based IDs and TTL cleanup.

Metadata lives in LMDB (fast key-value lookups, crash-safe, cross-session).
Tensors live in safetensors files on disk (LMDB just stores the path).
"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional, Tuple

import lmdb
import torch
from loguru import logger
from safetensors.torch import save_file, load_file

from web.backend import config

# LMDB map size — 256MB is plenty for metadata-only (no tensors).
# LMDB won't allocate this upfront; it's a ceiling.
_LMDB_MAP_SIZE = 256 * 1024 * 1024


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


def _record_to_bytes(record: LatentRecord) -> bytes:
    """Serialize a LatentRecord to JSON bytes for LMDB storage."""
    d = asdict(record)
    d["shape"] = list(d["shape"])  # tuple → list for JSON
    return json.dumps(d, separators=(",", ":")).encode("utf-8")


def _bytes_to_record(data: bytes) -> LatentRecord:
    """Deserialize JSON bytes from LMDB into a LatentRecord."""
    meta = json.loads(data)
    return LatentRecord(
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


class LatentStore:
    """Manages persistent latent tensors with LMDB metadata and auto-cleanup."""

    def __init__(self):
        os.makedirs(config.LATENT_DIR, exist_ok=True)
        lmdb_path = os.path.join(config.LATENT_DIR, "metadata.lmdb")
        self._env = lmdb.open(lmdb_path, map_size=_LMDB_MAP_SIZE)
        self._cleanup_thread: Optional[threading.Thread] = None
        self._running = False

        # Migrate any legacy .json companion files into LMDB
        self._migrate_legacy_json()

    def _migrate_legacy_json(self):
        """One-time migration: import .json companion files into LMDB, then delete them."""
        json_files = [
            f for f in os.listdir(config.LATENT_DIR) if f.endswith(".json")
        ]
        if not json_files:
            return

        migrated = 0
        with self._env.begin(write=True) as txn:
            for fname in json_files:
                latent_id = fname.replace(".json", "")
                # Skip if already in LMDB
                if txn.get(latent_id.encode()) is not None:
                    # Remove the now-redundant JSON file
                    try:
                        os.remove(os.path.join(config.LATENT_DIR, fname))
                    except OSError:
                        pass
                    continue

                json_path = os.path.join(config.LATENT_DIR, fname)
                tensor_path = os.path.join(config.LATENT_DIR, f"{latent_id}.safetensors")
                if not os.path.exists(tensor_path):
                    # Orphan JSON with no tensor — clean up
                    try:
                        os.remove(json_path)
                    except OSError:
                        pass
                    continue

                try:
                    with open(json_path) as f:
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
                    txn.put(latent_id.encode(), _record_to_bytes(record))
                    migrated += 1
                except Exception as e:
                    logger.warning(f"Failed to migrate latent {latent_id}: {e}")

                # Remove the JSON file regardless (it's been imported or is broken)
                try:
                    os.remove(json_path)
                except OSError:
                    pass

        if migrated:
            logger.info(f"Migrated {migrated} legacy latent records to LMDB")

    def store(self, tensor: torch.Tensor, metadata: Dict[str, Any]) -> str:
        """Serialize tensor to safetensors, store metadata in LMDB, return UUID."""
        latent_id = uuid.uuid4().hex[:12]
        tensor_path = os.path.join(config.LATENT_DIR, f"{latent_id}.safetensors")

        # Ensure tensor is on CPU and contiguous
        t = tensor.detach().cpu().contiguous()

        # Save tensor to disk
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

        # Write metadata to LMDB (atomic)
        with self._env.begin(write=True) as txn:
            txn.put(latent_id.encode(), _record_to_bytes(record))

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
        """Get metadata from LMDB without loading tensor."""
        with self._env.begin() as txn:
            data = txn.get(latent_id.encode())
        if data is None:
            return None
        try:
            return _bytes_to_record(data)
        except Exception as e:
            logger.error(f"Failed to deserialize latent record {latent_id}: {e}")
            return None

    def pin(self, latent_id: str) -> bool:
        """Mark latent as pinned (survives TTL cleanup)."""
        with self._env.begin(write=True) as txn:
            data = txn.get(latent_id.encode())
            if data is None:
                return False
            record = _bytes_to_record(data)
            record.pinned = True
            txn.put(latent_id.encode(), _record_to_bytes(record))
        return True

    def unpin(self, latent_id: str) -> bool:
        """Remove pin from a latent (will be cleaned up by TTL)."""
        with self._env.begin(write=True) as txn:
            data = txn.get(latent_id.encode())
            if data is None:
                return False
            record = _bytes_to_record(data)
            record.pinned = False
            txn.put(latent_id.encode(), _record_to_bytes(record))
        return True

    def delete(self, latent_id: str) -> None:
        """Explicitly remove a latent and its files."""
        with self._env.begin(write=True) as txn:
            data = txn.get(latent_id.encode())
            if data is not None:
                record = _bytes_to_record(data)
                txn.delete(latent_id.encode())
                # Remove tensor file
                try:
                    os.remove(record.path)
                except OSError:
                    pass

    def list_records(self) -> List[LatentRecord]:
        """List all stored latents (metadata only, no tensors)."""
        records = []
        with self._env.begin() as txn:
            cursor = txn.cursor()
            for _key, value in cursor:
                try:
                    records.append(_bytes_to_record(value))
                except Exception:
                    continue
        return records

    def start_cleanup(self):
        self._running = True
        self._cleanup_thread = threading.Thread(
            target=self._cleanup_loop, daemon=True
        )
        self._cleanup_thread.start()
        count = self._count()
        logger.info(
            f"Latent store started (dir={config.LATENT_DIR}, "
            f"ttl={config.LATENT_TTL_HOURS}h, records={count})"
        )

    def stop_cleanup(self):
        self._running = False

    def _count(self) -> int:
        """Count total records in LMDB."""
        with self._env.begin() as txn:
            return txn.stat()["entries"]

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
        expired_paths = []

        # Single write txn — avoids TOCTOU race with pin()
        with self._env.begin(write=True) as txn:
            cursor = txn.cursor()
            for key, value in cursor:
                try:
                    record = _bytes_to_record(value)
                except Exception:
                    continue
                if record.pinned:
                    continue
                if now - record.created_at > ttl:
                    expired_paths.append(record.path)
                    cursor.delete()

        if not expired_paths:
            return

        # Remove tensor files (outside txn — not critical if some fail)
        for path in expired_paths:
            try:
                os.remove(path)
            except OSError:
                pass

        logger.info(f"Cleaned up {len(expired_paths)} expired latents")


latent_store = LatentStore()
