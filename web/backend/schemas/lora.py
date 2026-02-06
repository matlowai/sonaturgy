"""Schemas for LoRA endpoints."""

from typing import Optional, Dict, Any
from pydantic import BaseModel


class LoadLoRARequest(BaseModel):
    path: str


class EnableLoRARequest(BaseModel):
    enabled: bool


class ScaleLoRARequest(BaseModel):
    scale: float


class LoRAStatusResponse(BaseModel):
    loaded: bool = False
    enabled: bool = False
    path: Optional[str] = None
    scale: float = 1.0
    info: Optional[Dict[str, Any]] = None
