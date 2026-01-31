"""OpenRouter API adapter for ACE-Step music generation.

This module provides OpenRouter-compatible endpoints that wrap the ACE-Step
music generation API, enabling integration with OpenRouter's unified API gateway.

Endpoints:
- POST /v1/chat/completions  - Generate music via chat completion format
- GET  /v1/models            - List available models (OpenRouter format)
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import tempfile
import time
import traceback
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from acestep.openrouter_models import (
    AudioConfig,
    AudioOutput,
    AudioOutputUrl,
    AssistantMessage,
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    Choice,
    DeltaContent,
    ErrorDetail,
    ErrorResponse,
    ModelInfo,
    ModelPricing,
    ModelsResponse,
    StreamChoice,
    Usage,
)


# =============================================================================
# Constants
# =============================================================================

# Model ID prefix for OpenRouter
MODEL_PREFIX = "acestep"

# Default model configurations
DEFAULT_INFERENCE_STEPS = 8
DEFAULT_GUIDANCE_SCALE = 7.0
DEFAULT_BATCH_SIZE = 1  # OpenRouter typically expects single output
DEFAULT_AUDIO_FORMAT = "mp3"

# Supported audio formats for input/output
SUPPORTED_AUDIO_FORMATS = {"mp3", "wav", "flac", "ogg", "m4a", "aac"}

# Default timesteps for turbo model (8 steps)
DEFAULT_TIMESTEPS_TURBO = [0.97, 0.76, 0.615, 0.5, 0.395, 0.28, 0.18, 0.085, 0.0]


# =============================================================================
# Helper Functions
# =============================================================================

def _generate_completion_id() -> str:
    """Generate a unique completion ID."""
    return f"chatcmpl-{uuid4().hex[:24]}"


def _get_model_id(model_name: str) -> str:
    """Convert internal model name to OpenRouter model ID."""
    return f"{MODEL_PREFIX}/{model_name}"


def _parse_model_name(model_id: str) -> str:
    """Extract internal model name from OpenRouter model ID."""
    if "/" in model_id:
        return model_id.split("/", 1)[1]
    return model_id


def _audio_to_base64_url(audio_path: str, audio_format: str = "mp3") -> str:
    """Convert audio file to base64 data URL."""
    if not audio_path or not os.path.exists(audio_path):
        return ""

    mime_types = {
        "mp3": "audio/mpeg",
        "wav": "audio/wav",
        "flac": "audio/flac",
        "ogg": "audio/ogg",
        "m4a": "audio/mp4",
        "aac": "audio/aac",
    }
    mime_type = mime_types.get(audio_format.lower(), "audio/mpeg")

    with open(audio_path, "rb") as f:
        audio_data = f.read()

    b64_data = base64.b64encode(audio_data).decode("utf-8")
    return f"data:{mime_type};base64,{b64_data}"


def _base64_to_temp_file(b64_data: str, audio_format: str = "mp3") -> str:
    """Save base64 audio data to temporary file."""
    # Remove data URL prefix if present
    if "," in b64_data:
        b64_data = b64_data.split(",", 1)[1]

    audio_bytes = base64.b64decode(b64_data)

    suffix = f".{audio_format}" if not audio_format.startswith(".") else audio_format
    fd, path = tempfile.mkstemp(suffix=suffix, prefix="openrouter_audio_")
    os.close(fd)

    with open(path, "wb") as f:
        f.write(audio_bytes)

    return path


import re

def _extract_tagged_content(text: str) -> Tuple[Optional[str], Optional[str], str]:
    """
    Extract content from <prompt> and <lyrics> tags.

    Returns:
        (prompt, lyrics, remaining_text)
        - prompt: Content inside <prompt>...</prompt> or None
        - lyrics: Content inside <lyrics>...</lyrics> or None
        - remaining_text: Text after removing tagged content
    """
    prompt = None
    lyrics = None
    remaining = text

    # Extract <prompt>...</prompt>
    prompt_match = re.search(r'<prompt>(.*?)</prompt>', text, re.DOTALL | re.IGNORECASE)
    if prompt_match:
        prompt = prompt_match.group(1).strip()
        remaining = remaining.replace(prompt_match.group(0), '').strip()

    # Extract <lyrics>...</lyrics>
    lyrics_match = re.search(r'<lyrics>(.*?)</lyrics>', text, re.DOTALL | re.IGNORECASE)
    if lyrics_match:
        lyrics = lyrics_match.group(1).strip()
        remaining = remaining.replace(lyrics_match.group(0), '').strip()

    return prompt, lyrics, remaining


def _parse_messages(messages: List[Any]) -> Tuple[str, str, Optional[str], Optional[str], Optional[str]]:
    """
    Parse chat messages to extract prompt, lyrics, sample_query and audio references.

    Supports two modes:
    1. Tagged mode: Use <prompt>...</prompt> and <lyrics>...</lyrics> tags
    2. Heuristic mode: Auto-detect based on content structure

    Returns:
        (prompt, lyrics, reference_audio_path, system_instruction, sample_query)
        - sample_query is set when input doesn't look like lyrics and has no tags
    """
    prompt_parts = []
    lyrics = ""
    sample_query = None
    reference_audio_path = None
    system_instruction = None
    has_tags = False

    for msg in messages:
        role = msg.role
        content = msg.content

        if role == "system":
            # System message becomes instruction
            if isinstance(content, str):
                system_instruction = content
            continue

        if role != "user":
            continue

        # Parse user message content
        if isinstance(content, str):
            text = content.strip()
            # Try to extract tagged content first
            tagged_prompt, tagged_lyrics, remaining = _extract_tagged_content(text)
            if tagged_prompt is not None or tagged_lyrics is not None:
                has_tags = True
                if tagged_prompt:
                    prompt_parts.append(tagged_prompt)
                if tagged_lyrics:
                    lyrics = tagged_lyrics
                if remaining:
                    prompt_parts.append(remaining)
            else:
                # No tags - use heuristic detection
                if _looks_like_lyrics(text):
                    lyrics = text
                else:
                    prompt_parts.append(text)

        elif isinstance(content, list):
            # Multi-part content
            for part in content:
                if isinstance(part, dict):
                    part_type = part.get("type", "")

                    if part_type == "text":
                        text = part.get("text", "").strip()
                        tagged_prompt, tagged_lyrics, remaining = _extract_tagged_content(text)
                        if tagged_prompt is not None or tagged_lyrics is not None:
                            has_tags = True
                            if tagged_prompt:
                                prompt_parts.append(tagged_prompt)
                            if tagged_lyrics:
                                lyrics = tagged_lyrics
                            if remaining:
                                prompt_parts.append(remaining)
                        elif _looks_like_lyrics(text):
                            lyrics = text
                        else:
                            prompt_parts.append(text)

                    elif part_type == "input_audio":
                        audio_data = part.get("input_audio", {})
                        if isinstance(audio_data, dict):
                            b64_data = audio_data.get("data", "")
                            audio_format = audio_data.get("format", "mp3")
                            if b64_data:
                                try:
                                    path = _base64_to_temp_file(b64_data, audio_format)
                                    reference_audio_path = path
                                    temp_files.append(path)
                                except Exception:
                                    pass

                elif hasattr(part, "type"):
                    # Pydantic model
                    if part.type == "text":
                        text = getattr(part, "text", "").strip()
                        tagged_prompt, tagged_lyrics, remaining = _extract_tagged_content(text)
                        if tagged_prompt is not None or tagged_lyrics is not None:
                            has_tags = True
                            if tagged_prompt:
                                prompt_parts.append(tagged_prompt)
                            if tagged_lyrics:
                                lyrics = tagged_lyrics
                            if remaining:
                                prompt_parts.append(remaining)
                        elif _looks_like_lyrics(text):
                            lyrics = text
                        else:
                            prompt_parts.append(text)

                    elif part.type == "input_audio":
                        audio_data = getattr(part, "input_audio", None)
                        if audio_data:
                            b64_data = getattr(audio_data, "data", "")
                            audio_format = getattr(audio_data, "format", "mp3")
                            if b64_data:
                                try:
                                    path = _base64_to_temp_file(b64_data, audio_format)
                                    reference_audio_path = path
                                    temp_files.append(path)
                                except Exception:
                                    pass

    prompt = " ".join(prompt_parts).strip()

    # Determine if we should use sample mode
    # Use sample mode when: no tags, no lyrics detected, and we have text input
    if not has_tags and not lyrics and prompt:
        sample_query = prompt
        prompt = ""

    return prompt, lyrics, reference_audio_path, system_instruction, sample_query


def _looks_like_lyrics(text: str) -> bool:
    """
    Heuristic to detect if text looks like song lyrics.

    Lyrics typically have:
    - Multiple short lines
    - Section markers like [Verse], [Chorus], etc.
    - Repetitive patterns
    """
    if not text:
        return False

    # Check for common lyrics markers
    lyrics_markers = [
        "[verse", "[chorus", "[bridge", "[intro", "[outro",
        "[hook", "[pre-chorus", "[refrain", "[inst",
    ]
    text_lower = text.lower()
    for marker in lyrics_markers:
        if marker in text_lower:
            return True

    # Check line structure (lyrics tend to have many short lines)
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    if len(lines) >= 4:
        avg_line_length = sum(len(l) for l in lines) / len(lines)
        if avg_line_length < 60:  # Short lines suggest lyrics
            return True

    return False


# =============================================================================
# Router Factory
# =============================================================================

def create_openrouter_router(app_state_getter) -> APIRouter:
    """
    Create OpenRouter-compatible API router.

    Args:
        app_state_getter: Callable that returns the FastAPI app.state object

    Returns:
        APIRouter with OpenRouter-compatible endpoints
    """
    router = APIRouter(tags=["OpenRouter Compatible"])

    def _get_model_name_from_path(config_path: str) -> str:
        """Extract model name from config path."""
        if not config_path:
            return ""
        normalized = config_path.rstrip("/\\")
        return os.path.basename(normalized)

    @router.get("/v1/models", response_model=ModelsResponse)
    async def list_models_openrouter():
        """List available models in OpenRouter format."""
        state = app_state_getter()
        models = []
        created_timestamp = int(time.time()) - 86400 * 30  # ~30 days ago

        # Primary model
        if getattr(state, "_initialized", False):
            model_name = _get_model_name_from_path(state._config_path)
            if model_name:
                models.append(ModelInfo(
                    id=_get_model_id(model_name),
                    name=f"ACE-Step {model_name}",
                    created=created_timestamp,
                    input_modalities=["text", "audio"],
                    output_modalities=["audio", "text"],
                    context_length=4096,
                    max_output_length=300,
                    pricing=ModelPricing(
                        prompt="0",
                        completion="0",
                        request="0",
                    ),
                    description="AI music generation model",
                ))

        # Secondary model
        if getattr(state, "_initialized2", False) and state._config_path2:
            model_name = _get_model_name_from_path(state._config_path2)
            if model_name:
                models.append(ModelInfo(
                    id=_get_model_id(model_name),
                    name=f"ACE-Step {model_name}",
                    created=created_timestamp,
                    input_modalities=["text", "audio"],
                    output_modalities=["audio", "text"],
                    context_length=4096,
                    max_output_length=300,
                    pricing=ModelPricing(),
                    description="AI music generation model",
                ))

        # Third model
        if getattr(state, "_initialized3", False) and state._config_path3:
            model_name = _get_model_name_from_path(state._config_path3)
            if model_name:
                models.append(ModelInfo(
                    id=_get_model_id(model_name),
                    name=f"ACE-Step {model_name}",
                    created=created_timestamp,
                    input_modalities=["text", "audio"],
                    output_modalities=["audio", "text"],
                    context_length=4096,
                    max_output_length=300,
                    pricing=ModelPricing(),
                    description="AI music generation model",
                ))

        return ModelsResponse(data=models)

    @router.post("/v1/chat/completions")
    async def chat_completions(request: Request):
        """
        OpenRouter-compatible chat completions endpoint for music generation.

        Accepts standard chat completion format and generates music based on
        the conversation content.
        """
        state = app_state_getter()

        # Debug: print state info
        initialized = getattr(state, "_initialized", False)
        init_error = getattr(state, "_init_error", None)
        print(f"[OpenRouter] chat_completions called, _initialized={initialized}, _init_error={init_error}")

        # Parse request body
        try:
            body = await request.json()
            req = ChatCompletionRequest(**body)
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid request format: {str(e)}"
            )

        # Check if model is initialized
        if not initialized:
            raise HTTPException(
                status_code=503,
                detail=f"Model not initialized. init_error={init_error}"
            )

        # Parse model name
        model_name = _parse_model_name(req.model)

        # Parse messages to extract prompt, lyrics, sample_query and audio
        prompt, lyrics, reference_audio_path, system_instruction, sample_query = _parse_messages(req.messages)

        if not prompt and not lyrics and not sample_query:
            raise HTTPException(
                status_code=400,
                detail="No valid prompt, lyrics or sample query found in messages"
            )

        # Extract audio config
        audio_config = req.audio_config or AudioConfig()
        audio_format = audio_config.format or DEFAULT_AUDIO_FORMAT

        # Build generation parameters
        gen_params = _build_generation_params(
            req=req,
            prompt=prompt,
            lyrics=lyrics,
            reference_audio_path=reference_audio_path,
            audio_config=audio_config,
            model_name=model_name,
            sample_query=sample_query,
        )

        # Handle streaming vs non-streaming
        if req.stream:
            return StreamingResponse(
                _stream_generation(state, gen_params, req.model, audio_format),
                media_type="text/event-stream",
            )
        else:
            return await _sync_generation(state, gen_params, req.model, audio_format)

    return router


def _build_generation_params(
    req: ChatCompletionRequest,
    prompt: str,
    lyrics: str,
    reference_audio_path: Optional[str],
    audio_config: AudioConfig,
    model_name: str,
    sample_query: Optional[str] = None,
) -> Dict[str, Any]:
    """Build ACE-Step generation parameters from OpenRouter request."""
    params = {
        "prompt": prompt,
        "lyrics": lyrics,
        "model": model_name,
        "audio_format": audio_config.format or DEFAULT_AUDIO_FORMAT,
        "batch_size": req.batch_size or DEFAULT_BATCH_SIZE,
    }

    # Sample mode: use LLM to generate prompt and lyrics from query
    if sample_query:
        params["sample_query"] = sample_query

    # Audio config parameters
    if audio_config.duration:
        params["audio_duration"] = audio_config.duration
    if audio_config.bpm:
        params["bpm"] = audio_config.bpm
    if audio_config.key_scale:
        params["key_scale"] = audio_config.key_scale
    if audio_config.time_signature:
        params["time_signature"] = audio_config.time_signature
    if audio_config.vocal_language:
        params["vocal_language"] = audio_config.vocal_language
    if audio_config.instrumental is not None:
        if audio_config.instrumental:
            params["lyrics"] = "[inst]"

    # Reference audio
    if reference_audio_path:
        params["reference_audio_path"] = reference_audio_path
        params["task_type"] = "music_continuation"

    # LM parameters from OpenRouter standard params
    if req.temperature is not None:
        params["lm_temperature"] = req.temperature
    if req.top_p is not None:
        params["lm_top_p"] = req.top_p
    if req.top_k is not None:
        params["lm_top_k"] = req.top_k
    if req.seed is not None:
        params["seed"] = req.seed
        params["use_random_seed"] = False

    # ACE-Step specific parameters
    if req.thinking is not None:
        params["thinking"] = req.thinking
    if req.inference_steps is not None:
        params["inference_steps"] = req.inference_steps
    if req.guidance_scale is not None:
        params["guidance_scale"] = req.guidance_scale

    return params


# =============================================================================
# Generation Functions
# =============================================================================

async def _sync_generation(
    state: Any,
    gen_params: Dict[str, Any],
    model_id: str,
    audio_format: str,
) -> ChatCompletionResponse:
    """
    Synchronous music generation (waits for completion).

    Returns a complete ChatCompletionResponse with generated audio.
    """
    from concurrent.futures import ThreadPoolExecutor

    completion_id = _generate_completion_id()
    created_timestamp = int(time.time())

    try:
        # Run generation in thread pool to avoid blocking
        loop = asyncio.get_running_loop()
        executor = getattr(state, "executor", None)
        if executor is None:
            executor = ThreadPoolExecutor(max_workers=1)

        result = await loop.run_in_executor(
            executor,
            lambda: _run_generation(state, gen_params)
        )

        # Build response
        audio_outputs = []
        text_content = "Music generated successfully."

        if result.get("success"):
            audio_paths = result.get("audio_paths", [])
            for path in audio_paths:
                if path and os.path.exists(path):
                    b64_url = _audio_to_base64_url(path, audio_format)
                    if b64_url:
                        audio_outputs.append(AudioOutput(
                            audio_url=AudioOutputUrl(url=b64_url)
                        ))

            # Add generation info to text content
            gen_info = result.get("generation_info", "")
            if gen_info:
                text_content = f"Music generated successfully.\n\n{gen_info}"
        else:
            error_msg = result.get("error", "Unknown error")
            text_content = f"Music generation failed: {error_msg}"

        return ChatCompletionResponse(
            id=completion_id,
            created=created_timestamp,
            model=model_id,
            choices=[Choice(
                index=0,
                message=AssistantMessage(
                    content=text_content,
                    audio=audio_outputs if audio_outputs else None,
                ),
                finish_reason="stop",
            )],
            usage=Usage(),
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Generation failed: {str(e)}"
        )


async def _stream_generation(
    state: Any,
    gen_params: Dict[str, Any],
    model_id: str,
    audio_format: str,
):
    """
    Streaming music generation with SSE events.

    Yields SSE events during generation and final audio data.
    """
    from concurrent.futures import ThreadPoolExecutor

    completion_id = _generate_completion_id()
    created_timestamp = int(time.time())

    def _make_chunk(delta: DeltaContent, finish_reason: Optional[str] = None) -> str:
        chunk = ChatCompletionChunk(
            id=completion_id,
            created=created_timestamp,
            model=model_id,
            choices=[StreamChoice(
                index=0,
                delta=delta,
                finish_reason=finish_reason,
            )],
        )
        return f"data: {chunk.model_dump_json()}\n\n"

    try:
        # Send initial message
        yield _make_chunk(DeltaContent(role="assistant", content="Generating music..."))

        # Run generation
        loop = asyncio.get_running_loop()
        executor = getattr(state, "executor", None)
        if executor is None:
            executor = ThreadPoolExecutor(max_workers=1)

        result = await loop.run_in_executor(
            executor,
            lambda: _run_generation(state, gen_params)
        )

        # Send result
        if result.get("success"):
            audio_paths = result.get("audio_paths", [])
            audio_outputs = []
            print(f"[OpenRouter] Generation success, audio_paths={audio_paths}")

            for path in audio_paths:
                print(f"[OpenRouter] Processing path: {path}, exists={os.path.exists(path) if path else False}")
                if path and os.path.exists(path):
                    b64_url = _audio_to_base64_url(path, audio_format)
                    print(f"[OpenRouter] b64_url length: {len(b64_url) if b64_url else 0}")
                    if b64_url:
                        audio_outputs.append(AudioOutput(
                            audio_url=AudioOutputUrl(url=b64_url)
                        ))

            print(f"[OpenRouter] audio_outputs count: {len(audio_outputs)}")
            yield _make_chunk(DeltaContent(
                content="\n\nGeneration complete.",
                audio=audio_outputs if audio_outputs else None,
            ))
        else:
            error_msg = result.get("error", "Unknown error")
            yield _make_chunk(DeltaContent(content=f"\n\nError: {error_msg}"))

        # Send finish
        yield _make_chunk(DeltaContent(), finish_reason="stop")
        yield "data: [DONE]\n\n"

    except Exception as e:
        yield _make_chunk(DeltaContent(content=f"\n\nError: {str(e)}"))
        yield _make_chunk(DeltaContent(), finish_reason="error")
        yield "data: [DONE]\n\n"


def _run_generation(state: Any, gen_params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run the actual music generation using ACE-Step inference.

    This function runs synchronously and should be called from a thread pool.
    """
    try:
        from acestep.inference import (
            GenerationParams,
            GenerationConfig,
            generate_music,
        )
        from acestep.handler import AceStepHandler
        from acestep.llm_inference import LLMHandler

        # Get handlers from state
        handler: AceStepHandler = state.handler
        llm_handler: LLMHandler = getattr(state, "llm_handler", None)

        # Check LLM initialization
        llm_initialized = getattr(state, "_llm_initialized", False)
        if not llm_initialized:
            llm_handler = None

        # Select model handler
        model_name = gen_params.get("model", "")
        selected_handler = handler

        if model_name:
            # Check secondary model
            if getattr(state, "_initialized2", False):
                config_path2 = getattr(state, "_config_path2", "")
                if config_path2 and model_name in config_path2:
                    selected_handler = state.handler2

            # Check third model
            if getattr(state, "_initialized3", False):
                config_path3 = getattr(state, "_config_path3", "")
                if config_path3 and model_name in config_path3:
                    selected_handler = state.handler3

        # Handle sample mode: use LLM to generate prompt and lyrics from query
        sample_query = gen_params.get("sample_query")
        prompt = gen_params.get("prompt", "")
        lyrics = gen_params.get("lyrics", "")

        if sample_query and llm_handler and llm_initialized:
            from acestep.inference import create_sample
            sample_result = create_sample(
                llm_handler=llm_handler,
                query=sample_query,
                instrumental=gen_params.get("instrumental", False),
                vocal_language=gen_params.get("vocal_language"),
                temperature=gen_params.get("lm_temperature", 0.85),
                top_p=gen_params.get("lm_top_p", 0.9),
                top_k=gen_params.get("lm_top_k"),
            )
            if sample_result.success:
                prompt = sample_result.caption or ""
                lyrics = sample_result.lyrics or ""
                # Also use generated metadata if not explicitly provided
                if not gen_params.get("bpm") and sample_result.bpm:
                    gen_params["bpm"] = sample_result.bpm
                if not gen_params.get("audio_duration") and sample_result.duration:
                    gen_params["audio_duration"] = sample_result.duration
                if not gen_params.get("key_scale") and sample_result.keyscale:
                    gen_params["key_scale"] = sample_result.keyscale
                if not gen_params.get("time_signature") and sample_result.timesignature:
                    gen_params["time_signature"] = sample_result.timesignature
                if not gen_params.get("vocal_language") and sample_result.language:
                    gen_params["vocal_language"] = sample_result.language

        # Determine if instrumental
        instrumental = _is_instrumental(lyrics)

        # Get timesteps - use default for turbo model if not provided
        timesteps = gen_params.get("timesteps", DEFAULT_TIMESTEPS_TURBO)

        # Build GenerationParams
        params = GenerationParams(
            task_type=gen_params.get("task_type", "text2music"),
            caption=prompt,
            lyrics=lyrics,
            instrumental=instrumental,
            vocal_language=gen_params.get("vocal_language", "en"),
            bpm=gen_params.get("bpm"),
            keyscale=gen_params.get("key_scale", ""),
            timesignature=gen_params.get("time_signature", ""),
            duration=gen_params.get("audio_duration", -1.0),
            inference_steps=gen_params.get("inference_steps", DEFAULT_INFERENCE_STEPS),
            seed=gen_params.get("seed", -1),
            guidance_scale=gen_params.get("guidance_scale", DEFAULT_GUIDANCE_SCALE),
            reference_audio=gen_params.get("reference_audio_path"),
            thinking=gen_params.get("thinking", False),
            lm_temperature=gen_params.get("lm_temperature", 0.85),
            lm_top_p=gen_params.get("lm_top_p", 0.9),
            lm_top_k=gen_params.get("lm_top_k", 0),
            timesteps=timesteps,
        )

        # Build GenerationConfig
        config = GenerationConfig(
            batch_size=gen_params.get("batch_size", DEFAULT_BATCH_SIZE),
            use_random_seed=gen_params.get("use_random_seed", True),
            audio_format=gen_params.get("audio_format", DEFAULT_AUDIO_FORMAT),
        )

        # Get save directory
        save_dir = getattr(state, "temp_audio_dir", None)
        if not save_dir:
            save_dir = tempfile.mkdtemp(prefix="openrouter_audio_")
        print(f"[OpenRouter] save_dir={save_dir}")

        # Run generation
        result = generate_music(
            dit_handler=selected_handler,
            llm_handler=llm_handler,
            params=params,
            config=config,
            save_dir=save_dir,
            progress=None,
        )

        if not result.success:
            return {
                "success": False,
                "error": result.error or result.status_message,
            }

        # Extract audio paths
        print(f"[OpenRouter] result.success={result.success}")
        print(f"[OpenRouter] result.status_message={result.status_message}")
        print(f"[OpenRouter] result.audios count={len(result.audios)}")
        for i, audio in enumerate(result.audios):
            print(f"[OpenRouter] audio[{i}] path={audio.get('path')}, has_tensor={audio.get('tensor') is not None}")

        audio_paths = [audio["path"] for audio in result.audios if audio.get("path")]
        print(f"[OpenRouter] final audio_paths={audio_paths}")

        return {
            "success": True,
            "audio_paths": audio_paths,
            "generation_info": result.extra_outputs.get("generation_info", ""),
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
        }


def _is_instrumental(lyrics: str) -> bool:
    """Check if the music should be instrumental based on lyrics."""
    if not lyrics:
        return True
    lyrics_clean = lyrics.strip().lower()
    if not lyrics_clean:
        return True
    return lyrics_clean in ("[inst]", "[instrumental]")
