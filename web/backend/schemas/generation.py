"""Schemas for generation endpoints."""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class GenerateRequest(BaseModel):
    # Text Inputs
    caption: str = ""
    lyrics: str = ""
    instrumental: bool = False

    # Task
    task_type: str = "text2music"
    instruction: str = ""

    # Metadata
    vocal_language: str = "unknown"
    bpm: Optional[int] = None
    keyscale: str = ""
    timesignature: str = ""
    duration: float = -1.0

    # Audio references
    reference_audio_id: Optional[str] = None
    src_audio_id: Optional[str] = None
    audio_codes: str = ""

    # Repainting
    repainting_start: float = 0.0
    repainting_end: float = -1
    audio_cover_strength: float = 1.0

    # DiT parameters
    inference_steps: int = 8
    guidance_scale: float = 7.0
    seed: int = -1
    use_adg: bool = False
    cfg_interval_start: float = 0.0
    cfg_interval_end: float = 1.0
    shift: float = 1.0
    infer_method: str = "ode"
    timesteps: Optional[List[float]] = None

    # LM parameters
    thinking: bool = True
    lm_temperature: float = 0.85
    lm_cfg_scale: float = 2.0
    lm_top_k: int = 0
    lm_top_p: float = 0.9
    lm_negative_prompt: str = "NO USER INPUT"
    use_cot_metas: bool = True
    use_cot_caption: bool = True
    use_cot_language: bool = True
    use_constrained_decoding: bool = True

    # Batch / config
    batch_size: int = 2
    allow_lm_batch: bool = False
    use_random_seed: bool = True
    seeds: Optional[List[int]] = None
    lm_batch_chunk_size: int = 8
    constrained_decoding_debug: bool = False
    audio_format: str = "flac"
    is_format_caption: bool = False

    # Auto features
    auto_score: bool = False
    auto_lrc: bool = False
    score_scale: float = 1.0
    lm_codes_strength: float = 1.0

    # Latent resume (for resuming from a stored latent)
    init_latent_id: Optional[str] = None
    t_start: float = 1.0
    checkpoint_step: Optional[int] = None
    resume_sample_index: Optional[int] = None


class TaskStatusResponse(BaseModel):
    task_id: str
    status: str  # "pending", "running", "completed", "error"
    progress: float = 0.0
    message: str = ""
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class CreateSampleRequest(BaseModel):
    query: str
    instrumental: bool = False
    vocal_language: Optional[str] = None
    lm_temperature: float = 0.85
    lm_top_k: int = 0
    lm_top_p: float = 0.9
    use_constrained_decoding: bool = True
    constrained_decoding_debug: bool = False
    repetition_penalty: float = 1.0


class CreateSampleResponse(BaseModel):
    caption: str = ""
    lyrics: str = ""
    bpm: Optional[int] = None
    duration: Optional[float] = None
    keyscale: str = ""
    language: str = ""
    timesignature: str = ""
    instrumental: bool = False
    status_message: str = ""


class FormatRequest(BaseModel):
    caption: str
    lyrics: str
    bpm: Optional[int] = None
    duration: Optional[float] = None
    keyscale: str = ""
    timesignature: str = ""
    lm_temperature: float = 0.85
    lm_top_k: int = 0
    lm_top_p: float = 0.9
    constrained_decoding_debug: bool = False


class FormatResponse(BaseModel):
    caption: str = ""
    lyrics: str = ""
    bpm: Optional[int] = None
    duration: Optional[float] = None
    keyscale: str = ""
    language: str = ""
    timesignature: str = ""
    status_message: str = ""


class UnderstandRequest(BaseModel):
    audio_codes: str
    temperature: float = 0.85
    top_k: Optional[int] = None
    top_p: Optional[float] = None
    use_constrained_decoding: bool = True
    constrained_decoding_debug: bool = False


class UnderstandResponse(BaseModel):
    caption: str = ""
    lyrics: str = ""
    bpm: Optional[int] = None
    duration: Optional[float] = None
    keyscale: str = ""
    language: str = ""
    timesignature: str = ""
    status_message: str = ""


class AnalyzeRequest(BaseModel):
    """Request for analysis-only LLM preview (Phase 1 only, no diffusion)."""
    caption: str = ""
    lyrics: str = ""
    instrumental: bool = False

    # Metadata hints (passed as user_metadata to skip CoT for provided fields)
    vocal_language: str = "unknown"
    bpm: Optional[int] = None
    keyscale: str = ""
    timesignature: str = ""
    duration: float = -1.0

    # LM parameters
    lm_temperature: float = 0.85
    lm_cfg_scale: float = 2.0
    lm_top_k: int = 0
    lm_top_p: float = 0.9
    lm_negative_prompt: str = "NO USER INPUT"
    use_cot_metas: bool = True
    use_cot_caption: bool = True
    use_cot_language: bool = True
    use_constrained_decoding: bool = True


class AnalyzeResponse(BaseModel):
    """Response from analysis-only LLM preview."""
    caption: str = ""
    bpm: Optional[int] = None
    keyscale: str = ""
    duration: Optional[float] = None
    language: str = ""
    timesignature: str = ""
    thinking_text: str = ""
    phase1_time: float = 0.0
