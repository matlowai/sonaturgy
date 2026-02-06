"""Audio metadata utilities for embedding and extracting generation parameters."""

import json
from typing import Dict, Any, Optional, List
from pathlib import Path

from loguru import logger

# Metadata key prefix for ACE-Step params
METADATA_PREFIX = "ACESTEP_"


def embed_metadata_flac(filepath: str, metadata: Dict[str, Any]) -> bool:
    """Embed generation metadata into a FLAC file using Vorbis comments.

    Args:
        filepath: Path to the FLAC file
        metadata: Dictionary of generation parameters

    Returns:
        True if successful, False otherwise
    """
    try:
        from mutagen.flac import FLAC

        audio = FLAC(filepath)

        # Store the full metadata as JSON
        audio[f"{METADATA_PREFIX}JSON"] = json.dumps(metadata)

        # Also store individual fields for easy viewing in audio players
        if "caption" in metadata:
            audio["DESCRIPTION"] = metadata["caption"]
        if "lyrics" in metadata:
            audio["LYRICS"] = metadata["lyrics"]
        if "bpm" in metadata:
            audio["BPM"] = str(metadata["bpm"])
        if "keyscale" in metadata:
            audio["KEY"] = metadata["keyscale"]
        if "duration" in metadata:
            audio[f"{METADATA_PREFIX}DURATION"] = str(metadata["duration"])
        if "vocal_language" in metadata:
            audio[f"{METADATA_PREFIX}LANGUAGE"] = metadata["vocal_language"]
        if "instrumental" in metadata:
            audio[f"{METADATA_PREFIX}INSTRUMENTAL"] = str(metadata["instrumental"])
        if "seed" in metadata:
            audio[f"{METADATA_PREFIX}SEED"] = str(metadata["seed"])
        if "stages" in metadata:
            audio[f"{METADATA_PREFIX}STAGES"] = json.dumps(metadata["stages"])

        # Add software tag
        audio["SOFTWARE"] = "ACE-Step 1.5"

        audio.save()
        logger.debug(f"[audio_metadata] Embedded metadata in {filepath}")
        return True

    except Exception as e:
        logger.warning(f"[audio_metadata] Failed to embed metadata in {filepath}: {e}")
        return False


def embed_metadata_wav(filepath: str, metadata: Dict[str, Any]) -> bool:
    """Embed generation metadata into a WAV file using ID3 tags.

    Args:
        filepath: Path to the WAV file
        metadata: Dictionary of generation parameters

    Returns:
        True if successful, False otherwise
    """
    try:
        from mutagen.wave import WAVE
        from mutagen.id3 import ID3, TXXX, COMM

        audio = WAVE(filepath)

        # Add ID3 tag if not present
        if audio.tags is None:
            audio.add_tags()

        # Store full metadata as JSON in a custom frame
        audio.tags.add(TXXX(encoding=3, desc=f"{METADATA_PREFIX}JSON", text=json.dumps(metadata)))

        # Store caption as comment
        if "caption" in metadata:
            audio.tags.add(COMM(encoding=3, lang='eng', desc='desc', text=metadata["caption"]))

        audio.save()
        logger.debug(f"[audio_metadata] Embedded metadata in {filepath}")
        return True

    except Exception as e:
        logger.warning(f"[audio_metadata] Failed to embed metadata in {filepath}: {e}")
        return False


def embed_metadata(filepath: str, metadata: Dict[str, Any]) -> bool:
    """Embed generation metadata into an audio file.

    Supports FLAC and WAV formats.

    Args:
        filepath: Path to the audio file
        metadata: Dictionary of generation parameters

    Returns:
        True if successful, False otherwise
    """
    path = Path(filepath)
    ext = path.suffix.lower()

    if ext == ".flac":
        return embed_metadata_flac(filepath, metadata)
    elif ext == ".wav":
        return embed_metadata_wav(filepath, metadata)
    else:
        logger.debug(f"[audio_metadata] Metadata embedding not supported for {ext}")
        return False


def extract_metadata_flac(filepath: str) -> Optional[Dict[str, Any]]:
    """Extract generation metadata from a FLAC file.

    Args:
        filepath: Path to the FLAC file

    Returns:
        Dictionary of generation parameters, or None if not found
    """
    try:
        from mutagen.flac import FLAC

        audio = FLAC(filepath)

        # Try to get the full JSON metadata
        json_key = f"{METADATA_PREFIX}JSON"
        if json_key in audio:
            return json.loads(audio[json_key][0])

        # Fall back to individual fields
        metadata = {}

        if "DESCRIPTION" in audio:
            metadata["caption"] = audio["DESCRIPTION"][0]
        if "LYRICS" in audio:
            metadata["lyrics"] = audio["LYRICS"][0]
        if "BPM" in audio:
            try:
                metadata["bpm"] = int(audio["BPM"][0])
            except ValueError:
                metadata["bpm"] = audio["BPM"][0]
        if "KEY" in audio:
            metadata["keyscale"] = audio["KEY"][0]
        if f"{METADATA_PREFIX}DURATION" in audio:
            try:
                metadata["duration"] = int(audio[f"{METADATA_PREFIX}DURATION"][0])
            except ValueError:
                metadata["duration"] = float(audio[f"{METADATA_PREFIX}DURATION"][0])
        if f"{METADATA_PREFIX}LANGUAGE" in audio:
            metadata["vocal_language"] = audio[f"{METADATA_PREFIX}LANGUAGE"][0]
        if f"{METADATA_PREFIX}INSTRUMENTAL" in audio:
            metadata["instrumental"] = audio[f"{METADATA_PREFIX}INSTRUMENTAL"][0].lower() == "true"
        if f"{METADATA_PREFIX}SEED" in audio:
            try:
                metadata["seed"] = int(audio[f"{METADATA_PREFIX}SEED"][0])
            except ValueError:
                pass
        if f"{METADATA_PREFIX}STAGES" in audio:
            try:
                metadata["stages"] = json.loads(audio[f"{METADATA_PREFIX}STAGES"][0])
            except json.JSONDecodeError:
                pass

        return metadata if metadata else None

    except Exception as e:
        logger.warning(f"[audio_metadata] Failed to extract metadata from {filepath}: {e}")
        return None


def extract_metadata_wav(filepath: str) -> Optional[Dict[str, Any]]:
    """Extract generation metadata from a WAV file.

    Args:
        filepath: Path to the WAV file

    Returns:
        Dictionary of generation parameters, or None if not found
    """
    try:
        from mutagen.wave import WAVE
        from mutagen.id3 import TXXX

        audio = WAVE(filepath)

        if audio.tags is None:
            return None

        # Look for our custom TXXX frame
        for frame in audio.tags.values():
            if isinstance(frame, TXXX) and frame.desc == f"{METADATA_PREFIX}JSON":
                return json.loads(frame.text[0])

        return None

    except Exception as e:
        logger.warning(f"[audio_metadata] Failed to extract metadata from {filepath}: {e}")
        return None


def extract_metadata_mp3(filepath: str) -> Optional[Dict[str, Any]]:
    """Extract generation metadata from an MP3 file.

    Args:
        filepath: Path to the MP3 file

    Returns:
        Dictionary of generation parameters, or None if not found
    """
    try:
        from mutagen.mp3 import MP3
        from mutagen.id3 import TXXX

        audio = MP3(filepath)

        if audio.tags is None:
            return None

        # Look for our custom TXXX frame
        for frame in audio.tags.values():
            if isinstance(frame, TXXX) and frame.desc == f"{METADATA_PREFIX}JSON":
                return json.loads(frame.text[0])

        return None

    except Exception as e:
        logger.warning(f"[audio_metadata] Failed to extract metadata from {filepath}: {e}")
        return None


def extract_metadata(filepath: str) -> Optional[Dict[str, Any]]:
    """Extract generation metadata from an audio file.

    Supports FLAC, WAV, and MP3 formats.

    Args:
        filepath: Path to the audio file

    Returns:
        Dictionary of generation parameters, or None if not found/not supported
    """
    path = Path(filepath)
    ext = path.suffix.lower()

    if ext == ".flac":
        return extract_metadata_flac(filepath)
    elif ext == ".wav":
        return extract_metadata_wav(filepath)
    elif ext == ".mp3":
        return extract_metadata_mp3(filepath)
    else:
        logger.debug(f"[audio_metadata] Metadata extraction not supported for {ext}")
        return None


def build_pipeline_metadata(
    req,  # PipelineRequest
    stages: List[Dict[str, Any]],
    time_costs: Dict[str, float],
) -> Dict[str, Any]:
    """Build metadata dictionary from a pipeline request and results.

    Args:
        req: The PipelineRequest object
        stages: List of stage configs with their actual parameters
        time_costs: Dictionary of timing information

    Returns:
        Dictionary ready for embedding in audio
    """
    return {
        "generator": "ACE-Step 1.5 Pipeline",
        "caption": req.caption,
        "lyrics": req.lyrics,
        "instrumental": req.instrumental,
        "vocal_language": req.vocal_language,
        "bpm": req.bpm,
        "keyscale": req.keyscale,
        "timesignature": req.timesignature,
        "duration": req.duration,
        "batch_size": req.batch_size,
        "stages": [
            {
                "type": s.type,
                "model": s.model,
                "steps": s.steps,
                "shift": s.shift,
                "denoise": s.denoise,
                "seed": s.seed,
                "infer_method": s.infer_method,
                "guidance_scale": s.guidance_scale,
                "input_stage": s.input_stage,
            }
            for s in req.stages
        ],
        "time_costs": time_costs,
    }
