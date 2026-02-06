"""Prompt Library router: save, list, search, delete prompts."""

from typing import Optional, List

from fastapi import APIRouter, HTTPException, Query

from web.backend.schemas.common import ApiResponse
from web.backend.schemas.prompt_library import (
    PromptEntry,
    SavePromptRequest,
    UpdatePromptRequest,
    PromptListResponse,
    GenreTagsResponse,
)
from web.backend.services.prompt_library import prompt_library
from web.backend.services.audio_store import audio_store
from web.backend.services.audio_metadata import extract_metadata

router = APIRouter()


@router.get("/list")
def list_prompts(
    genres: Optional[str] = Query(None, description="Comma-separated genres"),
    tags: Optional[str] = Query(None, description="Comma-separated tags"),
    mood: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """List prompts with optional filtering."""
    genre_list = genres.split(",") if genres else None
    tag_list = tags.split(",") if tags else None

    prompts, total = prompt_library.list_prompts(
        genres=genre_list,
        tags=tag_list,
        mood=mood,
        search=search,
        limit=limit,
        offset=offset,
    )

    return ApiResponse(data=PromptListResponse(prompts=prompts, total=total))


@router.get("/taxonomy")
def get_taxonomy():
    """Get available genres, tags, and moods for filtering."""
    taxonomy = prompt_library.get_taxonomy()
    return ApiResponse(data=taxonomy)


@router.get("/{prompt_id}")
def get_prompt(prompt_id: str):
    """Get a single prompt by ID."""
    prompt = prompt_library.get_prompt(prompt_id)
    if not prompt:
        raise HTTPException(404, "Prompt not found")
    return ApiResponse(data=prompt)


@router.post("/save")
def save_prompt(req: SavePromptRequest):
    """Save a new prompt to the library."""
    if not req.name.strip():
        raise HTTPException(400, "Prompt name is required")
    if not req.caption.strip():
        raise HTTPException(400, "Caption is required")

    entry = prompt_library.save_prompt(req)
    return ApiResponse(data=entry)


@router.put("/{prompt_id}")
def update_prompt(prompt_id: str, req: UpdatePromptRequest):
    """Update an existing prompt."""
    entry = prompt_library.update_prompt(prompt_id, req)
    if not entry:
        raise HTTPException(404, "Prompt not found")
    return ApiResponse(data=entry)


@router.delete("/{prompt_id}")
def delete_prompt(prompt_id: str):
    """Delete a prompt from the library."""
    success = prompt_library.delete_prompt(prompt_id)
    if not success:
        raise HTTPException(404, "Prompt not found")
    return ApiResponse(data={"deleted": True})


@router.post("/import-from-audio/{audio_id}")
def import_from_audio(audio_id: str, name: str = Query(..., description="Name for the prompt")):
    """Import a prompt from a stored audio file's metadata."""
    entry = audio_store.get_file(audio_id)
    if not entry:
        raise HTTPException(404, "Audio file not found")

    metadata = extract_metadata(entry.path)
    if not metadata:
        raise HTTPException(400, "No ACE-Step metadata found in this audio file")

    prompt = prompt_library.import_from_metadata(metadata, name)
    return ApiResponse(data=prompt)


@router.post("/save-current")
def save_current_prompt(
    name: str,
    caption: str,
    lyrics: str = "",
    instrumental: bool = False,
    vocal_language: str = "unknown",
    bpm: Optional[int] = None,
    keyscale: str = "",
    timesignature: str = "",
    duration: int = 30,
    genres: str = "",  # Comma-separated
    tags: str = "",    # Comma-separated
    mood: str = "",
    notes: str = "",
):
    """Quick save current generation settings to library."""
    req = SavePromptRequest(
        name=name,
        caption=caption,
        lyrics=lyrics,
        instrumental=instrumental,
        vocal_language=vocal_language,
        bpm=bpm,
        keyscale=keyscale,
        timesignature=timesignature,
        duration=duration,
        genres=genres.split(",") if genres else [],
        tags=tags.split(",") if tags else [],
        mood=mood,
        notes=notes,
    )
    entry = prompt_library.save_prompt(req)
    return ApiResponse(data=entry)
