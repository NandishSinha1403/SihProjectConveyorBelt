"""Runtime-tunable settings.

Only knobs that are safe to change mid-stream are exposed. Anything requiring a
pipeline rebuild (the detector backend, the model file) stays in .env, so the
running state can never disagree with what the operator sees.
"""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..config import settings
from ..pipeline.session import manager

router = APIRouter(prefix="/api/settings", tags=["settings"])


class RuntimeSettings(BaseModel):
    enable_clahe: bool | None = None
    conf_threshold: float | None = Field(default=None, ge=0.01, le=0.99)
    iou_threshold: float | None = Field(default=None, ge=0.01, le=0.99)
    max_stream_fps: int | None = Field(default=None, ge=1, le=60)
    confirm_frames: int | None = Field(default=None, ge=1, le=60)


def _current() -> dict:
    return {
        "enable_clahe": settings.enable_clahe,
        "conf_threshold": settings.conf_threshold,
        "iou_threshold": settings.iou_threshold,
        "max_stream_fps": settings.max_stream_fps,
        "confirm_frames": settings.confirm_frames,
        "detector": settings.detector,
        "model_path": settings.model_path,
        "img_size": settings.img_size,
        "device": settings.device,
    }


@router.get("")
async def read_settings() -> dict:
    return _current()


@router.patch("")
async def update_settings(patch: RuntimeSettings) -> dict:
    for key, value in patch.model_dump(exclude_none=True).items():
        setattr(settings, key, value)

    # confirm_frames is read once when the engine is built, so push it through
    # to the live session rather than waiting for the next restart.
    session = manager.session
    if session is not None and patch.confirm_frames is not None:
        session.incidents._confirm_frames = patch.confirm_frames

    return _current()
