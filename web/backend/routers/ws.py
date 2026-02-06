"""WebSocket router for real-time progress updates."""

import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from web.backend.services.task_manager import task_manager

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    task_manager.register_ws(ws)
    try:
        while True:
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
                # Handle subscribe to specific task
                if msg.get("type") == "subscribe":
                    tid = msg.get("task_id")
                    if tid:
                        task_manager.register_ws(ws, tid)
                        # Send current status immediately
                        task = task_manager.get_task(tid)
                        if task:
                            await ws.send_json({
                                "type": "status",
                                "task_id": tid,
                                "status": task.status.value,
                                "progress": task.progress,
                                "message": task.message,
                            })
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        task_manager.unregister_ws(ws)
