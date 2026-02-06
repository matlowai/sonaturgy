"""Schemas for audio endpoints."""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel


class AudioUploadResponse(BaseModel):
    id: str
    filename: str


class ConvertToCodesRequest(BaseModel):
    audio_id: str


class ConvertToCodesResponse(BaseModel):
    audio_codes: str


class ScoreRequest(BaseModel):
    task_id: str
    sample_index: int = 0
    vocal_language: str = "en"
    inference_steps: int = 8
    seed: int = 42


class ScoreResponse(BaseModel):
    lm_score: float = 0.0
    dit_score: float = 0.0
    success: bool = True
    error: Optional[str] = None


class LRCRequest(BaseModel):
    task_id: str
    sample_index: int = 0
    total_duration_seconds: float = 0.0
    vocal_language: str = "en"
    inference_steps: int = 8
    seed: int = 42


class LRCResponse(BaseModel):
    lrc_text: str = ""
    success: bool = True
    error: Optional[str] = None
