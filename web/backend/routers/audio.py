"""Audio router: upload, serve, convert-to-codes, score, LRC, download-all."""

import os
import zipfile

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse

from web.backend.dependencies import get_dit_handler, get_llm_handler
from web.backend.schemas.common import ApiResponse
from web.backend.schemas.audio import (
    AudioUploadResponse,
    ConvertToCodesRequest,
    ConvertToCodesResponse,
    ScoreRequest,
    ScoreResponse,
    LRCRequest,
    LRCResponse,
)
from web.backend.services.audio_store import audio_store
from web.backend.services.task_manager import task_manager
from web.backend.services.audio_metadata import extract_metadata

router = APIRouter()


@router.post("/upload")
async def upload_audio(file: UploadFile = File(...)):
    data = await file.read()
    entry = audio_store.store_upload(data, file.filename or "upload.wav")
    return ApiResponse(data=AudioUploadResponse(id=entry.id, filename=entry.filename))


@router.get("/files/{file_id}")
def serve_audio(file_id: str):
    entry = audio_store.get_file(file_id)
    if not entry or not os.path.exists(entry.path):
        raise HTTPException(404, "Audio file not found")
    return FileResponse(entry.path, filename=entry.filename)


@router.get("/metadata/{file_id}")
def get_audio_metadata(file_id: str):
    """Extract generation metadata from an audio file.

    Returns the embedded ACE-Step generation parameters if present,
    allowing reimport of songs with all fields pre-populated.
    """
    entry = audio_store.get_file(file_id)
    if not entry or not os.path.exists(entry.path):
        raise HTTPException(404, "Audio file not found")

    metadata = extract_metadata(entry.path)
    if metadata is None:
        return ApiResponse(data={"has_metadata": False, "metadata": None})

    return ApiResponse(data={"has_metadata": True, "metadata": metadata})


@router.post("/upload-and-extract")
async def upload_and_extract_metadata(file: UploadFile = File(...)):
    """Upload an audio file and extract its generation metadata.

    This is useful for importing previously generated songs to
    reproduce or modify them with the same parameters.
    """
    data = await file.read()
    entry = audio_store.store_upload(data, file.filename or "upload.flac")

    metadata = extract_metadata(entry.path)

    return ApiResponse(data={
        "id": entry.id,
        "filename": entry.filename,
        "has_metadata": metadata is not None,
        "metadata": metadata,
    })


@router.post("/convert-to-codes")
def convert_to_codes(
    req: ConvertToCodesRequest,
    dit=Depends(get_dit_handler),
):
    path = audio_store.get_path(req.audio_id)
    if not path:
        raise HTTPException(404, "Audio file not found")
    codes = dit.convert_src_audio_to_codes(path)
    return ApiResponse(data=ConvertToCodesResponse(audio_codes=codes))


@router.post("/score")
def calculate_score(
    req: ScoreRequest,
    dit=Depends(get_dit_handler),
):
    task = task_manager.get_task(req.task_id)
    if not task or not task.extra_outputs:
        raise HTTPException(404, "Task not found or no extra outputs available")

    extra = task.extra_outputs
    pred_latents = extra.get("pred_latents")
    encoder_hidden_states = extra.get("encoder_hidden_states")
    encoder_attention_mask = extra.get("encoder_attention_mask")
    context_latents = extra.get("context_latents")
    lyric_token_idss = extra.get("lyric_token_idss")

    if pred_latents is None or encoder_hidden_states is None:
        raise HTTPException(400, "Missing required tensors for scoring")

    try:
        # Index into batch for the requested sample
        idx = req.sample_index
        score_result = dit.get_lyric_score(
            pred_latent=pred_latents[idx:idx+1],
            encoder_hidden_states=encoder_hidden_states[idx:idx+1],
            encoder_attention_mask=encoder_attention_mask[idx:idx+1],
            context_latents=context_latents[idx:idx+1],
            lyric_token_ids=lyric_token_idss[idx:idx+1] if lyric_token_idss is not None else None,
            vocal_language=req.vocal_language,
            inference_steps=req.inference_steps,
            seed=req.seed,
        )
        return ApiResponse(data=ScoreResponse(
            lm_score=score_result.get("lm_score", 0.0),
            dit_score=score_result.get("dit_score", 0.0),
            success=score_result.get("success", True),
            error=score_result.get("error"),
        ))
    except Exception as e:
        raise HTTPException(500, f"Scoring failed: {e}")


@router.post("/lrc")
def generate_lrc(
    req: LRCRequest,
    dit=Depends(get_dit_handler),
):
    task = task_manager.get_task(req.task_id)
    if not task or not task.extra_outputs:
        raise HTTPException(404, "Task not found or no extra outputs available")

    extra = task.extra_outputs
    pred_latents = extra.get("pred_latents")
    encoder_hidden_states = extra.get("encoder_hidden_states")
    encoder_attention_mask = extra.get("encoder_attention_mask")
    context_latents = extra.get("context_latents")
    lyric_token_idss = extra.get("lyric_token_idss")

    if pred_latents is None:
        raise HTTPException(400, "Missing required tensors for LRC generation")

    try:
        # Index into batch for the requested sample
        idx = req.sample_index
        lrc_result = dit.get_lyric_timestamp(
            pred_latent=pred_latents[idx:idx+1],
            encoder_hidden_states=encoder_hidden_states[idx:idx+1],
            encoder_attention_mask=encoder_attention_mask[idx:idx+1],
            context_latents=context_latents[idx:idx+1],
            lyric_token_ids=lyric_token_idss[idx:idx+1] if lyric_token_idss is not None else None,
            total_duration_seconds=req.total_duration_seconds,
            vocal_language=req.vocal_language,
            inference_steps=req.inference_steps,
            seed=req.seed,
        )
        return ApiResponse(data=LRCResponse(
            lrc_text=lrc_result.get("lrc_text", ""),
            success=lrc_result.get("success", True),
            error=lrc_result.get("error"),
        ))
    except Exception as e:
        raise HTTPException(500, f"LRC generation failed: {e}")


@router.get("/download-all/{task_id}")
def download_all(task_id: str):
    task = task_manager.get_task(task_id)
    if not task or not task.result:
        raise HTTPException(404, "Task not found")

    audios = task.result.get("audios", [])
    if not audios:
        raise HTTPException(404, "No audio files")

    zip_path = os.path.join(audio_store.temp_dir, f"{task_id}_all.zip")
    with zipfile.ZipFile(zip_path, "w") as zf:
        for i, audio in enumerate(audios):
            fid = audio.get("id", "")
            entry = audio_store.get_file(fid) if fid else None
            if entry and os.path.exists(entry.path):
                zf.write(entry.path, entry.filename)

    return FileResponse(zip_path, filename=f"ace-step-{task_id}.zip",
                        media_type="application/zip")
