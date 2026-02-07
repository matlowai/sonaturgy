"""Generation router: generate music, create-sample, format, understand."""

import os
import tempfile

import soundfile as sf
import torch
from fastapi import APIRouter, Depends, HTTPException
from loguru import logger

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
    AnalyzeRequest,
    AnalyzeResponse,
)
from web.backend.schemas.pipeline import PipelineRequest
from web.backend.services.task_manager import task_manager, TaskStatus
from web.backend.services.audio_store import audio_store
from web.backend.services.latent_store import latent_store
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

    # Resolve stored latent for resume
    init_latents_tensor = None
    effective_t_start = req.t_start

    if req.init_latent_id:
        record = latent_store.get_record(req.init_latent_id)
        if record is None:
            raise HTTPException(404, f"Latent '{req.init_latent_id}' not found or expired")

        # Validate model variant
        current_variant = getattr(dit, "model_variant", "unknown")
        if record.model_variant != "unknown" and record.model_variant != current_variant:
            raise HTTPException(
                422,
                f"Latent model mismatch: generated with '{record.model_variant}', "
                f"current model is '{current_variant}'"
            )

        # Validate resume_sample_index
        sample_idx = req.resume_sample_index if req.resume_sample_index is not None else 0
        if sample_idx >= record.batch_size:
            raise HTTPException(
                422,
                f"Sample index {sample_idx} out of range (latent has {record.batch_size} items)"
            )

        # Load tensor
        tensor = latent_store.get(req.init_latent_id)
        if tensor is None:
            raise HTTPException(404, f"Failed to load latent tensor '{req.init_latent_id}'")

        # Select batch item if stored latent has multiple
        if record.batch_size > 1:
            tensor = tensor[sample_idx : sample_idx + 1]

        # Expand to request batch_size
        if req.batch_size > 1:
            tensor = tensor.expand(req.batch_size, -1, -1).contiguous()

        # Renoise for partial denoising (same pattern as pipeline_executor.py)
        if effective_t_start < 1.0 - 1e-6:
            with torch.inference_mode():
                init_latents_tensor = dit.model.renoise(
                    tensor.to(dit.device).to(dit.dtype), effective_t_start,
                )
        else:
            # t_start >= 1.0 → generate from noise, ignore latent
            init_latents_tensor = None
            effective_t_start = 1.0

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
        init_latents=init_latents_tensor,
        t_start=effective_t_start,
        checkpoint_step=req.checkpoint_step,
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

        # Persist latents in latent_store
        pred_latents = result.extra_outputs.get("pred_latents")
        checkpoint_latent = result.extra_outputs.get("checkpoint_latent")
        checkpoint_step_val = result.extra_outputs.get("checkpoint_step")
        schedule_list = result.extra_outputs.get("schedule")
        lm_metadata = result.extra_outputs.get("lm_metadata")
        model_variant = getattr(dit, "model_variant", "unknown")
        req_dump = req.model_dump()

        latent_ids = []
        if pred_latents is not None:
            for i in range(pred_latents.shape[0]):
                lid = latent_store.store(
                    tensor=pred_latents[i : i + 1],
                    metadata={
                        "model_variant": model_variant,
                        "stage_type": req.task_type,
                        "is_checkpoint": False,
                        "checkpoint_step": None,
                        "total_steps": req.inference_steps,
                        "params": req_dump,
                        "lm_metadata": lm_metadata,
                        "batch_size": 1,
                        "schedule": schedule_list,
                    },
                )
                latent_ids.append(lid)

        # Store checkpoint latent if captured
        checkpoint_ids = []
        if checkpoint_latent is not None and checkpoint_step_val is not None:
            for i in range(checkpoint_latent.shape[0]):
                cid = latent_store.store(
                    tensor=checkpoint_latent[i : i + 1],
                    metadata={
                        "model_variant": model_variant,
                        "stage_type": req.task_type,
                        "is_checkpoint": True,
                        "checkpoint_step": checkpoint_step_val,
                        "total_steps": req.inference_steps,
                        "params": req_dump,
                        "lm_metadata": lm_metadata,
                        "batch_size": 1,
                        "schedule": schedule_list,
                    },
                )
                checkpoint_ids.append(cid)

        # Register generated files in audio_store
        audio_data = []
        for idx, audio in enumerate(result.audios):
            path = audio.get("path", "")
            latent_id = latent_ids[idx] if idx < len(latent_ids) else None
            ckpt_id = checkpoint_ids[idx] if idx < len(checkpoint_ids) else None
            entry_dict = {
                "key": audio.get("key", ""),
                "params": audio.get("params", {}),
                "latent_id": latent_id,
                "latent_checkpoint_id": ckpt_id,
                "checkpoint_step": checkpoint_step_val,
            }
            if path and os.path.exists(path):
                entry = audio_store.store_file(path)
                entry_dict["id"] = entry.id
                entry_dict["sample_rate"] = audio.get("sample_rate", 48000)
                entry_dict["codes"] = audio.get("params", {}).get("audio_codes", "")
            else:
                entry_dict["id"] = ""
            audio_data.append(entry_dict)

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


@router.post("/analyze")
def analyze_endpoint(
    req: AnalyzeRequest,
    llm=Depends(get_llm_handler),
):
    """Run LLM Phase 1 only (analysis/preview). Returns metadata in ~1-2 seconds."""
    if llm.model is None:
        raise HTTPException(400, "LLM service not initialized")

    top_k = None if req.lm_top_k == 0 else req.lm_top_k
    top_p = None if req.lm_top_p >= 1.0 else req.lm_top_p

    # Build user_metadata from provided fields
    user_metadata = {}
    if req.bpm is not None:
        user_metadata["bpm"] = str(req.bpm)
    if req.duration > 0:
        user_metadata["duration"] = str(int(req.duration))
    if req.keyscale:
        user_metadata["keyscale"] = req.keyscale
    if req.timesignature:
        user_metadata["timesignature"] = req.timesignature
    if req.vocal_language and req.vocal_language != "unknown":
        user_metadata["language"] = req.vocal_language

    result = llm.generate_with_stop_condition(
        caption=req.caption,
        lyrics=req.lyrics,
        infer_type="dit",  # Phase 1 only
        temperature=req.lm_temperature,
        cfg_scale=req.lm_cfg_scale,
        negative_prompt=req.lm_negative_prompt,
        top_k=top_k,
        top_p=top_p,
        use_constrained_decoding=req.use_constrained_decoding,
        user_metadata=user_metadata or None,
        use_cot_metas=req.use_cot_metas,
        use_cot_caption=req.use_cot_caption,
        use_cot_language=req.use_cot_language,
    )

    if not result.get("success"):
        return ApiResponse(success=False, error=result.get("error", "Analysis failed"))

    meta = result.get("metadata", {})
    extra = result.get("extra_outputs", {})
    time_costs = extra.get("time_costs", {})

    # Parse BPM as int if present
    bpm = meta.get("bpm")
    if bpm is not None:
        try:
            bpm = int(bpm)
        except (ValueError, TypeError):
            bpm = None

    # Parse duration as float if present
    duration = meta.get("duration")
    if duration is not None:
        try:
            duration = float(duration)
        except (ValueError, TypeError):
            duration = None

    return ApiResponse(data=AnalyzeResponse(
        caption=meta.get("caption", ""),
        bpm=bpm,
        keyscale=meta.get("keyscale", ""),
        duration=duration,
        language=meta.get("language", ""),
        timesignature=meta.get("timesignature", ""),
        thinking_text=extra.get("thinking_text", ""),
        phase1_time=time_costs.get("phase1_time", 0.0),
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

        # Refine must reference a previous stage OR a stored latent
        if stage.type == "refine" and not stage.src_latent_id:
            input_idx = (
                stage.input_stage if stage.input_stage is not None else idx - 1
            )
            if input_idx < 0 or input_idx >= idx:
                raise HTTPException(
                    422,
                    f"Stage {idx}: input_stage={input_idx} must reference "
                    f"a previous stage (0..{idx - 1})",
                )

        # Audio-requiring stages need src_audio_id, src_stage, or src_latent_id
        if stage.type in AUDIO_TYPES:
            if not stage.src_audio_id and stage.src_stage is None and not stage.src_latent_id:
                raise HTTPException(
                    422,
                    f"Stage {idx} ({stage.type}): must provide "
                    f"src_audio_id, src_stage, or src_latent_id",
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


@router.get("/latent/{latent_id}/metadata")
def get_latent_metadata(latent_id: str):
    """Get metadata for a stored latent without loading tensor."""
    record = latent_store.get_record(latent_id)
    if record is None:
        raise HTTPException(404, f"Latent '{latent_id}' not found")

    return ApiResponse(data={
        "id": record.id,
        "shape": list(record.shape),
        "dtype": record.dtype,
        "model_variant": record.model_variant,
        "stage_type": record.stage_type,
        "is_checkpoint": record.is_checkpoint,
        "checkpoint_step": record.checkpoint_step,
        "total_steps": record.total_steps,
        "params": record.params,
        "lm_metadata": record.lm_metadata,
        "batch_size": record.batch_size,
        "created_at": record.created_at,
        "pinned": record.pinned,
    })


@router.post("/latent/{latent_id}/decode")
def decode_latent(
    latent_id: str,
    dit=Depends(get_dit_handler),
):
    """VAE-decode a stored latent to audio for preview.

    Returns audio ID that can be played via /audio/files/{id}.
    """
    if dit.model is None:
        raise HTTPException(400, "DiT service not initialized (VAE required)")

    record = latent_store.get_record(latent_id)
    if record is None:
        raise HTTPException(404, f"Latent '{latent_id}' not found")

    tensor = latent_store.get(latent_id)
    if tensor is None:
        raise HTTPException(500, f"Failed to load latent tensor '{latent_id}'")

    # Stored latents are [B, T, D] — transpose to [B, D, T] for VAE decode
    with torch.inference_mode():
        with dit._load_model_context("vae"):
            latents_gpu = (
                tensor.to(dit.device)
                .transpose(1, 2)
                .contiguous()
                .to(dit.vae.dtype)
            )
            audio_tensor = dit.tiled_decode(latents_gpu)  # [B, Channels, Samples]
            if audio_tensor.dtype != torch.float32:
                audio_tensor = audio_tensor.float()
            del latents_gpu

    # Convert first batch item to numpy [Samples, Channels]
    audio_np = audio_tensor[0].cpu().numpy().T

    # Save to temp file and register in audio_store
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        sf.write(tmp.name, audio_np, dit.sample_rate, format="wav")
        temp_path = tmp.name

    entry = audio_store.store_file(temp_path)

    try:
        os.remove(temp_path)
    except OSError:
        pass

    logger.info(f"Decoded latent {latent_id} -> audio {entry.id}")

    return ApiResponse(data={
        "audio_id": entry.id,
        "latent_id": latent_id,
        "sample_rate": dit.sample_rate,
    })
