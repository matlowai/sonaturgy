"""Schemas for service endpoints."""

from typing import Optional, List, Dict
from pydantic import BaseModel


class InitializeRequest(BaseModel):
    checkpoint: str = ""
    config_path: str = "acestep-v15-turbo"
    device: str = "auto"
    init_llm: bool = True
    lm_model_path: str = "acestep-5Hz-lm-1.7B"
    backend: str = "vllm"
    use_flash_attention: bool = False
    offload_to_cpu: bool = False
    offload_dit_to_cpu: bool = False
    compile_model: bool = False
    quantization: Optional[str] = None


class ServiceStatus(BaseModel):
    dit_initialized: bool = False
    llm_initialized: bool = False
    dit_model: Optional[str] = None
    lm_model: Optional[str] = None
    device: Optional[str] = None
    is_turbo: Optional[bool] = None


class GPUConfigResponse(BaseModel):
    tier: str
    gpu_memory_gb: float
    max_duration_with_lm: int
    max_duration_without_lm: int
    max_batch_size_with_lm: int
    max_batch_size_without_lm: int
    init_lm_default: bool
    available_lm_models: List[str]
    lm_memory_gb: Dict[str, float]
