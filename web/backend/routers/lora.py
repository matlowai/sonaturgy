"""LoRA router: load, unload, enable, scale."""

from fastapi import APIRouter, Depends

from web.backend.dependencies import get_dit_handler
from web.backend.schemas.common import ApiResponse
from web.backend.schemas.lora import (
    LoadLoRARequest,
    EnableLoRARequest,
    ScaleLoRARequest,
    LoRAStatusResponse,
)

router = APIRouter()


@router.get("/status")
def lora_status(dit=Depends(get_dit_handler)):
    status = dit.get_lora_status()
    return ApiResponse(data=LoRAStatusResponse(**status))


@router.post("/load")
def load_lora(req: LoadLoRARequest, dit=Depends(get_dit_handler)):
    msg = dit.load_lora(req.path)
    return ApiResponse(data={"message": msg})


@router.post("/unload")
def unload_lora(dit=Depends(get_dit_handler)):
    msg = dit.unload_lora()
    return ApiResponse(data={"message": msg})


@router.post("/enable")
def enable_lora(req: EnableLoRARequest, dit=Depends(get_dit_handler)):
    msg = dit.set_use_lora(req.enabled)
    return ApiResponse(data={"message": msg})


@router.post("/scale")
def set_scale(req: ScaleLoRARequest, dit=Depends(get_dit_handler)):
    msg = dit.set_lora_scale(req.scale)
    return ApiResponse(data={"message": msg})
