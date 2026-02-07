"""Pipeline executor: runs multi-stage diffusion pipelines with latent chaining."""

import os
import random
import time
from typing import Dict, Any, List, Optional

import torch
import torchaudio
from loguru import logger

from acestep.constants import TASK_INSTRUCTIONS

from web.backend.schemas.pipeline import PipelineRequest, PipelineStageConfig
from web.backend.services.task_manager import task_manager
from web.backend.services.audio_store import audio_store
from web.backend.services.audio_metadata import embed_metadata, build_pipeline_metadata

# Stage types that need source audio
AUDIO_STAGE_TYPES = {"cover", "repaint", "extract", "lego", "complete"}


def build_stage_instruction(stage: PipelineStageConfig) -> str:
    """Build the DiT instruction text for a stage based on its type."""
    template = TASK_INSTRUCTIONS.get(stage.type, TASK_INSTRUCTIONS["text2music"])
    if "{TRACK_NAME}" in template:
        template = template.replace("{TRACK_NAME}", stage.track_name or "track")
    if "{TRACK_CLASSES}" in template:
        classes = ", ".join(stage.complete_track_classes or ["accompaniment"])
        template = template.replace("{TRACK_CLASSES}", classes)
    return template


def resolve_src_audio(
    stage: PipelineStageConfig,
    dit_handler,
    stage_latents: Dict[int, torch.Tensor],
    sample_rate: int,
) -> Optional[torch.Tensor]:
    """Resolve source audio for a stage — from upload or previous stage latent.

    Returns a [2, frames] CPU tensor (stereo waveform at 48kHz), or None.
    """
    if stage.src_audio_id:
        path = audio_store.get_path(stage.src_audio_id)
        if not path:
            raise ValueError(f"Audio ID '{stage.src_audio_id}' not found in store")
        logger.info(f"[pipeline] Resolving src_audio from upload: {path}")
        return dit_handler.process_src_audio(path)

    elif stage.src_stage is not None:
        if stage.src_stage not in stage_latents:
            raise ValueError(
                f"src_stage={stage.src_stage} has no latents "
                f"(available: {list(stage_latents.keys())})"
            )
        logger.info(f"[pipeline] Resolving src_audio from stage {stage.src_stage} (VAE decode)")
        latents = stage_latents[stage.src_stage]  # [batch, T, D] CPU
        with torch.inference_mode():
            with dit_handler._load_model_context("vae"):
                latents_gpu = (
                    latents.to(dit_handler.device)
                    .transpose(1, 2)
                    .contiguous()
                    .to(dit_handler.vae.dtype)
                )
                pred_wavs = dit_handler.tiled_decode(latents_gpu)
                if pred_wavs.dtype != torch.float32:
                    pred_wavs = pred_wavs.float()
                # Return batch item 0 as the shared source
                result = pred_wavs[0].cpu()
                del latents_gpu, pred_wavs
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                return result

    return None


def run_pipeline(
    task_id: str,
    dit_handler,
    req: PipelineRequest,
) -> Dict[str, Any]:
    """Execute a multi-stage pipeline, chaining latents between stages.

    Supports stage types: generate, refine, cover, repaint, extract, lego, complete.
    Audio-requiring stages resolve source from uploaded files or previous stage output.

    Returns dict with "result" key containing stage audio IDs and timing.
    """
    if dit_handler.model is None:
        raise RuntimeError("DiT service not initialized")

    total_stages = len(req.stages)
    stage_latents: Dict[int, torch.Tensor] = {}  # idx -> clean latent (CPU)
    stage_time_costs: Dict[str, float] = {}

    # ── Validate stages ───────────────────────────────────────────────
    for idx, stage in enumerate(req.stages):
        if stage.type == "refine":
            if stage.input_stage is None:
                stage.input_stage = idx - 1
            if stage.input_stage < 0 or stage.input_stage >= idx:
                raise ValueError(
                    f"Stage {idx}: input_stage={stage.input_stage} is invalid "
                    f"(must reference a previous stage 0..{idx - 1})"
                )

    # ── Shared conditioning params ────────────────────────────────────
    batch_size = max(1, req.batch_size)
    # Note: captions_batch and lyrics_batch are built per-stage below
    # to support per-stage overrides (Gap 1)

    meta: Dict[str, Any] = {}
    if req.bpm is not None:
        meta["bpm"] = req.bpm
    if req.keyscale:
        meta["keyscale"] = req.keyscale
    if req.timesignature:
        meta["timesignature"] = req.timesignature
    if req.duration > 0:
        meta["duration"] = int(req.duration)
    metas_batch = [meta] * batch_size

    vocal_languages_batch = [req.vocal_language] * batch_size

    # Blank reference audio (default for text2music stages)
    sample_rate = getattr(dit_handler, "sample_rate", 48000)
    blank_refer_audios = [
        [torch.zeros(2, 30 * sample_rate)] for _ in range(batch_size)
    ]

    # ── Track current model for swapping ─────────────────────────────
    current_model = getattr(dit_handler, "model_variant", None)
    loaded_models = {current_model} if current_model else set()

    # ── Run stages ────────────────────────────────────────────────────
    for idx, stage in enumerate(req.stages):
        stage_start = time.time()
        stage_label = f"Stage {idx + 1}/{total_stages} ({stage.type}, {stage.steps} steps)"

        # ── Model swapping ─────────────────────────────────────────────
        stage_model = stage.model
        if stage_model and stage_model != current_model:
            task_manager.update_progress(
                task_id, idx / total_stages, f"Swapping to {stage_model}..."
            )
            logger.info(f"[pipeline] Swapping model from {current_model} to {stage_model}")

            swap_msg, swap_ok = dit_handler.swap_dit_model(stage_model)
            if not swap_ok:
                raise RuntimeError(f"Model swap failed: {swap_msg}")

            current_model = stage_model
            loaded_models.add(stage_model)
            logger.info(f"[pipeline] {swap_msg}")

        task_manager.update_progress(
            task_id, idx / total_stages, f"{stage_label}..."
        )
        logger.info(f"[pipeline] Starting {stage_label}")

        # ── Per-stage conditioning (with fallback to shared) ──────────
        stage_caption = stage.caption or req.caption
        stage_lyrics = stage.lyrics or req.lyrics
        captions_batch = [stage_caption] * batch_size
        lyrics_batch = [stage_lyrics] * batch_size

        # ── Stage-specific setup ──────────────────────────────────────
        init_latents = None
        t_start = 1.0
        target_wavs = None
        refer_audios = blank_refer_audios
        instructions = None
        audio_cover_strength = 1.0
        audio_code_hints = None
        repainting_start = None
        repainting_end = None

        if stage.type == "refine" and stage.input_stage is not None:
            # Re-noise previous stage's clean latent
            clean_latents = stage_latents[stage.input_stage]
            t_start = stage.denoise

            if t_start < 1.0 - 1e-6:
                with torch.inference_mode():
                    device = dit_handler.device
                    dtype = dit_handler.dtype
                    init_latents = dit_handler.model.renoise(
                        clean_latents.to(device).to(dtype), t_start,
                    )
            else:
                init_latents = None
                t_start = 1.0

        elif stage.type in AUDIO_STAGE_TYPES:
            # Resolve source audio (upload or previous stage)
            src_audio = resolve_src_audio(
                stage, dit_handler, stage_latents, sample_rate
            )
            if src_audio is None:
                # Safety fallback: degrade to text2music instead of crashing
                logger.warning(
                    f"[pipeline] Stage {idx} ({stage.type}): no source audio "
                    f"resolved — falling back to text2music generation"
                )
                stage.type = "generate"
            else:
                # Expand to batch: [batch, 2, frames]
                target_wavs = src_audio.unsqueeze(0).expand(batch_size, -1, -1)

                # Build task instruction
                instruction = build_stage_instruction(stage)
                instructions = [instruction] * batch_size

                # Cover-specific: use source as style reference + set strength
                if stage.type == "cover":
                    audio_cover_strength = stage.audio_cover_strength
                    refer_audios = [[src_audio] for _ in range(batch_size)]
                    if stage.audio_code_hints:
                        audio_code_hints = [stage.audio_code_hints] * batch_size

                # Repaint-specific: set time range
                elif stage.type == "repaint":
                    if stage.repainting_start is not None:
                        repainting_start = [stage.repainting_start] * batch_size
                    if stage.repainting_end is not None:
                        repainting_end = [stage.repainting_end] * batch_size

        # Prepare seeds
        if stage.seed < 0:
            seed_list = [random.randint(0, 2**32 - 1) for _ in range(batch_size)]
        else:
            seed_list = [stage.seed] * batch_size

        # ── Run diffusion ─────────────────────────────────────────────
        logger.info(
            f"[pipeline] service_generate: type={stage.type}, "
            f"steps={stage.steps}, target_wavs={'yes' if target_wavs is not None else 'no'}, "
            f"init_latents={'yes' if init_latents is not None else 'no'}, t_start={t_start}"
        )

        try:
            outputs = dit_handler.service_generate(
                captions=captions_batch,
                lyrics=lyrics_batch,
                metas=metas_batch,
                vocal_languages=vocal_languages_batch,
                refer_audios=refer_audios,
                target_wavs=target_wavs,
                infer_steps=stage.steps,
                guidance_scale=stage.guidance_scale,
                seed=seed_list,
                shift=stage.shift,
                infer_method=stage.infer_method,
                scheduler=stage.scheduler,
                use_adg=stage.use_adg,
                cfg_interval_start=stage.cfg_interval_start,
                cfg_interval_end=stage.cfg_interval_end,
                timesteps=stage.timesteps,
                init_latents=init_latents,
                t_start=t_start,
                instructions=instructions,
                audio_cover_strength=audio_cover_strength,
                audio_code_hints=audio_code_hints,
                repainting_start=repainting_start,
                repainting_end=repainting_end,
            )
            if outputs is None:
                logger.error("[pipeline] service_generate returned None!")
                raise RuntimeError("service_generate returned None")
        except Exception as e:
            logger.exception(f"[pipeline] service_generate raised exception: {e}")
            raise

        # Store clean latents (CPU) for later stages
        stage_latents[idx] = outputs["target_latents"].detach().cpu()
        stage_time_costs[f"stage_{idx}"] = time.time() - stage_start
        logger.info(
            f"[pipeline] {stage_label} completed in "
            f"{stage_time_costs[f'stage_{idx}']:.1f}s"
        )

    # ── Determine which stages to VAE-decode ──────────────────────────
    final_idx = total_stages - 1
    decode_indices = {final_idx}
    for idx, stage in enumerate(req.stages):
        if stage.preview and idx != final_idx:
            decode_indices.add(idx)

    # ── VAE decode ────────────────────────────────────────────────────
    task_manager.update_progress(task_id, 0.92, "Decoding audio...")
    logger.info(f"[pipeline] VAE decoding stages: {sorted(decode_indices)}")

    save_dir = os.path.join(audio_store.temp_dir, task_id)
    os.makedirs(save_dir, exist_ok=True)

    audio_results: List[Dict[str, Any]] = []
    vae_start = time.time()

    with torch.inference_mode():
        with dit_handler._load_model_context("vae"):
            for stage_idx in sorted(decode_indices):
                latents = stage_latents[stage_idx]
                # [batch, T, D] -> [batch, D, T]
                latents_gpu = (
                    latents.to(dit_handler.device)
                    .transpose(1, 2)
                    .contiguous()
                    .to(dit_handler.vae.dtype)
                )

                pred_wavs = dit_handler.tiled_decode(latents_gpu)
                if pred_wavs.dtype != torch.float32:
                    pred_wavs = pred_wavs.float()
                pred_wavs = pred_wavs.cpu()

                del latents_gpu
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()

                # Save each batch item
                for batch_idx in range(pred_wavs.shape[0]):
                    audio_tensor = pred_wavs[batch_idx]  # [channels, samples]
                    fmt = req.audio_format or "flac"
                    filename = f"stage{stage_idx}_b{batch_idx}.{fmt}"
                    filepath = os.path.join(save_dir, filename)

                    # Save with format-specific options
                    if fmt == "mp3":
                        bitrate = getattr(req, 'mp3_bitrate', 320) * 1000
                        torchaudio.save(
                            filepath, audio_tensor, sample_rate,
                            backend='ffmpeg',
                            compression=bitrate,
                        )
                    else:
                        torchaudio.save(filepath, audio_tensor, sample_rate)

                    # Embed generation metadata for reproducibility
                    if stage_idx == final_idx:
                        metadata = build_pipeline_metadata(req, req.stages, stage_time_costs)
                        embed_metadata(filepath, metadata)

                    entry = audio_store.store_file(filepath)

                    audio_results.append({
                        "stage": stage_idx,
                        "batch": batch_idx,
                        "audio_id": entry.id,
                        "is_final": stage_idx == final_idx,
                        "is_preview": stage_idx != final_idx,
                    })

    stage_time_costs["vae_decode"] = time.time() - vae_start
    logger.info(f"[pipeline] VAE decode completed in {stage_time_costs['vae_decode']:.1f}s")

    return {
        "result": {
            "stages": audio_results,
            "final_stage": final_idx,
            "time_costs": stage_time_costs,
            "success": True,
        }
    }
