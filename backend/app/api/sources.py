"""Source management: upload test videos, list them, discover cameras."""
from __future__ import annotations

import logging
import re
import shutil
import uuid
from pathlib import Path

import cv2
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from ..config import settings
from ..sources import probe_devices

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/sources", tags=["sources"])

ALLOWED_SUFFIXES = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}
MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB
_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


class VideoInfo(BaseModel):
    name: str
    uri: str
    size_bytes: int
    duration: float
    fps: float
    width: int
    height: int
    frame_count: int


def _probe_video(path: Path) -> dict:
    cap = cv2.VideoCapture(str(path))
    try:
        if not cap.isOpened():
            return {"duration": 0.0, "fps": 0.0, "width": 0, "height": 0,
                    "frame_count": 0}
        fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        return {
            "duration": round(frames / fps, 2) if fps > 0 else 0.0,
            "fps": round(fps, 2),
            "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
            "frame_count": frames,
        }
    finally:
        cap.release()


def _describe(path: Path) -> VideoInfo:
    return VideoInfo(
        name=path.name,
        uri=f"file://media/uploads/{path.name}",
        size_bytes=path.stat().st_size,
        **_probe_video(path),
    )


@router.get("/videos", response_model=list[VideoInfo])
async def list_videos() -> list[VideoInfo]:
    """Test videos already on the server, newest first."""
    files = [p for p in settings.uploads_dir.iterdir()
             if p.is_file() and p.suffix.lower() in ALLOWED_SUFFIXES]
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return await run_in_threadpool(lambda: [_describe(p) for p in files])


@router.post("/upload", response_model=VideoInfo, status_code=201)
async def upload_video(file: UploadFile = File(...)) -> VideoInfo:
    """Store a test video on the server.

    Note what this endpoint does *not* do: it never decodes the video and never
    hands it to the detector. The file simply lands on disk. Detection only
    begins when a stream is started against it, and then strictly one
    wall-clock-paced frame at a time -- the same contract as a live camera.
    """
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported video format {suffix!r}. "
                   f"Allowed: {', '.join(sorted(ALLOWED_SUFFIXES))}",
        )

    stem = _SAFE.sub("_", Path(file.filename or "video").stem)[:60] or "video"
    target = settings.uploads_dir / f"{stem}_{uuid.uuid4().hex[:8]}{suffix}"

    written = 0
    try:
        with target.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413,
                                        detail="Video exceeds the 2 GB limit")
                out.write(chunk)
    except HTTPException:
        target.unlink(missing_ok=True)
        raise
    except Exception as exc:  # noqa: BLE001
        target.unlink(missing_ok=True)
        log.exception("Upload failed")
        raise HTTPException(status_code=500, detail="Upload failed") from exc
    finally:
        await file.close()

    info = await run_in_threadpool(_describe, target)
    if info.frame_count == 0 and info.duration == 0.0:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=400,
                            detail="File could not be decoded as a video")

    log.info("Stored upload %s (%.1f MB, %.1fs)",
             target.name, written / 1e6, info.duration)
    return info


@router.delete("/videos/{name}", status_code=204)
async def delete_video(name: str) -> None:
    path = (settings.uploads_dir / name).resolve()
    if not path.is_relative_to(settings.uploads_dir.resolve()) or not path.is_file():
        raise HTTPException(status_code=404, detail="Video not found")
    path.unlink()


@router.get("/devices")
async def list_devices() -> list[dict]:
    """Cameras attached to this machine.

    Probing opens each index in turn, which is slow enough to matter, so it runs
    off the event loop.
    """
    return await run_in_threadpool(probe_devices)


@router.get("/thumbnail/{name}")
async def thumbnail(name: str):
    """First decodable frame of an uploaded video, as a JPEG."""
    from fastapi.responses import Response

    path = (settings.uploads_dir / name).resolve()
    if not path.is_relative_to(settings.uploads_dir.resolve()) or not path.is_file():
        raise HTTPException(status_code=404, detail="Video not found")

    def grab() -> bytes | None:
        cap = cv2.VideoCapture(str(path))
        try:
            ok, frame = cap.read()
            if not ok:
                return None
            h, w = frame.shape[:2]
            scale = 320 / max(w, 1)
            if scale < 1:
                frame = cv2.resize(frame, (320, max(1, int(h * scale))))
            ok, buf = cv2.imencode(".jpg", frame,
                                   [int(cv2.IMWRITE_JPEG_QUALITY), 75])
            return buf.tobytes() if ok else None
        finally:
            cap.release()

    data = await run_in_threadpool(grab)
    if data is None:
        raise HTTPException(status_code=404, detail="Could not decode a frame")
    return Response(content=data, media_type="image/jpeg",
                    headers={"Cache-Control": "public, max-age=3600"})
