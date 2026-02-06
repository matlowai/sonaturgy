"""Generation router: generate music, create-sample, format, understand."""

import os

from fastapi import APIRouter, Depends, HTTPException

from web.backend.dependencies import get_dit_handler, get_llm_handler
from web.backend.schemas.common import ApiResponse
from web.backend.schemas.generation import (
    GenerateRequest,
    TaskStatusResponse,
    CreateSampleRequest,
    CreateSampleResponse,
    FormatRequest,
    FormatResponse,
    UnderstandRequest,
    UnderstandResponse,
)
from web.backend.schemas.pipeline import PipelineRequest
from web.backend.services.task_manager import task_manager, TaskStatus
from web.backend.services.audio_store import audio_store
from web.backend.services.pipeline_executor import run_pipeline

from acestep.inference import (
    GenerationParams,
    GenerationConfig,
    generate_music,
    create_sample,
    format_sample,
    understand_music,
)

router = APIRouter()


@router.post("/generate")
def start_generation(
    req: GenerateRequest,
    dit=Depends(get_dit_handler),
    llm=Depends(get_llm_handler),
):
    if dit.model is None:
        raise HTTPException(400, "DiT service not initialized")

    # Resolve uploaded audio IDs to paths
    ref_audio = audio_store.get_path(req.reference_audio_id) if req.reference_audio_id else None
    src_audio = audio_store.get_path(req.src_audio_id) if req.src_audio_id else None

    # For text2music with LM codes, lm_codes_strength controls how many
    # denoising steps use LM-generated code conditioning (same mechanism as
    # audio_cover_strength for cover tasks).  Apply it here so the frontend's
    # separate slider actually takes effect.
    effective_cover_strength = req.audio_cover_strength
    if req.task_type == "text2music" and req.thinking and req.lm_codes_strength < 1.0:
        effective_cover_strength = req.lm_codes_strength

    params = GenerationParams(
        caption=req.caption,
        lyrics=req.lyrics,
        instrumental=req.instrumental,
        task_type=req.task_type,
        instruction=req.instruction,
        vocal_language=req.vocal_language,
        bpm=req.bpm,
        keyscale=req.keyscale,
        timesignature=req.timesignature,
        duration=req.duration,
        reference_audio=ref_audio,
        src_audio=src_audio,
        audio_codes=req.audio_codes,
        repainting_start=req.repainting_start,
        repainting_end=req.repainting_end,
        audio_cover_strength=effective_cover_strength,
        inference_steps=req.inference_steps,
        guidance_scale=req.guidance_scale,
        seed=req.seed,
        use_adg=req.use_adg,
        cfg_interval_start=req.cfg_interval_start,
        cfg_interval_end=req.cfg_interval_end,
        shift=req.shift,
        infer_method=req.infer_method,
        timesteps=req.timesteps,
        thinking=req.thinking,
        lm_temperature=req.lm_temperature,
        lm_cfg_scale=req.lm_cfg_scale,
        lm_top_k=req.lm_top_k,
        lm_top_p=req.lm_top_p,
        lm_negative_prompt=req.lm_negative_prompt,
        use_cot_metas=req.use_cot_metas,
        use_cot_caption=req.use_cot_caption,
        use_cot_language=req.use_cot_language,
        use_constrained_decoding=req.use_constrained_decoding,
    )

    gen_config = GenerationConfig(
        batch_size=req.batch_size,
        allow_lm_batch=req.allow_lm_batch,
        use_random_seed=req.use_random_seed,
        seeds=req.seeds,
        lm_batch_chunk_size=req.lm_batch_chunk_size,
        constrained_decoding_debug=req.constrained_decoding_debug,
        audio_format=req.audio_format,
    )

    def _run(task_id):
        save_dir = os.path.join(audio_store.temp_dir, task_id)
        os.makedirs(save_dir, exist_ok=True)

        def progress_cb(progress_val, desc="", **kwargs):
            task_manager.update_progress(task_id, progress_val, desc)

        result = generate_music(
            dit_handler=dit,
            llm_handler=llm,
            params=params,
            config=gen_config,
            save_dir=save_dir,
            progress=progress_cb,
        )

        # Register generated files in audio_store
        audio_data = []
        for audio in result.audios:
            path = audio.get("path", "")
            if path and os.path.exists(path):
                entry = audio_store.store_file(path)
                audio_data.append({
                    "id": entry.id,
                    "key": audio.get("key", ""),
                    "sample_rate": audio.get("sample_rate", 48000),
                    "params": audio.get("params", {}),
                    "codes": audio.get("params", {}).get("audio_codes", ""),
                })
            else:
                audio_data.append({
                    "id": "",
                    "key": audio.get("key", ""),
                    "params": audio.get("params", {}),
                })

        # Serialize extra_outputs (remove non-serializable tensors)
        extra = {}
        if result.extra_outputs:
            time_costs = result.extra_outputs.get("time_costs", {})
            lm_metadata = result.extra_outputs.get("lm_metadata")
            extra["time_costs"] = time_costs
            extra["lm_metadata"] = lm_metadata

        return {
            "result": {
                "audios": audio_data,
                "status_message": result.status_message,
                "success": result.success,
                "error": result.error,
                "extra": extra,
            },
            "extra_outputs": result.extra_outputs,  # Keep tensors in memory for score/LRC
        }

    task_id = task_manager.submit(_run)
    return ApiResponse(data={"task_id": task_id})


@router.get("/task/{task_id}")
def get_task_status(task_id: str):
    task = task_manager.get_task(task_id)
    if not task:
        raise HTTPException(404, "Task not found")

    result_data = None
    if task.result:
        result_data = task.result

    return ApiResponse(data=TaskStatusResponse(
        task_id=task.id,
        status=task.status.value,
        progress=task.progress,
        message=task.message,
        result=result_data,
        error=task.error,
    ))


@router.post("/create-sample")
def create_sample_endpoint(
    req: CreateSampleRequest,
    llm=Depends(get_llm_handler),
):
    top_k = None if req.lm_top_k == 0 else req.lm_top_k
    top_p = None if req.lm_top_p >= 1.0 else req.lm_top_p

    result = create_sample(
        llm_handler=llm,
        query=req.query,
        instrumental=req.instrumental,
        vocal_language=req.vocal_language,
        temperature=req.lm_temperature,
        top_k=top_k,
        top_p=top_p,
        repetition_penalty=req.repetition_penalty,
        use_constrained_decoding=req.use_constrained_decoding,
        constrained_decoding_debug=req.constrained_decoding_debug,
    )

    if not result.success:
        return ApiResponse(success=False, error=result.error)

    return ApiResponse(data=CreateSampleResponse(
        caption=result.caption,
        lyrics=result.lyrics,
        bpm=result.bpm,
        duration=result.duration,
        keyscale=result.keyscale,
        language=result.language,
        timesignature=result.timesignature,
        instrumental=result.instrumental,
        status_message=result.status_message,
    ))


@router.post("/format")
def format_endpoint(
    req: FormatRequest,
    llm=Depends(get_llm_handler),
):
    top_k = None if req.lm_top_k == 0 else req.lm_top_k
    top_p = None if req.lm_top_p >= 1.0 else req.lm_top_p

    user_metadata = {}
    if req.bpm is not None:
        user_metadata["bpm"] = req.bpm
    if req.duration is not None:
        user_metadata["duration"] = int(req.duration)
    if req.keyscale:
        user_metadata["keyscale"] = req.keyscale
    if req.timesignature:
        user_metadata["timesignature"] = req.timesignature

    result = format_sample(
        llm_handler=llm,
        caption=req.caption,
        lyrics=req.lyrics,
        user_metadata=user_metadata or None,
        temperature=req.lm_temperature,
        top_k=top_k,
        top_p=top_p,
        use_constrained_decoding=True,
        constrained_decoding_debug=req.constrained_decoding_debug,
    )

    if not result.success:
        return ApiResponse(success=False, error=result.error)

    return ApiResponse(data=FormatResponse(
        caption=result.caption,
        lyrics=result.lyrics,
        bpm=result.bpm,
        duration=result.duration,
        keyscale=result.keyscale,
        language=result.language,
        timesignature=result.timesignature,
        status_message=result.status_message,
    ))


@router.post("/understand")
def understand_endpoint(
    req: UnderstandRequest,
    llm=Depends(get_llm_handler),
):
    result = understand_music(
        llm_handler=llm,
        audio_codes=req.audio_codes,
        temperature=req.temperature,
        top_k=req.top_k,
        top_p=req.top_p,
        use_constrained_decoding=req.use_constrained_decoding,
        constrained_decoding_debug=req.constrained_decoding_debug,
    )

    if not result.success:
        return ApiResponse(success=False, error=result.error)

    return ApiResponse(data=UnderstandResponse(
        caption=result.caption,
        lyrics=result.lyrics,
        bpm=result.bpm,
        duration=result.duration,
        keyscale=result.keyscale,
        language=result.language,
        timesignature=result.timesignature,
        status_message=result.status_message,
    ))


@router.post("/pipeline")
def start_pipeline(
    req: PipelineRequest,
    dit=Depends(get_dit_handler),
):
    """Run a multi-stage latent pipeline (Pipeline Builder).

    Each stage runs a diffusion pass. "refine" stages start from a previous
    stage's clean latent with noise added proportional to the denoise value.
    Returns a task_id for progress tracking via WebSocket / polling.
    """
    if dit.model is None:
        raise HTTPException(400, "DiT service not initialized")

    # Validate stage graph
    VALID_TYPES = {"generate", "refine", "cover", "repaint", "extract", "lego", "complete"}
    AUDIO_TYPES = {"cover", "repaint", "extract", "lego", "complete"}
    BASE_ONLY = {"extract", "lego", "complete"}

    for idx, stage in enumerate(req.stages):
        if stage.type not in VALID_TYPES:
            raise HTTPException(
                422, f"Stage {idx}: invalid type '{stage.type}'"
            )

        # Refine must reference a previous stage (latent input)
        if stage.type == "refine":
            input_idx = (
                stage.input_stage if stage.input_stage is not None else idx - 1
            )
            if input_idx < 0 or input_idx >= idx:
                raise HTTPException(
                    422,
                    f"Stage {idx}: input_stage={input_idx} must reference "
                    f"a previous stage (0..{idx - 1})",
                )

        # Audio-requiring stages need src_audio_id or src_stage
        if stage.type in AUDIO_TYPES:
            if not stage.src_audio_id and stage.src_stage is None:
                raise HTTPException(
                    422,
                    f"Stage {idx} ({stage.type}): must provide "
                    f"src_audio_id or src_stage",
                )
            if stage.src_stage is not None:
                if stage.src_stage < 0 or stage.src_stage >= idx:
                    raise HTTPException(
                        422,
                        f"Stage {idx}: src_stage={stage.src_stage} must "
                        f"reference a previous stage (0..{idx - 1})",
                    )

        # Model constraints
        if stage.type in BASE_ONLY:
            if stage.model and ("turbo" in stage.model or "sft" in stage.model):
                raise HTTPException(
                    422,
                    f"Stage {idx} ({stage.type}): requires base model, "
                    f"got '{stage.model}'",
                )

        # Track name required for extract/lego
        if stage.type in ("extract", "lego") and not stage.track_name:
            raise HTTPException(
                422,
                f"Stage {idx} ({stage.type}): track_name is required",
            )

    def _run(task_id):
        return run_pipeline(task_id=task_id, dit_handler=dit, req=req)

    task_id = task_manager.submit(_run)
    return ApiResponse(data={"task_id": task_id})
