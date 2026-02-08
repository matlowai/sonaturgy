"""Task manager for long-running generation tasks with WebSocket broadcast."""

from __future__ import annotations

import asyncio
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

from loguru import logger

from web.backend import config


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    ERROR = "error"


@dataclass
class Task:
    id: str
    status: TaskStatus = TaskStatus.PENDING
    progress: float = 0.0
    message: str = ""
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    error_detail: Optional[str] = None  # Full traceback when verbose errors enabled
    created_at: float = field(default_factory=time.time)
    extra_outputs: Optional[Dict[str, Any]] = None


class TaskManager:
    """Single-worker executor for GPU tasks with WebSocket progress broadcast."""

    def __init__(self):
        self._executor = ThreadPoolExecutor(max_workers=1)
        self._tasks: Dict[str, Task] = {}
        self._ws_connections: Dict[str, List[Any]] = {}  # task_id -> [websockets]
        self._global_connections: List[Any] = []
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def set_event_loop(self, loop: asyncio.AbstractEventLoop):
        """Store a reference to the main event loop for thread-safe broadcasts."""
        self._loop = loop

    def submit(self, fn: Callable, *args, **kwargs) -> str:
        task_id = uuid.uuid4().hex[:12]
        task = Task(id=task_id)
        self._tasks[task_id] = task

        def _run():
            task.status = TaskStatus.RUNNING
            self._broadcast_sync(task_id, {"type": "status", "status": "running", "task_id": task_id})
            try:
                result = fn(task_id, *args, **kwargs)
                task.status = TaskStatus.COMPLETED
                task.progress = 1.0
                task.result = result.get("result") if isinstance(result, dict) else result
                task.extra_outputs = result.get("extra_outputs") if isinstance(result, dict) else None
                self._broadcast_sync(task_id, {
                    "type": "completed",
                    "task_id": task_id,
                    "result": task.result,
                })
            except Exception as e:
                logger.exception(f"Task {task_id} failed")
                task.status = TaskStatus.ERROR
                task.error = str(e)
                tb = traceback.format_exc()
                if config.VERBOSE_ERRORS:
                    task.error_detail = tb
                self._broadcast_sync(task_id, {
                    "type": "error",
                    "task_id": task_id,
                    "error": str(e),
                    **({"error_detail": tb} if config.VERBOSE_ERRORS else {}),
                })

        self._executor.submit(_run)
        return task_id

    def get_task(self, task_id: str) -> Optional[Task]:
        return self._tasks.get(task_id)

    def update_progress(self, task_id: str, progress: float, message: str = ""):
        task = self._tasks.get(task_id)
        if task:
            task.progress = progress
            task.message = message
            self._broadcast_sync(task_id, {
                "type": "progress",
                "task_id": task_id,
                "progress": progress,
                "message": message,
            })

    def register_ws(self, ws, task_id: Optional[str] = None):
        if task_id:
            self._ws_connections.setdefault(task_id, []).append(ws)
        else:
            self._global_connections.append(ws)

    def unregister_ws(self, ws, task_id: Optional[str] = None):
        if task_id and task_id in self._ws_connections:
            try:
                self._ws_connections[task_id].remove(ws)
            except ValueError:
                pass
        try:
            self._global_connections.remove(ws)
        except ValueError:
            pass

    def _broadcast_sync(self, task_id: str, data: dict):
        """Broadcast data to WebSocket clients, safe to call from any thread."""
        targets = list(self._global_connections)
        if task_id in self._ws_connections:
            targets += self._ws_connections[task_id]
        if not targets:
            return
        loop = self._loop
        if loop is None:
            return
        for ws in targets:
            try:
                asyncio.run_coroutine_threadsafe(ws.send_json(data), loop)
            except Exception:
                pass

    def shutdown(self):
        self._executor.shutdown(wait=False)

    def cleanup_old_tasks(self, max_age_seconds: int = 3600):
        now = time.time()
        expired = [tid for tid, t in self._tasks.items()
                   if now - t.created_at > max_age_seconds
                   and t.status in (TaskStatus.COMPLETED, TaskStatus.ERROR)]
        for tid in expired:
            del self._tasks[tid]
            self._ws_connections.pop(tid, None)


task_manager = TaskManager()
