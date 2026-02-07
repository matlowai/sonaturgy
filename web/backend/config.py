"""Environment variable configuration for the web backend."""

import os

HOST = os.getenv("ACE_HOST", "0.0.0.0")
PORT = int(os.getenv("ACE_PORT", "8000"))
PROJECT_ROOT = os.getenv(
    "ACE_PROJECT_ROOT",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")),
)
TEMP_DIR = os.getenv("ACE_TEMP_DIR", os.path.join(PROJECT_ROOT, "web_tmp"))
AUDIO_TTL_HOURS = int(os.getenv("ACE_AUDIO_TTL_HOURS", "24"))
LATENT_DIR = os.getenv("ACE_LATENT_DIR", os.path.join(TEMP_DIR, "latents"))
LATENT_TTL_HOURS = int(os.getenv("ACE_LATENT_TTL_HOURS", "24"))
CORS_ORIGINS = os.getenv("ACE_CORS_ORIGINS", "http://localhost:3000").split(",")
