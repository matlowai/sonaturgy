"""Schemas for training endpoints."""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel


class ScanDatasetRequest(BaseModel):
    directory: str


class AutoLabelRequest(BaseModel):
    format_lyrics: bool = False
    transcribe_lyrics: bool = False
    skip_metas: bool = False
    only_unlabeled: bool = False


class SampleEdit(BaseModel):
    caption: Optional[str] = None
    genre: Optional[str] = None
    lyrics: Optional[str] = None
    raw_lyrics: Optional[str] = None
    bpm: Optional[int] = None
    keyscale: Optional[str] = None
    timesignature: Optional[str] = None
    language: Optional[str] = None
    is_instrumental: Optional[bool] = None
    custom_tag: Optional[str] = None


class SaveDatasetRequest(BaseModel):
    path: str
    dataset_name: Optional[str] = None


class LoadDatasetRequest(BaseModel):
    path: str


class PreprocessRequest(BaseModel):
    output_dir: str
    max_duration: float = 240.0


class TrainingRequest(BaseModel):
    tensor_dir: str
    output_dir: str
    rank: int = 8
    alpha: int = 16
    dropout: float = 0.1
    learning_rate: float = 1e-4
    max_epochs: int = 100
    batch_size: int = 1
    gradient_accumulation_steps: int = 4
    save_every_n_epochs: int = 10
    warmup_steps: int = 100
    seed: int = 42


class TrainingStatusResponse(BaseModel):
    running: bool = False
    step: int = 0
    epoch: int = 0
    total_epochs: int = 0
    loss: float = 0.0
    progress: float = 0.0
    message: str = ""
    losses: List[float] = []


class ExportLoRARequest(BaseModel):
    output_dir: str
    save_full_model: bool = False
