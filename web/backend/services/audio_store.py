"""Audio file store with UUID-based IDs and TTL cleanup."""

from __future__ import annotations

import os
import shutil
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, Optional

from loguru import logger
from web.backend import config


@dataclass
class AudioFile:
    id: str
    path: str
    filename: str
    created_at: float = field(default_factory=time.time)


class AudioStore:
    """Manages temporary audio files with auto-cleanup."""

    def __init__(self):
        self._files: Dict[str, AudioFile] = {}
        self._lock = threading.Lock()
        self._cleanup_thread: Optional[threading.Thread] = None
        self._running = False
        os.makedirs(config.TEMP_DIR, exist_ok=True)

    @property
    def temp_dir(self) -> str:
        return config.TEMP_DIR

    def store_file(self, src_path: str, filename: Optional[str] = None) -> AudioFile:
        file_id = uuid.uuid4().hex[:12]
        if filename is None:
            filename = os.path.basename(src_path)
        ext = os.path.splitext(filename)[1]
        dest = os.path.join(config.TEMP_DIR, f"{file_id}{ext}")
        shutil.copy2(src_path, dest)
        entry = AudioFile(id=file_id, path=dest, filename=filename)
        with self._lock:
            self._files[file_id] = entry
        return entry

    def store_upload(self, data: bytes, filename: str) -> AudioFile:
        file_id = uuid.uuid4().hex[:12]
        ext = os.path.splitext(filename)[1]
        dest = os.path.join(config.TEMP_DIR, f"{file_id}{ext}")
        with open(dest, "wb") as f:
            f.write(data)
        entry = AudioFile(id=file_id, path=dest, filename=filename)
        with self._lock:
            self._files[file_id] = entry
        return entry

    def get_file(self, file_id: str) -> Optional[AudioFile]:
        with self._lock:
            return self._files.get(file_id)

    def get_path(self, file_id: str) -> Optional[str]:
        entry = self.get_file(file_id)
        return entry.path if entry else None

    def start_cleanup(self):
        self._running = True
        self._cleanup_thread = threading.Thread(target=self._cleanup_loop, daemon=True)
        self._cleanup_thread.start()

    def stop_cleanup(self):
        self._running = False

    def _cleanup_loop(self):
        while self._running:
            try:
                self._do_cleanup()
            except Exception as e:
                logger.error(f"Audio cleanup error: {e}")
            time.sleep(600)  # Check every 10 minutes

    def _do_cleanup(self):
        ttl = config.AUDIO_TTL_HOURS * 3600
        now = time.time()
        expired = []
        with self._lock:
            for fid, entry in list(self._files.items()):
                if now - entry.created_at > ttl:
                    expired.append(fid)
                    try:
                        os.remove(entry.path)
                    except OSError:
                        pass
            for fid in expired:
                del self._files[fid]
        if expired:
            logger.info(f"Cleaned up {len(expired)} expired audio files")


audio_store = AudioStore()
