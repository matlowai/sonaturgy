"""Schemas for the pipeline builder endpoints."""

from typing import Optional, List
from pydantic import BaseModel, Field


class PipelineStageConfig(BaseModel):
    """Configuration for a single pipeline stage."""

    type: str = "generate"  # "generate", "refine", "cover", "repaint", "extract", "lego", "complete"
    input_stage: Optional[int] = None  # For refine: index of source latent stage

    # Per-stage conditioning overrides (falls back to PipelineRequest shared values)
    caption: Optional[str] = None
    lyrics: Optional[str] = None

    # Audio source (for cover/repaint/extract/lego/complete — mutually exclusive)
    src_audio_id: Optional[str] = None  # Uploaded audio UUID from audio_store
    src_stage: Optional[int] = None     # Use output of this previous stage as source audio

    # Cover-specific
    audio_cover_strength: float = 1.0   # 0-1, controls conditioning switch point
    audio_code_hints: Optional[str] = None  # Pre-extracted audio codes string

    # Repaint-specific
    repainting_start: Optional[float] = None  # Start time in seconds
    repainting_end: Optional[float] = None    # End time in seconds (-1 = end of audio)

    # Extract/lego/complete-specific
    track_name: Optional[str] = None              # e.g., "vocals", "drums", "guitar"
    complete_track_classes: Optional[List[str]] = None  # For complete: list of track names to add

    # Model selection (None = use current/default)
    model: Optional[str] = None  # e.g., "acestep-v15-base", "acestep-v15-turbo"

    # Diffusion params
    steps: int = 8
    shift: float = 3.0
    denoise: float = 1.0  # 1.0 = full generation, <1.0 = partial (t_start for refine)
    seed: int = -1
    infer_method: str = "ode"  # Sampler: "ode" or "sde"
    scheduler: Optional[str] = None  # Timestep scheduler: "linear", "discrete", "continuous" (None = model default)
    guidance_scale: float = 1.0
    use_adg: bool = False
    cfg_interval_start: float = 0.0
    cfg_interval_end: float = 1.0
    timesteps: Optional[List[float]] = None

    # Output
    preview: bool = False  # VAE-decode this stage for preview audio


class PipelineRequest(BaseModel):
    """Request for multi-stage pipeline generation."""

    # Shared conditioning (used by all stages)
    caption: str = ""
    lyrics: str = ""
    instrumental: bool = False
    vocal_language: str = "unknown"
    bpm: Optional[int] = None
    keyscale: str = ""
    timesignature: str = ""
    duration: float = -1.0
    batch_size: int = 1

    # LM settings (shared, default off for pipeline power users)
    thinking: bool = False
    lm_temperature: float = 0.85
    lm_cfg_scale: float = 2.0
    lm_top_k: int = 0
    lm_top_p: float = 0.9
    lm_negative_prompt: str = "NO USER INPUT"
    use_cot_metas: bool = False
    use_cot_caption: bool = False
    use_cot_language: bool = False
    use_constrained_decoding: bool = True

    audio_format: str = "flac"  # flac, wav, mp3
    mp3_bitrate: int = 320  # kbps: 128, 192, 256, 320

    # VRAM management
    keep_in_vram: bool = False  # If True, keep all models loaded (requires more VRAM)

    # Pipeline stages (at least 1)
    stages: List[PipelineStageConfig] = Field(..., min_length=1)
