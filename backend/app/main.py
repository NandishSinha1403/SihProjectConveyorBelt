"""FastAPI application entry point.

    uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import incidents, settings_api, sources, stream, ws
from .bus import bus
from .config import settings
from .pipeline.session import manager
from .pipeline.types import CLASS_LABELS
from .store.db import get_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)-28s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # The pipeline threads publish from outside the event loop, so the bus needs
    # a handle on it to marshal messages across.
    bus.bind_loop(asyncio.get_running_loop())
    get_db()
    log.info("Conveyor Belt Monitor ready (detector=%s)", settings.detector)

    if settings.source_uri:
        # A configured SOURCE_URI means "this deployment watches this camera" --
        # start it automatically so a restart resumes monitoring unattended.
        try:
            await asyncio.to_thread(manager.start, settings.source_uri)
        except Exception as exc:  # noqa: BLE001
            log.error("Could not auto-start %s: %s", settings.source_uri, exc)

    yield

    await asyncio.to_thread(manager.stop)
    get_db().close()
    log.info("Shutdown complete")


app = FastAPI(
    title="Intelligent Conveyor Belt Health Monitor",
    description=(
        "Real-time AI vision monitoring for conveyor belt damage and joint "
        "rupture in iron ore mining."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sources.router)
app.include_router(stream.router)
app.include_router(incidents.router)
app.include_router(settings_api.router)
app.include_router(ws.router)


@app.get("/api/health", tags=["meta"])
async def health() -> dict:
    return {
        "status": "ok",
        "detector": settings.detector,
        "classes": CLASS_LABELS,
        "stream": manager.status(),
        "ws_clients": bus.subscriber_count,
    }
