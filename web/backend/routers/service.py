"""Service router: initialize, status, GPU config."""

import os

from fastapi import APIRouter, Depends

from web.backend.dependencies import get_dit_handler, get_llm_handler
from web.backend.schemas.common import ApiResponse
from web.backend.schemas.service import (
    InitializeRequest,
    ServiceStatus,
    GPUConfigResponse,
)
from web.backend import config as app_config

router = APIRouter()


@router.get("/status")
def get_status(
    dit=Depends(get_dit_handler),
    llm=Depends(get_llm_handler),
):
    dit_initialized = dit.model is not None
    llm_initialized = getattr(llm, "llm_initialized", False)
    return ApiResponse(data=ServiceStatus(
        dit_initialized=dit_initialized,
        llm_initialized=llm_initialized,
        dit_model=getattr(getattr(dit, "config", None), "model_name", None) if dit_initialized else None,
        lm_model=getattr(llm, "lm_model_path", None) if llm_initialized else None,
        device=getattr(dit, "device", None),
        is_turbo=dit.is_turbo_model() if dit_initialized else None,
    ))


@router.post("/initialize")
def initialize(
    req: InitializeRequest,
    dit=Depends(get_dit_handler),
    llm=Depends(get_llm_handler),
):
    project_root = app_config.PROJECT_ROOT
    checkpoints_dir = os.path.join(project_root, "checkpoints")
    messages = []

    # Initialize DiT
    msg, success = dit.initialize_service(
        project_root=project_root,
        config_path=req.config_path,
        device=req.device,
        use_flash_attention=req.use_flash_attention,
        compile_model=req.compile_model,
        offload_to_cpu=req.offload_to_cpu,
        offload_dit_to_cpu=req.offload_dit_to_cpu,
        quantization=req.quantization,
    )
    messages.append(msg)

    if not success:
        return ApiResponse(success=False, error=msg)

    # Initialize LLM if requested
    if req.init_llm:
        lm_msg, lm_ok = llm.initialize(
            checkpoint_dir=checkpoints_dir,
            lm_model_path=req.lm_model_path,
            backend=req.backend,
            device=req.device,
            offload_to_cpu=req.offload_to_cpu,
        )
        messages.append(lm_msg)

    return ApiResponse(data={
        "messages": messages,
        "is_turbo": dit.is_turbo_model(),
    })


@router.post("/initialize-llm")
def initialize_llm(
    req: InitializeRequest,
    llm=Depends(get_llm_handler),
):
    """Initialize LLM independently (DiT must already be running)."""
    project_root = app_config.PROJECT_ROOT
    checkpoints_dir = os.path.join(project_root, "checkpoints")

    lm_msg, lm_ok = llm.initialize(
        checkpoint_dir=checkpoints_dir,
        lm_model_path=req.lm_model_path,
        backend=req.backend,
        device=req.device,
        offload_to_cpu=req.offload_to_cpu,
    )

    if not lm_ok:
        return ApiResponse(success=False, error=lm_msg)

    return ApiResponse(data={"message": lm_msg})


@router.get("/gpu-config")
def gpu_config():
    from acestep.gpu_config import get_gpu_config
    cfg = get_gpu_config()
    return ApiResponse(data=GPUConfigResponse(
        tier=cfg.tier,
        gpu_memory_gb=cfg.gpu_memory_gb,
        max_duration_with_lm=cfg.max_duration_with_lm,
        max_duration_without_lm=cfg.max_duration_without_lm,
        max_batch_size_with_lm=cfg.max_batch_size_with_lm,
        max_batch_size_without_lm=cfg.max_batch_size_without_lm,
        init_lm_default=cfg.init_lm_default,
        available_lm_models=cfg.available_lm_models,
        lm_memory_gb=cfg.lm_memory_gb,
    ))
