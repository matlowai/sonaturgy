"""Dependency injection for handler singletons."""

from __future__ import annotations

import sys
import os

# Ensure project root is on path so acestep is importable
_project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from acestep.handler import AceStepHandler
from acestep.llm_inference import LLMHandler

_dit_handler: AceStepHandler | None = None
_llm_handler: LLMHandler | None = None


def get_dit_handler() -> AceStepHandler:
    global _dit_handler
    if _dit_handler is None:
        _dit_handler = AceStepHandler()
    return _dit_handler


def get_llm_handler() -> LLMHandler:
    global _llm_handler
    if _llm_handler is None:
        _llm_handler = LLMHandler()
    return _llm_handler
