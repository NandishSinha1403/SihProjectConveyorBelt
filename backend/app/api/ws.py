"""WebSocket fan-out of pipeline events.

Message envelope: ``{"type": <topic>, "data": {...}}``.

Topics:
    stream.status     source/detector state, FPS, frames skipped
    frame             per-frame detections (throttled to ~10 Hz)
    incident.opened   a defect was confirmed over several frames
    incident.updated  a confirmed defect escalated in severity
    incident.closed   the defect left the field of view
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..bus import bus
from ..pipeline.session import manager

log = logging.getLogger(__name__)
router = APIRouter(tags=["ws"])

# If a client stops reading, its queue fills and the bus drops that client's
# oldest messages. This keeps one slow browser tab from stalling the pipeline.
SEND_TIMEOUT = 5.0


@router.websocket("/ws/events")
async def events(websocket: WebSocket) -> None:
    await websocket.accept()
    queue = bus.subscribe()
    log.debug("WebSocket connected (%d subscribers)", bus.subscriber_count)

    try:
        # Send current state immediately so a client that connects mid-stream
        # renders correctly instead of waiting for the next event.
        await websocket.send_json({"type": "stream.status", "data": manager.status()})

        while True:
            message = await queue.get()
            await asyncio.wait_for(websocket.send_json(message), timeout=SEND_TIMEOUT)
    except WebSocketDisconnect:
        pass
    except asyncio.TimeoutError:
        log.warning("WebSocket send timed out; dropping client")
    except Exception:  # noqa: BLE001
        log.debug("WebSocket closed with error", exc_info=True)
    finally:
        bus.unsubscribe(queue)
        log.debug("WebSocket disconnected (%d subscribers)", bus.subscriber_count)
