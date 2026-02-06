"""Examples router: random example loading."""

import json
import os
import random

from fastapi import APIRouter, Query

from web.backend.schemas.common import ApiResponse
from web.backend import config as app_config

router = APIRouter()


def _get_examples_dir(mode: str) -> str:
    base = os.path.join(app_config.PROJECT_ROOT, "acestep", "gradio_ui", "examples")
    if mode == "simple":
        return os.path.join(base, "simple")
    return base


@router.get("/random")
def random_example(
    mode: str = Query("custom"),
    task_type: str = Query("text2music"),
):
    examples_dir = _get_examples_dir(mode)

    if mode == "simple":
        # Simple mode examples
        if not os.path.isdir(examples_dir):
            return ApiResponse(success=False, error="Simple examples directory not found")
        files = [f for f in os.listdir(examples_dir) if f.endswith(".json")]
        if not files:
            return ApiResponse(success=False, error="No example files found")
        chosen = random.choice(files)
        with open(os.path.join(examples_dir, chosen)) as f:
            data = json.load(f)
        data["_source"] = chosen
        return ApiResponse(data=data)

    # Custom mode - look for task-specific examples
    task_dir = os.path.join(examples_dir, task_type)
    if os.path.isdir(task_dir):
        search_dir = task_dir
    else:
        search_dir = examples_dir

    files = [f for f in os.listdir(search_dir) if f.endswith(".json")]
    if not files:
        return ApiResponse(success=False, error=f"No examples found for {task_type}")

    chosen = random.choice(files)
    with open(os.path.join(search_dir, chosen)) as f:
        data = json.load(f)
    data["_source"] = chosen
    return ApiResponse(data=data)
