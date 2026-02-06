"""Prompt Library storage service using JSON file."""

import os
import json
import uuid
from datetime import datetime
from typing import List, Optional, Dict, Any
from pathlib import Path
from threading import Lock

from loguru import logger

from web.backend.schemas.prompt_library import (
    PromptEntry,
    SavePromptRequest,
    UpdatePromptRequest,
    GENRES,
    MOODS,
    TAGS,
)


class PromptLibrary:
    """JSON-based prompt library storage."""

    def __init__(self, storage_path: Optional[str] = None):
        """Initialize prompt library.

        Args:
            storage_path: Path to JSON storage file. Defaults to ~/.acestep/prompts.json
        """
        if storage_path is None:
            home = Path.home()
            storage_dir = home / ".acestep"
            storage_dir.mkdir(exist_ok=True)
            storage_path = str(storage_dir / "prompts.json")

        self.storage_path = storage_path
        self._lock = Lock()
        self._prompts: Dict[str, PromptEntry] = {}
        self._load()

    def _load(self):
        """Load prompts from disk."""
        if os.path.exists(self.storage_path):
            try:
                with open(self.storage_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for p in data.get("prompts", []):
                        entry = PromptEntry(**p)
                        self._prompts[entry.id] = entry
                logger.info(f"[PromptLibrary] Loaded {len(self._prompts)} prompts from {self.storage_path}")
            except Exception as e:
                logger.warning(f"[PromptLibrary] Failed to load prompts: {e}")
                self._prompts = {}
        else:
            logger.info(f"[PromptLibrary] No existing prompts file at {self.storage_path}")

    def _save(self):
        """Save prompts to disk."""
        try:
            data = {
                "version": 1,
                "prompts": [p.model_dump() for p in self._prompts.values()],
            }
            with open(self.storage_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            logger.debug(f"[PromptLibrary] Saved {len(self._prompts)} prompts")
        except Exception as e:
            logger.error(f"[PromptLibrary] Failed to save prompts: {e}")

    def list_prompts(
        self,
        genres: Optional[List[str]] = None,
        tags: Optional[List[str]] = None,
        mood: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[List[PromptEntry], int]:
        """List prompts with optional filtering.

        Args:
            genres: Filter by genres (any match)
            tags: Filter by tags (any match)
            mood: Filter by mood
            search: Search in name, caption, lyrics
            limit: Max results
            offset: Pagination offset

        Returns:
            Tuple of (prompts, total_count)
        """
        with self._lock:
            results = list(self._prompts.values())

        # Filter by genres
        if genres:
            genres_lower = [g.lower() for g in genres]
            results = [
                p for p in results
                if any(g.lower() in genres_lower for g in p.genres)
            ]

        # Filter by tags
        if tags:
            tags_lower = [t.lower() for t in tags]
            results = [
                p for p in results
                if any(t.lower() in tags_lower for t in p.tags)
            ]

        # Filter by mood
        if mood:
            mood_lower = mood.lower()
            results = [p for p in results if p.mood.lower() == mood_lower]

        # Search
        if search:
            search_lower = search.lower()
            results = [
                p for p in results
                if search_lower in p.name.lower()
                or search_lower in p.caption.lower()
                or search_lower in p.lyrics.lower()
            ]

        # Sort by updated_at descending
        results.sort(key=lambda p: p.updated_at, reverse=True)

        total = len(results)
        results = results[offset:offset + limit]

        return results, total

    def get_prompt(self, prompt_id: str) -> Optional[PromptEntry]:
        """Get a single prompt by ID."""
        with self._lock:
            return self._prompts.get(prompt_id)

    def save_prompt(self, req: SavePromptRequest) -> PromptEntry:
        """Save a new prompt.

        Args:
            req: Save request with prompt data

        Returns:
            Created prompt entry
        """
        now = datetime.utcnow().isoformat() + "Z"
        prompt_id = uuid.uuid4().hex[:12]

        entry = PromptEntry(
            id=prompt_id,
            name=req.name,
            created_at=now,
            updated_at=now,
            caption=req.caption,
            lyrics=req.lyrics,
            instrumental=req.instrumental,
            vocal_language=req.vocal_language,
            bpm=req.bpm,
            keyscale=req.keyscale,
            timesignature=req.timesignature,
            duration=req.duration,
            genres=req.genres,
            tags=req.tags,
            mood=req.mood,
            inference_steps=req.inference_steps,
            guidance_scale=req.guidance_scale,
            shift=req.shift,
            source_audio_id=req.source_audio_id,
            notes=req.notes,
        )

        with self._lock:
            self._prompts[prompt_id] = entry
            self._save()

        logger.info(f"[PromptLibrary] Saved prompt '{req.name}' with ID {prompt_id}")
        return entry

    def update_prompt(self, prompt_id: str, req: UpdatePromptRequest) -> Optional[PromptEntry]:
        """Update an existing prompt.

        Args:
            prompt_id: ID of prompt to update
            req: Update request with fields to change

        Returns:
            Updated prompt entry, or None if not found
        """
        with self._lock:
            if prompt_id not in self._prompts:
                return None

            entry = self._prompts[prompt_id]
            update_data = req.model_dump(exclude_unset=True)

            # Apply updates
            for key, value in update_data.items():
                if value is not None:
                    setattr(entry, key, value)

            entry.updated_at = datetime.utcnow().isoformat() + "Z"
            self._save()

        logger.info(f"[PromptLibrary] Updated prompt {prompt_id}")
        return entry

    def delete_prompt(self, prompt_id: str) -> bool:
        """Delete a prompt.

        Args:
            prompt_id: ID of prompt to delete

        Returns:
            True if deleted, False if not found
        """
        with self._lock:
            if prompt_id not in self._prompts:
                return False

            del self._prompts[prompt_id]
            self._save()

        logger.info(f"[PromptLibrary] Deleted prompt {prompt_id}")
        return True

    def get_taxonomy(self) -> Dict[str, List[str]]:
        """Get available genres, tags, and moods.

        Returns dict with:
        - genres: List of genre names
        - tags: List of tag names
        - moods: List of mood names
        - user_genres: Genres used in saved prompts
        - user_tags: Tags used in saved prompts
        """
        with self._lock:
            user_genres = set()
            user_tags = set()
            for p in self._prompts.values():
                user_genres.update(p.genres)
                user_tags.update(p.tags)

        return {
            "genres": GENRES,
            "tags": TAGS,
            "moods": MOODS,
            "user_genres": sorted(user_genres),
            "user_tags": sorted(user_tags),
        }

    def import_from_metadata(self, metadata: Dict[str, Any], name: str) -> PromptEntry:
        """Import a prompt from audio file metadata.

        Args:
            metadata: Metadata dict extracted from audio
            name: Name for the prompt

        Returns:
            Created prompt entry
        """
        req = SavePromptRequest(
            name=name,
            caption=metadata.get("caption", ""),
            lyrics=metadata.get("lyrics", ""),
            instrumental=metadata.get("instrumental", False),
            vocal_language=metadata.get("vocal_language", "unknown"),
            bpm=metadata.get("bpm"),
            keyscale=metadata.get("keyscale", ""),
            timesignature=metadata.get("timesignature", ""),
            duration=metadata.get("duration", 30),
            inference_steps=metadata.get("inference_steps"),
            guidance_scale=metadata.get("guidance_scale"),
            shift=metadata.get("shift"),
            notes=f"Imported from audio file",
        )
        return self.save_prompt(req)


# Singleton instance
prompt_library = PromptLibrary()
