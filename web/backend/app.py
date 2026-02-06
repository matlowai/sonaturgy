"""FastAPI application factory."""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from web.backend import config
from web.backend.services.task_manager import task_manager
from web.backend.services.audio_store import audio_store
from web.backend.routers import (
    service,
    generation,
    audio,
    lora,
    training,
    models,
    examples,
    prompts,
    ws,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task_manager.set_event_loop(asyncio.get_running_loop())
    audio_store.start_cleanup()
    yield
    task_manager.shutdown()
    audio_store.stop_cleanup()


def create_app() -> FastAPI:
    app = FastAPI(
        title="ACE-Step 1.5 API",
        version="1.5.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(service.router, prefix="/api/service", tags=["service"])
    app.include_router(models.router, prefix="/api/models", tags=["models"])
    app.include_router(generation.router, prefix="/api/generation", tags=["generation"])
    app.include_router(audio.router, prefix="/api/audio", tags=["audio"])
    app.include_router(lora.router, prefix="/api/lora", tags=["lora"])
    app.include_router(training.router, prefix="/api/training", tags=["training"])
    app.include_router(examples.router, prefix="/api/examples", tags=["examples"])
    app.include_router(prompts.router, prefix="/api/prompts", tags=["prompts"])
    app.include_router(ws.router, prefix="/api", tags=["websocket"])

    return app
