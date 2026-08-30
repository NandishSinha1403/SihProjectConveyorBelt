"""Stream control and MJPEG delivery."""
from __future__ import annotations

import asyncio
import logging
import time

import cv2
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..config import settings
from ..pipeline.annotate import placeholder
from ..pipeline.capture import LatestFrame
from ..pipeline.session import manager
from ..sources import SourceError

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/stream", tags=["stream"])

BOUNDARY = "frame"
JPEG_QUALITY = 80


class StartRequest(BaseModel):
    uri: str


@router.post("/start")
async def start_stream(req: StartRequest) -> dict:
    """Begin processing a source. Blocking work runs off the event loop."""
    try:
        session = await asyncio.to_thread(manager.start, req.uri)
    except SourceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        log.exception("Failed to start stream")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return session.status()


@router.post("/stop")
async def stop_stream() -> dict:
    await asyncio.to_thread(manager.stop)
    return manager.status()


@router.get("/status")
async def stream_status() -> dict:
    return manager.status()


def _encode(image) -> bytes | None:
    ok, buf = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY])
    return buf.tobytes() if ok else None


def _part(payload: bytes) -> bytes:
    return (b"--" + BOUNDARY.encode() + b"\r\n"
            b"Content-Type: image/jpeg\r\n"
            b"Content-Length: " + str(len(payload)).encode() + b"\r\n\r\n"
            + payload + b"\r\n")


async def _mjpeg(annotated: bool):
    """Yield an endless multipart JPEG stream from the current session.

    Each client reads the shared single-frame slot independently, so a slow
    client falls behind by dropping frames rather than by building a backlog --
    the same policy the inference worker uses, for the same reason.
    """
    interval = 1.0 / max(1, settings.max_stream_fps)
    last_id = -1
    idle_sent = 0.0

    while True:
        session = manager.session
        slot: LatestFrame | None = None
        if session is not None and session.running:
            slot = session.annotated if annotated else session.raw

        if slot is None:
            # Nothing is streaming: emit a low-rate placeholder so the browser's
            # <img> stays connected and recovers instantly when a stream starts.
            now = time.monotonic()
            if now - idle_sent >= 1.0:
                idle_sent = now
                data = await asyncio.to_thread(_encode, placeholder())
                if data:
                    yield _part(data)
            await asyncio.sleep(0.2)
            last_id = -1
            continue

        frame = await asyncio.to_thread(slot.wait_for_new, last_id, 1.0)
        if frame is None:
            await asyncio.sleep(0.05)
            continue

        last_id = frame.id
        data = await asyncio.to_thread(_encode, frame.image)
        if data:
            yield _part(data)
        await asyncio.sleep(interval)


@router.get("/mjpeg")
async def mjpeg(annotate: int = Query(1, ge=0, le=1)) -> StreamingResponse:
    """Live MJPEG of the current stream.

    ``?annotate=0`` serves clean frames, for clients that prefer to draw the
    boxes themselves on a canvas from the WebSocket detection events.
    """
    return StreamingResponse(
        _mjpeg(annotated=bool(annotate)),
        media_type=f"multipart/x-mixed-replace; boundary={BOUNDARY}",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Pragma": "no-cache",
            "Connection": "close",
            "X-Accel-Buffering": "no",   # don't let a proxy buffer the stream
        },
    )


@router.get("/snapshot")
async def snapshot(annotate: int = Query(1, ge=0, le=1)):
    """Single current frame, for the download button and for report embedding."""
    from fastapi.responses import Response

    session = manager.session
    if session is None or not session.running:
        raise HTTPException(status_code=409, detail="No active stream")

    slot = session.annotated if annotate else session.raw
    frame = slot.get()
    if frame is None:
        raise HTTPException(status_code=409, detail="No frame available yet")

    data = await asyncio.to_thread(_encode, frame.image)
    if data is None:
        raise HTTPException(status_code=500, detail="Failed to encode frame")
    filename = f"belt_frame_{frame.id}.jpg"
    return Response(content=data, media_type="image/jpeg",
                    headers={"Content-Disposition": f'inline; filename="{filename}"'})
