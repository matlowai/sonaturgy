"""Prompt Library schemas for storing and retrieving generation prompts."""

from typing import Optional, List
from pydantic import BaseModel, Field
from datetime import datetime


class PromptEntry(BaseModel):
    """A saved prompt with all generation parameters."""
    id: str
    name: str
    created_at: str  # ISO format
    updated_at: str

    # Core prompt
    caption: str
    lyrics: str = ""
    instrumental: bool = False
    vocal_language: str = "unknown"

    # Musical parameters
    bpm: Optional[int] = None
    keyscale: str = ""
    timesignature: str = ""
    duration: int = 30

    # Tags and genres for filtering
    genres: List[str] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    mood: str = ""

    # Optional: generation settings
    inference_steps: Optional[int] = None
    guidance_scale: Optional[float] = None
    shift: Optional[float] = None

    # Source info (if imported from audio)
    source_audio_id: Optional[str] = None
    notes: str = ""


class SavePromptRequest(BaseModel):
    """Request to save a new prompt."""
    name: str
    caption: str
    lyrics: str = ""
    instrumental: bool = False
    vocal_language: str = "unknown"

    bpm: Optional[int] = None
    keyscale: str = ""
    timesignature: str = ""
    duration: int = 30

    genres: List[str] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    mood: str = ""

    inference_steps: Optional[int] = None
    guidance_scale: Optional[float] = None
    shift: Optional[float] = None

    source_audio_id: Optional[str] = None
    notes: str = ""


class UpdatePromptRequest(BaseModel):
    """Request to update an existing prompt."""
    name: Optional[str] = None
    caption: Optional[str] = None
    lyrics: Optional[str] = None
    instrumental: Optional[bool] = None
    vocal_language: Optional[str] = None

    bpm: Optional[int] = None
    keyscale: Optional[str] = None
    timesignature: Optional[str] = None
    duration: Optional[int] = None

    genres: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    mood: Optional[str] = None

    notes: Optional[str] = None


class PromptListResponse(BaseModel):
    """Response with list of prompts."""
    prompts: List[PromptEntry]
    total: int


class GenreTagsResponse(BaseModel):
    """Available genres and tags for filtering."""
    genres: List[str]
    tags: List[str]
    moods: List[str]


# Pre-defined genre/mood/tag taxonomy
GENRES = [
    "Pop", "Rock", "Hip-Hop", "R&B", "Jazz", "Classical", "Electronic",
    "Country", "Folk", "Blues", "Reggae", "Latin", "Metal", "Punk",
    "Indie", "Soul", "Funk", "Disco", "House", "Techno", "Ambient",
    "Lo-Fi", "Trap", "Drill", "K-Pop", "J-Pop", "Afrobeat", "World",
]

MOODS = [
    "Happy", "Sad", "Energetic", "Calm", "Aggressive", "Romantic",
    "Melancholic", "Uplifting", "Dark", "Dreamy", "Nostalgic",
    "Epic", "Chill", "Intense", "Mysterious", "Playful",
]

TAGS = [
    "Acoustic", "Electric", "Orchestral", "Synth", "Vocal", "Instrumental",
    "Fast", "Slow", "Groovy", "Atmospheric", "Minimalist", "Complex",
    "Catchy", "Experimental", "Cinematic", "Dance", "Workout", "Study",
    "Sleep", "Party", "Road Trip", "Summer", "Winter", "Morning", "Night",
]
